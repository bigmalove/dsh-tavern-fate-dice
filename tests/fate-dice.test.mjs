import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { evaluateOutcome, extractVariableModifier, rollCheck, rollExpression, shiftDifficulty } from '../lib/dice-engine.js'
import {
  collectCharacterMaterial,
  normalizeCharacterProfile,
  refreshProfileWithBackgroundLlm,
  tierToRuleBonus
} from '../lib/auto-profiler.js'
import { buildDamperJudgeQuestions, resolveCheckFromDamperContext } from '../lib/damper-bridge.js'
import { heuristicAssessWithSkills, judgeActionDifficulty } from '../lib/difficulty-judge.js'
import { buildTurnInjection } from '../lib/prompt-builder.js'
import { apply as applyFateDicePlugin, inject as fateDiceInject, name as fateDiceName } from '../lib/index.js'

test('dice-engine：2d6 / d10 / d20 / d100 四骰制五档判定、能力加值、自由表达式与变量解析', () => {
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [6, 6], modifier: 0, difficulty: 'extreme' }).tier, 'critical')
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [1, 1], modifier: 4, difficulty: 'trivial' }).tier, 'fumble')
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [4, 4], skillBonus: 0, modifier: 0, difficulty: 'moderate' }).tier, 'costly')
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [4, 4], skillBonus: 2, modifier: 0, difficulty: 'moderate' }).tier, 'success')
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [2, 3], modifier: 0, difficulty: 'moderate' }).tier, 'failure')

  assert.equal(evaluateOutcome({ rule: 'd10', dice: [10], skillBonus: 2, difficulty: 'hard' }).tier, 'critical')
  assert.equal(evaluateOutcome({ rule: 'd10', dice: [1], skillBonus: 0, difficulty: 'moderate' }).tier, 'fumble')

  assert.equal(evaluateOutcome({ rule: 'd20', dice: [20], modifier: -3, difficulty: 'extreme' }).tier, 'critical')
  assert.equal(evaluateOutcome({ rule: 'd20', dice: [1], modifier: 5, difficulty: 'trivial' }).tier, 'fumble')
  assert.equal(evaluateOutcome({ rule: 'd20', dice: [11], skillBonus: 2, modifier: 1, difficulty: 'moderate' }).tier, 'costly')

  assert.equal(evaluateOutcome({ rule: 'd100', dice: [4], modifier: 0, difficulty: 'extreme' }).tier, 'critical')
  assert.equal(evaluateOutcome({ rule: 'd100', dice: [97], modifier: 2, difficulty: 'trivial' }).tier, 'fumble')
  assert.equal(evaluateOutcome({ rule: 'd100', dice: [65], skillBonus: 15, modifier: 0, difficulty: 'moderate' }).tier, 'success')

  assert.equal(shiftDifficulty('moderate', 1), 'hard')
  assert.equal(shiftDifficulty('extreme', 2), 'extreme')
  assert.equal(shiftDifficulty('trivial', -2), 'trivial')

  const rolled = rollCheck({ rule: '2d6', skillName: '潜行检定', skillBonus: 2, difficulty: 'hard', modifier: 1, hidden: true }, () => 4)
  assert.equal(rolled.check, '潜行')
  assert.deepEqual(rolled.dice, [4, 4])
  assert.equal(rolled.total, 11)
  assert.equal(rolled.hidden, true)

  const expr = rollExpression('3d8+2', () => 5)
  assert.equal(expr.expression, '3d8+2')
  assert.deepEqual(expr.dice, [5, 5, 5])
  assert.equal(expr.total, 17)
  assert.throws(() => rollExpression('abc'), /无效/)

  const vars = { stat_data: { 主角: { 敏捷: 16, 感知: 65, $meta: { 敏捷: 99 } } } }
  const extracted = extractVariableModifier(vars, '/主角/敏捷, 感知')
  assert.equal(extracted.modifier, 4)
})

test('auto-profiler：从角色卡、世界书、MVU 与近期正文自动提取四源材料并用后台 LLM 生成角色能力画像', async () => {
  assert.equal(tierToRuleBonus(2, '2d6'), 2)
  assert.equal(tierToRuleBonus(2, 'd20'), 4)
  assert.equal(tierToRuleBonus(2, 'd100'), 20)
  assert.equal(tierToRuleBonus(-2, 'd100'), -20)

  const mockTavern = {
    async getPlayerName() { return '苏夜' },
    async getCard() {
      return { name: '赛博委托人', description: '夜之城高层情报中间人。', personality: '冷酷多疑' }
    },
    async getCharacterDesigns() {
      return {
        characters: [
          { name: '苏夜', identity: '前荒坂反情报黑客，左臂义体过载受损', personality: '沉着冷静', sections: [] }
        ]
      }
    },
    async getCardContext() {
      return {
        lore: [
          { title: '深网协议', content: '黑客接入军用冰墙需神经义体支撑，过载会引发反噬。' }
        ]
      }
    },
    async getTurn() {
      return {
        turn: 3,
        text: '苏夜拔出滚烫的数据探针，左臂电弧闪烁。',
        variables: { stat_data: { 神经负荷: 82, 信用点: 1500, 隐蔽度: 65 } }
      }
    },
    async getHistory() {
      return [{ turn: 3, input: '接入终端下载密钥', text: '苏夜突破了第一层防火墙，但义体温度急剧攀升。' }]
    },
    async backgroundModel() {
      return { provider: 'mock-provider', model: 'mock-model' }
    }
  }

  const mat = await collectCharacterMaterial({ tavern: mockTavern, gameId: 'g-cyber', turn: 4 })
  assert.equal(mat.contextSources.playerName, '苏夜')
  assert.equal(mat.contextSources.hasCard, true)
  assert.equal(mat.contextSources.loreCount, 1)
  assert.equal(mat.contextSources.mvuKeyCount, 3)
  assert.match(mat.promptDigest, /深网协议/)
  assert.match(mat.promptDigest, /神经负荷/)

  const refreshed = await refreshProfileWithBackgroundLlm({
    tavern: mockTavern,
    gameId: 'g-cyber',
    turn: 4,
    rule: 'd20',
    llm: {
      async *stream() {
        yield {
          type: 'text-delta',
          text: '```json\n{"characterName":"苏夜","archetype":"前反情报黑客（神经义体高负荷）","traits":[{"name":"冰墙骇入","tier":2,"source":"角色卡","reason":"反情报老手"},{"name":"威胁嗅探","tier":1,"hidden":true,"source":"世界书","reason":"熟悉军用追踪"},{"name":"左臂义体过载","tier":-2,"source":"MVU","reason":"神经负荷高达82"}]}\n```'
        }
      }
    }
  })
  assert.equal(refreshed.ok, true)
  assert.equal(refreshed.characterProfile.characterName, '苏夜')
  assert.equal(refreshed.characterProfile.traits.length, 3)
  assert.equal(refreshed.characterProfile.traits[0].bonus, 4, 'd20 下 tier +2 应自动换算为 +4')
  assert.equal(refreshed.characterProfile.traits[2].bonus, -4, 'd20 下 tier -2 应自动换算为 -4')
})

