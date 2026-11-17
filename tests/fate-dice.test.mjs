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

test('楼层胶囊默认挂载与两阶段结算保护：默认通过 attach + registerMediaRenderer 自动显示胶囊，且后台画像二次结算不冲空已存骰点', async () => {
  const turnSections = []
  const settledHooks = []
  const settlementTools = []
  const handlers = new Map()
  const attachedItems = []
  const turnDataMap = new Map()
  const gameDataMap = new Map()

  applyFateDicePlugin({
    tavern: {
      capabilities: { decisionJudge: 1, narrativeDamper: 1 },
      damperTurnQuestions() { return () => {} },
      turnSection(def) { turnSections.push(def); return () => {} },
      settlementSection() { return () => {} },
      settlementTool(def) { settlementTools.push(def); return () => {} },
      onTurnSettled(fn) { settledHooks.push(fn); return () => {} },
      handle(name, fn) { handlers.set(name, fn) },
      async savePluginData() {},
      async readPluginData() { return null },
      async saveGameData({ gameId, data }) { gameDataMap.set(gameId, structuredClone(data)) },
      async readGameData({ gameId }) { return structuredClone(gameDataMap.get(gameId) || null) },
      async saveTurnData({ gameId, turn, textVersion, data }) {
        turnDataMap.set(`${gameId}:${turn}`, { turn, textVersion, data: structuredClone(data) })
        return { turn, textVersion }
      },
      async readTurnData({ gameId, turn }) { return structuredClone(turnDataMap.get(`${gameId}:${turn}`) || null) },
      async attach(payload) {
        attachedItems.push(payload)
        return { id: `m-${attachedItems.length}` }
      },
      async getTurn() { return { turn: 1, text: '试炼场中魔力涌动。', variables: {} } },
      async publishState() {},
      async getDamperTurnContext({ turn }) {
        return {
          active: true,
          turn,
          explicitSceneShift: false,
          ruling: { rulingTier: 'costly_advance', deltaBudget: 'step', leverageScore: 1.0 },
          answers: {
            fd_needs_check: { type: 'noul', probability: 0.9 },
            fd_difficulty: { type: 'choice', choice: 'hard' },
            fd_capability: { type: 'score', score: 1 },
            fd_domain: { type: 'choice', choice: 'general_arcana' }
          }
        }
      },
      async applyDamperDiceShift() {
        return { applied: true, ruling: { rulingTier: 'costly_advance', deltaBudget: 'step' } }
      }
    }
  })

  // 第一阶段：前台正文流结束触发首次 onTurnSettled
  await turnSections[0].text({ gameId: 'g-two-phase', turn: 5, input: '我尝试引导魔力点燃符文' })
  await settledHooks[0]({ gameId: 'g-two-phase', turn: 5, textVersion: 'ver-5-fg' })
  assert.equal(attachedItems.length, 1, '有检定结果时应自动挂载楼层 roll-capsule 媒体项')
  assert.equal(attachedItems[0].item.kind, 'dsh-tavern-fate-dice/roll-capsule')
  assert.ok(turnDataMap.get('g-two-phase:5')?.data?.roll, '前台结算后 turnData 必须存有 roll')

  // 第二阶段：后台结算模型跑完 fate_dice_profile_sync，宿主二次触发同楼层 onTurnSettled
  await settlementTools[0].execute({
    gameId: 'g-two-phase',
    turn: 5,
    arguments: {
      characterName: '艾瑟加德',
      archetype: '初窥门径的学徒',
      traits: [{ name: '基础冥想', tier: 1, source: '正文', reason: '初次尝试聚魔' }]
    }
  })
  await settledHooks[0]({ gameId: 'g-two-phase', turn: 5, textVersion: 'ver-5-fg' })
  assert.ok(turnDataMap.get('g-two-phase:5')?.data?.roll, '后台画像二次结算绝不能把 turnData.roll 冲成 null')
  assert.equal(attachedItems.length, 1, '同一 textVersion 二次结算不得重复 attach 胶囊')

  const readBack = await handlers.get('fate-dice:read-turn')({ gameId: 'g-two-phase', turn: 5 })
  assert.ok(readBack?.roll, 'read-turn 仍可稳定读回第 5 轮检定结果')

  // 校验 client.js 已注册 registerMediaRenderer('dsh-tavern-fate-dice/roll-capsule')
  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.match(clientCode, /registerMediaRenderer/)
  assert.match(clientCode, /dsh-tavern-fate-dice\/roll-capsule/)
})

