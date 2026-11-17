import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import {
  PRE_SEND_GATE_WAIT_DEFAULT_SEC,
  createPreSendGateBroker,
  normalizePreSendGateSettings,
  planPreSendGate,
  resolvePreSendGateAction
} from '../lib/pre-send-gate.js'
import { apply as applyFateDicePlugin } from '../lib/index.js'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const baseSettings = {
  enabled: true,
  autoCheck: true,
  rule: 'd100',
  sensitivity: 'normal',
  toneBias: 'gritty',
  allowHidden: true,
  allowHeuristicFallback: true,
  damperLinkage: false,
  preSendPause: true,
  preSendScope: 'both',
  preSendWait: 24
}

const failureRoll = { tier: 'failure', tierLabel: '失败', check: '潜行', hidden: false, rolledAt: 1 }
const fumbleRoll = { tier: 'fumble', tierLabel: '大失败', check: '潜行', hidden: false, rolledAt: 2 }

/* ── 1. 策略：该不该停、能选哪几种重投 ───────────────────────────── */

test('发前暂停策略：默认关闭不拦、开启后失败/大失败按范围拦截，暗骰与已重投一律放行', () => {
  assert.equal(planPreSendGate({ settings: {}, roll: failureRoll, turn: 3 }).pause, false)
  assert.equal(planPreSendGate({ settings: {}, roll: failureRoll, turn: 3 }).code, 'DISABLED')

  const off = planPreSendGate({ settings: { preSendPause: false }, roll: failureRoll, turn: 3 })
  assert.equal(off.pause, false)

  const on = planPreSendGate({ settings: baseSettings, roll: failureRoll, turn: 3, fatePoints: 2 })
  assert.equal(on.pause, true)
  assert.equal(on.code, 'OK')
  assert.deepEqual(on.modes, ['fate', 'push'], '有命运点时两种重投都可选')
  assert.equal(on.waitMs, 24000)
  assert.equal(on.turn, 3)

  assert.deepEqual(
    planPreSendGate({ settings: baseSettings, roll: failureRoll, turn: 3, fatePoints: 0 }).modes,
    ['push'],
    '命运点耗尽时只剩孤注一掷'
  )

  assert.equal(
    planPreSendGate({ settings: baseSettings, roll: { ...failureRoll, tier: 'success' }, turn: 3 }).code,
    'TIER_OUT_OF_SCOPE',
    '成功不需要暂停'
  )
  assert.equal(
    planPreSendGate({ settings: baseSettings, roll: { ...failureRoll, tier: 'costly' }, turn: 3 }).code,
    'TIER_OUT_OF_SCOPE',
    '代价成功算成功，不暂停'
  )
  assert.equal(
    planPreSendGate({ settings: baseSettings, roll: { ...failureRoll, hidden: true }, turn: 3 }).code,
    'HIDDEN_LOCKED',
    '暗骰不能提前拦：会剧透成败'
  )
  assert.equal(planPreSendGate({ settings: baseSettings, roll: failureRoll, turn: 3, rerolled: true }).code, 'ALREADY_REROLLED')
  assert.equal(planPreSendGate({ settings: baseSettings, roll: failureRoll, turn: 3, reused: true }).code, 'REGEN_REUSED')
  assert.equal(planPreSendGate({ settings: baseSettings, roll: null, turn: 3 }).code, 'NO_ROLL')

  const fumbleOnly = planPreSendGate({ settings: { ...baseSettings, preSendScope: 'fumble' }, roll: failureRoll, turn: 3 })
  assert.equal(fumbleOnly.pause, false, '仅大失败模式下普通失败不暂停')
  assert.equal(
    planPreSendGate({ settings: { ...baseSettings, preSendScope: 'fumble' }, roll: fumbleRoll, turn: 3 }).pause,
    true
  )

  const locked = planPreSendGate({
    settings: baseSettings,
    roll: failureRoll,
    turn: 3,
    rerollState: { allowed: false, code: 'HISTORY_LOCKED' }
  })
  assert.equal(locked.pause, false, '宿主重投资格不通过时不拦')
  assert.equal(locked.code, 'HISTORY_LOCKED')
})