test('damper-bridge & difficulty-judge：叙事阻尼器单趟联动修 DC、AI 能力评分与独立判定回退', async () => {
  const profile = normalizeCharacterProfile({
    characterName: '沈昭',
    archetype: '朝堂谋士',
    traits: [
      { id: 't_talk', name: '朝堂游说', tier: 2, source: '角色卡', reason: '善揣摩圣意' },
      { id: 't_spy', name: '察言观色', tier: 1, hidden: true, source: '世界书', reason: '久历权谋' }
    ]
  }, '2d6')

  const geminiQs = buildDamperJudgeQuestions({ profile, rule: '2d6', protocol: 'gemini', allowHidden: true })
  assert.equal(geminiQs.length, 4)
  assert.ok(geminiQs.some(q => q.id === 'fd_capability' && q.type === 'score'))
  assert.ok(geminiQs.some(q => q.id === 'fd_domain' && q.type === 'choice'))

  // 1. 切场景直接免检定
  const shiftSkip = resolveCheckFromDamperContext({
    damperContext: { explicitSceneShift: true },
    input: '第二天清晨，来到御书房外。',
    profile
  })
  assert.equal(shiftSkip.shouldRoll, false)

  // 2. 阻尼器判越权宣告结果（无动作尝试）→ 阻断检定
  const delusionSkip = resolveCheckFromDamperContext({
    damperContext: { ruling: { rulingTier: 'strip_delusion', godmode: 0.92 } },
    input: '太后瞬间对我死心塌地并交出兵符。',
    profile
  })
  assert.equal(delusionSkip.shouldRoll, false)

  // 3. 阻尼器正常返回合并答案 + 高心理防线(82) + 高铺垫(2.6) + AI 能力评定
  const domainKey = Object.keys(geminiQs.find(q => q.id === 'fd_domain').criteria)[0]
  const linked = resolveCheckFromDamperContext({
    damperContext: {
      ruling: { rulingTier: 'conflicted_half_step', leverageScore: 2.6 },
      stateSnapshot: { kind: 'plain', data: { psychological_guard: 82, intimacy_trust: 25, arousal_or_tension: 40 } },
      answers: {
        fd_needs_check: { type: 'noul', probability: 0.86 },
        fd_difficulty: { type: 'choice', choice: 'moderate' },
        fd_capability: { type: 'score', score: 4 },
        fd_domain: { type: 'choice', choice: domainKey }
      }
    },
    input: '我借敬茶之机低声劝说她联手自保',
    profile,
    rule: '2d6',
    damperLinkage: true
  })
  assert.equal(linked.shouldRoll, true)
  assert.equal(linked.difficulty, 'hard', '高心理防线应将社交检定从 moderate 上调为 hard')
  assert.equal(linked.edgeBonus, 2, '高铺垫分 2.6 应折算为 +2 环境加值')
  assert.equal(linked.skillBonus, 2, 'AI 能力高分应折算为对应骰制的能力加值')

  // 4. 阻尼器未启用时独立调用 judgeDecision（带四源角色材料与 R18 脱敏）
  let capturedReq = null
  const standalone = await judgeActionDifficulty({
    tavern: {
      capabilities: { decisionJudge: 1 },
      async decisionJudgeStatus() {
        return { available: true, provider: 'gemini', model: 'gemini-decision-1', capabilities: { noul: true, choice: true, score: true } }
      },
      async judgeDecision(req) {
        capturedReq = req
        return {
          provider: 'gemini',
          judgeTier: 'skeleton',
          retriedSafetyFallback: true,
          answers: {
            needs_check: { type: 'noul', probability: 0.85 },
            difficulty_tier: { type: 'choice', choice: 'hard' },
            character_capability: { type: 'score', score: 3 },
            character_domain: { type: 'choice', choice: domainKey },
            situation_edge: { type: 'score', score: 2 }
          }
        }
      }
    },
    gameId: 'g1',
    input: '在朝堂上据理力争驳斥首辅',
    characterMaterial: '【角色设定】朝堂谋士沈昭',
    profile,
    rule: 'd20'
  })
  assert.equal(capturedReq.desensitize, true)
  assert.match(capturedReq.input, /沈昭/)
  assert.equal(standalone.shouldRoll, true)
  assert.equal(standalone.difficulty, 'hard')

  const heur = heuristicAssessWithSkills({ input: '趁夜色潜行摸进偏殿偷看密折' })
  assert.equal(heur.shouldRoll, true)
})

test('prompt-builder：生成沉浸式检定注入块，禁止正文播报点数且暗骰防穿帮', () => {
  const text = buildTurnInjection({
    rule: '2d6', check: '宗门交涉', difficultyLabel: '困难',
    dice: [6, 5], skillBonus: 2, modifier: 1, total: 14, target: 8,
    tier: 'critical', tierLabel: '大成功', hidden: true, attempt: '探问长老密令'
  })
  assert.match(text, /严禁/)
  assert.match(text, /暗骰约束/)
  assert.equal(text.includes('随机事件'), false)
})

