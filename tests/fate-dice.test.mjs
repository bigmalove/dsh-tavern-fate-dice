import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { evaluateOutcome, extractVariableModifier, rollCheck, rollExpression, shiftDifficulty } from '../lib/dice-engine.js'
import {
  SKILL_TEMPLATES,
  computeSkillBudget,
  createSkillsFromTemplate,
  findMatchingSkill,
  listSkillTemplates,
  randomizeSkillBonuses,
  resetRecommendedBonuses
} from '../lib/skill-system.js'
import {
  createEventGroup,
  createEventItem,
  createEventTrack,
  createGeneralPlotTemplateGroup,
  evaluateEventConditions,
  rollTrack
} from '../lib/event-pool.js'
import {
  advanceDirectorOnSettled,
  applyArcOp,
  blockTopic,
  drawTurnEvents,
  mergeSettlementArcReport
} from '../lib/narrative-director.js'
import { buildDamperJudgeQuestions, resolveCheckFromDamperContext } from '../lib/damper-bridge.js'
import { heuristicAssessWithSkills, judgeActionDifficulty } from '../lib/difficulty-judge.js'
import { applyImportConfig, buildNativeExportBundle, previewImportConfig } from '../lib/config-transfer.js'
import { collectCharacterMaterial, refreshProfileWithBackgroundLlm, tierToRuleBonus } from '../lib/auto-profiler.js'
import { buildTurnInjection } from '../lib/prompt-builder.js'
import { apply as applyFateDicePlugin, inject as fateDiceInject, name as fateDiceName } from '../lib/index.js'

test('dice-engine：2d6 / d10 / d20 / d100 四骰制五档判定、技能加值、表达式与变量修正', () => {
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
  assert.equal(evaluateOutcome({ rule: 'd100', dice: [65], skillBonus: 0, modifier: 0, difficulty: 'moderate' }).tier, 'costly')
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
  assert.equal(extracted.matched.length, 2)
})

test('skill-system：12 套世界观技能样板、加值预算计算、随机正负分配与恢复默认', () => {
  const templates = listSkillTemplates()
  assert.equal(templates.length, 12)
  assert.equal(Object.keys(SKILL_TEMPLATES).length, 12)

  const dndSkills = createSkillsFromTemplate('dnd5e', 'd20')
  assert.equal(dndSkills.length, 18)
  const budget0 = computeSkillBudget(dndSkills, 'd20')
  assert.equal(budget0.recommended, 54)
  assert.equal(budget0.net, 54)
  assert.ok(dndSkills.some(s => s.name === '察觉' && s.hidden === true))

  const randomized = randomizeSkillBonuses(dndSkills, 'd20', 40)
  assert.equal(randomized.length, 18)
  const budgetRand = computeSkillBudget(randomized, 'd20', 40)
  assert.equal(budgetRand.net, 40)

  const reset = resetRecommendedBonuses(randomized, 'd20')
  assert.equal(computeSkillBudget(reset, 'd20').net, 54)

  const xianxia = createSkillsFromTemplate('xianxia', '2d6')
  const matched = findMatchingSkill(xianxia, '宗门')
  assert.match(matched.name, /宗门/)
})