test('楼层顶栏胶囊（与叙事阻尼器胶囊并排）：正在生成期间即可实时读回本轮检定并在顶栏渲染胶囊，点开显示命运点与重投按钮', async () => {
  const turnSections = []
  const settledHooks = []
  const handlers = new Map()
  const gameDataMap = new Map()
  const turnDataMap = new Map()

  applyFateDicePlugin({
    tavern: {
      capabilities: { decisionJudge: 1, narrativeDamper: 1 },
      damperTurnQuestions() { return () => {} },
      turnSection(def) { turnSections.push(def); return () => {} },
      settlementSection() { return () => {} },
      settlementTool() { return () => {} },
      onTurnSettled(fn) { settledHooks.push(fn); return () => {} },
      handle(name, fn) { handlers.set(name, fn) },
      async savePluginData() {},
      async readPluginData() { return null },
      async saveGameData({ gameId, data }) { gameDataMap.set(gameId, structuredClone(data)) },
      async readGameData({ gameId }) { return structuredClone(gameDataMap.get(gameId) || null) },
      async saveTurnData({ gameId, turn, textVersion, data }) {
        turnDataMap.set(`${gameId}:${turn}`, { turn, textVersion, data: structuredClone(data) })
        return { turn, textVersion }
      },
      async readTurnData({ gameId, turn }) { return structuredClone(turnDataMap.get(`${gameId}:${turn}`) || null) },
      async getTurnState() { return { turn: 5, settled: false, generating: true } },
      async getTurn() { return { turn: 1, text: '书房里摆放着古老魔导书。', variables: {} } },
      async publishState() {},
      async getDamperTurnContext({ turn }) {
        return {
          active: true,
          turn,
          explicitSceneShift: false,
          ruling: { rulingTier: 'resist_pushback', deltaBudget: 'frozen', leverageScore: 0 },
          answers: {
            fd_needs_check: { type: 'noul', probability: 0.92 },
            fd_difficulty: { type: 'choice', choice: 'extreme' },
            fd_capability: { type: 'score', score: 0 },
            fd_domain: { type: 'choice', choice: 'general_arcana' }
          }
        }
      },
      async applyDamperDiceShift() {
        return { applied: true, ruling: { rulingTier: 'resist_pushback', deltaBudget: 'frozen' } }
      }
    }
  })

  await handlers.get('fate-dice:save-global-settings')({ settings: { rule: 'd10' } })

  // 预置旧版遗留 turn=5 历史空记录，并模拟 regenBody 重新生成时 turnSection 收到递增的 DSH nativeTurn=15、而页面与结算使用 storyTurn=5
  turnDataMap.set('g-head-pill:5', { turn: 5, textVersion: 'old', data: { roll: null, judged: { shouldRoll: false, needProbability: 0.05 } } })
  await turnSections[0].text({ gameId: 'g-head-pill', turn: 15, input: '学习魔法' })

  // 即使前端按 storyTurn=5（streaming:true）且未传 gameId 读取，也必须穿透旧缓存立即读回 nativeTurn=15 的本轮实时真骰结果
  const liveRead = await handlers.get('fate-dice:read-turn')({ gameId: '', turn: 5, streaming: true })
  assert.ok(liveRead?.roll, '正在生成期间即使 nativeTurn(15) !== storyTurn(5) 也必须立即读回本轮真骰结果')
  assert.equal(liveRead.turn, 5)
  assert.equal(liveRead.streaming, true)
  assert.equal(liveRead.fate.points, 2)

  // 验证前端 StoryFloorDiceItem 与 fdExtractFloorTurn 胶囊渲染树
  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let loadedModule = null
  function makeEl(tag) {
    const attrs = new Map()
    const listeners = new Map()
    const el = {
      tagName: String(tag || '').toUpperCase(),
      className: '',
      textContent: '',
      title: '',
      type: '',
      disabled: false,
      style: {},
      parentNode: null,
      children: [],
      get lastElementChild() { return this.children.length ? this.children[this.children.length - 1] : null },
      classList: {
        contains(cls) { return String(el.className || '').split(/\s+/).includes(cls) }
      },
      setAttribute(k, v) { attrs.set(k, String(v)) },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null },
      hasAttribute(k) { return attrs.has(k) },
      appendChild(child) {
        if (child.parentNode && child.parentNode !== el) child.parentNode.removeChild(child)
        const idx = el.children.indexOf(child)
        if (idx >= 0) el.children.splice(idx, 1)
        child.parentNode = el
        el.children.push(child)
        return child
      },
      removeChild(child) {
        const idx = el.children.indexOf(child)
        if (idx >= 0) el.children.splice(idx, 1)
        child.parentNode = null
        return child
      },
      querySelector(sel) {
        if (sel === '.dsh-tavern-story-floor-head') {
          return el.children.find(c => c.classList.contains('dsh-tavern-story-floor-head')) || null
        }
        // 每轮对话的尾部容器：胶囊优先挂这里
        if (sel === '.dsh-tavern-story-row-actions') {
          return el.children.find(c => c.classList.contains('dsh-tavern-story-row-actions')) || null
        }
        return null
      },
      addEventListener(ev, fn) { listeners.set(ev, fn) },
      click() {
        const fn = listeners.get('click')
        if (fn) fn({ stopPropagation() {} })
      }
    }
    Object.defineProperty(el, 'textContent', {
      get() {
        return el._text !== undefined && el.children.length === 0
          ? el._text
          : (el._text || '') + el.children.map(c => c.textContent).join('')
      },
      set(val) {
        el._text = String(val ?? '')
        if (val === '') el.children.forEach(c => { c.parentNode = null })
        if (val === '') el.children = []
      }
    })
    return el
  }

  const fakeArticle = makeEl('article')
  fakeArticle.className = 'dsh-tavern-story-transcript-row dsh-tavern-assistant dsh-tavern-story-floor dsh-tavern-story-streaming'
  fakeArticle.setAttribute('data-floor', '4')
  fakeArticle.setAttribute('data-legacy-turn', '5')
  const fakeHead = makeEl('div')
  fakeHead.className = 'dsh-tavern-story-floor-head'
  fakeArticle.appendChild(fakeHead)
  // story 视图每轮对话的尾部操作栏：胶囊必须落在这里，而不是楼层顶栏
  const fakeTailActions = makeEl('div')
  fakeTailActions.className = 'dsh-tavern-story-row-actions'
  fakeArticle.appendChild(fakeTailActions)

  const fakeBody = makeEl('body')
  fakeBody.appendChild(fakeArticle)
  const fakeDoc = {
    head: makeEl('head'),
    body: fakeBody,
    getElementById: () => null,
    createElement: tag => makeEl(tag),
    querySelectorAll: sel => (sel === 'article.dsh-tavern-story-floor' ? [fakeArticle] : [])
  }

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
    document: fakeDoc,
    MutationObserver: class { observe() {} disconnect() {} },
    setTimeout,
    clearTimeout,
    console
  }
  vm.runInNewContext(clientCode, sandbox, { filename: 'client.js' })
  // 模拟真实 DSH 宿主 ModuleLoader：只暴露 react，require('react-dom') 抛错
  const exported = loadedModule.factory(mod => {
    if (mod === 'react') return fakeReact
    throw new Error('host exposes no ' + mod)
  })

  assert.equal(exported.__test.fdExtractFloorTurn(fakeArticle), 5)

  // 1) 在「正在生成」（streaming）期间挂载纯原生 DOM 顶栏胶囊，必须无需 react-dom 直接出现
  const fakeUi = {
    callHost: (name, args) => handlers.get(name)(args),
    watchState: () => () => {}
  }
  const unmount = exported.__test.fdMountImperativeFloorHeaders(fakeUi)
  await new Promise(resolve => setTimeout(resolve, 15))

  const headSlot = fakeTailActions.children.find(c => c.classList.contains('fd-floor-head-slot'))
  const panelSlot = fakeTailActions.children.find(c => c.classList.contains('fd-floor-panel-slot'))
  assert.ok(headSlot && headSlot.children.length === 1, '正在生成期间必须在每轮对话的尾部（story-row-actions）插入胶囊按钮')
  assert.match(headSlot.children[0].textContent, /通用·技艺/)
  assert.ok(!fakeHead.children.some(c => c.classList.contains('fd-floor-head-slot')), '胶囊不再挂在楼层顶栏')

  // 2) 结算后刷新并点击胶囊：展开详情面板，出现「✦ 命运点 2/3」「✦ 逆命重投」「🔥 孤注一掷」
  await settledHooks[0]({ gameId: 'g-head-pill', turn: 5, textVersion: 'v5' })
  fakeArticle.className = 'dsh-tavern-story-transcript-row dsh-tavern-assistant dsh-tavern-story-floor'
  unmount()

  const unmount2 = exported.__test.fdMountImperativeFloorHeaders(fakeUi)
  await new Promise(resolve => setTimeout(resolve, 15))
  const settledHeadSlot = fakeTailActions.children.find(c => c.classList.contains('fd-floor-head-slot'))
  const settledPanelSlot = fakeTailActions.children.find(c => c.classList.contains('fd-floor-panel-slot'))
  settledHeadSlot.children[0].click()
  assert.ok(settledPanelSlot.children.length === 1, '点击尾部胶囊后应在下方展开详情面板')
  const panelText = settledPanelSlot.textContent
  assert.match(panelText, /✦ 命运点 [23]\/3/)
  assert.match(panelText, /✦ 逆命重投/)
  assert.match(panelText, /🔥 孤注一掷/)
  unmount2()
})