test('宿主全链路集成（方案 A 纯粹版）：阻尼器单趟合并与反向配额联动、后台 AI 角色画像同步、骰制等比换算', async () => {
  assert.equal(fateDiceName, 'dsh-tavern-fate-dice')
  assert.deepEqual(fateDiceInject, ['tavern'])

  let gameSettingsCalled = false
  let damperQuestionProvider = null
  const turnSections = []
  const settlementTools = []
  const settledHooks = []
  const handlers = new Map()
  const turnDataMap = new Map()
  const gameDataMap = new Map()
  let pluginData = null
  const states = new Map()
  const damperShifts = []

  const baseCtx = {
    inject(deps, cb) {
      if (Array.isArray(deps) && deps.includes('llm')) cb({ llm: null })
    },
    tavern: {
      capabilities: { decisionJudge: 1, narrativeDamper: 1 },
      gameSettings() { gameSettingsCalled = true },
      damperTurnQuestions(def) { damperQuestionProvider = def; return () => {} },
      turnSection(def) { turnSections.push(def); return () => {} },
      settlementSection() { return () => {} },
      settlementTool(def) { settlementTools.push(def); return () => {} },
      onTurnSettled(fn) { settledHooks.push(fn); return () => {} },
      onTimelineChanged() { return () => {} },
      onGameRemoved() { return () => {} },
      handle(name, fn) { handlers.set(name, fn) },
      async savePluginData({ data }) { pluginData = structuredClone(data) },
      async readPluginData() { return pluginData ? structuredClone(pluginData) : null },
      async saveGameData({ gameId, data }) { gameDataMap.set(gameId, structuredClone(data)) },
      async readGameData({ gameId }) { return structuredClone(gameDataMap.get(gameId) || null) },
      async saveTurnData({ gameId, turn, textVersion, data }) {
        turnDataMap.set(`${gameId}:${turn}`, { turn, textVersion, data: structuredClone(data) })
        return { turn, textVersion }
      },
      async readTurnData({ gameId, turn }) { return structuredClone(turnDataMap.get(`${gameId}:${turn}`) || null) },
      async getTurn() { return { turn: 1, text: '殿内烛火摇曳。', variables: { stat_data: { 身法: 16, 气血: 75 } } } },
      async publishState({ gameId, name, data }) { states.set(`${gameId}:${name}`, data) },
      async decisionJudgeStatus() {
        return { available: true, provider: 'gemini', model: 'gemini-decision-1', capabilities: { noul: true, choice: true, score: true } }
      },
      async getDamperTurnContext({ gameId, turn }) {
        const qs = await damperQuestionProvider.questions({ gameId, turn, protocol: 'gemini' })
        const domainQ = qs.find(q => q.id === 'fd_domain')
        const domainChoice = Object.keys(domainQ?.criteria || {})[0] || 'general_stealth'
        return {
          active: true,
          turn,
          explicitSceneShift: false,
          stateSnapshot: { kind: 'plain', data: { intimacy_trust: 30, psychological_guard: 78, arousal_or_tension: 50, leverage_depth: 1 } },
          posture: '长老负手立于丹墀之上',
          ruling: { rulingTier: 'resist_pushback', deltaBudget: 'frozen', leverageScore: 2.5 },
          answers: {
            fd_needs_check: { type: 'noul', probability: 0.92 },
            fd_difficulty: { type: 'choice', choice: 'moderate' },
            fd_capability: { type: 'score', score: 3 },
            fd_domain: { type: 'choice', choice: domainChoice }
          }
        }
      },
      async applyDamperDiceShift(payload) {
        damperShifts.push(payload)
        return { applied: true, ruling: { rulingTier: 'conflicted_half_step', deltaBudget: 'micro_step' } }
      }
    }
  }
  // 模拟真实 Cordis Context Proxy：未在 inject 声明的服务属性读取即抛错
  const strictCordisCtx = new Proxy(baseCtx, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !['tavern', 'inject', 'effect', 'plugin', 'then'].includes(prop)) {
        throw new Error(`cannot get property "${prop}" without inject`)
      }
      return Reflect.get(target, prop, receiver)
    }
  })
  applyFateDicePlugin(strictCordisCtx)

  assert.equal(gameSettingsCalled, false)
  assert.equal(handlers.has('fate-dice:event-group-op'), false, '随机事件组接口应已彻底移除')
  assert.equal(handlers.has('fate-dice:plotline'), false, '持续剧情线接口应已彻底移除')
  assert.equal(settlementTools.length, 1, '仅保留 fate_dice_profile_sync 一个结算工具')
  assert.equal(settlementTools[0].name, 'fate_dice_profile_sync')

  const injected = await turnSections[0].text({ gameId: 'g-main', turn: 2, input: '我趁长老转身之际施展身法探查案几暗格' })
  assert.match(injected, /检定/)
  assert.equal(damperShifts.length, 1)
  assert.ok(states.get('g-main:live-roll')?.roll?.damper?.applied)

  // 同轮重试幂等复用
  const injectedRetry = await turnSections[0].text({ gameId: 'g-main', turn: 2, input: '我趁长老转身之际施展身法探查案几暗格' })
  assert.equal(injectedRetry, injected)
  assert.equal(damperShifts.length, 1)

  // 后台结算同步主角能力画像并正式落盘
  await settlementTools[0].execute({
    gameId: 'g-main',
    turn: 2,
    arguments: {
      characterName: '林岚',
      archetype: '青云内门剑修（轻身专精，右肩轻伤）',
      traits: [
        { name: '踏雪身法', tier: 2, source: '角色卡', reason: '内门轻功大成' },
        { name: '右肩剑伤', tier: -1, source: 'MVU', reason: '气血受损牵动发力' }
      ]
    }
  })
  await settledHooks[0]({ gameId: 'g-main', turn: 2, textVersion: 'ver-2a' })

  const wbAfter = await handlers.get('fate-dice:workbench')({ gameId: 'g-main' })
  assert.equal(wbAfter.summary.total, 1)
  assert.equal(wbAfter.characterProfile.characterName, '林岚')
  assert.equal(wbAfter.characterProfile.traits.find(t => t.name === '踏雪身法').bonus, 2)

  // 切换为 d100 骰制自动等比换算能力加值（+2 -> +20）
  const rescaled = await handlers.get('fate-dice:save-profile-note')({ gameId: 'g-main', rule: 'd100' })
  assert.equal(rescaled.characterProfile.traits.find(t => t.name === '踏雪身法').bonus, 20)
})

test('未配置叙事阻尼器决策模型门控：默认跳过自动检定并推送配置引导，开启离线兜底后才允许本地规则检定', async () => {
  const turnSections = []
  const handlers = new Map()
  const states = new Map()
  let pluginData = null
  const gameDataMap = new Map()

  applyFateDicePlugin({
    tavern: {
      capabilities: { decisionJudge: 1 },
      turnSection(def) { turnSections.push(def); return () => {} },
      onTurnSettled() { return () => {} },
      handle(name, fn) { handlers.set(name, fn) },
      async savePluginData({ data }) { pluginData = structuredClone(data) },
      async readPluginData() { return pluginData ? structuredClone(pluginData) : null },
      async saveGameData({ gameId, data }) { gameDataMap.set(gameId, structuredClone(data)) },
      async readGameData({ gameId }) { return structuredClone(gameDataMap.get(gameId) || null) },
      async getTurn() { return { turn: 1, text: '守卫站在门前。', variables: {} } },
      async publishState({ gameId, name, data }) { states.set(`${gameId}:${name}`, data) },
      async decisionJudgeStatus() {
        return { available: false, provider: 'gemini', model: 'gemini-decision-1', reason: 'NOT_CONFIGURED' }
      }
    }
  })

  const inj1 = await turnSections[0].text({ gameId: 'g-unconf', turn: 2, input: '我趁守卫转身时尝试强行撬开铁门锁' })
  assert.equal(inj1, '')
  assert.equal(states.get('g-unconf:live-roll')?.kind, 'setup-required')
  assert.match(states.get('g-unconf:live-roll')?.message || '', /设置 › 叙事阻尼器/)

  await handlers.get('fate-dice:save-global-settings')({ settings: { allowHeuristicFallback: true } })
  const inj2 = await turnSections[0].text({ gameId: 'g-unconf', turn: 3, input: '我趁守卫转身时尝试强行撬开铁门锁' })
  assert.match(inj2, /检定/)
  assert.equal(states.get('g-unconf:live-roll')?.kind, 'check')
})