test('event-pool & narrative-director：多轨事件抽取、双轨上限、2轮主题冷却、5轮屏蔽、AND条件与3条持续剧情线', () => {
  const general = createGeneralPlotTemplateGroup()
  assert.equal(general.tracks.length, 4)
  assert.equal(general.tracks[0].mode, 'd1')

  const d100Track = createEventTrack({
    name: '奇遇百分表',
    mode: 'd100',
    items: [
      createEventItem({ text: '拾得残卷', category: 'push', topic: '奇遇', min: 1, max: 30 }),
      createEventItem({ text: '山风呼啸', category: 'vibe', min: 31, max: 100 })
    ]
  })
  assert.equal(rollTrack(d100Track, () => 25).matchedItem.text, '拾得残卷')
  assert.equal(rollTrack(d100Track, () => 80).matchedItem.text, '山风呼啸')

  const condCheck = evaluateEventConditions([
    { kind: 'mvu', path: '好感.女主', op: '>=', value: 50 },
    { kind: 'input', value: '试探' },
    { kind: 'arc', arcId: 'arc_1', status: 'active' }
  ], {
    variables: { stat_data: { 好感: { 女主: 60 } } },
    input: '我开口试探她的底细',
    arcs: [{ id: 'arc_1', title: '密信疑云', status: 'active' }]
  })
  assert.equal(condCheck.ok, true)

  const longGroup = createEventGroup({
    id: 'long-1',
    name: '长期池',
    tracks: [
      createEventTrack({ mode: 'd1', name: '常驻', items: [{ text: '保持冷峻文风', category: 'constant' }] }),
      createEventTrack({ mode: 'dn', sides: 2, name: '推动A', items: [{ text: '暗哨逼近', category: 'push', topic: '危机' }, { text: '暗哨逼近2', category: 'push', topic: '危机' }] }),
      createEventTrack({ mode: 'dn', sides: 2, name: '推动B', items: [{ text: '旧友来信', category: 'push', topic: '线索' }, { text: '旧友来信2', category: 'push', topic: '线索' }] })
    ]
  })
  const sceneGroup = createEventGroup({
    id: 'scene-1',
    name: '场景池',
    tracks: [
      createEventTrack({ mode: 'dn', sides: 2, name: '场景氛围', items: [{ text: '雨打屋檐', category: 'vibe', topic: '天气' }] })
    ]
  })

  // 第 1 轮：常驻不占上限，push 受 maxPushPerTurn=1 限制只选 1 条，vibe 选 1 条
  const turn1 = drawTurnEvents({
    longGroup,
    sceneGroup,
    storyEnhance: true,
    settings: { maxPushPerTurn: 1, maxVibePerTurn: 1, cooldownTurns: 2, sceneVarPath: '场景.位置' },
    gameState: { lastSceneValue: '客栈' },
    variables: { stat_data: { 场景: { 位置: '客栈' } } },
    input: '推窗查看街道',
    draw: () => 1
  })
  assert.equal(turn1.pickedEvents.filter(e => e.category === 'constant').length, 1)
  assert.equal(turn1.pickedEvents.filter(e => e.category === 'push').length, 1)
  assert.equal(turn1.pickedEvents.filter(e => e.category === 'vibe').length, 1)
  assert.equal(turn1.pickedEvents.find(e => e.category === 'push').topic, '危机')

  // 结算第 1 轮：「危机」进入 2 轮冷却
  let dirState = advanceDirectorOnSettled({}, { turn: 2, pickedEvents: turn1.pickedEvents, cooldownTurns: 2, sceneVarPath: '场景.位置', nextSceneValue: '客栈' })
  assert.equal(dirState.topicCooldowns['危机'], 2)

  // 第 2 轮：「危机」处于冷却，自动跳过并选中「线索」；同时测试场景位置变化自动停用场景组
  const turn2 = drawTurnEvents({
    longGroup,
    sceneGroup,
    storyEnhance: true,
    settings: { maxPushPerTurn: 1, maxVibePerTurn: 1, cooldownTurns: 2, sceneVarPath: '场景.位置' },
    gameState: dirState,
    variables: { stat_data: { 场景: { 位置: '城外破庙' } } },
    input: '踏入庙门',
    draw: () => 1
  })
  assert.equal(turn2.sceneAutoPaused, true, '场景变量改变时应自动停用旧场景组')
  assert.equal(turn2.pickedEvents.find(e => e.category === 'push').topic, '线索')
  assert.equal(turn2.pickedEvents.filter(e => e.category === 'vibe').length, 0, '旧场景组停用后不再抽其氛围轨')

  // 测试临时屏蔽主题 5 轮
  dirState = blockTopic(dirState, '线索', 5)
  assert.equal(dirState.blockedTopics['线索'], 5)

  // 测试持续剧情线最多 3 条活跃上限与结算回报合并
  let arcs = []
  for (let i = 1; i <= 3; i++) {
    const r = applyArcOp(arcs, { op: 'create', title: `主线${i}`, origin: `起因${i}` })
    assert.equal(r.ok, true)
    arcs = r.arcs
  }
  const fourth = applyArcOp(arcs, { op: 'create', title: '溢出线', origin: '不应挤占' })
  assert.equal(fourth.ok, false, '满 3 条活跃剧情线时禁止新增活跃线')

  // 结算回报先完结 1 条再新增 1 条应成功
  const settledArcs = mergeSettlementArcReport(arcs, {
    updates: [
      { op: 'complete', arcId: arcs[0].id, summary: '已水落石出' },
      { op: 'create', title: '新支线4', summary: '新的暗流浮现' }
    ]
  }, 5)
  assert.equal(settledArcs.arcs.filter(a => a.status === 'active').length, 3)
  assert.ok(settledArcs.arcs.some(a => a.title === '新支线4' && a.status === 'active'))
})