test('发前暂停设置归一化：等待秒数夹在 5~24 秒，非法范围回退 both', () => {
  assert.equal(normalizePreSendGateSettings({}).enabled, false)
  assert.equal(normalizePreSendGateSettings({}).waitSec, PRE_SEND_GATE_WAIT_DEFAULT_SEC)
  assert.equal(normalizePreSendGateSettings({ preSendPause: true, preSendWait: 999 }).waitSec, 24)
  assert.equal(normalizePreSendGateSettings({ preSendWait: -3 }).waitSec, 5)
  assert.equal(normalizePreSendGateSettings({ preSendWait: 'abc' }).waitSec, PRE_SEND_GATE_WAIT_DEFAULT_SEC)
  assert.equal(normalizePreSendGateSettings({ preSendScope: 'weird' }).scope, 'both')
  assert.equal(normalizePreSendGateSettings({ preSendScope: 'fumble' }).scope, 'fumble')
})

test('玩家选择归一化：fate 需要命运点，push 恒定可选，accept 与超时等价认栽', () => {
  assert.deepEqual(resolvePreSendGateAction('fate', { fatePoints: 1, modes: ['fate', 'push'] }), {
    ok: true, action: 'fate', mode: 'fate', code: 'REROLL_FATE'
  })
  assert.equal(resolvePreSendGateAction('fate', { fatePoints: 0 }).code, 'NO_FATE_POINTS')
  assert.equal(resolvePreSendGateAction('FATE', { fatePoints: 2 }).mode, 'fate', '大小写不敏感')
  assert.equal(resolvePreSendGateAction('push', { fatePoints: 0 }).mode, 'push')
  assert.equal(resolvePreSendGateAction('push', { modes: ['fate'] }).code, 'MODE_NOT_ALLOWED')
  for (const action of ['accept', 'keep', 'decline', 'timeout']) {
    const resolved = resolvePreSendGateAction(action, { fatePoints: 2 })
    assert.equal(resolved.ok, true)
    assert.equal(resolved.action, 'accept')
    assert.equal(resolved.mode, null)
  }
  assert.equal(resolvePreSendGateAction('nuke', {}).code, 'INVALID_ACTION')
})

test('等待器：玩家选择先到先得，超时自动接受，重复解决与未知闸门都被拒绝', async () => {
  const broker = createPreSendGateBroker()
  const first = broker.open({ id: 'gate-a', waitMs: 5000, meta: { gameId: 'g' } })
  assert.equal(broker.peek('gate-a').meta.gameId, 'g')
  assert.equal(broker.resolve('gate-a', 'fate').ok, true)
  const decided = await first.promise
  assert.equal(decided.action, 'fate')
  assert.equal(decided.timedOut, false)
  assert.equal(broker.resolve('gate-a', 'push').ok, false, '同一道闸门不能被解决两次')
  assert.equal(broker.peek('gate-a'), null)
  assert.equal(broker.size, 0)

  const second = broker.open({ id: 'gate-b', waitMs: 20 })
  const timedOut = await second.promise
  assert.equal(timedOut.action, 'accept')
  assert.equal(timedOut.code, 'TIMEOUT')
  assert.equal(timedOut.timedOut, true)

  const third = broker.open({ id: 'gate-c', waitMs: 5000 })
  assert.equal(broker.cancel('gate-c').toString(), 'true')
  assert.equal((await third.promise).code, 'CANCELLED')

  assert.equal(broker.resolve('missing', 'accept').code, 'NO_PENDING_GATE')
})

/* ── 2. 宿主接线：设置白名单、RPC、端到端拦截 ───────────────────────── */

