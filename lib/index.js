import { createHash, randomInt } from 'node:crypto'
import {
  DICE_RULES,
  DIFFICULTY_LABELS,
  DIFFICULTY_TIERS,
  OUTCOME_LABELS,
  OUTCOME_TIERS,
  RULE_LABELS,
  RULE_TARGETS,
  SKILL_BUDGET_SPECS,
  extractVariableModifier,
  normalizeDifficulty,
  normalizeRule,
  rollCheck,
  rollExpression
} from './dice-engine.js'
import {
  SKILL_CATEGORIES,
  computeSkillBudget,
  createSkillGroup,
  createSkillsFromTemplate,
  getSkillTemplate,
  listSkillTemplates,
  normalizeSkills,
  randomizeSkillBonuses,
  recommendedSkillBudget,
  resetRecommendedBonuses
} from './skill-system.js'
import {
  createEventItem,
  createEventTrack,
  createGeneralPlotTemplateGroup,
  eventGroupStats,
  normalizeEventGroup
} from './event-pool.js'
import {
  DIRECTOR_DEFAULTS,
  MAX_ACTIVE_ARCS,
  activeArcsOf,
  advanceDirectorOnSettled,
  applyArcOp,
  blockTopic,
  drawTurnEvents,
  mergeSettlementArcReport,
  normalizeArcs,
  normalizeDirectorState,
  pauseNextPush,
  unblockTopic
} from './narrative-director.js'
import { buildDamperJudgeQuestions, resolveCheckFromDamperContext } from './damper-bridge.js'
import { judgeActionDifficulty } from './difficulty-judge.js'
import {
  buildProfileDigest,
  collectCharacterMaterial,
  normalizeCharacterProfile,
  refreshProfileWithBackgroundLlm,
  summarizeMvuVariables
} from './auto-profiler.js'
import { buildTurnInjection, extractContextSnippet } from './prompt-builder.js'
import {
  applyImportConfig,
  buildNativeExportBundle,
  buildSampleExportBundle,
  previewImportConfig
} from './config-transfer.js'

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
  randomEvents: false,
  storyEnhance: false,
  damperLinkage: true,
  allowHeuristicFallback: false,
  rule: '2d6',
  sensitivity: 'normal',
  allowHidden: true,
  animation: 'bounce',
  toneBias: 'balanced',
  modifierFormula: '',
  maxPushPerTurn: 1,
  maxVibePerTurn: 1,
  cooldownTurns: DIRECTOR_DEFAULTS.cooldownTurns,
  blockedTopicTurns: DIRECTOR_DEFAULTS.blockedTopicTurns,
  sceneVarPath: '',
  longEventGroupId: '',
  sceneEventGroupId: '',
  skillGroupId: ''
})

function hashText(text) {
  return createHash('sha1').update(String(text || '').trim()).digest('hex').slice(0, 16)
}

function emptySummary() {
  return {
    total: 0,
    counts: { critical: 0, success: 0, costly: 0, failure: 0, fumble: 0 },
    recent: []
  }
}

function appendToSummary(prev, roll, turn, pickedEvents = [], damperSynced = false) {
  const base = prev && typeof prev === 'object' ? prev : emptySummary()
  const eventCount = Array.isArray(pickedEvents) ? pickedEvents.length : 0
  if ((!roll || typeof roll !== 'object') && eventCount === 0) return base
  const counts = { ...emptySummary().counts, ...(base.counts || {}) }
  if (roll && Object.hasOwn(counts, roll.tier)) counts[roll.tier] += 1
  const entry = roll
    ? {
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
        eventCount,
        damperSynced: Boolean(damperSynced || roll.damper?.applied),
        damper: Boolean(damperSynced || roll.damper?.applied),
        rolledAt: roll.rolledAt || Date.now()
      }
    : {
        turn: Number(turn) || 0,
        rule: 'events',
        check: '随机事件',
        total: eventCount,
        target: 0,
        tier: 'success',
        tierLabel: `${eventCount}条`,
        hidden: false,
        eventCount,
        damperSynced: false,
        damper: false,
        rolledAt: Date.now()
      }
  const recent = [entry, ...(Array.isArray(base.recent) ? base.recent : []).filter(item => item.turn !== entry.turn)].slice(0, 10)
  return {
    total: (Number(base.total) || 0) + (roll ? 1 : 0),
    counts,
    recent
  }
}