test('damper-bridge & difficulty-judge：叙事阻尼器单趟联动修 DC 与独立判定回退', async () => {
  const skills = createSkillsFromTemplate('palace', '2d6')
  const geminiQs = buildDamperJudgeQuestions({ skills, protocol: 'gemini', allowHidden: true })
  assert.equal(geminiQs.length, 3)
  assert.ok(geminiQs.some(q => q.id === 'fd_skill' && q.type === 'choice'))

  // 1. 切场景直接免检定
  const shiftSkip = resolveCheckFromDamperContext({
    damperContext: { explicitSceneShift: true },
    input: '第二天清晨，来到御书房外。',
    skills
  })
  assert.equal(shiftSkip.shouldRoll, false)

  // 2. 阻尼器判越权宣告结果（无动作尝试）→ 直接阻断检定
  const delusionSkip = resolveCheckFromDamperContext({
    damperContext: { ruling: { rulingTier: 'strip_delusion', godmode: 0.92 } },
    input: '太后瞬间对我死心塌地并交出兵符。',
    skills
  })
  assert.equal(delusionSkip.shouldRoll, false)

  // 3. 阻尼器正常返回合并答案 + 高心理防线(82) + 高铺垫(2.6) → 社交检定难度 +1 档且获得铺垫加值 +2
  const socialSkill = skills.find(s => s.category === 'social') || skills[0]
  const linked = resolveCheckFromDamperContext({
    damperContext: {
      ruling: { rulingTier: 'conflicted_half_step', leverageScore: 2.6 },
      stateSnapshot: { kind: 'plain', data: { psychological_guard: 82, intimacy_trust: 25, arousal_or_tension: 40 } },
      answers: {
        fd_needs_check: { type: 'noul', probability: 0.86 },
        fd_difficulty: { type: 'choice', choice: 'moderate' },
        fd_skill: { type: 'choice', choice: socialSkill.id }
      }
    },
    input: '我借敬茶之机低声劝说她联手自保',
    skills,
    damperLinkage: true
  })
  assert.equal(linked.shouldRoll, true)
  assert.equal(linked.skillId, socialSkill.id)
  assert.equal(linked.difficulty, 'hard', '高心理防线应将社交检定从 moderate 上调为 hard')
  assert.equal(linked.edgeBonus, 2, '高铺垫分 2.6 应直接折算为 +2 环境加值')

  // 4. 阻尼器未启用时独立调用 judgeDecision（带技能表 choice 与 R18 脱敏）
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
            check_skill: { type: 'choice', choice: socialSkill.id },
            situation_edge: { type: 'score', score: 2 }
          }
        }
      }
    },
    gameId: 'g1',
    input: '在朝堂上据理力争驳斥首辅',
    skills
  })
  assert.equal(capturedReq.desensitize, true)
  assert.equal(standalone.shouldRoll, true)
  assert.equal(standalone.difficulty, 'hard')

  const heur = heuristicAssessWithSkills({ input: '趁夜色潜行摸进偏殿偷看密折', skills })
  assert.equal(heur.shouldRoll, true)
})