test('回归验证：历史免检定楼层开启「每轮必检定」后点「重新生成正文」（settled:true 预检帧 + regenerate 时间线早于后台结算 + 后续跳号新轮）全程必投骰且正常落盘', async () => {
  const turnSections = []
  const settledHooks = []
  const timelineHooks = []
  const handlers = new Map()
  const gameDataMap = new Map()
  const turnDataMap = new Map()
  let pluginData = null
  let currentTurnState = { turn: 0, settled: false, generating: true, greeting: false }

  applyFateDicePlugin({
    tavern: {
      capabilities: { decisionJudge: 1, narrativeDamper: 1 },
      damperTurnQuestions() { return () => {} },
      turnSection(def) { turnSections.push(def); return () => {} },
      settlementSection() { return () => {} },
      settlementTool() { return () => {} },
      onTurnSettled(fn) { settledHooks.push(fn); return () => {} },
      onTimelineChanged(fn) { timelineHooks.push(fn); return () => {} },
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
      async getTurnState() { return structuredClone(currentTurnState) },
      async getTurn() { return { turn: 3, text: '你接过瓷碟咬了一口蜂蜜蛋糕。', variables: {} } },
      async publishState() {},
      async getDamperTurnContext({ turn }) {
        return {
          active: true,
          turn,
          explicitSceneShift: false,
          ruling: { rulingTier: 'allow_advance', deltaBudget: 'step', leverageScore: 1.2 },
          answers: {
            fd_needs_check: { type: 'noul', probability: 0.05 },
            fd_difficulty: { type: 'choice', choice: 'easy' },
            fd_capability: { type: 'score', score: 2 },
            fd_domain: { type: 'choice', choice: 'general_social' }
          }
        }
      },
      async applyDamperDiceShift() {
        return { applied: true, ruling: { rulingTier: 'allow_advance', deltaBudget: 'step' } }
      }
    }
  })

  const inputFloor3 = '安雅蹲身替我拍净衣摆浮沙，我顺势抬手揉了揉她的发顶，她喉间立刻滚起满足的呼噜，尾巴卷上你的手腕。'

  // 1) 首次发送（未开每轮必检定）：5% < 积极阈值 35%，免检定落盘
  await handlers.get('fate-dice:save-global-settings')({ settings: { sensitivity: 'strict', alwaysRoll: false } })
  currentTurnState = { turn: 0, settled: false, generating: true, greeting: false }
  const firstInj = await turnSections[0].text({ gameId: 'g-regen-always', turn: 4, input: inputFloor3 })
  assert.equal(firstInj, '')
  await settledHooks[0]({ gameId: 'g-regen-always', turn: 4, textVersion: 'v4-skip' })
  const skippedRead = await handlers.get('fate-dice:read-turn')({ gameId: 'g-regen-always', turn: 4 })
  assert.equal(skippedRead.roll, null)
  assert.equal(skippedRead.judged.shouldRoll, false)

  // 2) 用户打开「每轮必检定」，对第 3 楼（storyTurn=4）点击「重新生成正文」：
  //    真实宿主在 prepareRegenerationFrameCache 阶段：getTurnState 返回 { turn: 4, settled: true, generating: false }，turnSection 传入 candidateTurn=16
  await handlers.get('fate-dice:save-global-settings')({ settings: { alwaysRoll: true } })
  currentTurnState = { turn: 4, settled: true, generating: false, greeting: false }
  const regenInput = `${inputFloor3}\n\n<turn_extra_request>\n写细腻一点\n</turn_extra_request>`
  const regenInj = await turnSections[0].text({ gameId: 'g-regen-always', turn: 16, input: regenInput })
  assert.match(regenInj, /本轮客观检定已由系统真骰裁定/, '开启每轮必检定后重新生成必须强制投出真骰')

  // 流式期间前端按 turn=4 读取，必须立即看到新真骰而非旧的 5% 免检定
  const streamingRead = await handlers.get('fate-dice:read-turn')({ gameId: 'g-regen-always', turn: 4, streaming: true })
  assert.ok(streamingRead?.roll, '重新生成流式期间按原楼层 turn=4 必须读到新真骰')
  assert.match(String(streamingRead.roll.reason || ''), /每轮必检定/)
  assert.equal(streamingRead.roll.attempt, inputFloor3, '重新生成附加标签不得污染检定动作文本')

  // 真实宿主 regenBody 返回后立即触发 timelineChanged('regenerate')，此时后台结算尚未完成，不得误删 pending
  timelineHooks[0]({ gameId: 'g-regen-always', kind: 'regenerate', turn: 4 })

  // 随后后台结算完成触发 onTurnSettled(turn=4)，必须成功落盘覆盖旧的免检定记录
  await settledHooks[0]({ gameId: 'g-regen-always', turn: 4, textVersion: 'v4-rolled' })
  const settledRead = await handlers.get('fate-dice:read-turn')({ gameId: 'g-regen-always', turn: 4 })
  assert.ok(settledRead?.roll, '重新生成结算完成后第 3 楼（turn=4）必须持久保存真骰结果，不再显示免检定')
  assert.equal(settledRead.roll.rolledAt, streamingRead.roll.rolledAt)

  // 3) 重新生成导致原生轮号跳到 18 后，玩家继续发送新一轮行动：turn=18 必须对齐落盘，不因 4+1=5 错位丢失
  currentTurnState = { turn: 4, settled: true, generating: true, greeting: false }
  const nextInj = await turnSections[0].text({ gameId: 'g-regen-always', turn: 18, input: '练习基础剑法' })
  assert.match(nextInj, /本轮客观检定已由系统真骰裁定/)
  await settledHooks[0]({ gameId: 'g-regen-always', turn: 18, textVersion: 'v18-1' })
  const turn18Read = await handlers.get('fate-dice:read-turn')({ gameId: 'g-regen-always', turn: 18 })
  assert.ok(turn18Read?.roll, '跳号后的新楼层（turn=18）结算必须正常落盘')
})