function mountGatePlugin({ fatePoints = 2, settings = {}, gameId = 'g-gate', judge = true } = {}) {
  const turnSections = []
  const settledHooks = []
  const handlers = new Map()
  const states = []
  const gameWrites = []
  const gameDataMap = new Map()
  let pluginData = {
    version: 3,
    settings: { ...baseSettings, ...settings },
    updatedAt: Date.now()
  }
  gameDataMap.set(gameId, {
    version: 3,
    rule: 'd100',
    config: { enabled: true, autoCheck: true, rule: 'd100' },
    characterProfile: null,
    fate: { points: fatePoints, max: 3, failCount: 0 },
    lastTurn: 1,
    lastRoll: null,
    settledRolls: {},
    summary: { total: 0, counts: { critical: 0, success: 0, costly: 0, failure: 0, fumble: 0 }, recent: [] }
  })

  let liveTurnState = null
  const turnDataMap = new Map()

  applyFateDicePlugin({
    inject(deps, cb) { if (Array.isArray(deps) && deps.includes('llm')) cb({ llm: null }) },
    tavern: {
      capabilities: judge ? { decisionJudge: 1 } : {},
      turnSection(def) { turnSections.push(def); return () => {} },
      settlementSection() { return () => {} },
      onTurnSettled(fn) { settledHooks.push(fn); return () => {} },
      onTimelineChanged() { return () => {} },
      handle(name, fn) { handlers.set(name, fn) },
      async readPluginData() { return structuredClone(pluginData) },
      async savePluginData({ data }) { pluginData = structuredClone(data) },
      async readGameData({ gameId: id }) {
        const raw = gameDataMap.get(id)
        return raw ? structuredClone(raw) : null
      },
      async saveGameData({ gameId: id, data }) {
        gameDataMap.set(id, structuredClone(data))
        gameWrites.push({ gameId: id, data: structuredClone(data) })
      },
      async readTurnData({ gameId: id, turn }) { return structuredClone(turnDataMap.get(`${id}:${turn}`) || null) },
      async saveTurnData({ gameId: id, turn, textVersion, data }) {
        turnDataMap.set(`${id}:${turn}`, { turn, textVersion, data: structuredClone(data) })
        return {}
      },
      async getTurnState() { return liveTurnState ? structuredClone(liveTurnState) : null },
      async getTurn() { return { turn: 1, text: '', variables: {} } },
      async publishState({ gameId: id, name, data }) { states.push({ gameId: id, name, data }) },
      async decisionJudgeStatus() {
        if (!judge) return { available: false, reason: 'NOT_CONFIGURED' }
        return { available: true, provider: 'stub-judge', capabilities: { noul: true, choice: true, score: true } }
      },
      /* 固定判难：极难（d100 目标 20）+ 能力档 0 + 无额外边缘加值 → 单次失败概率约八成 */
      async judgeDecision() {
        return {
          provider: 'stub-judge',
          judgeTier: 'full',
          answers: {
            needs_check: { type: 'noul', probability: 0.95 },
            difficulty_tier: { type: 'choice', choice: 'extreme' },
            character_capability: { type: 'score', score: 0 },
            situation_edge: { type: 'score', score: 1 },
            check_category: { type: 'choice', choice: 'physical' }
          }
        }
      }
    }
  })

  return {
    turnSections,
    settledHooks,
    handlers,
    states,
    gameWrites,
    gameData: id => gameDataMap.get(id || gameId),
    setGameData: (patch, id = gameId) => {
      const prev = gameDataMap.get(id) || {}
      gameDataMap.set(id, structuredClone({ ...prev, ...patch }))
    },
    setLiveTurnState: next => { liveTurnState = next },
    gateStates: () => states.filter(item => item.name === 'pre-send-gate')
  }
}

/* 启发式判难 + d100「轻松」档目标 80：单次失败概率约八成，几轮内必中 */
const GATE_INPUTS = Array.from({ length: 12 }, (_, index) => `我尝试打听第${index + 1}号货栈的来历与货主`)

async function waitForGate(harness, input, gameId = 'g-gate') {
  const before = harness.states.length
  const promise = harness.turnSections[0].text({ gameId, turn: 2, input })
  for (let i = 0; i < 80; i += 1) {
    await sleep(5)
    const gate = harness.states
      .slice(before)
      .filter(item => item.name === 'pre-send-gate' && item.data && item.data.gateId)
      .pop()
    if (gate) return { promise, gate: gate.data, before }
  }
  return { promise, gate: null, before }
}

async function reachGate(harness, options = {}) {
  for (const input of GATE_INPUTS) {
    const hit = await waitForGate(harness, input, options.gameId)
    if (hit.gate) return hit
    await hit.promise
  }
  return null
}

