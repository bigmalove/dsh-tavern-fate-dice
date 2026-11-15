import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { evaluateOutcome, extractVariableModifier, rollCheck, rollExpression } from '../lib/dice-engine.js'
import { heuristicAssess, judgeActionDifficulty } from '../lib/difficulty-judge.js'
import { buildTurnInjection } from '../lib/prompt-builder.js'
import { apply as applyFateDicePlugin, inject as fateDiceInject, name as fateDiceName } from '../lib/index.js'

test('dice-engine：2d6 / d20 / d100 五档判定、自由表达式与变量修正提取', () => {
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [6, 6], modifier: 0, difficulty: 'extreme' }).tier, 'critical')
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [1, 1], modifier: 4, difficulty: 'trivial' }).tier, 'fumble')
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [4, 4], modifier: 0, difficulty: 'moderate' }).tier, 'costly')
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [5, 5], modifier: 0, difficulty: 'moderate' }).tier, 'success')
  assert.equal(evaluateOutcome({ rule: '2d6', dice: [2, 3], modifier: 0, difficulty: 'moderate' }).tier, 'failure')

  assert.equal(evaluateOutcome({ rule: 'd20', dice: [20], modifier: -3, difficulty: 'extreme' }).tier, 'critical')
  assert.equal(evaluateOutcome({ rule: 'd20', dice: [1], modifier: 5, difficulty: 'trivial' }).tier, 'fumble')
  assert.equal(evaluateOutcome({ rule: 'd20', dice: [11], modifier: 1, difficulty: 'moderate' }).tier, 'costly')

  assert.equal(evaluateOutcome({ rule: 'd100', dice: [4], modifier: 0, difficulty: 'extreme' }).tier, 'critical')
  assert.equal(evaluateOutcome({ rule: 'd100', dice: [97], modifier: 2, difficulty: 'trivial' }).tier, 'fumble')
  assert.equal(evaluateOutcome({ rule: 'd100', dice: [65], modifier: 0, difficulty: 'moderate' }).tier, 'costly')

  const rolled = rollCheck({ rule: '2d6', check: '潜行检定', difficulty: 'hard', modifier: 2, hidden: true }, () => 4)
  assert.equal(rolled.check, '潜行')
  assert.deepEqual(rolled.dice, [4, 4])
  assert.equal(rolled.total, 10)
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

test('difficulty-judge：Gemini / Jev 协议判定与不可用时启发式回退', async () => {
  const seenRequests = []
  const geminiStub = {
    capabilities: { decisionJudge: 1 },
    async decisionJudgeStatus() {
      return { available: true, provider: 'gemini', model: 'gemini-decision-1', capabilities: { noul: true, choice: true, score: true } }
    },
    async judgeDecision(req) {
      seenRequests.push(req)
      return {
        provider: 'gemini',
        judgeTier: 'digest',
        retriedSafetyFallback: true,
        answers: {
          needs_check: { type: 'noul', probability: 0.88 },
          difficulty_tier: { type: 'choice', choice: 'hard' },
          check_category: { type: 'choice', choice: 'insight' },
          situation_edge: { type: 'score', score: 3 }
        }
      }
    }
  }
  const gRes = await judgeActionDifficulty({ tavern: geminiStub, gameId: 'g1', input: '偷偷观察对方袖口是不是藏了武器' })
  assert.equal(seenRequests[0].desensitize, true, '必须向宿主开启 R18 语义分级脱敏')
  assert.equal(gRes.shouldRoll, true)
  assert.equal(gRes.difficulty, 'hard')
  assert.equal(gRes.check, '察觉')
  assert.equal(gRes.hidden, true)
  assert.equal(gRes.edgeBonus, 2)
  assert.equal(gRes.retriedSafetyFallback, true)

  const jevStub = {
    capabilities: { decisionJudge: 1 },
    async decisionJudgeStatus() {
      return { available: true, provider: 'jev', model: 'jev-1.13.0', capabilities: { noul: true, choice: false, score: false } }
    },
    async judgeDecision() {
      return {
        provider: 'jev',
        judgeTier: 'full',
        answers: {
          needs_check: { type: 'noul', probability: 0.72 },
          high_difficulty: { type: 'noul', probability: 0.85 },
          favorable_edge: { type: 'noul', probability: 0.15 },
          hidden_perception: { type: 'noul', probability: 0.2 }
        }
      }
    }
  }
  const jRes = await judgeActionDifficulty({ tavern: jevStub, gameId: 'g1', input: '正面劈砍重甲骑士' })
  assert.equal(jRes.shouldRoll, true)
  assert.equal(jRes.difficulty, 'extreme')
  assert.equal(jRes.edgeBonus, -1)
  assert.equal(jRes.hidden, false)

  const downStub = {
    capabilities: { decisionJudge: 1 },
    async decisionJudgeStatus() { return { available: false, reason: 'NOT_CONFIGURED' } }
  }
  const hChat = await judgeActionDifficulty({ tavern: downStub, gameId: 'g1', input: '嗯，我知道了。' })
  assert.equal(hChat.shouldRoll, false)
  assert.equal(hChat.source, 'heuristic')

  const hStealth = heuristicAssess({ input: '我趁守卫转身时尝试强行撬开铁门锁。', sensitivity: 'normal' })
  assert.equal(hStealth.shouldRoll, true)
  assert.equal(hStealth.difficulty, 'hard')
})