test('回归验证：切换会话 + 跳号第 5 楼（turn=18）流式期间不卡「定难中」，且异步落盘窗口内骰子胶囊不消失', async () => {
  const turnSections = []
  const settledHooks = []
  const handlers = new Map()
  const gameDataMap = new Map()
  const turnDataMap = new Map()
  const watchListeners = new Map()
  let saveDelayMs = 0

  function emitState(gameId, name, data) {
    const set = watchListeners.get(`${gameId}:${name}`)
    if (!set) return
    for (const fn of set) fn(structuredClone(data))
  }

  applyFateDicePlugin({
    tavern: {
      capabilities: { decisionJudge: 1, narrativeDamper: 1 },
      damperTurnQuestions() { return () => {} },
      turnSection(def) { turnSections.push(def); return () => {} },
      settlementSection() { return () => {} },
      settlementTool() { return () => {} },
      onTurnSettled(fn) { settledHooks.push(fn); return () => {} },
      handle(name, fn) { handlers.set(name, fn) },
      async savePluginData() {},
      async readPluginData() { return null },
      async saveGameData({ gameId, data }) {
        if (saveDelayMs > 0) await new Promise(r => setTimeout(r, saveDelayMs))
        gameDataMap.set(gameId, structuredClone(data))
      },
      async readGameData({ gameId }) { return structuredClone(gameDataMap.get(gameId) || null) },
      async saveTurnData({ gameId, turn, textVersion, data }) {
        if (saveDelayMs > 0) await new Promise(r => setTimeout(r, saveDelayMs))
        turnDataMap.set(`${gameId}:${turn}`, { turn, textVersion, data: structuredClone(data) })
        return { turn, textVersion }
      },
      async readTurnData({ gameId, turn }) { return structuredClone(turnDataMap.get(`${gameId}:${turn}`) || null) },
      async getTurnState() { return { turn: 5, settled: true, generating: true, greeting: false } },
      async getTurn() { return { turn: 5, text: '藏书阁烛光摇曳。', variables: {} } },
      async publishState({ gameId, name, data }) { emitState(gameId, name, data) },
      async getDamperTurnContext({ turn }) {
        return {
          active: true,
          turn,
          explicitSceneShift: false,
          ruling: { rulingTier: 'costly_advance', deltaBudget: 'micro_step', leverageScore: 1.28 },
          answers: {
            fd_needs_check: { type: 'noul', probability: 0.78 },
            fd_difficulty: { type: 'choice', choice: 'normal' },
            fd_capability: { type: 'score', score: 1 },
            fd_domain: { type: 'choice', choice: 'general_physical' }
          }
        }
      },
      async applyDamperDiceShift() {
        return { applied: true, ruling: { rulingTier: 'costly_advance', deltaBudget: 'micro_step' } }
      }
    }
  })

  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let loadedModule = null
  const effects = []

  function makeEl(tag) {
    const attrs = new Map()
    const listeners = new Map()
    const el = {
      tagName: String(tag || '').toUpperCase(),
      className: '',
      title: '',
      type: '',
      disabled: false,
      style: {},
      parentNode: null,
      children: [],
      get lastElementChild() { return this.children.length ? this.children[this.children.length - 1] : null },
      classList: {
        contains(cls) { return String(el.className || '').split(/\s+/).includes(cls) }
      },
      setAttribute(k, v) { attrs.set(k, String(v)) },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null },
      hasAttribute(k) { return attrs.has(k) },
      appendChild(child) {
        if (child.parentNode && child.parentNode !== el) child.parentNode.removeChild(child)
        const idx = el.children.indexOf(child)
        if (idx >= 0) el.children.splice(idx, 1)
        child.parentNode = el
        el.children.push(child)
        return child
      },
      removeChild(child) {
        const idx = el.children.indexOf(child)
        if (idx >= 0) el.children.splice(idx, 1)
        child.parentNode = null
        return child
      },
      querySelector(sel) {
        if (sel === '.dsh-tavern-story-floor-head') {
          return el.children.find(c => c.classList.contains('dsh-tavern-story-floor-head')) || null
        }
        return null
      },
      addEventListener(ev, fn) { listeners.set(ev, fn) }
    }
    Object.defineProperty(el, 'textContent', {
      get() {
        return el._text !== undefined && el.children.length === 0
          ? el._text
          : (el._text || '') + el.children.map(c => c.textContent).join('')
      },
      set(val) {
        el._text = String(val ?? '')
        if (val === '') el.children.forEach(c => { c.parentNode = null })
        if (val === '') el.children = []
      }
    })
    return el
  }

  let mutationCb = null
  const articles = []
  const fakeBody = makeEl('body')
  const fakeDoc = {
    head: makeEl('head'),
    body: fakeBody,
    getElementById: () => null,
    createElement: tag => makeEl(tag),
    querySelectorAll: sel => (sel === 'article.dsh-tavern-story-floor' ? articles : [])
  }
  const fakeReact = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: fn => { effects.push(fn) },
    useMemo: fn => fn(),
    useRef: val => ({ current: val })
  }
  const sandbox = {
    window: { __ModuleLoader__: { load(def) { loadedModule = def } }, localStorage: { getItem: () => null, setItem: () => {} } },
    document: fakeDoc,
    MutationObserver: class {
      constructor(cb) { mutationCb = cb }
      observe() {}
      disconnect() {}
    },
    setTimeout,
    clearTimeout,
    console
  }
  vm.runInNewContext(clientCode, sandbox, { filename: 'client.js' })
  const exported = loadedModule.factory(mod => {
    if (mod === 'react') return fakeReact
    throw new Error('host exposes no ' + mod)
  })

  // 验证 data-row-key 退化为 index:N 时，fdExtractFloorTurn 仍取 data-chat-turn=18 而非 data-floor=5
  const rowIndexArticle = makeEl('article')
  rowIndexArticle.setAttribute('data-row-key', 'index:8')
  rowIndexArticle.setAttribute('data-chat-turn', '18')
  rowIndexArticle.setAttribute('data-floor', '5')
  assert.equal(exported.__test.fdExtractFloorTurn(rowIndexArticle), 18)

  const fakeUi = {
    callHost: (name, args) => handlers.get(name)(args),
    watchState: (gameId, name, fn) => {
      const k = `${gameId}:${name}`
      if (!watchListeners.has(k)) watchListeners.set(k, new Set())
      watchListeners.get(k).add(fn)
      return () => { watchListeners.get(k)?.delete(fn) }
    }
  }

  // 先残留旧会话 ID（模拟之前打开过另一张角色卡），再由 ComposerLiveDock 切换至新会话 session-new
  exported.__test.fdNoteActiveGameId('session-old-stale')
  const unmountHeaders = exported.__test.fdMountImperativeFloorHeaders(fakeUi)
  exported.__test.ComposerLiveDock({ ui: fakeUi, sessionId: 'session-new' })
  while (effects.length) {
    const fn = effects.shift()
    fn()
  }
  assert.equal(exported.__test.fdGetActiveGameId(), 'session-new', 'ComposerLiveDock 必须将活跃会话同步到新局')

  // 发送前 turnSection 先产出结果并广播 live-roll（turn=18，第 5 楼），随后流式 DOM 节点才插入
  await turnSections[0].text({ gameId: 'session-new', turn: 18, input: '继续推进剑术' })

  const streamArticle = makeEl('article')
  streamArticle.className = 'dsh-tavern-story-transcript-row dsh-tavern-assistant dsh-tavern-story-floor dsh-tavern-story-streaming'
  streamArticle.setAttribute('data-floor', '5')
  streamArticle.setAttribute('data-legacy-turn', '18')
  const streamHead = makeEl('div')
  streamHead.className = 'dsh-tavern-story-floor-head'
  streamArticle.appendChild(streamHead)
  articles.push(streamArticle)

  mutationCb([{ target: fakeBody }])
  await new Promise(r => setTimeout(r, 25))

  const headSlot = streamHead.children.find(c => c.classList.contains('fd-floor-head-slot'))
  assert.ok(headSlot && headSlot.children.length === 1)
  assert.doesNotMatch(headSlot.children[0].textContent, /真骰定难中/, '发送前已出结果时，流式期间不得卡在「真骰定难中」')
  assert.match(headSlot.children[0].textContent, /体魄/, '流式期间应直接展示本轮已投出的真骰结果')

  // 模拟正文流式刚结束（streaming 类移除）而后台 MVU + onTurnSettled 持久化仍在异步写入（saveDelayMs=40ms）
  saveDelayMs = 40
  const settlePromise = settledHooks[0]({ gameId: 'session-new', turn: 18, textVersion: 'v18-final' })
  await new Promise(r => setTimeout(r, 10))

  // 在 onTurnSettled 尚未写完磁盘的中间时刻，前端流式结束发起非流式读取，不得读空消失
  streamArticle.className = 'dsh-tavern-story-transcript-row dsh-tavern-assistant dsh-tavern-story-floor'
  mutationCb([{ target: streamArticle }])
  await new Promise(r => setTimeout(r, 15))
  assert.ok(headSlot.children.length === 1, '流式结束且结算落盘进行中时，顶栏骰子胶囊不得消失')
  assert.match(headSlot.children[0].textContent, /体魄/)

  await settlePromise
  await new Promise(r => setTimeout(r, 20))
  assert.ok(headSlot.children.length === 1, '生成与结算全部完成后，第 5 楼顶栏骰子胶囊必须稳定保留')
  assert.match(headSlot.children[0].textContent, /体魄/)

  unmountHeaders()
})