test('浏览器端 client.js：极简双页签滚动工作台（检定与能力 + 检定设置）、未配模型引导框与全设置 ? 详述', async () => {
  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.equal(clientCode.includes('registerComposerAction'), false, '无发送栏骰盘按钮')
  assert.equal(clientCode.includes('DicePadOverlay'), false, '无发前手投弹窗')
  assert.equal(clientCode.includes('随机事件'), false, '随机事件冗余标签页已彻底移除')
  assert.equal(clientCode.includes('随机分配加值'), false, '手动预算表已彻底移除')
  assert.ok(clientCode.includes('检定与能力') && clientCode.includes('检定设置'), '必须收敛为极简双页签')
  assert.ok(clientCode.includes('fd-wb-scroll') && clientCode.includes('overflow-y: auto'), '具备独立纵向滚动容器')

  let loadedModule = null
  const fakeReact = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: fn => fn(),
    useRef: val => ({ current: val }),
    useCallback: fn => fn
  }

  const sandbox = {
    window: { __ModuleLoader__: { load(def) { loadedModule = def } } },
    document: {
      head: { appendChild() {} },
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '', style: {} })
    },
    console
  }

  vm.runInNewContext(clientCode, sandbox, { filename: 'client.js' })
  const exported = loadedModule.factory(mod => {
    if (mod === 'react') return fakeReact
    throw new Error('unexpected require: ' + mod)
  })
  assert.equal(exported.name, 'dsh-tavern-fate-dice')
  assert.deepEqual(Array.from(exported.inject), ['tavernUi'])

  const registered = []
  exported.apply({
    tavernUi: {
      apiVersion: 8,
      registerPanel: spec => { registered.push(['panel', spec.id, spec.title]); return () => {} },
      registerComposerSlot: spec => { registered.push(['slot', spec.id]); return () => {} },
      registerTurnView: spec => { registered.push(['turn', spec.id]); return () => {} },
      registerStatusSection: spec => { registered.push(['status', spec.id]); return () => {} },
      watchState: () => () => {},
      callHost: async () => ({})
    },
    effect() {}
  })

  assert.deepEqual(registered, [
    ['panel', 'fate-dice', '命运之骰'],
    ['slot', 'fate-dice-live'],
    ['turn', 'fate-dice-turn'],
    ['status', 'fate-dice-status']
  ])

  const expandVnode = node => {
    if (!node || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(expandVnode)
    if (typeof node.type === 'function') return expandVnode(node.type({ ...(node.props || {}), children: node.children }))
    return { type: String(node.type), props: node.props, children: (node.children || []).map(expandVnode) }
  }

  const { DecisionModelGuideBanner, LiveRollBanner, FdHelp } = exported.__test
  const bannerVnode = expandVnode(DecisionModelGuideBanner({ view: { judgeStatus: { available: false, reason: 'NOT_CONFIGURED' } } }))
  assert.match(JSON.stringify(bannerVnode), /设置 › 叙事阻尼器/)

  const helpClosed = expandVnode(FdHelp({ title: '触发灵敏度', text: '详细说明正文' }))
  assert.match(JSON.stringify(helpClosed), /fd-help-btn/)
  assert.ok((clientCode.match(/fd-help-btn|FdHelp|\bhelp\s*:/g) || []).length >= 20, '双页签所有设置与分区均配备 ? 详细说明')
})

test('collectCharacterMaterial：以 tavern.方法() 形式调用，保留调用者（宿主守卫靠 this 定位 fiber）', async () => {
  // 复刻 dsh-tavern 插件 API 的 service 包装：带 gameId 的调用先按 this 定位调用方插件。
  const service = {
    _owner: 'dsh-tavern-fate-dice',
    async getPlayerName() { return '苏夜' },
    async getCharacterDesigns() { return { characters: [{ name: '苏夜', identity: '前荒坂反情报黑客' }] } },
    async getCard() { return { name: '赛博委托人', description: '夜之城情报中间人。' } },
    async getCardContext() { return { lore: [{ title: '深网协议', content: '军用冰墙需神经义体支撑。' }] } },
    async getTurn() {
      return { turn: 3, text: '苏夜拔出数据探针。', variables: { stat_data: { 神经负荷: 82, 信用点: 1500, 隐蔽度: 65 } } }
    },
    async getHistory() { return [{ turn: 3, input: '接入终端', text: '苏夜突破第一层防火墙。' }] }
  }
  for (const key of Object.keys(service)) {
    const method = service[key]
    if (typeof method !== 'function') continue
    service[key] = async function (...args) {
      const input = args[0]
      if (input && typeof input === 'object' && (input.gameId !== undefined || input.card !== undefined)) {
        const owner = String((this && this._owner) || '')
        if (!owner || owner === 'root') throw new Error('请在插件里通过 ctx.inject 取得 tavern 服务，并以 tavern.方法名() 的形式调用')
      }
      return await method.apply(this, args)
    }
  }

  const mat = await collectCharacterMaterial({ tavern: service, gameId: 'g-strict', turn: 4 })
  assert.equal(mat.contextSources.playerName, '苏夜')
  assert.equal(mat.contextSources.hasCard, true)
  assert.equal(mat.contextSources.cardName, '赛博委托人')
  assert.equal(mat.contextSources.loreCount, 1)
  assert.equal(mat.contextSources.mvuKeyCount, 3, 'MVU 变量必须取到（摘方法裸调会让守卫抛错，四源全空）')
  assert.equal(mat.contextSources.historyTurns, 1)
  assert.match(mat.promptDigest, /神经负荷/)
  assert.match(mat.promptDigest, /深网协议/)
  assert.match(mat.promptDigest, /苏夜突破第一层防火墙/)
})

test('低不确定性回合：默认不掷骰但必须给出「本轮无需检定」可见反馈；开启每轮必检定后强制投骰', async () => {
  const turnSections = []
  const handlers = new Map()
  const states = new Map()
  const gameDataMap = new Map()
  let pluginData = null

  applyFateDicePlugin({
    inject(deps, cb) { if (Array.isArray(deps) && deps.includes('llm')) cb({ llm: null }) },
    tavern: {
      capabilities: { decisionJudge: 1, narrativeDamper: 1 },
      turnSection(def) { turnSections.push(def); return () => {} },
      damperTurnQuestions() { return () => {} },
      onTurnSettled() { return () => {} },
      handle(name, fn) { handlers.set(name, fn) },
      async savePluginData({ data }) { pluginData = structuredClone(data) },
      async readPluginData() { return pluginData ? structuredClone(pluginData) : null },
      async saveGameData({ gameId, data }) { gameDataMap.set(gameId, structuredClone(data)) },
      async readGameData({ gameId }) { return structuredClone(gameDataMap.get(gameId) || null) },
      async getTurn() { return { turn: 1, text: '她抬手替你斟了一杯温热的茶。', variables: {} } },
      async publishState({ gameId, name, data }) { states.set(`${gameId}:${name}`, data) },
      async decisionJudgeStatus() {
        return { available: true, provider: 'gemini', model: 'gemini-decision-1', capabilities: { noul: true, choice: true, score: true } }
      },
      async getDamperTurnContext({ gameId, turn }) {
        return {
          active: true,
          turn,
          explicitSceneShift: false,
          stateSnapshot: { kind: 'plain', data: { intimacy_trust: 60 } },
          ruling: { rulingTier: 'allow', deltaBudget: 'micro_step', leverageScore: 1.0 },
          answers: {
            fd_needs_check: { type: 'noul', probability: 0.31 },
            fd_difficulty: { type: 'choice', choice: 'trivial' },
            fd_capability: { type: 'score', score: 2 },
            fd_domain: { type: 'choice', choice: 'general_social' }
          }
        }
      }
    }
  })

  // 1) 默认设置：阻尼器判定 31% 低于 normal 阈值 55% → 不掷骰，但必须给出可见的跳过说明
  const injected = await turnSections[0].text({ gameId: 'g-calm', turn: 2, input: '我端起茶杯抿了一口，随口问她今天宫里有什么闲话' })
  assert.equal(injected, '', '不掷骰时不注入任何检定约束')
  const skipState = states.get('g-calm:live-roll')
  assert.ok(skipState, 'live-roll 状态必须被占用，不能静默置空')
  assert.equal(skipState.kind, 'skipped')
  assert.equal(skipState.needProbability, 0.31)
  assert.equal(skipState.threshold, 0.55)
  assert.match(skipState.message, /本轮无需检定/)
  assert.match(skipState.message, /触发概率 31%/)

  // 2) 打开「每轮必检定」后同样输入必须真投骰
  await handlers.get('fate-dice:save-global-settings')({ settings: { alwaysRoll: true } })
  const injected2 = await turnSections[0].text({ gameId: 'g-calm', turn: 3, input: '我端起茶杯抿了一口，随口问她今天宫里有什么闲话' })
  assert.match(injected2, /本轮客观检定已由系统真骰裁定/)
  const forced = states.get('g-calm:live-roll')
  assert.equal(forced.kind, 'check')
  assert.ok(forced.roll && typeof forced.roll.total === 'number')
  assert.match(String(forced.roll.reason || ''), /每轮必检定/)
})

