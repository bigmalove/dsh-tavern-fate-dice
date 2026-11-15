import { createHash } from 'node:crypto'
import {
  DICE_RULES,
  DIFFICULTY_LABELS,
  DIFFICULTY_TIERS,
  OUTCOME_LABELS,
  OUTCOME_TIERS,
  RULE_LABELS,
  RULE_TARGETS,
  SKILL_BUDGET_SPECS,
  normalizeDifficulty,
  normalizeRule,
  rollCheck,
  rollExpression
} from './dice-engine.js'
import {
  SKILL_CATEGORIES,
  buildProfileDigest,
  collectCharacterMaterial,
  normalizeCharacterProfile,
  refreshProfileWithBackgroundLlm,
  summarizeMvuVariables
} from './auto-profiler.js'
import { buildDamperJudgeQuestions, resolveCheckFromDamperContext } from './damper-bridge.js'
import { judgeActionDifficulty } from './difficulty-judge.js'
import { buildTurnInjection, extractContextSnippet } from './prompt-builder.js'

export const name = 'dsh-tavern-fate-dice'
export const inject = ['tavern']
export const PLUGIN_VERSION = '2.0.0'

const TONE_BIAS_BONUS = Object.freeze({ balanced: 0, heroic: 1, gritty: -1 })
const SENSITIVITY_VALUES = Object.freeze(['strict', 'normal', 'rare'])
const ANIMATION_VALUES = Object.freeze(['bounce', 'compact', 'none'])
const TONE_VALUES = Object.freeze(Object.keys(TONE_BIAS_BONUS))
const GLOBAL_GAME_ID = '__fate_dice_global__'
const MAX_CACHE_ENTRIES = 60

export const DEFAULT_GLOBAL_SETTINGS = Object.freeze({
  enabled: true,
  autoCheck: true,
  damperLinkage: true,
  allowHeuristicFallback: false,
  rule: '2d6',
  sensitivity: 'normal',
  toneBias: 'balanced',
  allowHidden: true,
  animation: 'bounce'
})

function hashText(text) {
  return createHash('sha1').update(String(text || '').trim()).digest('hex').slice(0, 16)
}

function toInt(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.trunc(num) : fallback
}

function emptySummary() {
  return {
    total: 0,
    counts: { critical: 0, success: 0, costly: 0, failure: 0, fumble: 0 },
    recent: []
  }
}

function appendToSummary(prev, roll, turn, damperSynced = false) {
  const base = prev && typeof prev === 'object' ? prev : emptySummary()
  if (!roll || typeof roll !== 'object') return base
  const counts = { ...emptySummary().counts, ...(base.counts || {}) }
  if (Object.hasOwn(counts, roll.tier)) counts[roll.tier] += 1
  const entry = {
    turn: Number(turn) || 0,
    rule: roll.rule,
    check: roll.check,
    skillId: roll.skillId || 'general',
    skillBonus: Number(roll.skillBonus) || 0,
    difficulty: roll.difficulty,
    difficultyLabel: roll.difficultyLabel,
    total: roll.total,
    target: roll.target,
    tier: roll.tier,
    tierLabel: roll.tierLabel,
    hidden: Boolean(roll.hidden),
    damperSynced: Boolean(damperSynced || roll.damper?.applied),
    damper: Boolean(damperSynced || roll.damper?.applied),
    rolledAt: roll.rolledAt || Date.now()
  }
  const recent = [entry, ...(Array.isArray(base.recent) ? base.recent : []).filter(item => item.turn !== entry.turn)].slice(0, 10)
  return {
    total: (Number(base.total) || 0) + 1,
    counts,
    recent
  }
}

function sanitizeSettings(input = {}, fallback = DEFAULT_GLOBAL_SETTINGS) {
  const base = { ...DEFAULT_GLOBAL_SETTINGS, ...(fallback || {}) }
  const next = { ...base }
  const source = input && typeof input === 'object' ? input : {}
  for (const key of ['enabled', 'autoCheck', 'damperLinkage', 'allowHidden', 'allowHeuristicFallback']) {
    if (source[key] !== undefined) next[key] = Boolean(source[key])
  }
  if (source.autoHidden !== undefined && source.allowHidden === undefined) next.allowHidden = Boolean(source.autoHidden)
  if (source.heuristicFallback !== undefined && source.allowHeuristicFallback === undefined) {
    next.allowHeuristicFallback = Boolean(source.heuristicFallback)
  }
  if (source.rule !== undefined) next.rule = normalizeRule(source.rule)
  if (source.sensitivity !== undefined && SENSITIVITY_VALUES.includes(source.sensitivity)) next.sensitivity = source.sensitivity
  if (source.animation !== undefined && ANIMATION_VALUES.includes(source.animation)) next.animation = source.animation
  if (source.toneBias !== undefined && TONE_VALUES.includes(source.toneBias)) next.toneBias = source.toneBias
  return next
}