test('config-transfer：原生 v2 导出导入与 AutoRandomInput v1/v2 配置无损转换', () => {
  const nativeBundle = buildNativeExportBundle({
    skillGroups: [{ id: 'sg1', name: '修仙组', rule: '2d6', skills: createSkillsFromTemplate('xianxia', '2d6') }],
    eventGroups: [createGeneralPlotTemplateGroup()]
  })
  const prevNative = previewImportConfig(JSON.stringify(nativeBundle))
  assert.equal(prevNative.ok, true)
  assert.equal(prevNative.skillGroups.length, 1)
  assert.equal(prevNative.eventGroups.length, 1)

  // 模拟 AutoRandomInput 配置包导入
  const ariConfig = {
    version: 2,
    groups: [
      {
        id: 'ari-g1',
        name: '修仙组',
        diceList: [
          {
            name: '秘境突发',
            diceType: 'd6',
            enabled: true,
            commands: [
              { text: '古阵残魂苏醒', category: '剧情推动', topic: '妖兽' },
              { text: '灵雾漫过石阶', category: '氛围描写', topic: '环境' }
            ]
          },
          {
            name: '奇遇百分表',
            diceType: 'd100',
            enabled: true,
            d100Ranges: [
              { min: 1, max: 25, text: '发现前人洞府', category: '剧情推动', topic: '奇遇' }
            ]
          }
        ]
      }
    ],
    skillGroups: [
      {
        id: 'ari-sk1',
        name: '修仙组',
        diceType: 'd20',
        skills: [
          { name: '御剑术', bonus: 5 },
          { name: '神识探查', bonus: 4, hidden: true }
        ]
      }
    ]
  }
  const prevAri = previewImportConfig(JSON.stringify(ariConfig))
  assert.equal(prevAri.ok, true)
  assert.equal(prevAri.skillGroups.length, 1)
  assert.equal(prevAri.eventGroups.length, 1)

  // 导入重名自动追加 (2) 不覆盖原组
  const applied = applyImportConfig(JSON.stringify(ariConfig), nativeBundle.skillGroups, nativeBundle.eventGroups)
  assert.equal(applied.ok, true)
  assert.equal(applied.skillGroups.length, 2)
  assert.equal(applied.skillGroups[1].name, '修仙组 (2)')
})

test('prompt-builder：强制正文沉浸不报点数，兼容检定、暗骰、随机事件与活跃剧情线', () => {
  const text = buildTurnInjection({
    roll: {
      rule: '2d6', check: '宗门交涉', difficultyLabel: '困难',
      dice: [6, 5], skillBonus: 2, modifier: 1, total: 14, target: 8,
      tier: 'critical', tierLabel: '大成功', hidden: true, attempt: '探问长老密令'
    },
    pickedEvents: [
      { category: 'constant', text: '保持古风措辞' },
      { category: 'push', topic: '线索', text: '长老袖中滑落半枚玉简' }
    ],
    activeArcs: [{ id: 'a1', title: '禁地异动', summary: '后山封印松动' }],
    storyEnhance: true
  })
  assert.match(text, /严禁/)
  assert.match(text, /暗骰/)
  assert.match(text, /玉简/)
  assert.match(text, /禁地异动/)
})