function toInt(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.trunc(num) : fallback
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

const GROUP_OP_ALIASES = Object.freeze({
  add: 'create', new: 'create', addgroup: 'create', creategroup: 'create', newgroup: 'create',
  updategroup: 'update', editgroup: 'update',
  deletegroup: 'delete', removegroup: 'delete',
  copygroup: 'duplicate', duplicategroup: 'duplicate',
  randomizebonuses: 'randomize', resetbonuses: 'reset'
})

function normalizeGroupOp(raw) {
  const text = String(raw || 'update').trim()
  const key = text.replace(/[\s_-]+/g, '').toLowerCase()
  return GROUP_OP_ALIASES[key] || text.toLowerCase()
}

function sanitizeSettings(input = {}, fallback = DEFAULT_GLOBAL_SETTINGS) {
  const base = { ...DEFAULT_GLOBAL_SETTINGS, ...(fallback || {}) }
  const next = { ...base }
  const source = input && typeof input === 'object' ? input : {}
  for (const key of ['enabled', 'autoCheck', 'randomEvents', 'storyEnhance', 'damperLinkage', 'allowHidden', 'allowHeuristicFallback']) {
    if (source[key] !== undefined) next[key] = Boolean(source[key])
  }
  if (source.rule !== undefined) next.rule = normalizeRule(source.rule)
  if (source.sensitivity !== undefined && SENSITIVITY_VALUES.includes(source.sensitivity)) next.sensitivity = source.sensitivity
  if (source.animation !== undefined && ANIMATION_VALUES.includes(source.animation)) next.animation = source.animation
  if (source.toneBias !== undefined && TONE_VALUES.includes(source.toneBias)) next.toneBias = source.toneBias
  if (source.modifierFormula !== undefined) next.modifierFormula = String(source.modifierFormula || '').slice(0, 200)
  if (source.maxPushPerTurn !== undefined) next.maxPushPerTurn = Math.max(0, Math.min(3, toInt(source.maxPushPerTurn, 1)))
  if (source.maxVibePerTurn !== undefined) next.maxVibePerTurn = Math.max(0, Math.min(3, toInt(source.maxVibePerTurn, 1)))
  if (source.cooldownTurns !== undefined) next.cooldownTurns = Math.max(0, Math.min(6, toInt(source.cooldownTurns, 2)))
  if (source.blockedTopicTurns !== undefined) next.blockedTopicTurns = Math.max(1, Math.min(10, toInt(source.blockedTopicTurns, 5)))
  if (source.sceneVarPath !== undefined) next.sceneVarPath = String(source.sceneVarPath || '').trim().slice(0, 120)
  if (source.longEventGroupId !== undefined) next.longEventGroupId = String(source.longEventGroupId || '')
  if (source.sceneEventGroupId !== undefined) next.sceneEventGroupId = String(source.sceneEventGroupId || '')
  if (source.eventGroupId !== undefined) {
    next.longEventGroupId = String(source.eventGroupId || '')
    if (source.sceneEventGroupId === undefined) next.sceneEventGroupId = String(source.eventGroupId || '')
  }
  if (source.skillGroupId !== undefined) next.skillGroupId = String(source.skillGroupId || '')
  // 浏览器工作台字段别名 ↔ 宿主 canonical 字段
  if (source.autoHidden !== undefined && source.allowHidden === undefined) next.allowHidden = Boolean(source.autoHidden)
  if (source.maxPlotPush !== undefined && source.maxPushPerTurn === undefined) next.maxPushPerTurn = Math.max(0, Math.min(3, toInt(source.maxPlotPush, 1)))
  if (source.maxAmbience !== undefined && source.maxVibePerTurn === undefined) next.maxVibePerTurn = Math.max(0, Math.min(3, toInt(source.maxAmbience, 1)))
  if (source.themeCooldown !== undefined && source.cooldownTurns === undefined) next.cooldownTurns = Math.max(0, Math.min(6, toInt(source.themeCooldown, 2)))
  if (source.scenePath !== undefined && source.sceneVarPath === undefined) next.sceneVarPath = String(source.scenePath || '').trim().slice(0, 120)
  if (source.multiTrack !== undefined && source.randomEvents === undefined) next.randomEvents = Boolean(source.multiTrack)
  if (source.enhanced !== undefined && source.storyEnhance === undefined) next.storyEnhance = Boolean(source.enhanced)
  return next
}

const CLIENT_CATEGORY_MAP = Object.freeze({ '推动': 'push', '氛围': 'vibe', '常驻': 'constant', push: 'push', vibe: 'vibe', constant: 'constant' })
const CATEGORY_CLIENT_LABEL = Object.freeze({ push: '推动', vibe: '氛围', constant: '常驻' })

function decorateEventForClient(item) {
  if (!item || typeof item !== 'object') return item
  return {
    ...item,
    type: CATEGORY_CLIENT_LABEL[item.category] || '推动',
    theme: item.topic || ''
  }
}

const CLIENT_OP_MAP = Object.freeze({ '=': '==', '≠': '!=', '≥': '>=', '≤': '<=', '>': '>', '<': '<', '包含': 'contains', '不包含': 'contains' })

function adaptIncomingEventGroup(raw, fallbackName = '事件组') {
  if (!raw || typeof raw !== 'object') return null
  const tracks = (Array.isArray(raw.tracks) ? raw.tracks : []).map(track => {
    const srcItems = Array.isArray(track?.items) ? track.items : (Array.isArray(track?.entries) ? track.entries : [])
    const items = srcItems.map(entry => {
      const conditions = Array.isArray(entry?.conditions)
        ? entry.conditions.filter(cond => cond && typeof cond === 'object').map(cond => ({
            kind: cond.kind || 'mvu',
            path: String(cond.path || ''),
            op: CLIENT_OP_MAP[String(cond.op || '')] || cond.op || '==',
            value: /^-?\d+(\.\d+)?$/.test(String(cond.value)) ? Number(cond.value) : cond.value
          }))
        : entry?.conditions
      return {
        ...entry,
        category: CLIENT_CATEGORY_MAP[entry?.category || entry?.type] || 'push',
        topic: String(entry?.topic ?? entry?.theme ?? '').trim(),
        conditions
      }
    })
    return { ...track, items }
  })
  return normalizeEventGroup({ ...raw, tracks }, fallbackName)
}

function normalizeLibrary(raw) {
  const data = raw && typeof raw === 'object' ? raw : {}
  const skillGroups = (Array.isArray(data.skillGroups) ? data.skillGroups : [])
    .map((group, index) => {
      if (!group || typeof group !== 'object') return null
      const rule = normalizeRule(group.rule)
      const skills = normalizeSkills(group.skills, rule)
      return {
        id: String(group.id || `sg-imported-${index + 1}`),
        name: String(group.name || `技能组 ${index + 1}`).slice(0, 60),
        rule,
        mvuPath: String(group.mvuPath || '').slice(0, 200),
        customBudget: group.customBudget === null || group.customBudget === undefined
          ? null
          : recommendedSkillBudget(rule, skills.length, group.customBudget),
        templateId: group.templateId || null,
        description: String(group.description || '').slice(0, 200),
        skills,
        createdAt: toInt(group.createdAt, Date.now()),
        updatedAt: toInt(group.updatedAt, Date.now())
      }
    })
    .filter(Boolean)
  const eventGroups = (Array.isArray(data.eventGroups) ? data.eventGroups : [])
    .map((group, index) => adaptIncomingEventGroup(group, `事件组 ${index + 1}`))
    .filter(Boolean)
  return {
    version: 2,
    settings: sanitizeSettings(data.settings, DEFAULT_GLOBAL_SETTINGS),
    skillGroups,
    eventGroups,
    updatedAt: toInt(data.updatedAt, Date.now())
  }
}

function createDefaultLibrary() {
  const skillGroup = createSkillGroup({
    name: '日常通用技能组',
    rule: '2d6',
    skills: createSkillsFromTemplate('daily', '2d6'),
    templateId: 'daily'
  })
  const eventGroup = createGeneralPlotTemplateGroup()
  return normalizeLibrary({
    version: 2,
    settings: DEFAULT_GLOBAL_SETTINGS,
    skillGroups: [skillGroup],
    eventGroups: [eventGroup],
    updatedAt: Date.now()
  })
}

function normalizeGameState(raw) {
  const data = raw && typeof raw === 'object' ? raw : {}
  return {
    version: 2,
    config: data.config && typeof data.config === 'object' ? { ...data.config } : {},
    skills: Array.isArray(data.skills) ? data.skills : null,
    characterProfile: data.characterProfile && typeof data.characterProfile === 'object'
      ? normalizeCharacterProfile(data.characterProfile, normalizeRule(data.config?.rule))
      : null,
    director: normalizeDirectorState(data.director),
    arcs: normalizeArcs(data.arcs),
    summary: data.summary && typeof data.summary === 'object' ? data.summary : emptySummary(),
    lastRoll: data.lastRoll && typeof data.lastRoll === 'object' ? data.lastRoll : null,
    lastTurn: toInt(data.lastTurn, 0),
    updatedAt: toInt(data.updatedAt, Date.now())
  }
}

export function apply(ctx) {
  const tavern = ctx?.tavern
  if (!tavern || typeof tavern !== 'object') return

  const turnCacheByGame = new Map()
  const pendingByGame = new Map()
  const pendingArcReportByGame = new Map()
  const pendingProfileByGame = new Map()
  let libraryCache = null
  let lastActiveGameId = ''
  let runtimeLlm = null

  try {
    ctx.inject?.(['llm'], container => {
      if (container?.llm) runtimeLlm = container.llm
    })
  } catch {
    runtimeLlm = null
  }

  const isStoryEnhance = settings => Boolean(settings?.storyEnhance)

  function backgroundModelReady() {
    return Boolean(runtimeLlm && typeof tavern.backgroundModel === 'function')
  }

  /** 客户端展示用的素材来源摘要。 */
  function buildContextSources(profile, material = null) {
    const traits = Array.isArray(profile?.traits) ? profile.traits.filter(item => item && item.name) : []
    const sources = {
      hasProfile: traits.length > 0,
      traitCount: traits.length,
      updatedTurn: Math.max(0, toInt(profile?.updatedTurn, 0)),
      backgroundModelReady: backgroundModelReady()
    }
    if (material?.contextSources) {
      return { ...material.contextSources, ...sources }
    }
    sources.mvuKeyCount = Array.isArray(profile?.mvuHighlights) ? profile.mvuHighlights.length : 0
    return sources
  }

  /** 按当前骰制取本局画像（tier 不变，bonus 重算）。 */
  function profileOf(game, rule) {
    const raw = game?.characterProfile
    if (!raw || typeof raw !== 'object') return null
    const normalized = normalizeCharacterProfile(raw, normalizeRule(rule))
    return normalized.traits.length || normalized.archetype ? normalized : null
  }

  async function readLibrary() {
    if (libraryCache) return libraryCache
    let raw = null
    try {
      if (typeof tavern.readPluginData === 'function') raw = await tavern.readPluginData()
      else if (typeof tavern.readGameData === 'function') raw = await tavern.readGameData({ gameId: GLOBAL_GAME_ID })
    } catch {
      raw = null
    }
    const data = raw && typeof raw === 'object' && raw.data !== undefined ? raw.data : raw
    if (!data || typeof data !== 'object' || (!Array.isArray(data.skillGroups) && !Array.isArray(data.eventGroups))) {
      const fresh = createDefaultLibrary()
      await saveLibrary(fresh)
      return fresh
    }
    libraryCache = normalizeLibrary(data)
    return libraryCache
  }

  async function saveLibrary(library) {
    const payload = normalizeLibrary({ ...library, updatedAt: Date.now() })
    libraryCache = payload
    try {
      if (typeof tavern.savePluginData === 'function') {
        try {
          await tavern.savePluginData({ data: payload })
        } catch {
          await tavern.savePluginData(payload)
        }
      } else if (typeof tavern.saveGameData === 'function') {
        await tavern.saveGameData({ gameId: GLOBAL_GAME_ID, data: payload })
      }
    } catch {
      // 存储不可用时保留内存态，保证本回合流程不中断
    }
    return payload
  }

  async function readGame(gameId) {
    if (!gameId) return normalizeGameState(null)
    let raw = null
    try {
      if (typeof tavern.readGameData === 'function') raw = await tavern.readGameData({ gameId })
    } catch {
      raw = null
    }
    return normalizeGameState(raw && raw.data !== undefined ? raw.data : raw)
  }

  async function writeGame(gameId, data) {
    if (!gameId) return data
    const next = { ...data, updatedAt: Date.now() }
    try {
      if (typeof tavern.saveGameData === 'function') await tavern.saveGameData({ gameId, data: next })
    } catch {
      // 忽略存储异常
    }
    return next
  }

  function effectiveSettings(library, game) {
    return sanitizeSettings({ ...(library?.settings || {}), ...(game?.config || {}) }, library?.settings || DEFAULT_GLOBAL_SETTINGS)
  }

  function resolveSkillGroup(library, game, settings) {
    const groups = library?.skillGroups || []
    if (!groups.length) return null
    const wanted = game?.config?.skillGroupId || settings?.skillGroupId || ''
    return groups.find(group => String(group.id) === String(wanted)) || groups[0]
  }

  function resolveGameSkills(library, game, settings) {
    if (Array.isArray(game?.skills) && game.skills.length) return normalizeSkills(game.skills, settings.rule)
    const group = resolveSkillGroup(library, game, settings)
    return group ? normalizeSkills(group.skills, settings.rule) : []
  }

  function resolveEventGroup(library, id, fallbackIndex = 0) {
    const groups = library?.eventGroups || []
    if (!groups.length) return null
    if (id) {
      const found = groups.find(group => String(group.id) === String(id))
      if (found) return found
    }
    return groups[fallbackIndex] || groups[0] || null
  }

  async function readLatestContextAndVars(gameId, currentTurn) {
    const prevTurnNum = Math.max(1, Number(currentTurn) - 1)
    let turnSnap = null
    try {
      turnSnap = await tavern.getTurn({ gameId, turn: prevTurnNum })
    } catch {
      turnSnap = null
    }
    if (!turnSnap && prevTurnNum > 1) {
      try {
        turnSnap = await tavern.getTurn({ gameId, turn: 1 })
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

  /**
   * 核心回合计算：合并阻尼器裁定 / 独立判定 → 真骰 → 随机事件 → 注入文本。
   */
  async function computeTurn({ gameId, turn, input, overrideSettings = null, force = false } = {}) {
    const cleanInput = String(input || '').trim()
    if (gameId) lastActiveGameId = gameId
    if (!gameId || !cleanInput) return { skipped: 'empty', injection: '' }
    const library = await readLibrary()
    const game = await readGame(gameId)
    const settings = sanitizeSettings(
      { ...effectiveSettings(library, game), ...(overrideSettings || {}) },
      library.settings
    )
    if (!settings.enabled) return { skipped: 'disabled', injection: '' }

    const inputHash = hashText(cleanInput)
    const cacheKey = `${gameId}:${turn}:${inputHash}`
    if (!force) {
      const cached = turnCacheByGame.get(cacheKey)
      if (cached) return cached
    }

    const skills = resolveGameSkills(library, game, settings)
    const skillGroup = resolveSkillGroup(library, game, settings)
    const { recentContext, variables } = await readLatestContextAndVars(gameId, turn)
    // 能力修正 100% 由画像推演：玩家无需再维护技能数值
    const activeRule = normalizeRule(skillGroup?.rule || settings.rule)
    const characterProfile = profileOf(game, activeRule)
    const mvuNow = summarizeMvuVariables(variables)
    const characterMaterial = buildProfileDigest(
      characterProfile,
      mvuNow.summary ? `【MVU 实时状态】${mvuNow.summary}` : ''
    )

    let judged = null
    let damperUsed = false
    let damperContext = null
    let setupRequiredReason = ''

    if (settings.autoCheck && settings.damperLinkage) {
      damperContext = await readDamperContext(gameId, turn)
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
            skills,
            profile: characterProfile,
            rule: activeRule,
            sensitivity: settings.sensitivity,
            allowHidden: settings.allowHidden,
            damperLinkage: settings.damperLinkage
          })
        }
      }
    }
    if (settings.autoCheck && !damperUsed && !setupRequiredReason) {
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
        judged = await judgeActionDifficulty({
          tavern,
          gameId,
          input: cleanInput,
          recentContext,
          characterMaterial,
          profile: characterProfile,
          skills,
          rule: activeRule,
          sensitivity: settings.sensitivity,
          allowHidden: settings.allowHidden,
          timeoutMs: 2500
        })
      }
    }

    let roll = null
    if (settings.autoCheck && judged?.shouldRoll) {
      const effectiveFormula = String(skillGroup?.mvuPath || settings.modifierFormula || '').trim()
      const varMod = extractVariableModifier(variables, effectiveFormula)
      const toneBonus = TONE_BIAS_BONUS[settings.toneBias] || 0
      const edgeBonus = Number(judged.edgeBonus) || 0
      const skillBonus = Number(judged.skillBonus) || 0
      roll = rollCheck({
        rule: normalizeRule(skillGroup?.rule || settings.rule),
        skillId: judged.skillId,
        skillName: judged.skillName || judged.check,
        check: judged.check,
        skillBonus,
        difficulty: normalizeDifficulty(judged.difficulty),
        modifier: edgeBonus + varMod.modifier + toneBonus,
        hidden: Boolean(judged.hidden),
        attempt: cleanInput.slice(0, 120),
        reason: judged.reason,
        stakes: '成功推动预期进展；失败产生真实阻力与新变化'
      })
      roll.modifierBreakdown = {
        skillBonus,
        edgeBonus,
        varModifier: varMod.modifier,
        matchedVars: varMod.matched,
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

    let pickedEvents = []
    let trace = []
    let sceneAutoPaused = false
    let nextSceneValue = null
    if (settings.randomEvents) {
      const longGroup = resolveEventGroup(library, settings.longEventGroupId, 0)
      const sceneGroup = isStoryEnhance(settings) && settings.sceneEventGroupId
        ? resolveEventGroup(library, settings.sceneEventGroupId, -1)
        : null
      const drawn = drawTurnEvents({
        longGroup,
        sceneGroup: sceneGroup && (!longGroup || sceneGroup.id !== longGroup.id) ? sceneGroup : null,
        storyEnhance: isStoryEnhance(settings),
        settings,
        gameState: { ...game.director, arcs: game.arcs },
        variables,
        input: cleanInput
      })
      pickedEvents = drawn.pickedEvents
      trace = drawn.trace
      sceneAutoPaused = drawn.sceneAutoPaused
      nextSceneValue = drawn.nextSceneValue
    }

    const activeArcs = activeArcsOf(game.arcs)
    const injection = buildTurnInjection({
      roll,
      pickedEvents,
      activeArcs,
      storyEnhance: isStoryEnhance(settings)
    })

    const clientEvents = pickedEvents.map(decorateEventForClient)
    const record = {
      gameId,
      turn: Number(turn) || 0,
      input: cleanInput,
      inputHash,
      injection,
      roll,
      judged,
      pickedEvents,
      events: clientEvents,
      trace,
      sceneAutoPaused,
      nextSceneValue,
      damperUsed,
      damperShiftResult,
      settings,
      skills,
      characterProfile,
      skillGroupId: skillGroup?.id || '',
      animation: settings.animation,
      createdAt: Date.now()
    }

    turnCacheByGame.set(cacheKey, record)
    trimCache(gameId)
    pendingByGame.set(gameId, record)

    if (roll || clientEvents.length > 0) {
      await tavern.publishState({
        gameId,
        name: 'live-roll',
        data: {
          id: `${turn}-${roll ? roll.rolledAt : Date.now()}`,
          turn,
          kind: roll ? 'check' : 'events-only',
          roll,
          animation: settings.animation,
          events: clientEvents,
          sceneAutoPaused
        }
      }).catch(() => {})
    } else if (setupRequiredReason) {
      await tavern.publishState({
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
      await tavern.publishState({ gameId, name: 'live-roll', data: null }).catch(() => {})
    }

    return record
  }

  // ── 发前无感注入 ────────────────────────────────────────────────
  if (typeof tavern.turnSection === 'function') tavern.turnSection({
    name: 'fate-dice',
    position: 'after',
    async text({ gameId, turn, input } = {}) {
      if (!gameId) return ''
      const record = await computeTurn({ gameId, turn, input })
      return record?.injection || ''
    }
  })

  // ── 叙事阻尼器单趟合并提问 ──────────────────────────────────────
  if (tavern.capabilities?.narrativeDamper && typeof tavern.damperTurnQuestions === 'function') {
    try {
      tavern.damperTurnQuestions({
        name: 'fate-dice-judge',
        async questions({ gameId, protocol: dynamicProtocol, capabilities: dynCaps } = {}) {
          const library = await readLibrary()
          const game = await readGame(gameId)
          const settings = effectiveSettings(library, game)
          if (!settings.enabled || !settings.autoCheck || !settings.damperLinkage) return []
          const skillGroup = resolveSkillGroup(library, game, settings)
          const activeRule = normalizeRule(skillGroup?.rule || settings.rule)
          const skills = resolveGameSkills(library, game, { ...settings, rule: activeRule })
          const resolvedProto = dynamicProtocol || (dynCaps?.choice && dynCaps?.score ? 'gemini' : 'noul')
          return buildDamperJudgeQuestions({
            profile: profileOf(game, activeRule),
            skills,
            rule: activeRule,
            protocol: resolvedProto,
            allowHidden: settings.allowHidden,
            autoProfile: true
          })
        }
      })
    } catch {
      // 宿主不支持时跳过合并提问，回退独立判定
    }
  }

  // ── 结算段与剧情线结算工具 ──────────────────────────────────────
  if (typeof tavern.settlementSection === 'function') tavern.settlementSection({
    name: 'fate-dice-arcs',
    async text({ gameId } = {}) {
      if (!gameId) return ''
      lastActiveGameId = gameId
      const library = await readLibrary()
      const game = await readGame(gameId)
      const settings = effectiveSettings(library, game)
      if (!settings.enabled) return ''
      const blocks = []
      if (settings.storyEnhance) {
        const active = activeArcsOf(game.arcs)
        blocks.push([
          '【命运之骰·持续剧情线结算】',
          active.length
            ? `当前活跃剧情线（最多 ${MAX_ACTIVE_ARCS} 条）：\n${active.map(arc => `- [${arc.id}] ${arc.title}：${arc.summary || '暂无摘要'}`).join('\n')}`
            : '当前没有活跃剧情线。',
          '若本轮正文出现了实质性的线索、危机升级或承诺进展，请调用工具 fate_dice_arc_report 提交剧情线变更；每个用户回合最多新增 1 条，活跃上限 3 条，无实质进展则不要调用。'
        ].join('\n'))
      }
      if (settings.autoCheck) blocks.push(buildProfileSyncSection(game, settings))
      return blocks.filter(Boolean).join('\n\n')
    }
  })

  /** 结算段中的能力画像同步提示（首次建档 / 仅在实质变化时更新）。 */
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
        `- 当前骰制 ${rule}：tier 会自动换算为检定加值，玩家无需填写任何数值。`
      ].join('\n')
    }
    return [
      '【命运之骰·主角能力画像（动态演进）】',
      `当前画像已建立（${traits.length} 条）：${traits.map(item => `${item.name}[tier ${Number(item.tier) >= 0 ? '+' : ''}${Number(item.tier) || 0}]`).join('、')}`,
      '仅在正文或 MVU 发生实质的能力变化、伤病、境界突破/跌落或关键道具得失时，才调用 fate_dice_profile_sync 更新画像；无实质变化不要调用。'
    ].join('\n')
  }

  const arcReportTool = async (rawCall = {}, toolCtx = {}) => {
    const envelope = rawCall && typeof rawCall === 'object' ? rawCall : {}
    const payload = envelope.arguments && typeof envelope.arguments === 'object' ? envelope.arguments : envelope
    const gameId = payload.gameId || envelope.gameId || toolCtx?.gameId || lastActiveGameId || ''
    const report = payload.updates || payload.report || payload.arcs || payload
    const list = Array.isArray(report?.updates) ? report.updates : (Array.isArray(report) ? report : (Array.isArray(report?.arcs) ? report.arcs : []))
    if (gameId) pendingArcReportByGame.set(gameId, report)
    return { ok: true, gameId: gameId || null, accepted: list.length }
  }
  if (typeof tavern.settlementTool === 'function') tavern.settlementTool({
    name: 'fate_dice_arc_report',
    description: '提交持续剧情线的新增/更新/完结/暂停，每用户回合最多新增 1 条，活跃上限 3 条。',
    parameters: {
      type: 'object',
      properties: {
        gameId: { type: 'string', description: '当前对局 id（宿主上下文已提供时可省略）' },
        updates: {
          type: 'array',
          description: '本轮剧情线变更列表，按需提交 0~2 条',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['create', 'update', 'pause', 'resume', 'complete'] },
              arcId: { type: 'string', description: '更新已有剧情线时填写' },
              title: { type: 'string' },
              summary: { type: 'string' },
              anchors: { type: 'array', items: { type: 'string' } }
            }
          }
        }
      }
    },
    handler: arcReportTool,
    execute: arcReportTool
  })

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
  if (typeof tavern.settlementTool === 'function') tavern.settlementTool({
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

  // ── 结算推进 ───────────────────────────────────────────────────
  if (typeof tavern.onTurnSettled === 'function') tavern.onTurnSettled(async ({ gameId, turn, textVersion } = {}) => {
    if (!gameId) return
    const pending = pendingByGame.get(gameId)
    if (!pending || Number(pending.turn) !== Number(turn)) return
    pendingByGame.delete(gameId)

    const library = await readLibrary()
    const game = await readGame(gameId)
    const settings = pending.settings || effectiveSettings(library, game)
    const report = pendingArcReportByGame.get(gameId)
    pendingArcReportByGame.delete(gameId)
    const profileReport = pendingProfileByGame.get(gameId)
    pendingProfileByGame.delete(gameId)
    const settledRule = normalizeRule(settings.rule)

    let arcs = game.arcs
    let arcResult = null
    if (report && isStoryEnhance(settings)) {
      arcResult = mergeSettlementArcReport(arcs, report, turn)
      arcs = arcResult.arcs
    }

    const director = advanceDirectorOnSettled(game.director, {
      turn,
      pickedEvents: pending.pickedEvents,
      cooldownTurns: settings.cooldownTurns,
      sceneVarPath: settings.sceneVarPath,
      sceneAutoPaused: pending.sceneAutoPaused,
      nextSceneValue: pending.nextSceneValue,
      arcs
    })

    // 能力画像随结算动态演进：仅在结算模型提交时才覆盖，重算/回滚不丢既有画像
    let characterProfile = game.characterProfile || null
    if (profileReport) {
      const prevProfile = characterProfile && typeof characterProfile === 'object' ? characterProfile : {}
      const mergedTraits = profileReport.traits.length
        ? profileReport.traits
        : (Array.isArray(prevProfile.traits) ? prevProfile.traits : [])
      characterProfile = normalizeCharacterProfile({
        characterName: profileReport.characterName || prevProfile.characterName || '',
        archetype: profileReport.archetype || prevProfile.archetype || '',
        traits: mergedTraits,
        mvuHighlights: Array.isArray(prevProfile.mvuHighlights) ? prevProfile.mvuHighlights : [],
        customNote: prevProfile.customNote || '',
        updatedTurn: toInt(turn, 0),
        updatedAt: Date.now()
      }, settledRule)
    }

    const nextGame = {
      ...game,
      arcs,
      director,
      characterProfile: characterProfile || pending.characterProfile || null,
      summary: appendToSummary(game.summary, pending.roll, turn, pending.pickedEvents, pending.damperUsed),
      lastRoll: pending.roll || game.lastRoll,
      lastTurn: toInt(turn, game.lastTurn),
      updatedAt: Date.now()
    }
    await writeGame(gameId, nextGame)

    try {
      await tavern.saveTurnData({
        gameId,
        turn,
        textVersion,
        data: {
          roll: pending.roll,
          judged: pending.judged,
          pickedEvents: pending.pickedEvents,
          events: pending.events || (pending.pickedEvents || []).map(decorateEventForClient),
          trace: pending.trace,
          arcs,
          director: { sceneAutoPaused: pending.sceneAutoPaused, nextSceneValue: pending.nextSceneValue },
          storyEnhance: isStoryEnhance(settings),
          skillGroupId: pending.skillGroupId,
          characterProfile,
          arcResult
        }
      })
    } catch {
      // 落盘失败时仍继续广播，下一轮可重新结算
    }

    await tavern.publishState({ gameId, name: 'summary', data: nextGame.summary }).catch(() => {})
    await tavern.publishState({
      gameId,
      name: 'workbench-sync',
      data: {
        turn,
        summary: nextGame.summary,
        arcs,
        plotlines: toClientPlotlines(arcs),
        blockedThemes: toClientThemes(director.blockedTopics),
        cooldowns: toClientThemes(director.topicCooldowns),
        paused: director.pauseNextPush,
        director,
        lastRoll: nextGame.lastRoll,
        characterProfile: characterProfile ? normalizeCharacterProfile(characterProfile, settledRule) : null,
        contextSources: buildContextSources(characterProfile),
        arcResult
      }
    }).catch(() => {})

    for (const key of [...turnCacheByGame.keys()]) {
      if (key.startsWith(`${gameId}:${turn}:`)) turnCacheByGame.delete(key)
    }
  })

  if (typeof tavern.onTimelineChanged === 'function') tavern.onTimelineChanged(({ gameId } = {}) => {
    if (!gameId) return
    pendingByGame.delete(gameId)
    pendingArcReportByGame.delete(gameId)
    pendingProfileByGame.delete(gameId)
    for (const key of [...turnCacheByGame.keys()]) {
      if (key.startsWith(`${gameId}:`)) turnCacheByGame.delete(key)
    }
  })

  if (typeof tavern.onGameRemoved === 'function') tavern.onGameRemoved(({ gameId } = {}) => {
    if (!gameId) return
    pendingByGame.delete(gameId)
    pendingArcReportByGame.delete(gameId)
    pendingProfileByGame.delete(gameId)
    for (const key of [...turnCacheByGame.keys()]) {
      if (key.startsWith(`${gameId}:`)) turnCacheByGame.delete(key)
    }
  })

  // ── 浏览器侧 RPC ───────────────────────────────────────────────
  function handle(rpcName, fn) {
    if (typeof tavern.handle === 'function') tavern.handle(rpcName, fn)
  }

  async function buildBootstrap(params = {}) {
    const gameId = params.gameId || ''
    const library = await readLibrary()
    const game = await readGame(gameId)
    const settings = effectiveSettings(library, game)
    const skills = resolveGameSkills(library, game, settings)
    const skillGroup = resolveSkillGroup(library, game, settings)
    let judgeStatus = { available: false }
    if (typeof tavern.decisionJudgeStatus === 'function') {
      try {
        judgeStatus = await tavern.decisionJudgeStatus()
      } catch {
        judgeStatus = { available: false }
      }
    }
    let damperStatus = null
    if (typeof tavern.damperStatus === 'function') {
      try {
        damperStatus = await tavern.damperStatus({ gameId })
      } catch {
        damperStatus = null
      }
    }
    const characterProfile = profileOf(game, settings.rule)
    let profileMaterial = null
    if (gameId) {
      try {
        profileMaterial = await collectCharacterMaterial({ tavern, gameId, turn: Math.max(2, toInt(game.lastTurn, 1) + 1) })
      } catch {
        profileMaterial = null
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
      templates: listSkillTemplates(),
      skillGroups: library.skillGroups,
      eventGroups: library.eventGroups,
      eventGroupStats: library.eventGroups.map(group => ({ id: group.id, name: group.name, ...eventGroupStats(group) })),
      globalSettings: library.settings,
      gameConfig: { ...settings, skills },
      gameSkills: skills,
      characterProfile,
      contextSources: buildContextSources(characterProfile, profileMaterial),
      budget: computeSkillBudget(skills, settings.rule, game.config?.customBudget ?? skillGroup?.customBudget ?? null),
      arcs: game.arcs,
      activeArcs: activeArcsOf(game.arcs),
      director: game.director,
      summary: game.summary || emptySummary(),
      lastRoll: game.lastRoll,
      judgeStatus,
      damperStatus,
      damperLinkageAvailable: Boolean(tavern.capabilities?.narrativeDamper),
      limits: { maxActiveArcs: MAX_ACTIVE_ARCS, cacheEntries: MAX_CACHE_ENTRIES },
      defaults: DEFAULT_GLOBAL_SETTINGS
    }
  }

  handle('fate-dice:bootstrap', async (params = {}) => buildBootstrap(params || {}))

  async function handleSaveGlobalSettings(params = {}) {
    const library = await readLibrary()
    const incoming = params.settings || params.data || params.config || params
    const settings = sanitizeSettings(incoming, library.settings)
    const next = await saveLibrary({ ...library, settings })
    return { ok: true, settings: next.settings }
  }
  handle('fate-dice:save-global-settings', handleSaveGlobalSettings)

  async function handleSaveGameConfig(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const library = await readLibrary()
    const game = await readGame(gameId)
    const incoming = params.config || params.settings || params.data || {}
    const config = sanitizeSettings(incoming, effectiveSettings(library, game))
    const nextConfig = {}
    for (const key of Object.keys(DEFAULT_GLOBAL_SETTINGS)) {
      if (Object.hasOwn(incoming, key) || game.config[key] !== undefined) nextConfig[key] = config[key]
    }
    const skills = Array.isArray(params.skills)
      ? normalizeSkills(params.skills, config.rule)
      : (Array.isArray(incoming.skills) ? normalizeSkills(incoming.skills, config.rule) : game.skills)
    const nextGame = await writeGame(gameId, { ...game, config: nextConfig, skills })
    return { ok: true, config: nextConfig, skills: nextGame.skills, settings: effectiveSettings(library, nextGame) }
  }
  handle('fate-dice:save-game-config', handleSaveGameConfig)

  async function handleUpdateGameSkills(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const library = await readLibrary()
    const game = await readGame(gameId)
    const settings = effectiveSettings(library, game)
    const rule = normalizeRule(params.rule || settings.rule)
    const source = Array.isArray(params.skills) ? params.skills : game.skills
    const skills = normalizeSkills(source, rule)
    const config = { ...game.config }
    if (params.skillGroupId !== undefined) config.skillGroupId = String(params.skillGroupId || '')
    if (params.customBudget !== undefined) config.customBudget = recommendedSkillBudget(rule, skills.length, params.customBudget)
    if (params.rule !== undefined) config.rule = rule
    const nextGame = await writeGame(gameId, { ...game, config, skills })
    return {
      ok: true,
      skills: nextGame.skills,
      rule,
      budget: computeSkillBudget(nextGame.skills, rule, config.customBudget ?? null)
    }
  }
  handle('fate-dice:update-game-skills', handleUpdateGameSkills)

  function findGroupIndex(groups, groupId) {
    return (Array.isArray(groups) ? groups : []).findIndex(group => String(group.id) === String(groupId))
  }

  async function handleSkillGroupOp(params = {}) {
    const library = await readLibrary()
    const groups = cloneJson(library.skillGroups) || []
    const op = normalizeGroupOp(params.op || params.action || 'update')
    const groupId = params.groupId || params.id || params.group?.id || ''

    if (op === 'create' || op === 'add' || op === 'template') {
      const templateId = params.templateId || params.template || ''
      let group
      if (templateId && getSkillTemplate(templateId)) {
        const template = getSkillTemplate(templateId)
        group = createSkillGroup({
          name: params.name || template.name,
          rule: params.rule || library.settings.rule,
          skills: createSkillsFromTemplate(templateId, params.rule || library.settings.rule),
          customBudget: params.customBudget ?? null,
          templateId
        })
      } else {
        group = createSkillGroup({
          name: params.name || params.group?.name || '新建技能组',
          rule: params.rule || params.group?.rule || library.settings.rule,
          skills: params.skills || params.group?.skills || [],
          customBudget: params.customBudget ?? params.group?.customBudget ?? null,
          templateId: params.templateId || null
        })
      }
      groups.push(group)
      const saved = await saveLibrary({ ...library, skillGroups: groups })
      return { ok: true, op: 'create', group, skillGroups: saved.skillGroups }
    }

    const index = findGroupIndex(groups, groupId)
    if (index < 0) return { ok: false, error: '技能组不存在' }

    if (op === 'delete' || op === 'remove') {
      groups.splice(index, 1)
      const saved = await saveLibrary({ ...library, skillGroups: groups })
      return { ok: true, op: 'delete', skillGroups: saved.skillGroups }
    }

    if (op === 'duplicate' || op === 'copy') {
      const source = groups[index]
      const copy = createSkillGroup({
        name: `${source.name} 副本`,
        rule: source.rule,
        skills: source.skills,
        customBudget: source.customBudget,
        templateId: source.templateId
      })
      groups.push(copy)
      const saved = await saveLibrary({ ...library, skillGroups: groups })
      return { ok: true, op: 'duplicate', group: copy, skillGroups: saved.skillGroups }
    }

    if (op === 'randomize' || op === 'reset') {
      const group = groups[index]
      group.skills = op === 'randomize'
        ? randomizeSkillBonuses(group.skills, group.rule, group.customBudget, randomInt)
        : resetRecommendedBonuses(group.skills, group.rule)
      group.updatedAt = Date.now()
      const saved = await saveLibrary({ ...library, skillGroups: groups })
      return { ok: true, op, group, skillGroups: saved.skillGroups, budget: computeSkillBudget(group.skills, group.rule, group.customBudget) }
    }

    const patch = params.patch || params.group || {}
    const group = groups[index]
    const rule = normalizeRule(patch.rule || params.rule || group.rule)
    if (patch.name !== undefined || params.name !== undefined) group.name = String(patch.name ?? params.name ?? group.name).slice(0, 60)
    if (patch.rule !== undefined || params.rule !== undefined) group.rule = rule
    if (patch.skills !== undefined || params.skills !== undefined) {
      group.skills = normalizeSkills(patch.skills ?? params.skills, rule)
    } else if (group.rule !== rule) {
      group.skills = normalizeSkills(group.skills, rule)
    }
    if (patch.customBudget !== undefined || params.customBudget !== undefined) {
      const rawBudget = patch.customBudget ?? params.customBudget
      group.customBudget = rawBudget === null ? null : recommendedSkillBudget(rule, group.skills.length, rawBudget)
    }
    if (patch.templateId !== undefined) group.templateId = patch.templateId
    group.updatedAt = Date.now()
    const saved = await saveLibrary({ ...library, skillGroups: groups })
    return { ok: true, op: 'update', group, skillGroups: saved.skillGroups, budget: computeSkillBudget(group.skills, group.rule, group.customBudget) }
  }
  handle('fate-dice:skill-group-op', handleSkillGroupOp)

  async function handleEventGroupOp(params = {}) {
    const library = await readLibrary()
    const groups = cloneJson(library.eventGroups) || []
    const op = normalizeGroupOp(params.op || params.action || 'update')
    const groupId = params.groupId || params.id || params.group?.id || ''
    const index = findGroupIndex(groups, groupId)

    if (op === 'create' || op === 'add') {
      const group = params.template === 'general' || params.templateId === 'general'
        ? createGeneralPlotTemplateGroup(params.suffix || '新建')
        : normalizeEventGroup(params.group || {
            name: params.name || '新建事件组',
            description: params.description || '',
            tracks: params.tracks || []
          }, '新建事件组')
      if (!group) return { ok: false, error: '事件组内容无效' }
      groups.push(group)
      const saved = await saveLibrary({ ...library, eventGroups: groups })
      return { ok: true, op: 'create', group, eventGroups: saved.eventGroups }
    }

    if (index < 0) return { ok: false, error: '事件组不存在' }

    if (op === 'delete' || op === 'remove') {
      groups.splice(index, 1)
      const saved = await saveLibrary({ ...library, eventGroups: groups })
      return { ok: true, op: 'delete', eventGroups: saved.eventGroups }
    }

    if (op === 'duplicate' || op === 'copy') {
      const source = groups[index]
      const copy = normalizeEventGroup({
        ...cloneJson(source),
        id: undefined,
        name: params.name || `${source.name} 副本`
      })
      groups.push(copy)
      const saved = await saveLibrary({ ...library, eventGroups: groups })
      return { ok: true, op: 'duplicate', group: copy, eventGroups: saved.eventGroups }
    }

    if (op === 'template' || op === 'load-template') {
      const group = createGeneralPlotTemplateGroup(params.suffix || '副本')
      group.name = params.name || group.name
      groups.push(group)
      const saved = await saveLibrary({ ...library, eventGroups: groups })
      return { ok: true, op: 'template', group, eventGroups: saved.eventGroups }
    }

    const group = groups[index]
    const trackId = params.trackId || params.track?.id || ''
    const itemId = params.itemId || params.item?.id || ''
    const trackIndex = (Array.isArray(group.tracks) ? group.tracks : []).findIndex(track => String(track.id) === String(trackId))

    if (op === 'add-track') {
      group.tracks = [...(group.tracks || []), createEventTrack({
        name: params.name || params.track?.name || '新事件轨',
        mode: params.mode || params.track?.mode || 'dn',
        sides: params.sides ?? params.track?.sides ?? null,
        items: params.items || params.track?.items || []
      })]
    } else if (op === 'update-track') {
      if (trackIndex < 0) return { ok: false, error: '事件轨不存在' }
      const track = group.tracks[trackIndex]
      const patch = params.track || params.patch || {}
      if (patch.name !== undefined || params.name !== undefined) track.name = String(patch.name ?? params.name)
      if (patch.enabled !== undefined || params.enabled !== undefined) track.enabled = Boolean(patch.enabled ?? params.enabled)
      if (patch.mode !== undefined || params.mode !== undefined) track.mode = patch.mode ?? params.mode
      if (patch.sides !== undefined || params.sides !== undefined) track.sides = toInt(patch.sides ?? params.sides, track.sides)
      if (Array.isArray(patch.items) || Array.isArray(params.items)) {
        track.items = (patch.items || params.items).map(item => createEventItem(item))
      }
    } else if (op === 'delete-track') {
      if (trackIndex < 0) return { ok: false, error: '事件轨不存在' }
      group.tracks.splice(trackIndex, 1)
    } else if (op === 'add-item') {
      if (trackIndex < 0) return { ok: false, error: '事件轨不存在' }
      group.tracks[trackIndex].items.push(createEventItem(params.item || params))
    } else if (op === 'update-item') {
      if (trackIndex < 0) return { ok: false, error: '事件轨不存在' }
      const itemIndex = group.tracks[trackIndex].items.findIndex(item => String(item.id) === String(itemId))
      if (itemIndex < 0) return { ok: false, error: '事件条目不存在' }
      group.tracks[trackIndex].items[itemIndex] = createEventItem({ ...group.tracks[trackIndex].items[itemIndex], ...(params.item || params.patch || {}) })
    } else if (op === 'delete-item') {
      if (trackIndex < 0) return { ok: false, error: '事件轨不存在' }
      group.tracks[trackIndex].items = group.tracks[trackIndex].items.filter(item => String(item.id) !== String(itemId))
    } else if (params.group || params.patch || params.name !== undefined || params.tracks) {
      const merged = normalizeEventGroup({
        ...group,
        ...(params.patch || params.group || {}),
        ...(params.name !== undefined ? { name: params.name } : {}),
        ...(params.description !== undefined ? { description: params.description } : {}),
        ...(params.tracks !== undefined ? { tracks: params.tracks } : {})
      }, group.name)
      if (!merged) return { ok: false, error: '事件组内容无效' }
      groups[index] = merged
    } else {
      return { ok: false, error: `未知事件组操作 ${op}` }
    }

    groups[index] = normalizeEventGroup(groups[index], group.name) || groups[index]
    const saved = await saveLibrary({ ...library, eventGroups: groups })
    return { ok: true, op, group: groups[index], eventGroups: saved.eventGroups }
  }
  handle('fate-dice:event-group-op', handleEventGroupOp)

  async function handleArcOp(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const game = await readGame(gameId)
    const rawOp = String(params.op || params.action || '').toLowerCase()
    const arcOp = rawOp === 'finish' || rawOp === 'close' ? 'complete' : (rawOp === 'add' || rawOp === 'new' ? 'create' : rawOp)
    const result = applyArcOp(game.arcs, {
      op: arcOp || undefined,
      arcId: params.arcId || params.id,
      arc: params.arc,
      title: params.title,
      summary: params.summary,
      anchors: params.anchors,
      status: params.status,
      turn: params.turn ?? game.lastTurn
    })
    if (!result.ok) return { ok: false, error: result.reason, arcs: result.arcs }
    await writeGame(gameId, { ...game, arcs: result.arcs })
    await tavern.publishState({ gameId, name: 'workbench-sync', data: { arcs: result.arcs, activeArcs: activeArcsOf(result.arcs) } }).catch(() => {})
    return { ok: true, op: result.op, arcs: result.arcs, activeArcs: activeArcsOf(result.arcs), arc: result.arc }
  }
  handle('fate-dice:arc-op', handleArcOp)

  async function handleTopicOp(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const game = await readGame(gameId)
    const op = String(params.op || params.action || 'block').toLowerCase().replace(/[\s_]+/g, '-')
    let director
    if (op === 'block' || op === 'block-topic') director = blockTopic(game.director, params.topic, params.turns ?? DEFAULT_GLOBAL_SETTINGS.blockedTopicTurns)
    else if (op === 'unblock' || op === 'unblock-topic') director = unblockTopic(game.director, params.topic)
    else if (op === 'pause-push' || op === 'pause-next-push' || op === 'pause' || op === 'pause-next') director = pauseNextPush(game.director, true)
    else if (op === 'resume-push' || op === 'resume-next-push' || op === 'resume') director = pauseNextPush(game.director, false)
    else return { ok: false, error: `未知主题操作 ${op}` }
    await writeGame(gameId, { ...game, director })
    await tavern.publishState({ gameId, name: 'workbench-sync', data: { director } }).catch(() => {})
    return { ok: true, op, director }
  }
  handle('fate-dice:topic-op', handleTopicOp)

  async function handleReadTurn(params = {}) {
    const gameId = params.gameId
    const turn = toInt(params.turn, 0)
    if (!gameId) return null
    let stored = null
    try {
      if (typeof tavern.readTurnData === 'function') stored = await tavern.readTurnData({ gameId, turn })
    } catch {
      stored = null
    }
    const pending = pendingByGame.get(gameId)
    if (stored && stored.turn === turn && stored.data) {
      const picked = stored.data.pickedEvents || []
      return {
        turn,
        textVersion: stored.textVersion ?? null,
        roll: stored.data.roll || null,
        judged: stored.data.judged || null,
        pickedEvents: picked,
        events: stored.data.events || picked.map(decorateEventForClient),
        trace: stored.data.trace || [],
        arcs: stored.data.arcs || [],
        storyEnhance: Boolean(stored.data.storyEnhance)
      }
    }
    if (pending && Number(pending.turn) === turn) {
      const picked = pending.pickedEvents || []
      return {
        turn,
        textVersion: null,
        roll: pending.roll,
        judged: pending.judged,
        pickedEvents: picked,
        events: pending.events || picked.map(decorateEventForClient),
        trace: pending.trace,
        arcs: activeArcsOf((await readGame(gameId)).arcs),
        storyEnhance: isStoryEnhance(pending.settings)
      }
    }
    return null
  }
  handle('fate-dice:read-turn', handleReadTurn)

  async function handleRerollTurn(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const library = await readLibrary()
    const game = await readGame(gameId)
    const settings = effectiveSettings(library, game)
    const pendingRecord = pendingByGame.get(gameId)

    if (params.check || params.difficulty || (!params.turn && !pendingRecord)) {
      const skills = resolveGameSkills(library, game, settings)
      const matched = skills.find(item => String(item.id) === String(params.skillId || '')) ||
        (params.check ? skills.find(item => String(item.name) === String(params.check)) : null)
      const roll = rollCheck({
        rule: normalizeRule(params.rule || settings.rule),
        skillId: params.skillId || matched?.id || 'general',
        skillName: params.check || matched?.name || '自由检定',
        skillBonus: params.skillBonus ?? matched?.bonus ?? 0,
        difficulty: normalizeDifficulty(params.difficulty),
        modifier: params.modifier ?? 0,
        hidden: Boolean(params.hidden),
        attempt: String(params.input || '面板手动重投').slice(0, 120),
        reason: '插件面板手动重投',
        stakes: '手动裁定结果'
      })
      roll.modifierBreakdown = { skillBonus: roll.skillBonus, edgeBonus: 0, varModifier: 0, matchedVars: [], toneBonus: 0 }
      await tavern.publishState({
        gameId,
        name: 'live-roll',
        data: { id: `reroll-${roll.rolledAt}`, turn: params.turn || 0, kind: 'reroll', roll, animation: settings.animation }
      }).catch(() => {})
      return { ok: true, kind: 'manual', roll, injection: buildTurnInjection({ roll, activeArcs: activeArcsOf(game.arcs), storyEnhance: isStoryEnhance(settings) }) }
    }

    const turn = toInt(params.turn, pendingRecord?.turn || 0)
    let stored = null
    try {
      if (typeof tavern.readTurnData === 'function') stored = await tavern.readTurnData({ gameId, turn })
    } catch {
      stored = null
    }
    if (stored?.textVersion) {
      return { ok: false, error: '该回合正文已正式结算，无法重投；可在面板发起自由检定', turn }
    }
    const sourceInput = String(params.input || pendingRecord?.input || '').trim()
    if (!sourceInput) return { ok: false, error: '缺少原始输入，无法重投', turn }

    for (const key of [...turnCacheByGame.keys()]) {
      if (key.startsWith(`${gameId}:${turn}:`)) turnCacheByGame.delete(key)
    }
    const record = await computeTurn({ gameId, turn, input: sourceInput, force: true, overrideSettings: params.settings || null })
    return {
      ok: true,
      kind: 'turn',
      turn,
      roll: record.roll || null,
      pickedEvents: record.pickedEvents || [],
      injection: record.injection || '',
      sceneAutoPaused: Boolean(record.sceneAutoPaused)
    }
  }
  handle('fate-dice:reroll-turn', handleRerollTurn)

  async function handleFreeRoll(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const library = await readLibrary()
    const game = await readGame(gameId)
    const settings = effectiveSettings(library, game)
    const result = rollExpression(params.expression || '2d6')
    await tavern.publishState({
      gameId,
      name: 'live-roll',
      data: { id: `free-${result.rolledAt}`, turn: 0, kind: 'free', result, animation: settings.animation }
    }).catch(() => {})
    return { ok: true, result }
  }
  handle('fate-dice:free-roll', handleFreeRoll)

  async function handleExport(params = {}) {
    const library = await readLibrary()
    const skillIds = Array.isArray(params.skillGroupIds) ? params.skillGroupIds : (Array.isArray(params.skillGroupId) ? params.skillGroupId : null)
    const eventIds = Array.isArray(params.eventGroupIds) ? params.eventGroupIds : (Array.isArray(params.eventGroupId) ? params.eventGroupId : null)
    const bundle = params.sample
      ? buildSampleExportBundle()
      : buildNativeExportBundle({
          skillGroups: (skillIds ? library.skillGroups.filter(group => skillIds.includes(group.id)) : library.skillGroups),
          eventGroups: (eventIds ? library.eventGroups.filter(group => eventIds.includes(group.id)) : library.eventGroups)
        })
    return { ok: true, bundle, json: JSON.stringify(bundle, null, 2), filename: `fate-dice-${Date.now()}.json` }
  }
  handle('fate-dice:export', handleExport)

  function readImportText(params = {}) {
    const raw = params.json ?? params.jsonText ?? params.text ?? params.content ?? params.data ?? ''
    return typeof raw === 'string' ? raw : JSON.stringify(raw)
  }

  async function handleImportPreview(params = {}) {
    const preview = previewImportConfig(readImportText(params))
    if (!preview || !preview.ok) return preview
    const rawSkills = preview.data?.skillGroups || preview.skillGroups || []
    const rawEvents = preview.data?.eventGroups || preview.eventGroups || []
    return {
      ...preview,
      skillGroups: toClientSkillGroups(rawSkills),
      eventGroups: toClientEventGroups(rawEvents),
      skillGroupCount: rawSkills.length,
      eventGroupCount: rawEvents.length
    }
  }
  handle('fate-dice:import-preview', handleImportPreview)

  async function handleImportApply(params = {}) {
    const library = await readLibrary()
    let rawInput = params
    if (params && typeof params === 'object' && (Array.isArray(params.skillGroups) || Array.isArray(params.eventGroups)) && !params.json && !params.jsonText && !params.text) {
      rawInput = JSON.stringify({
        format: 'dsh-fate-dice-v2',
        version: 2,
        skillGroups: fromClientSkillGroups(params.skillGroups || []),
        eventGroups: fromClientEventGroups(params.eventGroups || [])
      })
    } else {
      rawInput = readImportText(params)
    }
    const result = applyImportConfig(rawInput, library.skillGroups, library.eventGroups)
    if (!result.ok) return result
    const saved = await saveLibrary({
      ...library,
      skillGroups: result.skillGroups,
      eventGroups: result.eventGroups
    })
    if (params.gameId) {
      await tavern.publishState({
        gameId: params.gameId,
        name: 'workbench-sync',
        data: { skillGroups: toClientSkillGroups(saved.skillGroups), eventGroups: toClientEventGroups(saved.eventGroups) }
      }).catch(() => {})
    }
    return { ...result, skillGroups: toClientSkillGroups(saved.skillGroups), eventGroups: toClientEventGroups(saved.eventGroups) }
  }
  handle('fate-dice:import-apply', handleImportApply)

  // ── 浏览器工作台兼容 RPC（与 client 的 workbench/save-* 命名对齐） ──
  const CLIENT_TYPE_BY_CATEGORY = Object.freeze({ push: '推动', vibe: '氛围', constant: '常驻' })
  const CATEGORY_BY_CLIENT_TYPE = Object.freeze({ '推动': 'push', '氛围': 'vibe', '常驻': 'constant' })
  const CLIENT_OP_BY_OP = Object.freeze({ '==': '=', '!=': '≠', '>=': '≥', '<=': '≤', '>': '>', '<': '<', contains: '包含', not_contains: '不包含' })
  const OP_BY_CLIENT = Object.freeze({ '=': '==', '≠': '!=', '≥': '>=', '≤': '<=', '>': '>', '<': '<', '包含': 'contains', '不包含': 'not_contains' })
  const TEMPLATE_RULE_HINT = Object.freeze({
    dnd5e: 'd20', detective: 'd100', fantasy: 'd20', apocalypse: 'd100', cyberpunk: 'd20', urban_power: 'd20', cthulhu: 'd100'
  })

  function inferCategoryFromName(name) {
    const text = String(name || '')
    if (/察觉|观察|侦查|调查|识破|倾听|感知|探|搜|洞察|情报/.test(text)) return 'insight'
    if (/潜行|隐匿|开锁|偷|踪|藏|伪装/.test(text)) return 'stealth'
    if (/说服|交涉|谈判|威吓|欺|社交|魅|话术|表演|唱/.test(text)) return 'social'
    if (/意志|抵抗|忍|定力|心性|专注|抗压|精神/.test(text)) return 'will'
    if (/法术|奥术|丹|阵|符|医|炼|机械|黑客|骇|技艺|学|知识|修理|驾驶|代码|机关/.test(text)) return 'arcana'
    return 'physical'
  }

  function toClientConditions(conditions) {
    return (Array.isArray(conditions) ? conditions : []).map(cond => {
      const kind = cond?.kind || 'mvu'
      if (kind === 'arc' || kind === 'storyline') {
        return { path: `剧情线:${cond.arcId || cond.id || ''}`, op: '=', value: String(cond.status || cond.state || 'active') }
      }
      if (kind === 'input' || kind === 'keyword') {
        const list = cond.keywords !== undefined ? cond.keywords : (cond.contains ?? cond.value ?? '')
        const excluded = cond.mode === 'exclude' || cond.not === true || cond.negate === true || cond.op === 'not_contains'
        return { path: '', op: excluded ? '不包含' : '包含', value: Array.isArray(list) ? list.join('，') : String(list ?? '') }
      }
      return {
        path: String(cond.path || cond.key || ''),
        op: CLIENT_OP_BY_OP[cond.op || cond.operator || '=='] || '=',
        value: String(cond.value ?? cond.equals ?? '')
      }
    }).filter(cond => cond.path || cond.value)
  }

  function fromClientConditions(conditions) {
    const out = []
    for (const cond of Array.isArray(conditions) ? conditions : []) {
      if (!cond || typeof cond !== 'object') continue
      const path = String(cond.path || '').trim()
      const op = String(cond.op || '=').trim()
      const value = cond.value
      if (path.startsWith('剧情线:')) {
        out.push({ kind: 'arc', arcId: path.slice(4), status: String(value || 'active') })
        continue
      }
      if (!path) {
        if (!String(value || '').trim()) continue
        const words = String(value).split(/[，,;；]+/).map(item => item.trim()).filter(Boolean)
        out.push({ kind: 'input', keywords: words, mode: op === '不包含' ? 'exclude' : 'include' })
        continue
      }
      out.push({
        kind: 'mvu',
        path,
        op: OP_BY_CLIENT[op] || '==',
        value: /^-?\d+(\.\d+)?$/.test(String(value)) ? Number(value) : value
      })
    }
    return out
  }

  function toClientSkillGroups(groups) {
    return (Array.isArray(groups) ? groups : []).map(group => ({
      id: group.id,
      name: group.name,
      rule: group.rule,
      mvuPath: String(group.mvuPath || ''),
      updatedAt: group.updatedAt,
      skills: (group.skills || []).map(skill => ({
        id: skill.id,
        name: skill.name,
        bonus: skill.bonus,
        hidden: skill.hidden,
        category: skill.category
      }))
    }))
  }

  function fromClientSkillGroups(incoming) {
    const existing = libraryCache?.skillGroups || []
    return (Array.isArray(incoming) ? incoming : []).map(raw => {
      const old = existing.find(group => String(group.id) === String(raw?.id)) || existing.find(group => group.name === raw?.name)
      const rule = normalizeRule(raw?.rule || old?.rule || '2d6')
      const skills = (Array.isArray(raw?.skills) ? raw.skills : []).map(skill => {
        const prior = (old?.skills || []).find(item => String(item.id) === String(skill?.id)) ||
          (old?.skills || []).find(item => item.name === skill?.name)
        return {
          id: String(skill?.id || skill?.name || ''),
          name: String(skill?.name || '未命名技能'),
          category: prior?.category || inferCategoryFromName(skill?.name),
          hidden: Boolean(skill?.hidden),
          bonus: toInt(skill?.bonus, 0)
        }
      }).filter(skill => skill.name)
      const group = createSkillGroup({
        name: raw?.name || old?.name || '技能组',
        rule,
        skills,
        customBudget: old?.customBudget ?? null,
        templateId: old?.templateId || null
      })
      group.mvuPath = String(raw?.mvuPath ?? old?.mvuPath ?? '').slice(0, 200)
      if (raw?.id) group.id = String(raw.id)
      if (old?.createdAt) group.createdAt = old.createdAt
      group.mvuPath = String(raw?.mvuPath ?? old?.mvuPath ?? '').slice(0, 200)
      return group
    }).filter(group => group.skills.length)
  }

  function toClientEventGroups(groups) {
    return (Array.isArray(groups) ? groups : []).map(group => ({
      id: group.id,
      name: group.name,
      description: group.description,
      updatedAt: group.updatedAt,
      tracks: (group.tracks || []).map(track => ({
        id: track.id,
        name: track.name,
        enabled: track.enabled !== false,
        mode: track.mode,
        sides: track.sides,
        entries: (track.items || []).map(item => ({
          id: item.id,
          text: item.text,
          type: CLIENT_TYPE_BY_CATEGORY[item.category] || '推动',
          theme: item.topic || '',
          min: item.min === null || item.min === undefined ? 1 : item.min,
          max: item.max === null || item.max === undefined ? 100 : item.max,
          weight: item.weight || 1,
          conditions: toClientConditions(item.conditions)
        }))
      }))
    }))
  }

  function fromClientEventGroups(incoming) {
    const existing = libraryCache?.eventGroups || []
    return (Array.isArray(incoming) ? incoming : []).map(raw => {
      const oldGroup = existing.find(group => String(group.id) === String(raw?.id)) || existing.find(group => group.name === raw?.name)
      const tracks = (Array.isArray(raw?.tracks) ? raw.tracks : []).map(track => {
        const oldTrack = (oldGroup?.tracks || []).find(item => String(item.id) === String(track?.id))
        const sourceItems = Array.isArray(track?.entries) ? track.entries : (Array.isArray(track?.items) ? track.items : [])
        const items = sourceItems.map(entry => {
          const prior = (oldTrack?.items || []).find(item => String(item.id) === String(entry?.id))
          const category = CATEGORY_BY_CLIENT_TYPE[entry?.type] || entry?.category || prior?.category || 'push'
          return createEventItem({
            id: entry?.id,
            text: entry?.text,
            category,
            topic: entry?.theme !== undefined ? entry.theme : (entry?.topic ?? prior?.topic ?? ''),
            weight: entry?.weight,
            min: entry?.min ?? prior?.min ?? null,
            max: entry?.max ?? prior?.max ?? null,
            arcId: prior?.arcId || entry?.arcId || '',
            conditions: Array.isArray(entry?.conditions) && entry.conditions.length
              ? fromClientConditions(entry.conditions)
              : (prior?.conditions || [])
          })
        }).filter(item => item.text)
        return createEventTrack({
          id: track?.id,
          name: track?.name,
          enabled: track?.enabled !== false,
          mode: track?.mode,
          sides: track?.sides,
          items
        })
      })
      return normalizeEventGroup({
        id: raw?.id,
        name: raw?.name,
        description: raw?.description || oldGroup?.description || '',
        tracks
      }, raw?.name || '事件组')
    }).filter(Boolean)
  }

  function toClientPlotlines(arcs) {
    return normalizeArcs(arcs).map(arc => ({
      id: arc.id,
      title: arc.title,
      origin: arc.origin || arc.summary || '',
      progress: arc.progress || (arc.anchors || []).join('；') || '',
      status: arc.status === 'completed' ? 'closed' : arc.status,
      createdAt: arc.createdAt || Date.now()
    }))
  }

  function toClientThemes(map) {
    return Object.entries(map && typeof map === 'object' ? map : {}).map(([theme, rounds]) => ({ theme, rounds: toInt(rounds, 0) }))
  }

  function settingsForClient(settings) {
    return {
      sensitivity: settings.sensitivity,
      toneBias: settings.toneBias,
      autoHidden: settings.allowHidden,
      damperLinkage: settings.damperLinkage,
      allowHeuristicFallback: Boolean(settings.allowHeuristicFallback),
      animation: settings.animation,
      maxPlotPush: settings.maxPushPerTurn,
      maxAmbience: settings.maxVibePerTurn,
      themeCooldown: settings.cooldownTurns,
      scenePath: settings.sceneVarPath,
      allowHidden: settings.allowHidden,
      maxPushPerTurn: settings.maxPushPerTurn,
      maxVibePerTurn: settings.maxVibePerTurn,
      cooldownTurns: settings.cooldownTurns,
      sceneVarPath: settings.sceneVarPath
    }
  }

  async function handleWorkbench(params = {}) {
    const gameId = params.gameId || ''
    const library = await readLibrary()
    const game = await readGame(gameId)
    const settings = effectiveSettings(library, game)
    let judgeStatus = { available: false }
    if (typeof tavern.decisionJudgeStatus === 'function') {
      try {
        judgeStatus = await tavern.decisionJudgeStatus()
      } catch {
        judgeStatus = { available: false }
      }
    }
    const characterProfile = profileOf(game, settings.rule)
    let profileMaterial = null
    if (gameId) {
      try {
        profileMaterial = await collectCharacterMaterial({ tavern, gameId, turn: Math.max(2, toInt(game.lastTurn, 1) + 1) })
      } catch {
        profileMaterial = null
      }
    }
    return {
      settings: settingsForClient(settings),
      rule: settings.rule,
      characterProfile,
      contextSources: buildContextSources(characterProfile, profileMaterial),
      autoCheck: settings.autoCheck,
      multiTrack: settings.randomEvents,
      enhanced: settings.storyEnhance,
      paused: game.director.pauseNextPush,
      skillGroups: toClientSkillGroups(library.skillGroups),
      eventGroups: toClientEventGroups(library.eventGroups),
      skillTemplates: listSkillTemplates().map(template => ({
        id: template.id,
        name: template.name,
        rule: TEMPLATE_RULE_HINT[template.id] || '2d6',
        note: template.description,
        skills: template.skills
      })),
      binding: {
        skillGroupId: game.config.skillGroupId || settings.skillGroupId || '',
        eventGroupId: game.config.longEventGroupId || settings.longEventGroupId || '',
        sceneEventGroupId: game.config.sceneEventGroupId || settings.sceneEventGroupId || '',
        sceneSuspended: game.director.sceneGroupPaused,
        autoCheck: settings.autoCheck,
        multiTrack: settings.randomEvents,
        enhanced: settings.storyEnhance
      },
      plotlines: toClientPlotlines(game.arcs),
      blockedThemes: toClientThemes(game.director.blockedTopics),
      cooldowns: toClientThemes(game.director.topicCooldowns),
      damper: { available: Boolean(tavern.capabilities?.narrativeDamper), linkage: settings.damperLinkage },
      damperBridgeAvailable: Boolean(tavern.capabilities?.narrativeDamper),
      damperLinkage: settings.damperLinkage,
      judgeStatus,
      summary: game.summary || emptySummary(),
      source: 'host'
    }
  }
  handle('fate-dice:workbench', handleWorkbench)

  async function handleRefreshProfile(params = {}) {
    const gameId = params.gameId || lastActiveGameId || ''
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const library = await readLibrary()
    const game = await readGame(gameId)
    const settings = effectiveSettings(library, game)
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
        contextSources,
        contextDigest: result.raw || ''
      }
    }
    const saved = {
      ...characterProfile,
      updatedTurn: turn,
      updatedAt: Date.now()
    }
    await writeGame(gameId, { ...game, characterProfile: saved })
    await tavern.publishState({
      gameId,
      name: 'workbench-sync',
      data: { characterProfile: saved, contextSources, refreshedAt: Date.now(), turn }
    }).catch(() => {})
    return { ok: true, turn, characterProfile: saved, contextSources }
  }
  handle('fate-dice:refresh-profile', handleRefreshProfile)

  async function handleSaveProfileNote(params = {}) {
    const gameId = params.gameId || ''
    const library = await readLibrary()
    if (!gameId) {
      if (params.rule !== undefined && params.rule !== '') {
        const nextRule = normalizeRule(params.rule)
        const savedLib = await saveLibrary({ ...library, settings: { ...library.settings, rule: nextRule } })
        return { ok: true, rule: savedLib.settings.rule, characterProfile: null, contextSources: null }
      }
      return { ok: false, error: '缺少 gameId' }
    }
    const game = await readGame(gameId)
    const settings = effectiveSettings(library, game)
    const nextRule = params.rule !== undefined && params.rule !== ''
      ? normalizeRule(params.rule)
      : normalizeRule(settings.rule)
    const config = { ...game.config }
    if (params.rule !== undefined && params.rule !== '') config.rule = nextRule
    const base = game.characterProfile ? normalizeCharacterProfile(game.characterProfile, nextRule) : null
    const characterProfile = base || normalizeCharacterProfile({}, nextRule)
    if (params.customNote !== undefined) characterProfile.customNote = String(params.customNote || '').slice(0, 200)
    // 切换骰制时 traits 的 bonus 已在 normalizeCharacterProfile 中按 nextRule 重算
    characterProfile.updatedAt = Date.now()
    await writeGame(gameId, { ...game, config, characterProfile })
    const contextSources = buildContextSources(characterProfile)
    await tavern.publishState({
      gameId,
      name: 'workbench-sync',
      data: {
        characterProfile,
        contextSources,
        rule: nextRule,
        traits: characterProfile.traits.map(item => ({ id: item.id, name: item.name, tier: item.tier, bonus: item.bonus }))
      }
    }).catch(() => {})
    return { ok: true, rule: nextRule, characterProfile, contextSources }
  }
  handle('fate-dice:save-profile-note', handleSaveProfileNote)

  async function handleSaveSkillGroups(params = {}) {
    const library = await readLibrary()
    const groups = fromClientSkillGroups(params.skillGroups || [])
    if (!groups.length) return { ok: false, error: '技能组内容为空' }
    const saved = await saveLibrary({ ...library, skillGroups: groups })
    if (params.gameId) {
      const game = await readGame(params.gameId)
      if (game.skills) await writeGame(params.gameId, { ...game, skills: null })
    }
    return { ok: true, skillGroups: toClientSkillGroups(saved.skillGroups) }
  }
  handle('fate-dice:save-skill-groups', handleSaveSkillGroups)

  async function handleSaveEventGroups(params = {}) {
    const library = await readLibrary()
    const groups = fromClientEventGroups(params.eventGroups || [])
    if (!groups.length) return { ok: false, error: '事件组内容为空' }
    const saved = await saveLibrary({ ...library, eventGroups: groups })
    return { ok: true, eventGroups: toClientEventGroups(saved.eventGroups) }
  }
  handle('fate-dice:save-event-groups', handleSaveEventGroups)

  async function handleSaveBinding(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const game = await readGame(gameId)
    const binding = params.binding && typeof params.binding === 'object' ? params.binding : params
    const config = { ...game.config }
    if (binding.skillGroupId !== undefined) config.skillGroupId = String(binding.skillGroupId || '')
    if (binding.eventGroupId !== undefined) config.longEventGroupId = String(binding.eventGroupId || '')
    if (binding.sceneEventGroupId !== undefined) config.sceneEventGroupId = String(binding.sceneEventGroupId || '')
    if (typeof binding.autoCheck === 'boolean') config.autoCheck = binding.autoCheck
    if (typeof binding.multiTrack === 'boolean') config.randomEvents = binding.multiTrack
    if (typeof binding.enhanced === 'boolean') config.storyEnhance = binding.enhanced
    if (typeof binding.rule === 'string') config.rule = normalizeRule(binding.rule)
    const director = { ...game.director }
    if (binding.sceneSuspended !== undefined) director.sceneGroupPaused = Boolean(binding.sceneSuspended)
    const nextSkills = binding.skillGroupId !== undefined && binding.skillGroupId !== game.config.skillGroupId
      ? null
      : game.skills
    await writeGame(gameId, { ...game, skills: nextSkills, config, director })
    return { ok: true, binding: { ...binding } }
  }
  handle('fate-dice:save-binding', handleSaveBinding)

  async function handlePlotline(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const game = await readGame(gameId)
    const action = String(params.action || params.op || 'add').toLowerCase()
    const line = params.plotline && typeof params.plotline === 'object' ? params.plotline : (params.arc || {})
    let result
    if (action === 'add' || action === 'create') {
      result = applyArcOp(game.arcs, {
        op: 'create',
        id: line.id,
        title: line.title,
        origin: line.origin || '',
        progress: line.progress || '',
        summary: line.summary || (line.origin && line.progress ? `${line.origin}｜${line.progress}` : (line.progress || line.origin || '')),
        anchors: line.progress ? [line.progress] : [],
        turn: game.lastTurn
      })
    } else if (action === 'update' || action === 'edit') {
      result = applyArcOp(game.arcs, {
        op: 'update',
        arcId: line.id || params.id,
        title: line.title,
        origin: line.origin,
        progress: line.progress,
        summary: line.summary,
        anchors: line.progress ? [line.progress] : (line.anchors || undefined),
        turn: game.lastTurn
      })
    } else if (action === 'status') {
      const status = String(line.status || params.status || 'active')
      const op = status === 'closed' || status === 'completed' ? 'complete' : (status === 'paused' ? 'pause' : 'resume')
      result = applyArcOp(game.arcs, { op, arcId: line.id || params.id, turn: game.lastTurn })
    } else if (action === 'remove' || action === 'delete') {
      result = applyArcOp(game.arcs, { op: 'remove', arcId: line.id || params.id })
    } else {
      return { ok: false, error: `未知剧情线操作 ${action}` }
    }
    if (!result.ok) return { ok: false, error: result.reason, plotlines: toClientPlotlines(result.arcs) }
    await writeGame(gameId, { ...game, arcs: result.arcs })
    await tavern.publishState({ gameId, name: 'workbench-sync', data: { arcs: result.arcs, plotlines: toClientPlotlines(result.arcs) } }).catch(() => {})
    return { ok: true, plotlines: toClientPlotlines(result.arcs), arc: result.arc }
  }
  handle('fate-dice:plotline', handlePlotline)

  async function handlePauseNextRoll(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const game = await readGame(gameId)
    const director = pauseNextPush(game.director, Boolean(params.paused ?? params.pauseNext))
    await writeGame(gameId, { ...game, director })
    return { ok: true, paused: director.pauseNextPush }
  }
  handle('fate-dice:pause-next-roll', handlePauseNextRoll)

  async function handleBlockTheme(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const game = await readGame(gameId)
    const theme = params.theme || params.topic
    if (!theme) return { ok: false, error: '缺少主题' }
    const director = blockTopic(game.director, theme, params.rounds ?? params.turns ?? DEFAULT_GLOBAL_SETTINGS.blockedTopicTurns)
    await writeGame(gameId, { ...game, director })
    return { ok: true, blockedThemes: toClientThemes(director.blockedTopics) }
  }
  handle('fate-dice:block-theme', handleBlockTheme)

  async function handleUnblockTheme(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const game = await readGame(gameId)
    const director = unblockTopic(game.director, params.theme || params.topic)
    await writeGame(gameId, { ...game, director })
    return { ok: true, blockedThemes: toClientThemes(director.blockedTopics) }
  }
  handle('fate-dice:unblock-theme', handleUnblockTheme)

  async function handleClearCooldown(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const game = await readGame(gameId)
    const director = { ...normalizeDirectorState(game.director), topicCooldowns: {} }
    await writeGame(gameId, { ...game, director })
    return { ok: true, cooldowns: [] }
  }
  handle('fate-dice:clear-cooldown', handleClearCooldown)

  async function handleSceneResume(params = {}) {
    const gameId = params.gameId
    if (!gameId) return { ok: false, error: '缺少 gameId' }
    const game = await readGame(gameId)
    const director = { ...normalizeDirectorState(game.director), sceneGroupPaused: false }
    await writeGame(gameId, { ...game, director })
    return { ok: true, sceneSuspended: false }
  }
  handle('fate-dice:scene-resume', handleSceneResume)

  // 兼容旧命名与工作台别名，避免客户端别名回退时丢失能力
  const ALIAS_HANDLERS = {
    'fate-dice:read-workbench': handleWorkbench,
    'fate-dice:workbench-state': handleWorkbench,
    'fate-dice:save-settings': handleSaveGlobalSettings,
    'fate-dice:global-settings': handleSaveGlobalSettings,
    'fate-dice:skill-groups-save': handleSaveSkillGroups,
    'fate-dice:save-skills': handleSaveSkillGroups,
    'fate-dice:event-groups-save': handleSaveEventGroups,
    'fate-dice:save-events': handleSaveEventGroups,
    'fate-dice:bind-groups': handleSaveBinding,
    'fate-dice:save-bind': handleSaveBinding,
    'fate-dice:plotlines': handlePlotline,
    'fate-dice:plot-line': handlePlotline,
    'fate-dice:pause-next': handlePauseNextRoll,
    'fate-dice:pause-events': handlePauseNextRoll,
    'fate-dice:theme-block': handleBlockTheme,
    'fate-dice:theme-unblock': handleUnblockTheme,
    'fate-dice:clear-cooldowns': handleClearCooldown,
    'fate-dice:resume-scene': handleSceneResume,
    'fate-dice:preview-import': handleImportPreview,
    'fate-dice:apply-import': handleImportApply
  }
  for (const [aliasName, fn] of Object.entries(ALIAS_HANDLERS)) handle(aliasName, fn)

  handle('fate-dice:skill-groups', async () => ({ ok: true, skillGroups: toClientSkillGroups((await readLibrary()).skillGroups) }))
  handle('fate-dice:event-groups', async () => ({ ok: true, eventGroups: toClientEventGroups((await readLibrary()).eventGroups) }))

  async function handleStatus(params = {}) {
    return buildBootstrap(params || {})
  }
  handle('fate-dice:status', handleStatus)
}

export default { name, inject, apply }