test('工作台回读发前暂停设置：开关、范围与等待时长都会落盘并回传', async () => {
  const harness = mountGatePlugin({ settings: { preSendPause: false } })
  const saved = await harness.handlers.get('fate-dice:save-global-settings')({
    settings: { preSendPause: true, preSendScope: 'fumble', preSendWait: 10 }
  })
  assert.equal(saved.ok, true)
  assert.equal(saved.settings.preSendPause, true)
  assert.equal(saved.settings.preSendScope, 'fumble')
  assert.equal(saved.settings.preSendWait, 10)

  const view = await harness.handlers.get('fate-dice:workbench')({})
  assert.equal(view.settings.preSendPause, true)
  assert.equal(view.settings.preSendScope, 'fumble')
  assert.equal(view.settings.preSendWait, 10)

  const clamped = await harness.handlers.get('fate-dice:save-global-settings')({ settings: { preSendWait: 900 } })
  assert.equal(clamped.settings.preSendWait, 24, '等待时长必须夹在 24 秒以内，避免撞宿主 30 秒上限')
})

test('发前闸门 RPC：没有等待中的闸门时明确回绝，缺 gateId 也能区分', async () => {
  const harness = mountGatePlugin()
  const missing = await harness.handlers.get('fate-dice:gate-resolve')({ gameId: 'g-gate', action: 'fate' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'MISSING_GATE')
  const idle = await harness.handlers.get('fate-dice:gate-resolve')({ gameId: 'g-gate', gateId: 'nope', action: 'fate' })
  assert.equal(idle.ok, false)
  assert.equal(idle.code, 'NO_PENDING_GATE')
})

test('端到端：失败时正文被按住不发，选择「接受命运」后按原失败结果继续', async () => {
  const harness = mountGatePlugin()
  const hit = await reachGate(harness)
  assert.ok(hit && hit.gate, '开启暂停后应能在若干次判定内命中一次失败闸门')
  const gate = hit.gate
  assert.equal(gate.gameId, 'g-gate')
  assert.equal(gate.turn, 2)
  assert.ok(['failure', 'fumble'].includes(gate.tier))
  assert.ok(gate.deadlineAt > gate.at, '必须给出自动接受的截止时间')
  assert.ok(gate.waitMs >= 3000, '等待时长必须留出重投余量')
  assert.deepEqual(gate.modes, ['fate', 'push'])
  assert.equal(gate.fate.points, 2)

  /* 正文此刻仍在等待：没有 settle、也没有第二次注入 */
  const resolved = await harness.handlers.get('fate-dice:gate-resolve')({
    gameId: 'g-gate',
    gateId: gate.gateId,
    action: 'accept'
  })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.mode, null)

  const injection = await hit.promise
  assert.ok(injection.includes('本轮客观检定'), '接受后必须把原骰结果注入正文请求')
  assert.ok(injection.includes('渐进失败'), '失败结论必须带渐进失败要求')
  const lastGate = harness.gateStates().pop()
  assert.equal(lastGate.data, null, '闸门关闭后要清空状态，避免下次误弹')
})

test('端到端：失败时选「✦ 逆命重投」立刻扣 1 点命运点，注入改判后的新结果', async () => {
  const harness = mountGatePlugin({ fatePoints: 2 })
  const hit = await reachGate(harness)
  assert.ok(hit && hit.gate)
  const originalInjectionRolledAt = hit.gate.total

  const resolved = await harness.handlers.get('fate-dice:gate-resolve')({
    gameId: 'g-gate',
    gateId: hit.gate.gateId,
    action: 'fate'
  })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.mode, 'fate')

  const injection = await hit.promise
  assert.ok(injection.includes('本轮客观检定'))
  assert.ok(!injection.includes('暗骰约束'), '重投后仍是明骰')
  const game = harness.gameData()
  assert.equal(game.fate.points, 1, '命运点必须在发送前就扣掉')
  const fateWrites = harness.gameWrites.filter(item => item.data && item.data.fate)
  assert.ok(fateWrites.length >= 1)
  assert.ok(
    typeof originalInjectionRolledAt === 'number',
    '闸门载荷必须带骰点，方便弹窗展示'
  )
})