/* 设置项的「即时生效」契约：改一次 → 立刻落盘 → 再次读取必须读回同一值。
   曾经的表现是打开「每轮必检定」后又被自动关闭，本质是改动只在本地草稿里、没落盘，
   下一次工作台读取就用旧值把界面打回默认。 */
function mountPluginWithData({ pluginData: initial = null, readThrows = false, gameData = null } = {}) {
  const handlers = new Map()
  const writes = []
  let pluginData = initial ? structuredClone(initial) : null
  applyFateDicePlugin({
    inject(deps, cb) { if (Array.isArray(deps) && deps.includes('llm')) cb({ llm: null }) },
    tavern: {
      capabilities: {},
      turnSection() { return () => {} },
      damperTurnQuestions() { return () => {} },
      onTurnSettled() { return () => {} },
      handle(name, fn) { handlers.set(name, fn) },
      async savePluginData({ data }) { pluginData = structuredClone(data); writes.push(structuredClone(data)) },
      async readPluginData() {
        if (readThrows) throw new Error('宿主插件数据读取失败')
        return pluginData ? structuredClone(pluginData) : null
      },
      async saveGameData() {},
      async readGameData() { return gameData ? structuredClone(gameData) : null },
      async getTurn() { return { turn: 1, text: '', variables: {} } },
      async publishState() {},
      async decisionJudgeStatus() { return { available: false, reason: 'NOT_CONFIGURED' } }
    }
  })
  return { handlers, writes, snapshot: () => (pluginData ? structuredClone(pluginData) : null) }
}

test('检定设置即时生效：改一项就落盘，再读工作台必须读回改后的值（无需保存按钮）', async () => {
  const { handlers, snapshot } = mountPluginWithData()

  const saved = await handlers.get('fate-dice:save-global-settings')({ settings: { alwaysRoll: true } })
  assert.equal(saved.ok, true)
  assert.equal(saved.settings.alwaysRoll, true, '保存结果必须回传生效后的设置')
  assert.equal(snapshot().settings.alwaysRoll, true, '「每轮必检定」必须立刻写进插件数据')
  assert.equal(snapshot().version, 3, '落盘结构必须是当前版本')

  const view = await handlers.get('fate-dice:workbench')({})
  assert.equal(view.settings.alwaysRoll, true, '再次读取必须读回开启状态，否则界面会自己关回去')
  assert.equal(view.settings.allowHidden, true)
  assert.equal(view.settings.damperLinkage, true)

  // 关回去同样立刻生效
  const off = await handlers.get('fate-dice:save-global-settings')({ settings: { alwaysRoll: false } })
  assert.equal(off.settings.alwaysRoll, false)
  assert.equal((await handlers.get('fate-dice:workbench')({})).settings.alwaysRoll, false)
})

test('全局设置不被本局历史 config 覆盖：本局残留 alwaysRoll:false 也不能把全局开关打回关闭', async () => {
  const { handlers, snapshot } = mountPluginWithData({
    gameData: { config: { autoCheck: true, alwaysRoll: false, sensitivity: 'rare' }, summary: { total: 0, counts: {}, recent: [] } }
  })
  await handlers.get('fate-dice:save-global-settings')({ settings: { alwaysRoll: true, sensitivity: 'normal' } })
  const view = await handlers.get('fate-dice:workbench')({ gameId: 'g-1' })
  assert.equal(view.settings.alwaysRoll, true, '全局开关不能被本局残留值覆盖')
  assert.equal(view.settings.sensitivity, 'normal', '全局灵敏度不能被本局残留值覆盖')
  assert.equal(view.autoCheck, true, '本局仍可覆盖自动检定开关')
  assert.equal(snapshot().settings.alwaysRoll, true)
})

test('插件数据读取异常时不得用默认值覆盖已存设置（避免开关被静默冲回默认）', async () => {
  const { handlers, writes } = mountPluginWithData({ readThrows: true })
  const view = await handlers.get('fate-dice:workbench')({})
  assert.equal(view.settings.alwaysRoll, false)
  assert.equal(writes.length, 0, '读取失败时不允许写盘覆盖用户已有设置')
})

test('检定设置页：拨动「每轮必检定」当场走持久化（无草稿、无保存按钮）', async () => {
  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let loadedModule = null
  const fakeReact = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: fn => fn(),
    useRef: val => ({ current: val })
  }
  const sandbox = {
    window: { __ModuleLoader__: { load(def) { loadedModule = def } }, localStorage: { getItem: () => null, setItem: () => {} } },
    document: { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ id: '', textContent: '', style: {} }) },
    console
  }
  vm.runInNewContext(clientCode, sandbox, { filename: 'client.js' })
  const exported = loadedModule.factory(mod => {
    if (mod === 'react') return fakeReact
    throw new Error('unexpected require: ' + mod)
  })

  const calls = []
  const actions = { persistSettings: next => { calls.push(next); return Promise.resolve(next) } }
  const tree = exported.__test.SettingsTab({
    view: { settings: { sensitivity: 'normal', alwaysRoll: false, toneBias: 'balanced', autoHidden: true, damperLinkage: true, allowHeuristicFallback: false, animation: 'bounce' } },
    actions,
    notify: () => {}
  })

  const findSwitch = (node, label) => {
    if (!node || typeof node !== 'object') return null
    if (node.props && node.props.label === label && typeof node.props.onChange === 'function') return node
    for (const child of node.children || []) {
      const hit = findSwitch(child, label)
      if (hit) return hit
    }
    return null
  }

  const alwaysRollSwitch = findSwitch(tree, '每轮必检定')
  assert.ok(alwaysRollSwitch, '设置页必须渲染「每轮必检定」开关')
  assert.equal(alwaysRollSwitch.props.on, false)

  alwaysRollSwitch.props.onChange(true)
  assert.equal(calls.length, 1, '拨动开关必须立刻触发一次持久化，不能等保存按钮')
  assert.equal(calls[0].alwaysRoll, true)
  assert.equal(calls[0].sensitivity, 'normal', '其余设置项必须随同保留，不能被冲掉')
  assert.equal(calls[0].autoHidden, true)

  const flat = JSON.stringify(tree)
  assert.equal(flat.includes('保存设置'), false, '不得再出现「保存设置」按钮文案')
  assert.ok(flat.includes('即时生效'), '必须向用户说明改动即时生效')
})