test('输入栏悬浮骰子胶囊与弹出裁定小窗：latest 读取、胶囊文案、与楼层一致的裁定详情与重投闭环', async () => {
  const turnSections = []
  const settledHooks = []
  const handlers = new Map()
  const gameDataMap = new Map()
  const turnDataMap = new Map()

  applyFateDicePlugin({
    tavern: {
      capabilities: { decisionJudge: 1, narrativeDamper: 1 },
      damperTurnQuestions() { return () => {} },
      turnSection(def) { turnSections.push(def); return () => {} },
      settlementSection() { return () => {} },
      settlementTool() { return () => {} },
      onTurnSettled(fn) { settledHooks.push(fn); return () => {} },
      handle(name, fn) { handlers.set(name, fn) },
      async savePluginData() {},
      async readPluginData() { return null },
      async saveGameData({ gameId, data }) { gameDataMap.set(gameId, structuredClone(data)) },
      async readGameData({ gameId }) { return structuredClone(gameDataMap.get(gameId) || null) },
      async saveTurnData({ gameId, turn, textVersion, data }) {
        turnDataMap.set(`${gameId}:${turn}`, { turn, textVersion, data: structuredClone(data) })
        return { turn, textVersion }
      },
      async readTurnData({ gameId, turn }) { return structuredClone(turnDataMap.get(`${gameId}:${turn}`) || null) },
      async getTurnState() { return { turn: 5, settled: true, generating: false, greeting: false } },
      async getTurn() { return { turn: 5, text: '演武场木桩旁尘土飞扬。', variables: {} } },
      async publishState() {},
      async getDamperTurnContext({ turn }) {
        return {
          active: true,
          turn,
          explicitSceneShift: false,
          ruling: { rulingTier: 'resist_pushback', deltaBudget: 'frozen', leverageScore: 1.5 },
          answers: {
            fd_needs_check: { type: 'noul', probability: 0.74 },
            fd_difficulty: { type: 'choice', choice: 'easy' },
            fd_capability: { type: 'score', score: 0 },
            fd_domain: { type: 'choice', choice: 'general_physical' }
          }
        }
      },
      async applyDamperDiceShift() {
        return { applied: true, ruling: { rulingTier: 'resist_pushback', deltaBudget: 'frozen' } }
      }
    }
  })

  // 1) 无记录时 latest 读取返回初始元信息，而不带 latest 的 turn:0 仍返回 null
  const withoutLatest = await handlers.get('fate-dice:read-turn')({ gameId: 'g-dock', turn: 0 })
  assert.equal(withoutLatest, null)
  const emptyLatest = await handlers.get('fate-dice:read-turn')({ gameId: 'g-dock', turn: 0, latest: true })
  assert.equal(emptyLatest.turn, 0)
  assert.equal(emptyLatest.roll, null)
  assert.equal(emptyLatest.rule, '2d6')
  assert.equal(emptyLatest.fate.points, 2)

  // 2) 完成第 5 楼检定并落盘后，latest 读取自动命中最末楼层 turn=5
  await handlers.get('fate-dice:save-global-settings')({ settings: { alwaysRoll: true } })
  await turnSections[0].text({ gameId: 'g-dock', turn: 5, input: '我全力向演武场木桩挥出重拳' })
  await settledHooks[0]({ gameId: 'g-dock', turn: 5, textVersion: 'v5-1' })

  const latestRecord = await handlers.get('fate-dice:read-turn')({ gameId: 'g-dock', turn: 0, latest: true })
  assert.equal(latestRecord.turn, 5)
  assert.ok(latestRecord.roll)
  /* 真骰是加密随机：掷出大失败时结算会回充 +1 命运点（2 → 3），两种都合法 */
  assert.equal(latestRecord.fate.points, latestRecord.roll.tier === 'fumble' ? 3 : 2)

  // 3) 校验浏览器端悬浮胶囊渲染、Portal 弹窗与按钮回调
  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let loadedModule = null
  let stateIndex = 0
  let stateSlots = []
  const effects = []
  const portaled = []

  const fakeDoc = {
    head: { appendChild() {} },
    body: { tagName: 'BODY' },
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    querySelectorAll: () => []
  }
  const fakeReact = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: init => {
      const idx = stateIndex++
      if (!(idx in stateSlots)) stateSlots[idx] = typeof init === 'function' ? init() : init
      const set = val => {
        stateSlots[idx] = typeof val === 'function' ? val(stateSlots[idx]) : val
      }
      return [stateSlots[idx], set]
    },
    useEffect: fn => { effects.push(fn) },
    useMemo: fn => fn(),
    useRef: val => ({ current: val })
  }
  const fakeReactDOM = {
    createPortal: (node, target) => {
      portaled.push({ node, target })
      return { portal: true, node, target }
    }
  }
  const sandbox = {
    window: {
      innerWidth: 1280,
      innerHeight: 800,
      __ModuleLoader__: { load(def) { loadedModule = def } },
      localStorage: { getItem: () => null, setItem: () => {} }
    },
    document: fakeDoc,
    MutationObserver: class { observe() {}; disconnect() {} },
    setTimeout,
    clearTimeout,
    console
  }
  vm.runInNewContext(clientCode, sandbox, { filename: 'client.js' })
  const exported = loadedModule.factory(mod => {
    if (mod === 'react') return fakeReact
    if (mod === 'react-dom') return fakeReactDOM
    throw new Error('unexpected require: ' + mod)
  })

  const expandVnode = node => {
    if (!node || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(expandVnode)
    if (node.portal) return { portal: true, node: expandVnode(node.node) }
    if (typeof node.type === 'function') return expandVnode(node.type({ ...(node.props || {}), children: node.children }))
    return { type: String(node.type), props: node.props, children: (node.children || []).map(expandVnode) }
  }
  const findNodes = (tree, pred, acc = []) => {
    if (!tree || typeof tree !== 'object') return acc
    if (Array.isArray(tree)) {
      tree.forEach(item => findNodes(item, pred, acc))
      return acc
    }
    if (pred(tree)) acc.push(tree)
    if (tree.node) findNodes(tree.node, pred, acc)
    if (Array.isArray(tree.children)) findNodes(tree.children, pred, acc)
    return acc
  }

  const fakeUi = {
    callHost: (name, args) => handlers.get(name)(args),
    watchState: () => () => {}
  }

  // 初次渲染：空状态悬浮胶囊展示「🎲 命运之骰」
  stateIndex = 0
  const initialTree = expandVnode(exported.__test.ComposerLiveDock({ ui: fakeUi, sessionId: 'g-dock' }))
  const initialPill = findNodes(initialTree, n => n.type === 'button' && String(n.props?.className || '').includes('fd-composer-pill'))[0]
  assert.ok(initialPill, 'ComposerLiveDock 必须渲染悬浮骰子胶囊按钮')
  assert.match(JSON.stringify(initialPill), /命运之骰/)

  // 运行 useEffect 拉取 latest 记录后重渲染
  while (effects.length) {
    const fn = effects.shift()
    fn()
  }
  await new Promise(r => setTimeout(r, 20))

  stateIndex = 0
  const loadedTree = expandVnode(exported.__test.ComposerLiveDock({ ui: fakeUi, sessionId: 'g-dock' }))
  const loadedPill = findNodes(loadedTree, n => n.type === 'button' && String(n.props?.className || '').includes('fd-composer-pill'))[0]
  assert.ok(loadedPill)
  assert.match(JSON.stringify(loadedPill), /体魄/, '载入第5楼记录后悬浮胶囊应显示当前楼层检定摘要')

  // 点击悬浮胶囊 → 展开并经 ReactDOM.createPortal 挂载到 document.body
  loadedPill.props.onClick({ stopPropagation() {} })
  stateIndex = 0
  portaled.length = 0
  const openTree = expandVnode(exported.__test.ComposerLiveDock({ ui: fakeUi, sessionId: 'g-dock' }))
  assert.equal(portaled.length, 1, '弹出小窗必须通过 ReactDOM.createPortal 挂载到 document.body')
  assert.equal(portaled[0].target, fakeDoc.body)
  const popoverStr = JSON.stringify(openTree)
  assert.match(popoverStr, /命运之骰裁定/)
  assert.match(popoverStr, /骰面算式/)
  assert.match(popoverStr, /能力修正/)
  assert.match(popoverStr, /叙事阻尼器/)
  assert.match(popoverStr, /难度理由/)
  assert.match(popoverStr, /✦ 命运点 [23]\/3/)

  // 构造失败检定记录传入 ComposerDicePopover 验证重投按钮与孤注一掷按钮及关闭按钮
  let rerollMode = ''
  let closed = false
  const failRecord = {
    turn: 5,
    rule: '2d6',
    fate: { points: 2, max: 3, failCount: 0 },
    rerollState: { allowed: true, canFate: true, canPush: true, fatePoints: 2, fateMax: 3 },
    roll: {
      rule: '2d6',
      check: '通用 · 体魄',
      dice: [3, 1],
      total: 4,
      target: 6,
      skillBonus: 0,
      modifier: 0,
      tier: 'failure',
      tierLabel: '失败',
      difficultyLabel: '容易',
      reason: '叙事阻尼器合并裁定：触发概率 74%',
      damper: { applied: true, quotaLabel: '配额:frozen', quota: 'resist_pushback / frozen', reason: '叙事阻尼器合并裁定：触发概率 74%' }
    }
  }
  const popTree = expandVnode(exported.__test.ComposerDicePopover({
    record: failRecord,
    peeked: true,
    rerolling: false,
    rerollHint: '',
    isStreaming: false,
    popoverStyle: exported.__test.fdComputePopoverStyle({ left: 12, top: 680, bottom: 706 }),
    onReroll: mode => { rerollMode = mode },
    onClose: () => { closed = true }
  }))
  const popStr = JSON.stringify(popTree)
  assert.match(popStr, /命运之骰裁定 · 通用 · 体魄检定（失败）/)
  assert.match(popStr, /fd-reroll-btn is-fate/)
  assert.match(popStr, /✦ 逆命重投/)
  assert.match(popStr, /-1 点 · 余 2\/3/)
  assert.match(popStr, /fd-reroll-btn is-push/)
  assert.match(popStr, /🔥 孤注一掷/)
  assert.match(popStr, /直接点「重新生成正文」将自动复用原骰点/)

  const popBtns = findNodes(popTree, n => n.type === 'button')
  const fateBtn = popBtns.find(b => JSON.stringify(b).includes('逆命重投'))
  const pushBtn = popBtns.find(b => JSON.stringify(b).includes('孤注一掷'))
  const closeBtn = popBtns.find(b => b.props?.className === 'fd-popover-close')
  assert.ok(fateBtn && pushBtn && closeBtn)
  fateBtn.props.onClick()
  assert.equal(rerollMode, 'fate')
  pushBtn.props.onClick()
  assert.equal(rerollMode, 'push')
  closeBtn.props.onClick({ stopPropagation() {} })
  assert.equal(closed, true)
})