test('prompt-builder：生成不含泄密点数（暗骰）的正文注入块', () => {
  const openText = buildTurnInjection({
    rule: '2d6', check: '说服', difficultyLabel: '中等', dice: [5, 4], modifier: 1, total: 10, target: 7, tier: 'success', tierLabel: '成功', hidden: false, attempt: '劝降守卫'
  })
  assert.match(openText, /说服检定/)
  assert.match(openText, /【成功】/)
  assert.equal(openText.includes('暗骰约束'), false)

  const hiddenText = buildTurnInjection({
    rule: 'd100', check: '察觉', difficultyLabel: '困难', dice: [38], modifier: 0, total: 38, target: 40, tier: 'success', tierLabel: '成功', hidden: true
  })
  assert.match(hiddenText, /暗骰约束/)
})

test('插件宿主集成流程：发前定难注入、R18 脱敏、版本落盘、手投锁定与自由骰', async () => {
  assert.equal(fateDiceName, 'dsh-tavern-fate-dice')
  assert.deepEqual(fateDiceInject, ['tavern'])

  const turnSections = []
  const settledHooks = []
  const removedHooks = []
  const handlers = new Map()
  const turnDataMap = new Map()
  const gameDataMap = new Map()
  const states = new Map()
  let judgeCalls = 0
  let settings = {
    mode: 'auto',
    rule: '2d6',
    sensitivity: 'normal',
    toneBias: 'balanced',
    animation: 'bounce',
    allowHidden: true,
    modifierFormula: '敏捷'
  }

  const tavernStub = {
    capabilities: { decisionJudge: 1 },
    gameSettings() {},
    async getGameSettings() { return settings },
    turnSection(def) { turnSections.push(def) },
    onTurnSettled(fn) { settledHooks.push(fn) },
    onGameRemoved(fn) { removedHooks.push(fn) },
    handle(name, fn) { handlers.set(name, fn) },
    async getTurnState() { return { turn: 1, key: 'v1', writing: false, settling: false } },
    async getTurn({ turn }) {
      return turn === 1
        ? { turn: 1, text: '昏暗走廊尽头站着巡逻卫兵。', variables: { stat_data: { 敏捷: 14 } } }
        : null
    },
    async saveTurnData({ gameId, turn, textVersion, data }) {
      turnDataMap.set(`${gameId}:${turn}`, { turn, textVersion, data })
      return { turn, textVersion }
    },
    async readTurnData({ gameId, turn }) {
      return turnDataMap.get(`${gameId}:${turn}`) || null
    },
    async saveGameData({ gameId, data }) {
      gameDataMap.set(gameId, data)
    },
    async readGameData({ gameId }) {
      return gameDataMap.get(gameId) || null
    },
    async publishState({ gameId, name, data }) {
      states.set(`${gameId}:${name}`, data)
    },
    async decisionJudgeStatus() {
      return { available: true, provider: 'gemini', model: 'gemini-decision-1', capabilities: { noul: true, choice: true, score: true } }
    },
    async judgeDecision(req) {
      judgeCalls += 1
      assert.equal(req.desensitize, true)
      return {
        provider: 'gemini',
        judgeTier: 'digest',
        retriedSafetyFallback: true,
        answers: {
          needs_check: { type: 'noul', probability: 0.91 },
          difficulty_tier: { type: 'choice', choice: 'moderate' },
          check_category: { type: 'choice', choice: 'physical' },
          situation_edge: { type: 'score', score: 2 }
        }
      }
    }
  }

  applyFateDicePlugin({ tavern: tavernStub })
  assert.equal(turnSections.length, 1)

  // 1. 发前自动定难 + 真随机掷骰 + R18 脱敏透传 + live-roll 广播
  const injected = await turnSections[0].text({ gameId: 'g-1', turn: 2, input: '我强行冲过去抢走她的钥匙。' })
  assert.match(injected, /【本轮客观检定已由系统掷骰裁定/)
  assert.match(injected, /体魄检定/)
  const live = states.get('g-1:live-roll')
  assert.ok(live && live.roll.retriedSafetyFallback === true)
  assert.equal(live.roll.judgeTier, 'digest')
  assert.equal(live.roll.modifierBreakdown.varModifier, 2)

  // 2. 回合结算后按正文版本落盘
  for (const fn of settledHooks) await fn({ gameId: 'g-1', turn: 2, textVersion: 'v2' })
  const turnStored = await handlers.get('fate-dice:read-turn')({ gameId: 'g-1', turn: 2 })
  assert.equal(turnStored.textVersion, 'v2')
  assert.equal(turnStored.roll.check, '体魄')

  const status = await handlers.get('fate-dice:status')({ gameId: 'g-1' })
  assert.equal(status.summary.total, 1)

  // 3. 手投锁定流：预览 -> 锁定 -> 发送前直接消费，不再重复调决策模型
  const preview = await handlers.get('fate-dice:preview')({ gameId: 'g-1', input: '翻窗溜进二楼走廊' })
  assert.equal(preview.shouldRoll, true)

  const locked = await handlers.get('fate-dice:roll-and-lock')({
    gameId: 'g-1',
    input: '翻窗溜进二楼走廊',
    rule: 'd20',
    check: '潜行',
    difficulty: 'hard',
    modifier: 2,
    hidden: false
  })
  assert.equal(locked.roll.rule, 'd20')

  const callsBefore = judgeCalls
  const lockedInjected = await turnSections[0].text({ gameId: 'g-1', turn: 3, input: '翻窗溜进二楼走廊' })
  assert.equal(judgeCalls, callsBefore)
  assert.match(lockedInjected, /潜行检定/)
  assert.match(lockedInjected, /1d20|d20/)

  // 4. 自由骰与删局清理
  const free = await handlers.get('fate-dice:free-roll')({ gameId: 'g-1', expression: '2d6+1' })
  assert.equal(free.result.expression, '2d6+1')
  assert.equal(free.result.dice.length, 2)

  for (const fn of removedHooks) await fn({ gameId: 'g-1' })
})

