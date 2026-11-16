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