test('端到端：命运点耗尽时 fate 选择被拒且闸门继续等待，随后仍可选「🔥 孤注一掷」', async () => {
  const harness = mountGatePlugin({ fatePoints: 0 })
  const hit = await reachGate(harness)
  assert.ok(hit && hit.gate)
  assert.deepEqual(hit.gate.modes, ['push'], '没有命运点时只剩孤注一掷')

  const denied = await harness.handlers.get('fate-dice:gate-resolve')({
    gameId: 'g-gate',
    gateId: hit.gate.gateId,
    action: 'fate'
  })
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'NO_FATE_POINTS')

  const pushed = await harness.handlers.get('fate-dice:gate-resolve')({
    gameId: 'g-gate',
    gateId: hit.gate.gateId,
    action: 'push'
  })
  assert.equal(pushed.ok, true)
  assert.equal(pushed.mode, 'push')

  const injection = await hit.promise
  assert.ok(injection.includes('本轮客观检定'))
  assert.ok(injection.includes('孤注一掷'), '孤注一掷必须把代价要求写进注入文本')
  assert.equal(harness.gameData().fate.points, 0, '孤注一掷不消耗命运点')
})

test('关闭开关后不弹窗：失败也照常发正文，只把闸门状态清空', async () => {
  const harness = mountGatePlugin({ settings: { preSendPause: false } })
  const injection = await harness.turnSections[0].text({
    gameId: 'g-gate',
    turn: 2,
    input: '我尝试打听酒馆里流传的北境消息'
  })
  assert.ok(injection.includes('本轮客观检定'))
  const gateStates = harness.gateStates()
  assert.ok(gateStates.length >= 1)
  assert.equal(gateStates[gateStates.length - 1].data, null, '未开启暂停时必须清掉残留闸门状态')
})

test('浏览器端打包产物：包含发前逆命弹窗、闸门 RPC 与挂载注册', async () => {
  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  assert.ok(clientCode.includes("'fate-dice:gate-resolve'"), '必须带上闸门 RPC 名')
  assert.ok(clientCode.includes('fd-presend-overlay'), '必须带弹窗样式类')
  assert.ok(clientCode.includes('fdMountPreSendGate'), '必须导出并注册发前闸门挂载')
  assert.ok(clientCode.includes('fate-dice: pre-send reroll gate'), '必须在 main.js 里注册挂载点')
  assert.ok(clientCode.includes('失败 / 大失败时暂停正文发送'), '设置页必须有对应开关')
  assert.ok(clientCode.includes('fd-presend-btn is-fate'), '弹窗必须提供命运点重投按钮')
  assert.ok(clientCode.includes('fd-presend-btn is-push'), '弹窗必须提供孤注一掷按钮')
  assert.ok(clientCode.includes('接受命运'), '弹窗必须提供接受命运按钮')
  assert.ok(clientCode.includes("'fate-dice:gate-peek'"), '必须带上闸门轮询兜底 RPC 名')
})

test('回归验证：回退/删楼导致 game.lastTurn(29) > 当前最新轮(23) 时，发前暂停与楼层重投绝不被误判为 HISTORY_LOCKED', async () => {
  const harness = mountGatePlugin({ fatePoints: 1 })
  /* 模拟真实存档：此前跑过原生 turn=29 后回退到第 23 轮，lastTurn 残留 29 */
  harness.setGameData({
    lastTurn: 29,
    summary: {
      total: 1,
      counts: { critical: 0, success: 0, costly: 1, failure: 0, fumble: 0 },
      recent: [{ turn: 29, check: '技艺', tier: 'costly', tierLabel: '代价成功', total: 6, target: 6, rolledAt: 100 }]
    }
  })
  harness.setLiveTurnState({ turn: 23, settled: true, generating: false, greeting: false })

  let hit = null
  for (const input of GATE_INPUTS) {
    const before = harness.states.length
    const promise = harness.turnSections[0].text({ gameId: 'g-gate', turn: 23, input })
    for (let i = 0; i < 60; i += 1) {
      await sleep(5)
      const gate = harness.states
        .slice(before)
        .filter(item => item.name === 'pre-send-gate' && item.data && item.data.gateId)
        .pop()
      if (gate) {
        hit = { promise, gate: gate.data }
        break
      }
    }
    if (hit) break
    await promise
  }
  assert.ok(hit && hit.gate, '即使 game.lastTurn=29 大于当前 turn=23，发前失败也必须成功暂停并广播闸门')
  assert.equal(hit.gate.turn, 23)

  /* 验证 gate-peek 在无 gameId 参数时也能返回当前唯一挂起的闸门 */
  const peeked = await harness.handlers.get('fate-dice:gate-peek')({})
  assert.equal(peeked.ok, true)
  assert.equal(peeked.gate?.gateId, hit.gate.gateId)

  await harness.handlers.get('fate-dice:gate-resolve')({
    gameId: 'g-gate',
    gateId: hit.gate.gateId,
    action: 'accept'
  })
  await hit.promise
  await harness.settledHooks[0]({ gameId: 'g-gate', turn: 23, textVersion: 'v23-1' })

  assert.equal(harness.gameData().lastTurn, 23, '结算后 lastTurn 必须对齐回当前最新轮 23，不再卡在 29')
  const read23 = await harness.handlers.get('fate-dice:read-turn')({ gameId: 'g-gate', turn: 23 })
  assert.equal(read23.rerollState.allowed, true, '接受失败结算后，当前最新第 23 楼胶囊仍允许手动重投 1 次')
})