test('浏览器 client.js 装载与官方 UI 槽位注册', async () => {
  const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let descriptor = null
  const ReactStub = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: init => [init, () => {}],
    useEffect: () => {},
    useMemo: fn => fn(),
    useRef: init => ({ current: init })
  }
  vm.runInNewContext(clientSource, {
    window: { __ModuleLoader__: { load(desc) { descriptor = desc } } },
    console
  })
  assert.equal(descriptor.id, 'dsh-tavern-fate-dice')
  const exported = descriptor.factory(mod => mod === 'react' ? ReactStub : {})
  assert.equal(exported.name, 'dsh-tavern-fate-dice')
  assert.equal(typeof exported.apply, 'function')

  const registered = []
  exported.apply({
    inject(_deps, cb) {
      cb({
        tavernUi: {
          registerComposerSlot(item) { registered.push(['slot', item.id]); return () => {} },
          registerComposerAction(item) { registered.push(['action', item.id]); return () => {} },
          registerTurnView(item) { registered.push(['turn', item.id]); return () => {} },
          registerStatusSection(item) { registered.push(['status', item.id]); return () => {} }
        }
      })
    }
  })
  assert.deepEqual(registered, [
    ['slot', 'fate-dice-live'],
    ['action', 'fate-dice-pad'],
    ['turn', 'fate-dice-turn'],
    ['status', 'fate-dice-status']
  ])
  assert.equal(exported.__test.formatRollSummary({ check: '潜行', hidden: true }), '潜行暗骰 · 等待揭晓')
  assert.equal(exported.__test.formatRollSummary({ check: '潜行', dice: [4, 5], modifier: 1, total: 10, tierLabel: '成功', hidden: false }), '潜行检定 · [4+5]+1=10 · 成功')
})