test('宿主全链路集成：无 gameSettings/无发前手投、阻尼器单趟合并与反向配额联动、工作台全量 RPC 与后台剧情线结算', async () => {
  assert.equal(fateDiceName, 'dsh-tavern-fate-dice')
  assert.deepEqual(fateDiceInject, ['tavern'])

  let gameSettingsCalled = false
  let damperQuestionProvider = null
  const turnSections = []
  const settlementSections = []
  const settlementTools = []
  const settledHooks = []
  const handlers = new Map()
  const turnDataMap = new Map()
  const gameDataMap = new Map()
  let pluginData = null
  const states = new Map()
  const damperShifts = []

  const tavernStub = {
    capabilities: { decisionJudge: 1, narrativeDamper: 1 },
    gameSettings() { gameSettingsCalled = true },
    damperTurnQuestions(def) { damperQuestionProvider = def; return () => {} },
    turnSection(def) { turnSections.push(def); return () => {} },
    settlementSection(def) { settlementSections.push(def); return () => {} },
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
    async getTurn() { return { turn: 1, text: '殿内烛火摇曳。', variables: { stat_data: { 身法: 16, 场景: { 位置: '大殿' } } } } },
    async publishState({ gameId, name, data }) { states.set(`${gameId}:${name}`, data) },
    async decisionJudgeStatus() {
      return { available: true, provider: 'gemini', model: 'gemini-decision-1', capabilities: { noul: true, choice: true, score: true } }
    },
    async getDamperTurnContext({ gameId, turn }) {
      const qs = await damperQuestionProvider.questions({ gameId, turn, protocol: 'gemini' })
      const domainQ = qs.find(q => q.id === 'fd_domain' || q.id === 'fd_skill')
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
          fd_domain: { type: 'choice', choice: domainChoice },
          fd_skill: { type: 'choice', choice: domainChoice }
        }
      }
    },
    async applyDamperDiceShift(payload) {
      damperShifts.push(payload)
      return {
        applied: true,
        ruling: { rulingTier: 'conflicted_half_step', deltaBudget: 'micro_step' }
      }
    }
  }

  applyFateDicePlugin({ tavern: tavernStub })

  assert.equal(gameSettingsCalled, false, '设置已迁移至插件区面板，不应再调用 gameSettings')
  assert.equal(handlers.has('fate-dice:roll-and-lock'), false, '发前手投锁定接口必须彻底移除')
  assert.equal(handlers.has('fate-dice:preview'), false, '发前手投预览接口必须彻底移除')
  assert.ok(damperQuestionProvider && typeof damperQuestionProvider.questions === 'function', '必须以函数形式注册叙事阻尼器合并附加题')

  // 通过工作台 RPC 开启多轨随机事件与剧情增强双轨模式，并新增一条剧情线
  const wb0 = await handlers.get('fate-dice:workbench')({ gameId: 'g-main' })
  assert.equal(wb0.source, 'host')
  assert.equal(wb0.skillTemplates.length, 12)
  await handlers.get('fate-dice:save-binding')({
    gameId: 'g-main',
    binding: {
      skillGroupId: wb0.skillGroups[0].id,
      eventGroupId: wb0.eventGroups[0].id,
      autoCheck: true,
      multiTrack: true,
      enhanced: true
    }
  })
  const plotAdd = await handlers.get('fate-dice:plotline')({
    gameId: 'g-main',
    action: 'add',
    plotline: { title: '失窃密卷', origin: '藏经阁夜半失窃', progress: '查到外门弟子脚印' }
  })
  assert.equal(plotAdd.ok, true)
  assert.equal(plotAdd.plotlines.length, 1)

  // 玩家正常在主聊天框发送行动 → 触发阻尼器单趟合并判定 + 真骰 + 反向配额同步 + 随机事件抽取
  const injected = await turnSections[0].text({ gameId: 'g-main', turn: 2, input: '我趁长老转身之际施展身法探查案几暗格' })
  assert.match(injected, /检定/)
  assert.equal(damperShifts.length, 1, '真骰出点后必须调用 applyDamperDiceShift 反向同步阻尼配额')
  assert.ok(states.get('g-main:live-roll')?.roll?.damper?.applied, 'live-roll 应携带阻尼联动徽章数据')

  // 同轮重试幂等复用，不重复投骰或重复同步
  const injectedRetry = await turnSections[0].text({ gameId: 'g-main', turn: 2, input: '我趁长老转身之际施展身法探查案几暗格' })
  assert.equal(injectedRetry, injected)
  assert.equal(damperShifts.length, 1)

  // 模拟后台结算模型同时调用 fate_dice_arc_report 与 fate_dice_profile_sync 更新剧情线与 AI 动态角色能力画像
  assert.equal(settlementTools.length, 2)
  const arcTool = settlementTools.find(t => t.name === 'fate_dice_arc_report')
  const profileTool = settlementTools.find(t => t.name === 'fate_dice_profile_sync')
  assert.ok(arcTool && profileTool)
  await arcTool.execute({
    gameId: 'g-main',
    turn: 2,
    arguments: {
      updates: [{ op: 'update', arcId: plotAdd.plotlines[0].id, summary: '在暗格中发现了染血令牌' }]
    }
  })
  await profileTool.execute({
    gameId: 'g-main',
    turn: 2,
    arguments: {
      characterName: '林岚',
      archetype: '青云内门剑修（轻身专精，右肩轻伤）',
      traits: [
        { name: '踏雪身法', tier: 2, source: '角色卡', reason: '内门轻功大成' },
        { name: '神识微察', tier: 1, hidden: true, source: '世界书', reason: '筑基期神识外放' },
        { name: '右肩剑伤', tier: -1, source: 'MVU', reason: '气血受损牵动发力' }
      ]
    }
  })
  await settledHooks[0]({ gameId: 'g-main', turn: 2, textVersion: 'ver-2a' })

  const turnRead = await handlers.get('fate-dice:read-turn')({ gameId: 'g-main', turn: 2 })
  assert.equal(turnRead.textVersion, 'ver-2a')
  assert.ok(turnRead.roll)
  assert.ok(Array.isArray(turnRead.events) && turnRead.events.length >= 1)

  const wbAfter = await handlers.get('fate-dice:workbench')({ gameId: 'g-main' })
  assert.equal(wbAfter.summary.total, 1)
  assert.match(wbAfter.plotlines[0].progress, /染血令牌/)
  assert.equal(wbAfter.characterProfile.characterName, '林岚')
  assert.equal(wbAfter.characterProfile.traits.find(t => t.name === '踏雪身法').bonus, 2)

  // 切换为 d100 骰制时，AI 评定的能力档位自动等比换算（tier 2 -> +20），无需玩家改任何数字
  const rescaled = await handlers.get('fate-dice:save-profile-note')({ gameId: 'g-main', rule: 'd100' })
  assert.equal(rescaled.ok, true)
  assert.equal(rescaled.characterProfile.traits.find(t => t.name === '踏雪身法').bonus, 20)
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