test('同楼层重新生成锁骰复用：turn 与 inputHash 未变时强制复用首次已结算真骰并重同步阻尼器配额，改写行动或手动重投才换新骰', async () => {
  const turnSections = []
  const settledHooks = []
  const timelineHooks = []
  const handlers = new Map()
  const states = new Map()
  const damperShifts = []
  let pluginData = null
  const gameDataMap = new Map()
  const turnDataMap = new Map()
  let damperBudgetSeq = 0

  applyFateDicePlugin({
    tavern: {
      capabilities: { decisionJudge: 1, narrativeDamper: 1 },
      damperTurnQuestions() { return () => {} },
      turnSection(def) { turnSections.push(def); return () => {} },
      settlementSection() { return () => {} },
      settlementTool() { return () => {} },
      onTurnSettled(fn) { settledHooks.push(fn); return () => {} },
      onTimelineChanged(fn) { timelineHooks.push(fn); return () => {} },
      onGameRemoved() { return () => {} },
      handle(name, fn) { handlers.set(name, fn) },
      async savePluginData({ data }) { pluginData = structuredClone(data) },
      async readPluginData() { return pluginData ? structuredClone(pluginData) : null },
      async saveGameData({ gameId, data }) { gameDataMap.set(gameId, structuredClone(data)) },
      async readGameData({ gameId }) { return structuredClone(gameDataMap.get(gameId) || null) },
      async saveTurnData({ gameId, turn, textVersion, data }) {
        turnDataMap.set(`${gameId}:${turn}`, { turn, textVersion, data: structuredClone(data) })
        return { turn, textVersion }
      },
      async readTurnData({ gameId, turn }) { return structuredClone(turnDataMap.get(`${gameId}:${turn}`) || null) },
      async getTurn() { return { turn: 1, text: '铁门紧锁，走廊尽头传来脚步声。', variables: {} } },
      async publishState({ gameId, name, data }) { states.set(`${gameId}:${name}`, data) },
      async getDamperTurnContext({ turn }) {
        return {
          active: true,
          turn,
          explicitSceneShift: false,
          stateSnapshot: { kind: 'plain', data: { intimacy_trust: 20, psychological_guard: 70, arousal_or_tension: 65, leverage_depth: 1 } },
          ruling: { rulingTier: 'resist_pushback', deltaBudget: 'frozen', leverageScore: 2.0 },
          answers: {
            fd_needs_check: { type: 'noul', probability: 0.95 },
            fd_difficulty: { type: 'choice', choice: 'extreme' },
            fd_capability: { type: 'score', score: 0 },
            fd_domain: { type: 'choice', choice: 'general_stealth' }
          }
        }
      },
      async applyDamperDiceShift(payload) {
        damperBudgetSeq += 1
        damperShifts.push(payload)
        return {
          applied: true,
          ruling: {
            rulingTier: 'conflicted_half_step',
            deltaBudget: `budget_pass_${damperBudgetSeq}`
          }
        }
      }
    }
  })

  await handlers.get('fate-dice:save-global-settings')({ settings: { rule: 'd10', toneBias: 'gritty' } })

  const actionA = '我屏住呼吸用细铁丝拨动锁芯尝试撬开铁门'

  // 1) 第 2 轮首次生成并落盘结算
  const inj1 = await turnSections[0].text({ gameId: 'g-lock', turn: 2, input: actionA })
  const firstRoll = structuredClone(states.get('g-lock:live-roll')?.roll)
  assert.ok(firstRoll, '首次行动应正常投出真骰')
  assert.equal(damperShifts.length, 1)
  assert.equal(firstRoll.damper.quotaLabel, '配额:budget_pass_1')

  await settledHooks[0]({ gameId: 'g-lock', turn: 2, textVersion: 'v2-1' })
  const wb1 = await handlers.get('fate-dice:workbench')({ gameId: 'g-lock' })
  assert.equal(wb1.summary.total, 1)

  // 2) 模拟点击「重新生成」：触发时间线变更清内存缓存，甚至清空旧 textVersion 的 turnData，再次请求同楼层同输入
  timelineHooks[0]({ gameId: 'g-lock' })
  turnDataMap.delete('g-lock:2')

  const inj2 = await turnSections[0].text({ gameId: 'g-lock', turn: 2, input: actionA })
  const regenRoll = structuredClone(states.get('g-lock:live-roll')?.roll)
  assert.equal(inj2, inj1, '重新生成注入文本应完全复用首次已结算真骰结果')
  assert.deepEqual(regenRoll.dice, firstRoll.dice, '骰面数组必须与首次结算严格一致')
  assert.equal(regenRoll.total, firstRoll.total, '总点数必须与首次结算严格一致')
  assert.equal(regenRoll.tier, firstRoll.tier, '成败档位必须与首次结算严格一致')
  assert.equal(regenRoll.rolledAt, firstRoll.rolledAt, '真骰时间戳必须保持首次结算原值')
  assert.equal(regenRoll.reusedOnRegenerate, true, '应标记为重新生成锁骰复用')
  assert.equal(damperShifts.length, 2, '重新生成时必须向叙事阻尼器重新同步配额')
  assert.equal(damperShifts[1].tier, firstRoll.tier)
  assert.equal(regenRoll.damper.quotaLabel, '配额:budget_pass_2', '阻尼器最新配额回包应同步更新')

  await settledHooks[0]({ gameId: 'g-lock', turn: 2, textVersion: 'v2-2' })
  const wb2 = await handlers.get('g-lock') || await handlers.get('fate-dice:workbench')({ gameId: 'g-lock' })
  assert.equal(wb2.summary.total, 1, '重新生成复用原骰不应重复累加本局累计检定次数')

  // 3) 连续第二次重新生成：依然死锁在首次已结算结果
  timelineHooks[0]({ gameId: 'g-lock' })
  const inj3 = await turnSections[0].text({ gameId: 'g-lock', turn: 2, input: actionA })
  assert.equal(inj3, inj1)
  assert.equal(damperShifts.length, 3)
  await settledHooks[0]({ gameId: 'g-lock', turn: 2, textVersion: 'v2-3' })

  // 4) 玩家改写同楼层行动内容（inputHash 改变）：允许重新掷骰并更新锁定
  await new Promise(resolve => setTimeout(resolve, 2))
  timelineHooks[0]({ gameId: 'g-lock' })
  const actionB = '我退后两步蓄力用肩膀猛撞铁门合页'
  await turnSections[0].text({ gameId: 'g-lock', turn: 2, input: actionB })
  const editedRoll = structuredClone(states.get('g-lock:live-roll')?.roll)
  assert.ok(editedRoll)
  assert.equal(Boolean(editedRoll.reusedOnRegenerate), false, '改写行动文本后不应走旧锁复用')
  assert.notEqual(editedRoll.rolledAt, firstRoll.rolledAt, '改写行动文本后必须重新投掷新真骰')
  assert.equal(damperShifts.length, 4)
  await settledHooks[0]({ gameId: 'g-lock', turn: 2, textVersion: 'v2-4' })
  const wbAfterEdit = await handlers.get('fate-dice:workbench')({ gameId: 'g-lock' })
  assert.equal(wbAfterEdit.summary.total, 1, '同楼层改写行动替换原记录后累计轮数仍为 1')

  // 5) 玩家调手动重投（fate-dice:reroll-turn）：突破锁定重掷新骰，且后续重新生成复用手动重投后的新骰点
  await new Promise(resolve => setTimeout(resolve, 2))
  const rerollRes = await handlers.get('fate-dice:reroll-turn')({ gameId: 'g-lock', turn: 2 })
  assert.equal(rerollRes.ok, true)
  assert.ok(rerollRes.roll)
  assert.notEqual(rerollRes.roll.rolledAt, editedRoll.rolledAt, '手动重投必须生成全新真骰结果')
  assert.equal(damperShifts.length, 5)

  timelineHooks[0]({ gameId: 'g-lock' })
  const injAfterManualReroll = await turnSections[0].text({ gameId: 'g-lock', turn: 2, input: actionB })
  const lockedToManualRoll = states.get('g-lock:live-roll')?.roll
  assert.equal(injAfterManualReroll, rerollRes.injection, '手动重投后再点重新生成，应复用手动重投出的新骰点')
  assert.equal(lockedToManualRoll.rolledAt, rerollRes.roll.rolledAt)
  assert.equal(lockedToManualRoll.reusedOnRegenerate, true)
  assert.equal(damperShifts.length, 6, '手动重投后的重新生成同样要重新同步阻尼器配额')
})