function normalizeGlobalStore(raw) {
  const data = raw && typeof raw === 'object' ? raw : {}
  return {
    version: 3,
    settings: sanitizeSettings(data.settings, DEFAULT_GLOBAL_SETTINGS),
    updatedAt: toInt(data.updatedAt, Date.now())
  }
}

function normalizeGameState(raw, fallbackRule = '2d6') {
  const data = raw && typeof raw === 'object' ? raw : {}
  const config = data.config && typeof data.config === 'object' ? { ...data.config } : {}
  const rule = normalizeRule(config.rule || fallbackRule)
  return {
    version: 3,
    config,
    characterProfile: data.characterProfile && typeof data.characterProfile === 'object'
      ? normalizeCharacterProfile(data.characterProfile, rule)
      : normalizeCharacterProfile({}, rule),
    summary: data.summary && typeof data.summary === 'object' ? data.summary : emptySummary(),
    lastRoll: data.lastRoll && typeof data.lastRoll === 'object' ? data.lastRoll : null,
    lastTurn: toInt(data.lastTurn, 0),
    updatedAt: toInt(data.updatedAt, Date.now())
  }
}

export function apply(ctx) {
  const tavern = ctx?.tavern
  if (!tavern || typeof tavern !== 'object') return

  let runtimeLlm = null
  if (typeof ctx?.inject === 'function') {
    try {
      ctx.inject(['llm'], scoped => {
        runtimeLlm = scoped?.llm || null
        return () => { runtimeLlm = null }
      })
    } catch {}
  }

  const turnCacheByGame = new Map()
  const pendingByGame = new Map()
  const pendingProfileByGame = new Map()
  let globalCache = null
  let lastActiveGameId = ''

  async function readGlobal() {
    if (globalCache) return globalCache
    let raw = null
    try {
      if (typeof tavern.readPluginData === 'function') raw = await tavern.readPluginData()
      else if (typeof tavern.readGameData === 'function') raw = await tavern.readGameData({ gameId: GLOBAL_GAME_ID })
    } catch {
      raw = null
    }
    const data = raw && typeof raw === 'object' && raw.data !== undefined ? raw.data : raw
    if (!data || typeof data !== 'object' || !data.settings) {
      const fresh = normalizeGlobalStore({ settings: DEFAULT_GLOBAL_SETTINGS })
      await saveGlobal(fresh)
      return fresh
    }
    globalCache = normalizeGlobalStore(data)
    return globalCache
  }

  async function saveGlobal(store) {
    const payload = normalizeGlobalStore({ ...store, updatedAt: Date.now() })
    globalCache = payload
    try {
      if (typeof tavern.savePluginData === 'function') await tavern.savePluginData({ data: payload })
      else if (typeof tavern.saveGameData === 'function') await tavern.saveGameData({ gameId: GLOBAL_GAME_ID, data: payload })
    } catch {}
    return payload
  }

  async function readGame(gameId, fallbackRule = '2d6') {
    if (!gameId) return normalizeGameState(null, fallbackRule)
    let raw = null
    try {
      if (typeof tavern.readGameData === 'function') raw = await tavern.readGameData({ gameId })
    } catch {
      raw = null
    }
    return normalizeGameState(raw && raw.data !== undefined ? raw.data : raw, fallbackRule)
  }

  async function writeGame(gameId, data) {
    if (!gameId) return data
    const next = { ...data, updatedAt: Date.now() }
    try {
      if (typeof tavern.saveGameData === 'function') await tavern.saveGameData({ gameId, data: next })
    } catch {}
    return next
  }

  function effectiveSettings(globalStore, game) {
    return sanitizeSettings(
      { ...(globalStore?.settings || {}), ...(game?.config || {}) },
      globalStore?.settings || DEFAULT_GLOBAL_SETTINGS
    )
  }

  function profileOf(game, rule) {
    return normalizeCharacterProfile(game?.characterProfile || {}, normalizeRule(rule))
  }

  function buildContextSources(profile, material = null) {
    const src = material?.contextSources || {}
    return {
      playerName: String(src.playerName || profile?.characterName || ''),
      hasCard: Boolean(src.hasCard),
      cardName: String(src.cardName || ''),
      loreCount: toInt(src.loreCount, 0),
      mvuKeyCount: toInt(src.mvuKeyCount, Array.isArray(profile?.mvuHighlights) ? profile.mvuHighlights.length : 0),
      historyTurns: toInt(src.historyTurns, 0),
      backgroundModelReady: Boolean(runtimeLlm && typeof tavern.backgroundModel === 'function')
    }
  }

  async function readLatestContextAndVars(gameId, currentTurn) {
    const prevTurnNum = Math.max(1, Number(currentTurn) - 1)
    let turnSnap = null
    try {
      turnSnap = await tavern.getTurn?.({ gameId, turn: prevTurnNum })
    } catch {
      turnSnap = null
    }
    if (!turnSnap && prevTurnNum > 1) {
      try {
        turnSnap = await tavern.getTurn?.({ gameId, turn: 1 })
      } catch {
        turnSnap = null
      }
    }
    return {
      recentContext: extractContextSnippet(turnSnap),
      variables: turnSnap?.variables || null
    }
  }

  async function readDamperContext(gameId, turn) {
    if (typeof tavern.getDamperTurnContext !== 'function') return null
    let raw = null
    try {
      raw = await tavern.getDamperTurnContext({ gameId, turn })
    } catch {
      raw = null
    }
    if (!raw || typeof raw !== 'object') return null
    const context = raw.answers || raw.ruling || raw.explicitSceneShift !== undefined
      ? raw
      : (raw.data && typeof raw.data === 'object' ? raw.data : (raw.context && typeof raw.context === 'object' ? raw.context : raw))
    if (!context || typeof context !== 'object') return null
    if (!context.answers && !context.ruling && context.explicitSceneShift === undefined && !context.stateSnapshot) return null
    return context
  }

  function trimCache(gameId) {
    const keys = [...turnCacheByGame.keys()]
    if (keys.length <= MAX_CACHE_ENTRIES) return
    let removed = 0
    for (const key of keys) {
      if (removed >= keys.length - MAX_CACHE_ENTRIES) break
      if (key.startsWith(`${gameId}:`)) {
        turnCacheByGame.delete(key)
        removed += 1
      }
    }
  }

  function settingsForClient(settings) {
    return {
      sensitivity: settings.sensitivity,
      toneBias: settings.toneBias,
      autoHidden: settings.allowHidden,
      allowHidden: settings.allowHidden,
      damperLinkage: settings.damperLinkage,
      allowHeuristicFallback: Boolean(settings.allowHeuristicFallback),
      animation: settings.animation
    }
  }

  /**
   * 核心回合检定闭环：合并阻尼器单趟裁定 / 四源独立判定 → 真骰 → 配额反向同步 → 注入文本。
   */
  async function computeTurn({ gameId, turn, input, overrideSettings = null, force = false } = {}) {
    const cleanInput = String(input || '').trim()
    if (gameId) lastActiveGameId = gameId
    if (!gameId || !cleanInput) return { skipped: 'empty', injection: '' }

    const globalStore = await readGlobal()
    const game = await readGame(gameId, globalStore.settings.rule)
    const settings = sanitizeSettings(
      { ...effectiveSettings(globalStore, game), ...(overrideSettings || {}) },
      globalStore.settings
    )
    if (!settings.enabled || !settings.autoCheck) {
      await tavern.publishState?.({ gameId, name: 'live-roll', data: null }).catch(() => {})
      return { skipped: 'disabled', injection: '' }
    }

    const inputHash = hashText(cleanInput)
    const cacheKey = `${gameId}:${turn}:${inputHash}`
    if (!force) {
      const cached = turnCacheByGame.get(cacheKey)
      if (cached) return cached
    }

    const activeRule = normalizeRule(settings.rule)
    const characterProfile = profileOf(game, activeRule)
    const { recentContext, variables } = await readLatestContextAndVars(gameId, turn)
    const mvuNow = summarizeMvuVariables(variables)
    if (mvuNow.highlights?.length && !characterProfile.mvuHighlights?.length) {
      characterProfile.mvuHighlights = mvuNow.highlights.slice(0, 12)
    }

    let judged = null
    let damperUsed = false
    let setupRequiredReason = ''

    if (settings.damperLinkage) {
      const damperContext = await readDamperContext(gameId, turn)
      if (damperContext) {
        const bypassedCode = damperContext.outcome?.status === 'bypassed' ? String(damperContext.outcome.code || '') : ''
        const unconfiguredDamper = bypassedCode === 'DAMPER_NO_KEY' || bypassedCode === 'DAMPER_INVALID_CONFIG' || bypassedCode === 'DAMPER_AUTH_ERROR'
        if (unconfiguredDamper && !settings.allowHeuristicFallback) {
          setupRequiredReason = bypassedCode
        } else {
          damperUsed = true
          judged = resolveCheckFromDamperContext({
            damperContext,
            input: cleanInput,
            profile: characterProfile,
            rule: activeRule,
            sensitivity: settings.sensitivity,
            allowHidden: settings.allowHidden,
            damperLinkage: settings.damperLinkage
          })
        }
      }
    }

    if (!damperUsed && !setupRequiredReason) {
      let judgeReady = false
      let judgeReason = 'NOT_CONFIGURED'
      if (tavern?.capabilities?.decisionJudge && typeof tavern.decisionJudgeStatus === 'function') {
        try {
          const st = await tavern.decisionJudgeStatus()
          judgeReady = Boolean(st?.available)
          if (!judgeReady && st?.reason) judgeReason = String(st.reason)
        } catch {
          judgeReady = false
        }
      }
      if (!judgeReady && !settings.allowHeuristicFallback) {
        setupRequiredReason = judgeReason
      } else {
        const material = await collectCharacterMaterial({ tavern, gameId, turn }).catch(() => null)
        const characterMaterial = buildProfileDigest(
          characterProfile,
          [
            material?.promptDigest || '',
            mvuNow.summary ? `【MVU 实时状态】${mvuNow.summary}` : ''
          ].filter(Boolean).join('\n')
        )
        judged = await judgeActionDifficulty({
          tavern,
          gameId,
          input: cleanInput,
          recentContext,
          characterMaterial,
          profile: characterProfile,
          rule: activeRule,
          sensitivity: settings.sensitivity,
          allowHidden: settings.allowHidden,
          timeoutMs: 2500
        })
      }
    }

    let roll = null
    if (judged?.shouldRoll) {
      const toneBonus = TONE_BIAS_BONUS[settings.toneBias] || 0
      const edgeBonus = Number(judged.edgeBonus) || 0
      const skillBonus = Number(judged.skillBonus) || 0
      roll = rollCheck({
        rule: activeRule,
        skillId: judged.skillId,
        skillName: judged.skillName || judged.check,
        check: judged.check,
        skillBonus,
        difficulty: normalizeDifficulty(judged.difficulty),
        modifier: edgeBonus + toneBonus,
        hidden: Boolean(judged.hidden),
        attempt: cleanInput.slice(0, 120),
        reason: judged.reason,
        stakes: '成功推动预期进展；失败产生真实阻力与新变化'
      })
      roll.modifierBreakdown = {
        skillBonus,
        edgeBonus,
        varModifier: 0,
        matchedVars: mvuNow.highlights?.slice(0, 4).map(h => ({ label: h.key, value: h.value })) || [],
        toneBonus
      }
      roll.judgeSource = judged.source || 'heuristic'
      roll.judgeTier = judged.judgeTier || null
      roll.retriedSafetyFallback = Boolean(judged.retriedSafetyFallback)
      roll.damperSync = judged.damperSync || null
    }

    let damperShiftResult = null
    if (damperUsed && roll && settings.damperLinkage && typeof tavern.applyDamperDiceShift === 'function') {
      try {
        damperShiftResult = await tavern.applyDamperDiceShift({
          gameId,
          turn,
          tier: roll.tier,
          check: roll.check,
          summary: `${roll.rule}:${roll.total}/${roll.target} (${roll.tierLabel})`
        })
      } catch {
        damperShiftResult = null
      }
    }
    if (roll && (damperUsed || roll.damperSync)) {
      const syncedRuling = damperShiftResult?.ruling || null
      roll.damper = {
        applied: Boolean(damperShiftResult?.applied ?? true),
        blockedByViolation: Boolean(damperShiftResult?.blockedByViolation),
        modifier: Number(judged?.edgeBonus) || 0,
        quota: syncedRuling ? `${syncedRuling.rulingTier} / ${syncedRuling.deltaBudget}` : null,
        quotaLabel: syncedRuling
          ? `配额:${syncedRuling.deltaBudget}`
          : (damperShiftResult?.blockedByViolation ? '越权锁定' : '阻尼联动'),
        reason: Array.isArray(roll.damperSync?.notes) && roll.damperSync.notes.length
          ? roll.damperSync.notes.join('；')
          : (judged?.reason || '')
      }
    }

    const injection = buildTurnInjection(roll)
    const record = {
      gameId,
      turn: Number(turn) || 0,
      input: cleanInput,
      inputHash,
      injection,
      roll,
      judged,
      damperUsed,
      damperShiftResult,
      settings,
      characterProfile,
      animation: settings.animation,
      createdAt: Date.now()
    }

    turnCacheByGame.set(cacheKey, record)
    trimCache(gameId)
    pendingByGame.set(gameId, record)

    if (roll) {
      await tavern.publishState?.({
        gameId,
        name: 'live-roll',
        data: {
          id: `${turn}-${roll.rolledAt}`,
          turn,
          kind: 'check',
          roll,
          animation: settings.animation
        }
      }).catch(() => {})
    } else if (setupRequiredReason) {
      await tavern.publishState?.({
        gameId,
        name: 'live-roll',
        data: {
          id: `setup-${turn}-${Date.now()}`,
          turn,
          kind: 'setup-required',
          reason: setupRequiredReason,
          message: '请先前往酒馆「设置 › 叙事阻尼器」配置决策模型与 API Key，配好后即可启用 AI 自动检定',
          animation: settings.animation === 'none' ? 'compact' : settings.animation
        }
      }).catch(() => {})
    } else {
      await tavern.publishState?.({ gameId, name: 'live-roll', data: null }).catch(() => {})
    }

    return record
  }

  // ── 发前无感检定注入 ────────────────────────────────────────────
  if (typeof tavern.turnSection === 'function') {
    tavern.turnSection({
      name: 'fate-dice',
      position: 'after',
      async text({ gameId, turn, input } = {}) {
        if (!gameId) return ''
        const record = await computeTurn({ gameId, turn, input })
        return record?.injection || ''
      }
    })
  }

  // ── 叙事阻尼器单趟合并提问 ──────────────────────────────────────
  if (tavern.capabilities?.narrativeDamper && typeof tavern.damperTurnQuestions === 'function') {
    try {
      tavern.damperTurnQuestions({
        name: 'fate-dice-judge',
        async questions({ gameId, protocol: dynamicProtocol, capabilities: dynCaps } = {}) {
          const globalStore = await readGlobal()
          const game = await readGame(gameId, globalStore.settings.rule)
          const settings = effectiveSettings(globalStore, game)
          if (!settings.enabled || !settings.autoCheck || !settings.damperLinkage) return []
          const activeRule = normalizeRule(settings.rule)
          const resolvedProto = dynamicProtocol || (dynCaps?.choice && dynCaps?.score ? 'gemini' : 'noul')
          return buildDamperJudgeQuestions({
            profile: profileOf(game, activeRule),
            rule: activeRule,
            protocol: resolvedProto,
            allowHidden: settings.allowHidden,
            autoProfile: true
          })
        }
      })
    } catch {}
  }

  // ── 后台结算：自动建立与演进主角能力画像 ─────────────────────────
  function buildProfileSyncSection(game, settings) {
    const profile = game.characterProfile
    const traits = Array.isArray(profile?.traits) ? profile.traits.filter(item => item && item.name) : []
    const rule = normalizeRule(settings?.rule)
    if (!traits.length) {
      return [
        '【命运之骰·主角能力画像（自动建档）】',
        '本局尚未建立主角能力画像。请调用工具 fate_dice_profile_sync，依据【角色卡 / 用户人设 / 启用世界书 / 当前 MVU 变量 / 本轮正文】推演主角的能力画像：',
        '- characterName：受控主角名；archetype：一句话实力与当前状态定位；',
        '- traits：4~8 条，覆盖特长、短板与当前伤病/装备/境界状态；每条给 name（≤8字）、tier（-2..3 整数）、hidden（感知洞察类为 true）、source（角色卡|世界书|MVU|正文）、reason（简短依据）。',
        `- 当前骰制 ${rule}：tier 会自动换算为检定加值，无需玩家手动设置。`
      ].join('\n')
    }
    return [
      '【命运之骰·主角能力画像（动态演进）】',
      `当前画像已建立（${traits.length} 条）：${traits.map(item => `${item.name}[tier ${Number(item.tier) >= 0 ? '+' : ''}${Number(item.tier) || 0}]`).join('、')}`,
      '仅在正文或 MVU 发生实质的能力变化、伤病、境界突破/跌落或关键道具得失时，才调用 fate_dice_profile_sync 更新画像；无实质变化不要调用。'
    ].join('\n')
  }

  if (typeof tavern.settlementSection === 'function') {
    tavern.settlementSection({
      name: 'fate-dice-profile',
      async text({ gameId } = {}) {
        if (!gameId) return ''
        lastActiveGameId = gameId
        const globalStore = await readGlobal()
        const game = await readGame(gameId, globalStore.settings.rule)
        const settings = effectiveSettings(globalStore, game)
        if (!settings.enabled || !settings.autoCheck) return ''
        return buildProfileSyncSection(game, settings)
      }
    })
  }

  const profileSyncTool = async (rawCall = {}, toolCtx = {}) => {
    const envelope = rawCall && typeof rawCall === 'object' ? rawCall : {}
    const payload = envelope.arguments && typeof envelope.arguments === 'object' ? envelope.arguments : envelope
    const gameId = payload.gameId || envelope.gameId || toolCtx?.gameId || lastActiveGameId || ''
    const rawTraits = Array.isArray(payload.traits) ? payload.traits : (Array.isArray(payload.report?.traits) ? payload.report.traits : [])
    const report = {
      characterName: String(payload.characterName || envelope.characterName || ''),
      archetype: String(payload.archetype || envelope.archetype || ''),
      traits: rawTraits
    }
    if (gameId && (report.traits.length || report.characterName || report.archetype)) {
      pendingProfileByGame.set(gameId, report)
    }
    return { ok: true, gameId: gameId || null, accepted: report.traits.length }
  }

  if (typeof tavern.settlementTool === 'function') {
    tavern.settlementTool({
      name: 'fate_dice_profile_sync',
      description: '提交/更新主角能力画像（能力、短板与当前伤病/装备/境界状态）。首次建档必调，之后仅在实质变化时调用。',
      parameters: {
        type: 'object',
        properties: {
          gameId: { type: 'string', description: '当前对局 id（宿主上下文已提供时可省略）' },
          characterName: { type: 'string', description: '受控主角名' },
          archetype: { type: 'string', description: '一句话实力与当前状态定位' },
          traits: {
            type: 'array',
            description: '4~8 条能力特征',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '不超过 8 字的能力/状态名' },
                tier: { type: 'integer', description: '-2 到 3 的能力阶梯：-2 短板受创，0 普通，2 职业专精，3 高阶位格压制' },
                hidden: { type: 'boolean', description: '感知洞察类为 true（暗骰）' },
                source: { type: 'string', enum: ['角色卡', '世界书', 'MVU', '正文', '综合'] },
                reason: { type: 'string', description: '简短依据' }
              }
            }
          }
        }
      },
      handler: profileSyncTool,
      execute: profileSyncTool
    })
  }

  // ── 正式落盘结算 ────────────────────────────────────────────────
  if (typeof tavern.onTurnSettled === 'function') {
    tavern.onTurnSettled(async ({ gameId, turn, textVersion } = {}) => {
      if (!gameId) return
      const pending = pendingByGame.get(gameId)
      const syncedProfile = pendingProfileByGame.get(gameId)
      if ((!pending || Number(pending.turn) !== Number(turn)) && !syncedProfile) return
      if (pending && Number(pending.turn) === Number(turn)) pendingByGame.delete(gameId)
      pendingProfileByGame.delete(gameId)

      const globalStore = await readGlobal()
      const game = await readGame(gameId, globalStore.settings.rule)
      const settings = pending?.settings || effectiveSettings(globalStore, game)
      const activeRule = normalizeRule(settings.rule)

      const latestVars = (await readLatestContextAndVars(gameId, Number(turn) + 1)).variables
      const mvuNow = summarizeMvuVariables(latestVars)
      let characterProfile = profileOf(game, activeRule)
      if (syncedProfile) {
        characterProfile = normalizeCharacterProfile({
          ...characterProfile,
          characterName: syncedProfile.characterName || characterProfile.characterName,
          archetype: syncedProfile.archetype || characterProfile.archetype,
          traits: syncedProfile.traits?.length ? syncedProfile.traits : characterProfile.traits,
          mvuHighlights: mvuNow.highlights?.length ? mvuNow.highlights : characterProfile.mvuHighlights,
          customNote: characterProfile.customNote,
          updatedTurn: Number(turn) || game.lastTurn,
          updatedAt: Date.now()
        }, activeRule)
      } else if (mvuNow.highlights?.length) {
        characterProfile = { ...characterProfile, mvuHighlights: mvuNow.highlights.slice(0, 12) }
      }

      const nextSummary = pending?.roll
        ? appendToSummary(game.summary, pending.roll, turn, pending.damperUsed)
        : game.summary
      const nextGame = {
        ...game,
        characterProfile,
        summary: nextSummary,
        lastRoll: pending?.roll || game.lastRoll,
        lastTurn: toInt(turn, game.lastTurn),
        updatedAt: Date.now()
      }
      await writeGame(gameId, nextGame)

      try {
        await tavern.saveTurnData?.({
          gameId,
          turn,
          textVersion,
          data: {
            roll: pending?.roll || null,
            judged: pending?.judged || null,
            characterProfile
          }
        })
      } catch {}

      await tavern.publishState?.({ gameId, name: 'summary', data: nextSummary }).catch(() => {})
      await tavern.publishState?.({
        gameId,
        name: 'workbench-sync',
        data: {
          turn,
          summary: nextSummary,
          characterProfile,
          lastRoll: nextGame.lastRoll
        }
      }).catch(() => {})

      for (const key of [...turnCacheByGame.keys()]) {
        if (key.startsWith(`${gameId}:${turn}:`)) turnCacheByGame.delete(key)
      }
    })
  }

  if (typeof tavern.onTimelineChanged === 'function') {
    tavern.onTimelineChanged(({ gameId } = {}) => {
      if (!gameId) return
      pendingByGame.delete(gameId)
      pendingProfileByGame.delete(gameId)
      for (const key of [...turnCacheByGame.keys()]) {
        if (key.startsWith(`${gameId}:`)) turnCacheByGame.delete(key)
      }
    })
  }

  if (typeof tavern.onGameRemoved === 'function') {
    tavern.onGameRemoved(({ gameId } = {}) => {
      if (!gameId) return
      pendingByGame.delete(gameId)
      pendingProfileByGame.delete(gameId)
      for (const key of [...turnCacheByGame.keys()]) {
        if (key.startsWith(`${gameId}:`)) turnCacheByGame.delete(key)
      }
    })
  }

  // ── 浏览器侧极简 RPC ────────────────────────────────────────────
  function handle(rpcName, fn) {
    if (typeof tavern.handle === 'function') tavern.handle(rpcName, fn)
  }

  async function buildWorkbenchView(params = {}) {
    const gameId = params.gameId || ''
    const globalStore = await readGlobal()
    const game = await readGame(gameId, globalStore.settings.rule)
    const settings = effectiveSettings(globalStore, game)
    const activeRule = normalizeRule(settings.rule)
    const characterProfile = profileOf(game, activeRule)

    let judgeStatus = { available: false }
    if (typeof tavern.decisionJudgeStatus === 'function') {
      try {
        judgeStatus = await tavern.decisionJudgeStatus()
      } catch {
        judgeStatus = { available: false }
      }
    }

    let profileMaterial = null
    if (gameId) {
      profileMaterial = await collectCharacterMaterial({
        tavern,
        gameId,
        turn: Math.max(2, toInt(game.lastTurn, 1) + 1)
      }).catch(() => null)
      if (profileMaterial?.mvuHighlights?.length && !characterProfile.mvuHighlights?.length) {
        characterProfile.mvuHighlights = profileMaterial.mvuHighlights.slice(0, 12)
      }
    }

    return {
      ok: true,
      name,
      version: PLUGIN_VERSION,
      gameId: gameId || null,
      rules: DICE_RULES.map(rule => ({ value: rule, label: RULE_LABELS[rule], targets: RULE_TARGETS[rule], budget: SKILL_BUDGET_SPECS[rule] })),
      difficulties: DIFFICULTY_TIERS.map(value => ({ value, label: DIFFICULTY_LABELS[value] })),
      outcomes: OUTCOME_TIERS.map(value => ({ value, label: OUTCOME_LABELS[value] })),
      categories: SKILL_CATEGORIES,
      settings: settingsForClient(settings),
      globalSettings: globalStore.settings,
      rule: activeRule,
      autoCheck: settings.autoCheck,
      characterProfile,
      contextSources: buildContextSources(characterProfile, profileMaterial),
      binding: { autoCheck: settings.autoCheck, rule: activeRule },
      damper: { available: Boolean(tavern.capabilities?.narrativeDamper), linkage: settings.damperLinkage },
      damperBridgeAvailable: Boolean(tavern.capabilities?.narrativeDamper),
      damperLinkage: settings.damperLinkage,
      judgeStatus,
      summary: game.summary || emptySummary(),
      lastRoll: game.lastRoll,
      source: 'host'
    }
  }

  handle('fate-dice:workbench', buildWorkbenchView)
  handle('fate-dice:bootstrap', buildWorkbenchView)
  handle('fate-dice:status', buildWorkbenchView)

  async function handleSaveGlobalSettings(params = {}) {
    const globalStore = await readGlobal()
    const incoming = params.settings || params.data || params.config || params
    const settings = sanitizeSettings(incoming, globalStore.settings)
    const saved = await saveGlobal({ ...globalStore, settings })
    return { ok: true, settings: settingsForClient(saved.settings) }
  }
  handle('fate-dice:save-global-settings', handleSaveGlobalSettings)
  handle('fate-dice:save-settings', handleSaveGlobalSettings)

  async function handleSaveBinding(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const globalStore = await readGlobal()
    const game = await readGame(gameId, globalStore.settings.rule)
    const incoming = params.binding || params.config || params.settings || params
    const config = { ...game.config }
    if (typeof incoming.autoCheck === 'boolean') config.autoCheck = incoming.autoCheck
    if (typeof incoming.enabled === 'boolean') config.enabled = incoming.enabled
    if (typeof incoming.rule === 'string' && incoming.rule) config.rule = normalizeRule(incoming.rule)
    const activeRule = normalizeRule(config.rule || globalStore.settings.rule)
    const characterProfile = profileOf(game, activeRule)
    await writeGame(gameId, { ...game, config, characterProfile })
    return { ok: true, config, rule: activeRule, autoCheck: config.autoCheck ?? globalStore.settings.autoCheck }
  }
  handle('fate-dice:save-binding', handleSaveBinding)
  handle('fate-dice:save-game-config', handleSaveBinding)

  async function handleRefreshProfile(params = {}) {
    const gameId = params.gameId || lastActiveGameId || ''
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const globalStore = await readGlobal()
    const game = await readGame(gameId, globalStore.settings.rule)
    const settings = effectiveSettings(globalStore, game)
    const turn = Math.max(2, toInt(Number(params.turn) || toInt(game.lastTurn, 1) + 1, 2))
    const result = await refreshProfileWithBackgroundLlm({
      llm: runtimeLlm,
      tavern,
      gameId,
      turn,
      rule: settings.rule,
      existingProfile: game.characterProfile || null
    })
    const characterProfile = normalizeCharacterProfile(result.characterProfile, settings.rule)
    const contextSources = buildContextSources(characterProfile, { contextSources: result.contextSources })
    if (!result.ok || !characterProfile.traits.length) {
      return {
        ok: false,
        error: result.error || '未推演出有效的角色能力画像',
        characterProfile,
        contextSources
      }
    }
    const saved = { ...characterProfile, updatedTurn: turn, updatedAt: Date.now() }
    await writeGame(gameId, { ...game, characterProfile: saved })
    await tavern.publishState?.({
      gameId,
      name: 'workbench-sync',
      data: { characterProfile: saved, contextSources, refreshedAt: Date.now(), turn }
    }).catch(() => {})
    return { ok: true, turn, characterProfile: saved, contextSources }
  }
  handle('fate-dice:refresh-profile', handleRefreshProfile)

  async function handleSaveProfileNote(params = {}) {
    const gameId = params.gameId || ''
    const globalStore = await readGlobal()
    if (!gameId) {
      if (params.rule !== undefined && params.rule !== '') {
        const nextRule = normalizeRule(params.rule)
        const saved = await saveGlobal({ ...globalStore, settings: { ...globalStore.settings, rule: nextRule } })
        return { ok: true, rule: saved.settings.rule, characterProfile: null, contextSources: null }
      }
      return { ok: false, error: '缺少 gameId' }
    }
    const game = await readGame(gameId, globalStore.settings.rule)
    const settings = effectiveSettings(globalStore, game)
    const nextRule = params.rule !== undefined && params.rule !== ''
      ? normalizeRule(params.rule)
      : normalizeRule(settings.rule)
    const config = { ...game.config }
    if (params.rule !== undefined && params.rule !== '') config.rule = nextRule
    const characterProfile = normalizeCharacterProfile(game.characterProfile || {}, nextRule)
    if (params.customNote !== undefined) characterProfile.customNote = String(params.customNote || '').slice(0, 200)
    characterProfile.updatedAt = Date.now()
    await writeGame(gameId, { ...game, config, characterProfile })
    const contextSources = buildContextSources(characterProfile)
    await tavern.publishState?.({
      gameId,
      name: 'workbench-sync',
      data: { characterProfile, contextSources, rule: nextRule }
    }).catch(() => {})
    return { ok: true, rule: nextRule, characterProfile, contextSources }
  }
  handle('fate-dice:save-profile-note', handleSaveProfileNote)

  async function handleReadTurn(params = {}) {
    const gameId = params.gameId
    const turn = toInt(params.turn, 0)
    if (!gameId) return null
    let stored = null
    try {
      stored = await tavern.readTurnData?.({ gameId, turn })
    } catch {
      stored = null
    }
    if (stored && stored.turn === turn && stored.data) {
      return {
        turn,
        textVersion: stored.textVersion ?? null,
        roll: stored.data.roll || null,
        judged: stored.data.judged || null,
        characterProfile: stored.data.characterProfile || null
      }
    }
    const pending = pendingByGame.get(gameId)
    if (pending && Number(pending.turn) === turn) {
      return {
        turn,
        textVersion: null,
        roll: pending.roll,
        judged: pending.judged,
        characterProfile: pending.characterProfile || null
      }
    }
    return null
  }
  handle('fate-dice:read-turn', handleReadTurn)

  async function handleRerollTurn(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const pendingRecord = pendingByGame.get(gameId)
    const turn = toInt(params.turn, pendingRecord?.turn || 0)
    const sourceInput = String(params.input || pendingRecord?.input || '').trim()
    if (!sourceInput) return { ok: false, error: '缺少原始输入，仅支持重投尚未结算的当前轮', turn }
    for (const key of [...turnCacheByGame.keys()]) {
      if (key.startsWith(`${gameId}:${turn}:`)) turnCacheByGame.delete(key)
    }
    const record = await computeTurn({ gameId, turn, input: sourceInput, force: true })
    return { ok: true, turn, roll: record.roll || null, injection: record.injection || '' }
  }
  handle('fate-dice:reroll-turn', handleRerollTurn)

  async function handleFreeRoll(params = {}) {
    const gameId = params.gameId || ''
    const globalStore = await readGlobal()
    const game = gameId ? await readGame(gameId, globalStore.settings.rule) : null
    const settings = effectiveSettings(globalStore, game)
    const result = rollExpression(params.expression || '2d6')
    if (gameId) {
      await tavern.publishState?.({
        gameId,
        name: 'live-roll',
        data: { id: `free-${result.rolledAt}`, turn: 0, kind: 'free', result, animation: settings.animation }
      }).catch(() => {})
    }
    return { ok: true, result }
  }
  handle('fate-dice:free-roll', handleFreeRoll)
}

export default { name, inject, apply }