test('回归验证：失败楼层尚未走过发前闸门时，开启开关后点重新生成也必须暂停；接受后再重新生成则不再重复打扰', async () => {
  const harness = mountGatePlugin({ settings: { preSendPause: false }, fatePoints: 2 })
  let failedInput = ''
  for (const input of GATE_INPUTS) {
    const inj = await harness.turnSections[0].text({ gameId: 'g-gate', turn: 5, input })
    if (inj.includes('渐进失败') || inj.includes('大失败')) {
      failedInput = input
      await harness.settledHooks[0]({ gameId: 'g-gate', turn: 5, textVersion: 'v5-init' })
      break
    }
  }
  assert.ok(failedInput, '预置一轮未开启发前暂停时落盘的失败楼层')

  /* 玩家开启「失败 / 大失败时暂停正文发送」，对同一轮点击重新生成 */
  await harness.handlers.get('fate-dice:save-global-settings')({ settings: { preSendPause: true } })
  const before = harness.states.length
  const regenPromise = harness.turnSections[0].text({ gameId: 'g-gate', turn: 5, input: failedInput })
  let gate = null
  for (let i = 0; i < 60; i += 1) {
    await sleep(5)
    gate = harness.states.slice(before).filter(s => s.name === 'pre-send-gate' && s.data?.gateId).pop()?.data || null
    if (gate) break
  }
  assert.ok(gate, '此前未经过发前闸门的失败楼层，开启开关后重新生成必须暂停询问')
  await harness.handlers.get('fate-dice:gate-resolve')({ gameId: 'g-gate', gateId: gate.gateId, action: 'accept' })
  await regenPromise
  await harness.settledHooks[0]({ gameId: 'g-gate', turn: 5, textVersion: 'v5-accepted' })

  /* 已经在发前闸门确认接受过命运：再次同文重新生成直接复用，不再二次弹窗 */
  const secondBefore = harness.states.length
  const secondInj = await harness.turnSections[0].text({ gameId: 'g-gate', turn: 5, input: failedInput })
  assert.ok(secondInj.includes('本轮客观检定'))
  const secondGates = harness.states.slice(secondBefore).filter(s => s.name === 'pre-send-gate' && s.data?.gateId)
  assert.equal(secondGates.length, 0, '已确认接受过的同一楼层再次重新生成不再重复弹窗')
})