test('手动重投四重硬限制与「✦ 命运点 + 🔥 孤注一掷」代价及厄运回充闭环', async () => {
  const turnSections = []
  const settledHooks = []
  const timelineHooks = []
  const handlers = new Map()
  const damperShifts = []
  let pluginData = null
  const gameDataMap = new Map()
  const turnDataMap = new Map()
  let nextMockContext = {
    difficulty: 'trivial',
    capability: 5,
    domain: 'general_physical'
  }

  applyFateDicePlugin({
    tavern: {
      capabilities: { decisionJudge: 1, narrativeDamper: 1 },
      damperTurnQuestions() { return () => {} },
      turnSection(def) { turnSections.push(def); return () => {} },
      settlementSection() { return () => {} },
      settlementTool() { return () => {} },
      onTurnSettled(fn) { settledHooks.push(fn); return () => {} },
      onTimelineChanged(fn) { timelineHooks.push(fn); return () => {} },
      onGameRemoved() { return () => {} },
      handle(name, fn) { handlers.set(name, fn) },
      async savePluginData({ data }) { pluginData = structuredClone(data) },
      async readPluginData() { return pluginData ? structuredClone(pluginData) : null },
      async saveGameData({ gameId, data }) { gameDataMap.set(gameId, structuredClone(data)) },
      async readGameData({ gameId }) { return structuredClone(gameDataMap.get(gameId) || null) },
      async saveTurnData({ gameId, turn, textVersion, data }) {
        turnDataMap.set(`${gameId}:${turn}`, { turn, textVersion, data: structuredClone(data) })
        return { turn, textVersion }
      },
      async readTurnData({ gameId, turn }) { return structuredClone(turnDataMap.get(`${gameId}:${turn}`) || null) },
      async getTurn() { return { turn: 1, text: '暗道幽深。', variables: {} } },
      async publishState() {},
      async getDamperTurnContext({ turn }) {
        return {
          active: true,
          turn,
          explicitSceneShift: false,
          stateSnapshot: { kind: 'plain', data: { intimacy_trust: 50, psychological_guard: 30, arousal_or_tension: 30, leverage_depth: 1 } },
          ruling: { rulingTier: 'allow_advance', deltaBudget: 'step', leverageScore: 0 },
          answers: {
            fd_needs_check: { type: 'noul', probability: 0.96 },
            fd_difficulty: { type: 'choice', choice: nextMockContext.difficulty },
            fd_capability: { type: 'score', score: nextMockContext.capability },
            fd_domain: { type: 'choice', choice: nextMockContext.domain }
          }
        }
      },
      async applyDamperDiceShift(payload) {
        damperShifts.push(payload)
        return { applied: true, ruling: { rulingTier: 'synced', deltaBudget: 'step' } }
      }
    }
  })

  await handlers.get('fate-dice:save-global-settings')({ settings: { rule: 'd10', toneBias: 'balanced', allowHidden: true } })

  // 开局默认 2/3 命运点
  const wbInit = await handlers.get('fate-dice:workbench')({ gameId: 'g-fate' })
  assert.equal(wbInit.fate.points, 2)
  assert.equal(wbInit.fate.max, 3)

  // 1) 硬限制：已达成成功/大成功时禁止手动重投（d10 trivial target=3, score=5 => bonus=+6, 1+6=7 >= 6 必为 success/critical）
  nextMockContext = { difficulty: 'trivial', capability: 5, domain: 'general_physical' }
  await turnSections[0].text({ gameId: 'g-fate', turn: 2, input: '我轻松推开虚掩的木门' })
  await settledHooks[0]({ gameId: 'g-fate', turn: 2, textVersion: 'v2' })
  const denySuccess = await handlers.get('fate-dice:reroll-turn')({ gameId: 'g-fate', turn: 2 })
  assert.equal(denySuccess.ok, false)
  assert.equal(denySuccess.code, 'ALREADY_SUCCEEDED')

  // 2) 硬限制：感知洞察类暗骰一律禁止手动重投
  nextMockContext = { difficulty: 'extreme', capability: 0, domain: 'general_insight' }
  await turnSections[0].text({ gameId: 'g-fate', turn: 3, input: '我凝神观察石壁缝隙后的呼吸动静' })
  await settledHooks[0]({ gameId: 'g-fate', turn: 3, textVersion: 'v3' })
  const denyHidden = await handlers.get('fate-dice:reroll-turn')({ gameId: 'g-fate', turn: 3 })
  assert.equal(denyHidden.ok, false)
  assert.equal(denyHidden.code, 'HIDDEN_LOCKED')

  // 3) 推进到第 4 轮失败（d10 extreme target=11, score=0 => bonus=-4, max=6 < 9 必为 failure/fumble）
  nextMockContext = { difficulty: 'extreme', capability: 0, domain: 'general_stealth' }
  await turnSections[0].text({ gameId: 'g-fate', turn: 4, input: '我徒手攀爬湿滑的倒悬石壁' })
  await settledHooks[0]({ gameId: 'g-fate', turn: 4, textVersion: 'v4' })

  // 硬限制：尝试重投历史旧楼层（turn 2 / turn 3 < lastTurn 4）必须拦截
  const denyHistory = await handlers.get('fate-dice:reroll-turn')({ gameId: 'g-fate', turn: 2 })
  assert.equal(denyHistory.ok, false)
  assert.equal(denyHistory.code, 'HISTORY_LOCKED')

  // 强制预置命运点为 2，验证命运点消耗（2 -> 1 -> 0）与同楼层限 1 次硬限制
  const gSnap = await gameDataMap.get('g-fate')
  gSnap.fate = { points: 2, max: 3, failCount: 0, lastAwardTurn: 4 }
  gameDataMap.set('g-fate', gSnap)

  const fateReroll1 = await handlers.get('fate-dice:reroll-turn')({ gameId: 'g-fate', turn: 4, mode: 'fate' })
  assert.equal(fateReroll1.ok, true)
  assert.equal(fateReroll1.mode, 'fate')
  assert.equal(fateReroll1.fate.points, 1, '逆命重投消耗 1 点命运点')
  assert.equal(fateReroll1.roll.rerollMeta?.mode, 'fate')

  // 硬限制：同一楼层再次重投立即拦截（ALREADY_REROLLED）
  const denyTwice = await handlers.get('fate-dice:reroll-turn')({ gameId: 'g-fate', turn: 4 })
  assert.equal(denyTwice.ok, false)
  assert.equal(denyTwice.code, 'ALREADY_REROLLED')

  // 4) 第 5 轮耗尽最后 1 点命运点（1 -> 0）
  await turnSections[0].text({ gameId: 'g-fate', turn: 5, input: '我试图用匕首卡住下落的千斤闸' })
  await settledHooks[0]({ gameId: 'g-fate', turn: 5, textVersion: 'v5' })
  // 若第 5 轮首骰恰好出了大失败回充了 1 点，固定置为 1 点以验证耗尽边界
  const gSnap5 = gameDataMap.get('g-fate')
  gSnap5.fate.points = 1
  gameDataMap.set('g-fate', gSnap5)
  const fateReroll2 = await handlers.get('fate-dice:reroll-turn')({ gameId: 'g-fate', turn: 5, mode: 'fate' })
  assert.equal(fateReroll2.ok, true)
  assert.equal(fateReroll2.fate.points, 0)

  // 5) 第 6 轮命运点为 0：指定 mode:'fate' 被拒，自动走「🔥 孤注一掷」且失败强制恶化为大失败（fumble）并同步阻尼器
  await turnSections[0].text({ gameId: 'g-fate', turn: 6, input: '我咬牙硬扛机关弩箭强冲过去' })
  await settledHooks[0]({ gameId: 'g-fate', turn: 6, textVersion: 'v6' })
  const gSnap6 = gameDataMap.get('g-fate')
  gSnap6.fate.points = 0
  gameDataMap.set('g-fate', gSnap6)

  const noFateErr = await handlers.get('fate-dice:reroll-turn')({ gameId: 'g-fate', turn: 6, mode: 'fate' })
  assert.equal(noFateErr.ok, false)
  assert.equal(noFateErr.code, 'NO_FATE_POINTS')

  const pushFailRes = await handlers.get('fate-dice:reroll-turn')({ gameId: 'g-fate', turn: 6, mode: 'auto' })
  assert.equal(pushFailRes.ok, true)
  assert.equal(pushFailRes.mode, 'push', '0 命运点时 auto 自动走孤注一掷')
  assert.equal(pushFailRes.roll.tier, 'fumble', '孤注一掷未达标必须强制恶化为大失败')
  assert.equal(damperShifts.at(-1).tier, 'fumble', '恶化后的大失败档位必须同步传给叙事阻尼器')
  assert.match(pushFailRes.injection, /孤注一掷反噬（强制兑现）/)

  // 6) 孤注一掷逆转成功代价验证：初投失手后，切换高把握环境选 mode:'push' 翻盘，必须封顶为 success 并注入挂彩/透支代价
  nextMockContext = { difficulty: 'extreme', capability: 0, domain: 'general_physical' }
  await turnSections[0].text({ gameId: 'g-fate', turn: 7, input: '我燃尽气血震碎锁链' })
  await settledHooks[0]({ gameId: 'g-fate', turn: 7, textVersion: 'v7' })
  nextMockContext = { difficulty: 'trivial', capability: 5, domain: 'general_physical' }
  const pushWinRes = await handlers.get('fate-dice:reroll-turn')({ gameId: 'g-fate', turn: 7, mode: 'push' })
  assert.equal(pushWinRes.ok, true)
  assert.equal(pushWinRes.roll.tier, 'success', '孤注一掷即使掷出极高点也封顶为成功，不出无伤大成功')
  assert.equal(pushWinRes.roll.pushedCostRequired, true)
  assert.match(pushWinRes.injection, /孤注一掷代价（强制兑现）/)

  // 7) 厄运回充闭环：坦然接受失败不重投（累计 2 次失败或 1 次大失败）自动回充命运点，且重新生成不会重复加点
  const gSnap8 = gameDataMap.get('g-fate')
  gSnap8.fate = { points: 0, max: 3, failCount: 1, lastAwardTurn: 7 }
  gameDataMap.set('g-fate', gSnap8)

  nextMockContext = { difficulty: 'extreme', capability: 0, domain: 'general_stealth' }
  await turnSections[0].text({ gameId: 'g-fate', turn: 8, input: '我摸黑涉过地下暗河' })
  await settledHooks[0]({ gameId: 'g-fate', turn: 8, textVersion: 'v8-a' })
  const wbRecharged = await handlers.get('fate-dice:workbench')({ gameId: 'g-fate' })
  assert.equal(wbRecharged.fate.points, 1, '坦然接受第 2 次失败（或大失败）结算后自动回充 +1 点命运点')

  // 重新生成第 8 轮不得重复回充命运点
  timelineHooks[0]({ gameId: 'g-fate' })
  await turnSections[0].text({ gameId: 'g-fate', turn: 8, input: '我摸黑涉过地下暗河' })
  await settledHooks[0]({ gameId: 'g-fate', turn: 8, textVersion: 'v8-b' })
  const wbAfterRegen = await handlers.get('fate-dice:workbench')({ gameId: 'g-fate' })
  assert.equal(wbAfterRegen.fate.points, 1, '重新生成锁骰复用绝不能重复刷出命运点')
})