test('浏览器端 client.js：注册插件区面板 registerPanel，无独立行动输入框与骰盘按钮', async () => {
  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.equal(clientCode.includes('registerComposerAction'), false, '不应再向发送栏注册骰盘按钮')
  assert.equal(clientCode.includes('DicePadOverlay'), false, '不应再保留发前手投弹窗')
  assert.equal(clientCode.includes('随机分配加值'), false, '不应再让玩家手动分配技能加值预算')
  assert.ok(clientCode.includes('fd-wb-scroll') && clientCode.includes('overflow-y: auto'), '工作台必须具备独立纵向滚动容器以支持顺滑下滑')
  assert.ok(clientCode.includes('AI 动态角色能力画像'), '角色能力页必须采用 AI 动态能力画像视图')

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
    window: {
      __ModuleLoader__: {
        load(def) { loadedModule = def }
      }
    },
    document: {
      head: { appendChild() {} },
      getElementById: () => null,
      createElement: () => ({ id: '', textContent: '', style: {} })
    },
    console
  }

  vm.runInNewContext(clientCode, sandbox, { filename: 'client.js' })
  assert.ok(loadedModule)
  assert.equal(loadedModule.id, 'dsh-tavern-fate-dice')

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

  // 验证未配置决策模型时的引导横幅、输入栏 setup-required 提示卡与 ? 帮助按钮组件
  const { DecisionModelGuideBanner, LiveRollBanner, FdHelp } = exported.__test
  assert.equal(typeof DecisionModelGuideBanner, 'function')
  assert.equal(typeof FdHelp, 'function')
  assert.equal(DecisionModelGuideBanner({ view: { judgeStatus: { available: true } } }), null, '已配好模型时应自动隐藏引导框')
  const expandVnode = node => {
    if (!node || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(expandVnode)
    if (typeof node.type === 'function') return expandVnode(node.type({ ...(node.props || {}), children: node.children }))
    return { type: String(node.type), props: node.props, children: (node.children || []).map(expandVnode) }
  }

  const bannerVnode = expandVnode(DecisionModelGuideBanner({ view: { judgeStatus: { available: false, reason: 'NOT_CONFIGURED' } } }))
  const serializedBanner = JSON.stringify(bannerVnode)
  assert.match(serializedBanner, /设置 › 叙事阻尼器/)
  assert.match(serializedBanner, /重新检测模型/)

  const setupToastVnode = expandVnode(LiveRollBanner({ event: { id: 's1', kind: 'setup-required', reason: 'NOT_CONFIGURED' } }))
  assert.match(JSON.stringify(setupToastVnode), /设置 › 叙事阻尼器/)

  const helpClosed = expandVnode(FdHelp({ title: '触发灵敏度', text: '详细说明正文' }))
  assert.match(JSON.stringify(helpClosed), /fd-help-btn/)
  assert.ok((clientCode.match(/fd-help-btn|FdHelp|\bhelp\s*:/g) || []).length >= 35, '全工作台所有设置项均应配备 ? 详细说明')
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

  // 1. 默认 allowHeuristicFallback = false：未配模型时不伪装投骰，向前端推送 setup-required 引导条
  const inj1 = await turnSections[0].text({ gameId: 'g-unconf', turn: 2, input: '我趁守卫转身时尝试强行撬开铁门锁' })
  assert.equal(inj1, '')
  assert.equal(states.get('g-unconf:live-roll')?.kind, 'setup-required')
  assert.match(states.get('g-unconf:live-roll')?.message || '', /设置 › 叙事阻尼器/)

  // 2. 玩家显式开启 allowHeuristicFallback = true 后，允许离线关键词启发式检定
  await handlers.get('fate-dice:save-global-settings')({ settings: { allowHeuristicFallback: true } })
  const inj2 = await turnSections[0].text({ gameId: 'g-unconf', turn: 3, input: '我趁守卫转身时尝试强行撬开铁门锁' })
  assert.match(inj2, /检定/)
  assert.equal(states.get('g-unconf:live-roll')?.kind, 'check')
})