test('命运点工作台视觉层级与重投按钮显眼化：移除易误触的三宫格假按钮卡片，最新回合操作置顶并采用实心双轨重投按钮', async () => {
  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(clientCode, /fd-fate-rule-card/, '不得再保留外观酷似可点击按钮的三宫格规则卡片')
  assert.match(clientCode, /\.fd-reroll-btn\.is-fate\s*\{/)
  assert.match(clientCode, /\.fd-reroll-btn\.is-push\s*\{/)
  assert.match(clientCode, /\.fd-fate-footnote\s*\{/)

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

  const expandShallow = node => {
    if (!node || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(expandShallow)
    if (typeof node.type === 'function') {
      if (node.type === exported.__test.TurnRollCapsule) {
        return { type: 'TurnRollCapsuleStub', props: node.props, children: [] }
      }
      return expandShallow(node.type({ ...(node.props || {}), children: node.children }))
    }
    return { type: String(node.type), props: node.props, children: (node.children || []).map(expandShallow) }
  }

  const checksTree = expandShallow(exported.__test.ChecksTab({
    ui: { callHost: async () => ({}) },
    gameId: 'g-ui-order',
    hasGame: true,
    view: {
      judgeStatus: { available: true, provider: 'gemini' },
      damper: { available: true, linkage: true },
      fate: { points: 2, max: 3, failCount: 1 },
      lastTurn: 18,
      recent: [{ turn: 18, check: '通用·体魄', total: 4, tierLabel: '失败', rolledAt: 1 }]
    }
  }))
  const checksStr = JSON.stringify(checksTree)
  const heroIdx = checksStr.indexOf('fd-fate-hero')
  const latestIdx = checksStr.indexOf('fd-fate-latest-box')
  const footnoteIdx = checksStr.indexOf('fd-fate-footnote')
  assert.ok(heroIdx > -1 && latestIdx > heroIdx, '最新回合操作区必须紧贴命运点槽下方')
  assert.ok(footnoteIdx > latestIdx, '静态规则附注必须退居可交互的最新回合操作区之后')

  const modes = []
  const actionTree = expandShallow(exported.__test.FdRerollActionBox({
    rerollState: { allowed: true, canFate: true, canPush: true, fatePoints: 2, fateMax: 3 },
    fate: { points: 2, max: 3, failCount: 1 },
    rerolling: false,
    rerollHint: '',
    isStreaming: false,
    compact: false,
    onReroll: m => modes.push(m)
  }))
  const actionStr = JSON.stringify(actionTree)
  assert.match(actionStr, /fd-reroll-bar/)
  assert.match(actionStr, /fd-reroll-btn is-fate/)
  assert.match(actionStr, /fd-reroll-btn is-push/)

  const doneTree = expandShallow(exported.__test.FdRerollActionBox({
    rerollState: { allowed: false, reason: '本轮已重投锁定（每轮限 1 次）' },
    fate: { points: 1, max: 3, failCount: 0 },
    rerolling: false,
    rerollHint: '✦ 已消耗 1 点命运点逆命重投！现在点击酒馆「重新生成正文」即可按新点数改写剧情',
    isStreaming: false,
    compact: false
  }))
  assert.match(JSON.stringify(doneTree), /fd-reroll-done/)
})

test('移动端胶囊收成纯骰子图标：三处胶囊共用图标位，窄屏/触屏隐藏圆点与全文并保留可读语义', async () => {
  const client = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const styles = await readFile(new URL('../src/client/styles.js', import.meta.url), 'utf8')

  // 每个胶囊都必须同时具备 圆点 / 图标 / 文字 三个槽位，移动端才有东西可切换
  const count = re => (client.match(re) || []).length
  const reactDots = count(/className: 'fd-floor-dot'/g)
  const domDots = count(/fdEl\(doc, 'span', 'fd-floor-dot'\)/g)
  const reactIcons = count(/className: 'fd-floor-pill-icon'/g)
  const domIcons = count(/fdEl\(doc, 'span', 'fd-floor-pill-icon'\)/g)
  assert.equal(reactDots + domDots, 4, '楼层顶栏 / 轮次胶囊 / 输入栏胶囊 / 定难中占位四处都必须保留圆点槽位')
  assert.equal(reactIcons + domIcons, reactDots + domDots, '每个 fd-floor-dot 旁边都必须有对应的 fd-floor-pill-icon 图标位')
  assert.equal(count(/className: 'fd-floor-pill-text'/g) + count(/fdEl\(doc, 'span', 'fd-floor-pill-text'/g), 4,
    '胶囊文案节点必须带 fd-floor-pill-text 类名供移动端隐藏')
  assert.ok(!/fdEl\(doc, 'span', '', pillText\)/.test(client), '胶囊文案不得再使用无类名的裸 span')

  // 桌面端不显示图标，移动端只显示图标
  assert.match(styles, /\.fd-floor-pill-icon\s*\{[^}]*display:\s*none/, '图标默认必须隐藏，桌面端维持圆点 + 全文')
  const mobile = styles.match(/@media[^{]*\(hover:\s*none\)[^{]*\{[\s\S]*?\n\}/)
  assert.ok(mobile, '必须存在触屏（hover:none + pointer:coarse）分支，手机横屏与平板才能收起全文')
  const block = mobile[0]
  assert.match(block, /\.fd-floor-pill \.fd-floor-dot[\s\S]*?display:\s*none/, '移动端必须隐藏圆点')
  assert.match(block, /\.fd-floor-pill \.fd-floor-pill-text\s*\{\s*display:\s*none/, '移动端必须隐藏胶囊全文')
  assert.match(block, /\.fd-floor-pill \.fd-floor-pill-icon\s*\{\s*display:\s*block/, '移动端必须显示骰子图标')
  assert.match(block, /\.fd-floor-pill\.fd-composer-pill[\s\S]*?width:\s*22px/, '输入栏胶囊在移动端同样收成 22px 圆形图标')

  // 图标用 mask 绘制，随 --fd-pill-color 变色（成功率/失败率/暗骰等色调仍然可辨）
  assert.match(styles, /-webkit-mask:\s*url\("data:image\/svg\+xml,/, '图标必须用内联 SVG mask 绘制，避免额外资源请求')
  assert.match(styles, /background:\s*var\(--fd-pill-color\)/, '图标颜色必须跟随胶囊色调')

  // 文本被隐藏后语义不能丢：胶囊必须带 aria-label
  assert.ok((client.match(/'aria-label':\s*pillMeta\.pillText/g) || []).length >= 1, '输入栏胶囊须带 aria-label')
  assert.ok((client.match(/'aria-label':\s*pillText/g) || []).length >= 1, '轮次胶囊须带 aria-label')
  assert.ok((client.match(/setAttribute\('aria-label', pillText\)/g) || []).length >= 1, '楼层顶栏胶囊须带 aria-label')
})

test('3D HDR 舞台映射、6 款 WebGL2 主题设置与手动按钮长按蓄力控制器（无 WebGL 环境优雅降级）', async () => {
  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const ReactMock = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children }
    },
    Fragment: 'Fragment',
    useEffect() {},
    useMemo: fn => fn(),
    useRef: initial => ({ current: initial }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}]
  }
  let exported = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(mod) {
          exported = mod.factory(id => (id === 'react' ? ReactMock : null))
        }
      },
      matchMedia: () => ({ matches: false })
    },
    document: undefined,
    setTimeout,
    clearTimeout,
    console
  }
  vm.runInNewContext(clientCode, sandbox)
  assert.ok(exported && exported.__test, 'client.js 必须导出 __test 辅助集')

  const { FD3D, Fd3DDiceStage, FdRerollActionBox, fdAttachHoldChargeToDomBtn } = exported.__test
  assert.ok(FD3D && typeof FD3D.resolveTheme === 'function', '必须导出 FD3D 3D 引擎工具')
  assert.equal(FD3D.canUseWebGL2(), false, 'Node 无浏览器环境必须安全探测为 false 而不抛错')

  // 无 WebGL2 时 Fd3DDiceStage 返回 null 零副作用降级
  assert.equal(Fd3DDiceStage({ roll: { rule: '2d6', dice: [3, 4], total: 7 }, animation: 'bounce' }), null)

  // 主题路由：bounce 随模式智能切换；explicit 主题直接命中；compact/none 返回 null
  assert.equal(FD3D.resolveTheme('bounce', 'normal', false).id, 'astral')
  assert.equal(FD3D.resolveTheme('bounce', 'fate', false).id, 'prism')
  assert.equal(FD3D.resolveTheme('bounce', 'push', false).id, 'inferno')
  assert.equal(FD3D.resolveTheme('bounce', 'normal', true).id, 'singularity')
  assert.equal(FD3D.resolveTheme('jianxin', 'normal', false).id, 'jianxin')
  assert.equal(FD3D.resolveTheme('cyber', 'fate', false).id, 'cyber')
  assert.equal(FD3D.resolveTheme('compact', 'normal', false), null)
  assert.equal(FD3D.resolveTheme('none', 'normal', false), null)

  // 复用锁定骰（重新生成 / 编辑正文后重放同一楼层）不是一次新的重投：
  // 主题必须归位默认，否则 🔥孤注 的焚天熔炉会跟着锁定结果一直复现在后续重放上
  assert.equal(FD3D.resolveThemeMode({ rerollMeta: { mode: 'push' } }, false), 'push')
  assert.equal(FD3D.resolveThemeMode({ rerollMeta: { mode: 'push' }, reusedOnRegenerate: true }, false), 'normal')
  assert.equal(FD3D.resolveThemeMode({ rerollMeta: { mode: 'fate' }, reusedOnRegenerate: true }, false), 'normal')
  assert.equal(FD3D.resolveThemeMode({ hidden: true }, true), 'hidden')
  assert.equal(
    FD3D.resolveTheme('bounce', FD3D.resolveThemeMode({ rerollMeta: { mode: 'push' }, reusedOnRegenerate: true }, false), false).id,
    'astral'
  )

  // 骰制到 3D 多面体规格转换（含 d100 -> 00+0）
  const d100Spec = FD3D.rollToStageSpec({ rule: 'd100', dice: [100], total: 100, tier: 'fumble', check: '克苏鲁神话' }, false)
  assert.equal(d100Spec.diceSpecs.length, 2)
  assert.equal(d100Spec.diceSpecs[0].meshKey, 'd100_tens')
  assert.equal(d100Spec.diceSpecs[0].targetValue, 0)
  assert.equal(d100Spec.diceSpecs[1].meshKey, 'd100_ones')
  assert.equal(d100Spec.diceSpecs[1].targetValue, 0)

  const d20Spec = FD3D.rollToStageSpec({ rule: 'd20', dice: [20], total: 22, tier: 'critical', check: '潜行', rerollMeta: { mode: 'fate' } }, false)
  assert.equal(d20Spec.mode, 'fate')
  assert.equal(d20Spec.diceSpecs[0].meshKey, 'd20')
  assert.equal(d20Spec.diceSpecs[0].targetValue, 20)

  // React 重投按钮必须绑定长按蓄力事件与保留普通点击触发
  const triggered = []
  const box = FdRerollActionBox({
    rerollState: { allowed: true, canFate: true, canPush: true, fatePoints: 2, fateMax: 3 },
    fate: { points: 2, max: 3, failCount: 0 },
    rerolling: false,
    onReroll: m => triggered.push(m)
  })
  const findButtons = node => {
    const out = []
    if (!node || typeof node !== 'object') return out
    if (node.type === 'button') out.push(node)
    if (Array.isArray(node.children)) node.children.forEach(c => out.push(...findButtons(c)))
    return out
  }
  const btns = findButtons(box)
  assert.equal(btns.length, 2)
  assert.equal(typeof btns[0].props.onPointerDown, 'function')
  assert.equal(typeof btns[0].props.onPointerLeave, 'function')
  btns[0].props.onClick()
  btns[1].props.onClick()
  assert.deepEqual(triggered, ['fate', 'push'])

  // 原生 DOM 长按蓄力控制器：按住进入蓄力 -> 移出无损取消；按住释放 -> 携带 power > 0 触发
  const makeFakeBtn = () => {
    const listeners = new Map()
    const classes = new Set()
    const titleEl = { textContent: '✦ 逆命重投' }
    return {
      disabled: false,
      style: { removeProperty() {}, setProperty() {} },
      classList: {
        add: c => classes.add(c),
        remove: c => classes.delete(c),
        has: c => classes.has(c)
      },
      querySelector: () => titleEl,
      addEventListener: (ev, fn) => listeners.set(ev, fn),
      emit: (ev, payload = { button: 0 }) => listeners.get(ev)?.(payload),
      titleEl
    }
  }
  const calls = []
  const chargeEvents = []
  const fakeStage = {
    startButtonCharge: m => chargeEvents.push(['start', m]),
    cancelButtonCharge: () => chargeEvents.push(['cancel'])
  }
  const domBtn = makeFakeBtn()
  fdAttachHoldChargeToDomBtn(domBtn, {
    mode: 'fate',
    getStage: () => fakeStage,
    onTrigger: (m, p) => calls.push([m, p])
  })

  // 1) 长按 180ms 进入蓄力后移出取消：不触发重投且取消 3D 旋涡
  domBtn.emit('pointerdown', { button: 0 })
  await new Promise(r => setTimeout(r, 180))
  assert.ok(domBtn.classList.has('is-charging'), '长按超过 140ms 必须进入蓄力态')
  domBtn.emit('pointerleave', {})
  assert.equal(domBtn.classList.has('is-charging'), false, '移出按钮必须立刻解除蓄力态')
  assert.equal(calls.length, 0, '移出取消绝不能误触重投扣命运点')
  assert.deepEqual(chargeEvents, [['start', 'fate'], ['cancel']])

  // 2) 长按 220ms 后松手释放：携带 power > 0 爆发触发
  domBtn.emit('pointerdown', { button: 0 })
  await new Promise(r => setTimeout(r, 220))
  domBtn.emit('pointerup', {})
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'fate')
  assert.ok(calls[0][1] > 0.1, '蓄力释放必须携带蓄力强度 power > 0.1')

  // 3) 宿主端也接收所有新 3D 动效枚举值
  const { handlers } = mountPluginWithData()
  const saved = await handlers.get('fate-dice:save-global-settings')({ settings: { animation: 'jianxin' } })
  assert.equal(saved.settings.animation, 'jianxin', '后端设置白名单必须持久化 3D 动效主题值')
})


test('每轮生成的投骰动画：决策结果一到就在对话视口正中央全宽播放，不受空楼层高度挤压，并与尾部胶囊彻底剥离', async () => {
  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')

  // 1) 挂在 document.body 并实时锚定 [data-conversation-scroll] 全宽与垂直中心，绝不塞进刚生成 28px 高的空 article 里挤压变形
  assert.match(clientCode, /fdEl\(doc, 'div', 'fd-floor-roll-overlay'\)/)
  assert.match(clientCode, /fdEl\(doc, 'canvas', 'fd-3d-canvas fd-floor-roll-canvas'\)/)
  assert.match(clientCode, /\[data-conversation-scroll\]/)
  assert.match(clientCode, /mountHost\.appendChild\(wrap\)/)

  // 2) 决策结果一到即刻开播（live-roll 直连无需等待流式 DOM 楼层插入 + 流式首读兜底 + 手动重投）
  assert.match(clientCode, /fdPlayFloorRollAnim\(null, null, data\.roll, data\.animation/)
  assert.match(clientCode, /fdPlayFloorRollAnim\(entry\.article, entry, optimistic\.roll/)
  assert.match(clientCode, /fdPlayFloorRollAnim\(entry\.article, entry, nextRecord\.roll/)
  assert.match(clientCode, /fdPlayFloorRollAnim\(entry\.article, entry, nextRoll/)

  // 3) 胶囊里只剩静态骰面，不再自己播投骰/蓄力爆发动画
  assert.match(clientCode, /entry\.stage3d\.setStaticRoll\(spec\)/)
  assert.doesNotMatch(clientCode, /entry\.stage3d\.throwDice/)
  assert.doesNotMatch(clientCode, /entry\.stage3d\.releaseButtonCharge/)

  // 4) 样式：fixed 视口层 + 天际裂隙开合动效 + 严禁 max-height: calc(100% - ...) 把演出压成细条
  const styles = await readFile(new URL('../src/client/styles.js', import.meta.url), 'utf8')
  const overlayBlock = /\.fd-floor-roll-overlay \{([\s\S]*?)\n\}/.exec(styles)
  assert.ok(overlayBlock, '必须存在 .fd-floor-roll-overlay 样式块')
  assert.match(overlayBlock[1], /position: fixed;/)
  assert.match(overlayBlock[1], /pointer-events: none;/)
  assert.doesNotMatch(overlayBlock[1], /max-height:\s*calc\(100%/)
  assert.match(styles, /@keyframes fd-theater-open/)
  assert.match(styles, /@keyframes fd-theater-close/)
  assert.match(styles, /\.fd-floor-roll-overlay\.is-settled \.fd-floor-roll-readout/)
  assert.match(styles, /\.fd-floor-roll-overlay\.is-fading/)

  // 5) 无 WebGL2 环境优雅降级：不插入任何演出节点，也不抛错
  const el = {
    className: '',
    children: [],
    ownerDocument: { createElement: () => ({ className: '', children: [], appendChild(c) { this.children.push(c) }, setAttribute() {} }) },
    appendChild(child) { this.children.push(child); child.parentNode = this },
    removeChild(child) { this.children = this.children.filter(c => c !== child) }
  }
  const mod = await loadClientModuleForTest()
  const roll = { check: '通用·体魄', rule: '2d6', dice: [6, 4], total: 10 + 2, tier: 'success', tierLabel: '成功', rolledAt: 1700000000000 }
  assert.equal(mod.__test.fdFloorRollAnimKey(roll), '1700000000000:12:6,4:success:')
  const played = mod.__test.fdPlayFloorRollAnim(el, { disposed: false }, roll, 'bounce')
  assert.equal(played, false, '没有 WebGL2 时中央演出必须静默跳过')
  assert.equal(el.children.length, 0, '没有 WebGL2 时不得往楼层里插入空演出节点')
})

async function loadClientModuleForTest () {
  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let loadedModule = null
  const makeEl = tag => ({
    tagName: String(tag || '').toUpperCase(),
    className: '',
    style: {},
    children: [],
    parentNode: null,
    setAttribute() {},
    appendChild(child) { this.children.push(child); child.parentNode = this; return child },
    removeChild(child) { this.children = this.children.filter(c => c !== child); child.parentNode = null; return child },
    querySelector: () => null,
    addEventListener() {},
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0 })
  })
  const body = makeEl('body')
  const fakeDoc = {
    head: makeEl('head'),
    body,
    getElementById: () => null,
    createElement: tag => makeEl(tag),
    querySelectorAll: () => []
  }
  const fakeReact = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: fn => fn(),
    useRef: val => ({ current: val })
  }
  const sandbox = {
    window: {
      __ModuleLoader__: { load(def) { loadedModule = def } },
      localStorage: { getItem: () => null, setItem: () => {} },
      devicePixelRatio: 1
    },
    document: fakeDoc,
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: fn => setTimeout(fn, 0),
    cancelAnimationFrame: id => clearTimeout(id),
    setTimeout,
    clearTimeout,
    performance: { now: () => Date.now() },
    console
  }
  vm.runInNewContext(clientCode, sandbox, { filename: 'client.js' })
  return loadedModule.factory(mod => {
    if (mod === 'react') return fakeReact
    throw new Error('host exposes no ' + mod)
  })
}