test('回归验证：浏览器侧 fdGetActiveGameId 通知监听且 fdProbePreSendGate 在会话未知时也能拉起逆命弹窗', async () => {
  const harness = mountGatePlugin({ fatePoints: 2 })
  const hit = await reachGate(harness)
  assert.ok(hit && hit.gate)

  const clientCode = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let loadedModule = null
  function makeEl(tag) {
    const attrs = new Map()
    const listeners = new Map()
    const el = {
      tagName: String(tag || '').toUpperCase(),
      className: '',
      hidden: false,
      disabled: false,
      title: '',
      type: '',
      style: {},
      parentNode: null,
      children: [],
      get isConnected() { return Boolean(this.parentNode || this === fakeBody) },
      setAttribute(k, v) { attrs.set(k, String(v)) },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null },
      appendChild(child) { child.parentNode = el; el.children.push(child); return child },
      removeChild(child) {
        const idx = el.children.indexOf(child)
        if (idx >= 0) el.children.splice(idx, 1)
        child.parentNode = null
        return child
      },
      contains(node) {
        let cur = node
        while (cur) { if (cur === el) return true; cur = cur.parentNode }
        return false
      },
      querySelector(sel) {
        const match = node => {
          const cls = String(node.className || '').split(/\s+/).filter(Boolean)
          if (sel === '.fd-presend-count') return cls.includes('fd-presend-count')
          if (sel === '.fd-presend-hint') return cls.includes('fd-presend-hint')
          if (sel === '.fd-presend-notice') return cls.includes('fd-presend-notice')
          if (sel === '.fd-presend-btn.is-fate') return cls.includes('fd-presend-btn') && cls.includes('is-fate')
          if (sel === '.fd-presend-btn.is-push') return cls.includes('fd-presend-btn') && cls.includes('is-push')
          return false
        }
        const walk = node => {
          for (const ch of node.children) {
            if (match(ch)) return ch
            const found = walk(ch)
            if (found) return found
          }
          return null
        }
        return walk(el)
      },
      querySelectorAll(sel) {
        const out = []
        const walk = node => {
          for (const ch of node.children) {
            if (sel === '.fd-presend-btn' && String(ch.className || '').includes('fd-presend-btn')) out.push(ch)
            walk(ch)
          }
        }
        walk(el)
        return out
      },
      addEventListener(ev, fn) { listeners.set(ev, fn) },
      click() { const fn = listeners.get('click'); if (fn) fn({}) }
    }
    return el
  }
  const fakeBody = makeEl('body')
  const fakeDoc = {
    head: makeEl('head'),
    body: fakeBody,
    getElementById: () => null,
    createElement: tag => makeEl(tag),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  }
  const fakeReact = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: init => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useMemo: fn => fn(),
    useRef: val => ({ current: val })
  }
  let locationSearch = ''
  const sandbox = {
    window: {
      __ModuleLoader__: { load(def) { loadedModule = def } },
      get location() { return { search: locationSearch, hash: '', pathname: '/' } },
      localStorage: { getItem: () => null, setItem: () => {} },
      addEventListener() {},
      removeEventListener() {}
    },
    document: fakeDoc,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console
  }
  vm.runInNewContext(clientCode, sandbox, { filename: 'client.js' })
  const exported = loadedModule.factory(mod => {
    if (mod === 'react') return fakeReact
    throw new Error('unexpected module ' + mod)
  })

  const watchedIds = []
  const fakeUi = {
    callHost: (name, args) => {
      const fn = harness.handlers.get(name)
      if (!fn) return Promise.reject(new Error('missing rpc ' + name))
      return Promise.resolve(fn(args || {}))
    },
    watchState: (gid) => {
      watchedIds.push(gid)
      return () => {}
    }
  }

  /* 挂载时 URL 无会话 ID、watchState 暂未收到推送；随后通过 fdProbePreSendGate 兜底探出挂起闸门并弹出覆层 */
  const unmount = exported.__test.fdMountPreSendGate(fakeUi)
  const probed = await exported.__test.fdProbePreSendGate('')
  assert.equal(probed?.gateId, hit.gate.gateId, '客户端未获知 gameId 时也能经 gate-peek 发现挂起闸门')
  assert.ok(watchedIds.includes('g-gate'), '探出闸门后自动绑定对应会话 watchState')
  const overlay = fakeBody.children.find(c => String(c.className || '').includes('fd-presend-overlay'))
  assert.ok(overlay && overlay.hidden === false, '逆命弹窗覆层必须已弹出显示')

  /* 同时验证 URL 变化后先调 fdGetActiveGameId 也会触发监听绑定 */
  locationSearch = '?sessionId=session-url-next'
  assert.equal(exported.__test.fdGetActiveGameId(), 'session-url-next')
  assert.ok(watchedIds.includes('session-url-next'), 'fdGetActiveGameId 首次检出新 URL 会话时必须通知订阅者重绑')

  /* 点击弹窗里的「接受命运」释放宿主请求 */
  const btns = overlay.querySelectorAll('.fd-presend-btn')
  btns[btns.length - 1].click()
  const finalInj = await hit.promise
  assert.ok(finalInj.includes('本轮客观检定'))
  unmount()
})
