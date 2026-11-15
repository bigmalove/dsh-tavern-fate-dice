import { randomInt, randomBytes } from 'node:crypto'
import { readVariablePath } from './dice-engine.js'
import { evaluateEventConditions, isConstantTrack, rollTrack } from './event-pool.js'

export const MAX_ACTIVE_ARCS = 3

export const DIRECTOR_DEFAULTS = Object.freeze({
  maxPushPerTurn: 1,
  maxVibePerTurn: 1,
  cooldownTurns: 2,
  blockedTopicTurns: 5,
  maxActiveArcs: MAX_ACTIVE_ARCS
})

const ARC_STATUSES = Object.freeze(['active', 'paused', 'completed'])

function toInt(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.trunc(num) : fallback
}

function clampCount(value, fallback) {
  const num = toInt(value, fallback)
  return Math.max(0, Math.min(5, num))
}

function newArcId() {
  return `arc_${randomBytes(5).toString('hex')}`
}

export function normalizeDirectorState(state = {}) {
  const cooldowns = state && typeof state.topicCooldowns === 'object' && state.topicCooldowns ? state.topicCooldowns : {}
  const blocked = state && typeof state.blockedTopics === 'object' && state.blockedTopics ? state.blockedTopics : {}
  const cleanMap = map => {
    const out = {}
    for (const [key, value] of Object.entries(map || {})) {
      const num = toInt(value, 0)
      if (key && num > 0) out[key] = num
    }
    return out
  }
  return {
    topicCooldowns: cleanMap(cooldowns),
    blockedTopics: cleanMap(blocked),
    pauseNextPush: Boolean(state?.pauseNextPush),
    lastSceneValue: state?.lastSceneValue === undefined ? null : state.lastSceneValue,
    sceneGroupPaused: Boolean(state?.sceneGroupPaused),
    sceneVarPath: typeof state?.sceneVarPath === 'string' ? state.sceneVarPath : '',
    cooldownTurns: toInt(state?.cooldownTurns, DIRECTOR_DEFAULTS.cooldownTurns),
    lastTurn: toInt(state?.lastTurn, 0),
    arcs: normalizeArcs(state?.arcs)
  }
}

export function normalizeArc(raw, turn = 0) {
  if (!raw || typeof raw !== 'object') return null
  const rawStatus = raw.status === 'closed' ? 'completed' : raw.status
  const status = ARC_STATUSES.includes(rawStatus) ? rawStatus : 'active'
  const origin = String(raw.origin ?? raw.cause ?? '').slice(0, 200)
  const progress = String(raw.progress ?? '').slice(0, 300)
  const fallbackSummary = origin && progress ? `${origin}｜${progress}` : (progress || origin)
  const summary = String(raw.summary || raw.description || fallbackSummary || '').slice(0, 400)
  return {
    id: String(raw.id || newArcId()),
    title: String(raw.title || raw.name || '未命名剧情线').slice(0, 60),
    origin,
    progress,
    summary,
    anchors: (Array.isArray(raw.anchors) ? raw.anchors : (typeof raw.anchors === 'string' ? [raw.anchors] : []))
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 6),
    status,
    createdTurn: toInt(raw.createdTurn ?? raw.turn, toInt(turn, 0)),
    updatedTurn: toInt(raw.updatedTurn, toInt(turn, 0)),
    createdAt: toInt(raw.createdAt, Date.now()),
    updatedAt: toInt(raw.updatedAt, Date.now())
  }
}

export function normalizeArcs(arcs) {
  return (Array.isArray(arcs) ? arcs : []).map(item => normalizeArc(item)).filter(Boolean).slice(0, 12)
}

export function countActiveArcs(arcs) {
  return normalizeArcs(arcs).filter(item => item.status === 'active').length
}

export function activeArcsOf(arcs) {
  return normalizeArcs(arcs).filter(item => item.status === 'active')
}

/**
 * 剧情增强 3.2 调度器：每轮各轨只投一次真骰，按条件/冷却/屏蔽/上限筛选命中事件。
 */
export function drawTurnEvents({
  longGroup = null,
  sceneGroup = null,
  storyEnhance = false,
  settings = {},
  gameState = {},
  variables = null,
  input = '',
  draw = randomInt
} = {}) {
  const cfg = { ...DIRECTOR_DEFAULTS, ...(settings || {}) }
  const state = normalizeDirectorState(gameState)
  const sceneVarPath = String(cfg.sceneVarPath || state.sceneVarPath || '').trim()
  const arcs = state.arcs
  const condCtx = { variables, input, arcs }

  let sceneAutoPaused = false
  let currentSceneValue = null
  if (sceneVarPath) {
    const raw = readVariablePath(variables, sceneVarPath)
    if (raw !== undefined) currentSceneValue = raw
    const prev = state.lastSceneValue
    if (prev !== undefined && prev !== null && currentSceneValue !== null && String(prev) !== String(currentSceneValue)) {
      sceneAutoPaused = true
      state.sceneGroupPaused = true
      if (gameState && typeof gameState === 'object') gameState.sceneGroupPaused = true
    } else if (!sceneAutoPaused && state.sceneGroupPaused) {
      // 场景值已稳定，恢复当前场景组
      state.sceneGroupPaused = false
      if (gameState && typeof gameState === 'object') gameState.sceneGroupPaused = false
    }
  }

  const trace = []
  const pickedEvents = []
  const seenTopics = new Set()
  const seenArcs = new Set()

  const addEntry = (entry, item, pickReason) => {
    trace.push({
      trackId: entry.trackId,
      trackName: entry.trackName,
      mode: entry.mode,
      rollValue: entry.rollValue,
      itemId: item?.id || '',
      text: item?.text || '',
      category: item?.category || '',
      topic: item?.topic || '',
      arcId: item?.arcId || '',
      picked: false,
      reason: pickReason || ''
    })
    return trace[trace.length - 1]
  }

  const isEligible = (item, options = {}) => {
    if (!item || !String(item.text || '').trim()) return { ok: false, reason: '条目文本为空' }
    const cond = evaluateEventConditions(item.conditions, condCtx)
    if (!cond.ok) return { ok: false, reason: cond.reason || '条件未满足' }
    if (options.ignoreDirectorState) return { ok: true }
    if (item.arcId) {
      const arc = arcs.find(a => String(a.id) === String(item.arcId))
      if (!arc || arc.status !== 'active') return { ok: false, reason: '绑定剧情线未处于活跃状态' }
    }
    if (item.topic && state.blockedTopics[item.topic] > 0) {
      return { ok: false, reason: `主题「${item.topic}」临时屏蔽中（剩余 ${state.blockedTopics[item.topic]} 轮）` }
    }
    if (item.category === 'push' && item.topic && state.topicCooldowns[item.topic] > 0) {
      return { ok: false, reason: `主题「${item.topic}」冷却中（剩余 ${state.topicCooldowns[item.topic]} 轮）` }
    }
    return { ok: true }
  }

  const enabledTracks = group => (Array.isArray(group?.tracks) ? group.tracks : []).filter(track => track?.enabled !== false)

  const tracks = enabledTracks(longGroup)
  if (storyEnhance && sceneGroup && !state.sceneGroupPaused && String(sceneGroup.id || '') !== String(longGroup?.id || '')) {
    tracks.push(...enabledTracks(sceneGroup))
  }

  const maxPush = state.pauseNextPush ? 0 : clampCount(cfg.maxPushPerTurn, DIRECTOR_DEFAULTS.maxPushPerTurn)
  const maxVibe = clampCount(cfg.maxVibePerTurn, DIRECTOR_DEFAULTS.maxVibePerTurn)
  let pushCount = 0
  let vibeCount = 0

  const consume = (metadata, item, options = {}) => {
    const entry = addEntry(metadata, item)
    const eligible = isEligible(item, { ignoreDirectorState: !storyEnhance })
    if (!eligible.ok) {
      entry.reason = eligible.reason
      return
    }
    const constant = options.constant || item.category === 'constant'
    if (constant) {
      entry.picked = true
      entry.reason = '常驻要求（不受随机上限与冷却限制）'
      pickedEvents.push({ ...item, trackId: metadata.trackId, trackName: metadata.trackName, trackMode: metadata.mode, rollValue: metadata.rollValue })
      return
    }
    if (!storyEnhance) {
      entry.picked = true
      entry.reason = '剧情增强未开启：直接命中'
      pickedEvents.push({ ...item, trackId: metadata.trackId, trackName: metadata.trackName, trackMode: metadata.mode, rollValue: metadata.rollValue })
      return
    }
    const topicKey = item.topic ? String(item.topic) : ''
    const arcKey = item.arcId ? String(item.arcId) : ''
    if (topicKey && seenTopics.has(topicKey)) {
      entry.reason = `同主题「${topicKey}」本轮已选 1 条`
      return
    }
    if (arcKey && seenArcs.has(arcKey)) {
      entry.reason = '同剧情线本轮已选 1 条'
      return
    }
    if (item.category === 'vibe') {
      if (vibeCount >= maxVibe) {
        entry.reason = `超出本轮氛围描写上限 ${maxVibe} 条`
        return
      }
      vibeCount += 1
    } else {
      if (pushCount >= maxPush) {
        entry.reason = maxPush === 0 ? '本轮已暂停剧情推动（pauseNextPush）' : `超出本轮剧情推动上限 ${maxPush} 条`
        return
      }
      pushCount += 1
    }
    entry.picked = true
    entry.reason = '命中'
    if (topicKey) seenTopics.add(topicKey)
    if (arcKey) seenArcs.add(arcKey)
    pickedEvents.push({ ...item, trackId: metadata.trackId, trackName: metadata.trackName, trackMode: metadata.mode, rollValue: metadata.rollValue })
  }

  for (const track of tracks) {
    const rolled = rollTrack(track, draw)
    const metadata = {
      trackId: rolled.trackId,
      trackName: rolled.trackName,
      mode: rolled.mode,
      rollValue: rolled.rollValue
    }
    const items = (Array.isArray(track.items) ? track.items : []).filter(item => String(item?.text || '').trim())
    if (!items.length) {
      trace.push({ ...metadata, itemId: '', text: '', category: '', topic: '', arcId: '', picked: false, reason: '事件轨为空' })
      continue
    }
    if (isConstantTrack(track)) {
      for (const item of items) consume(metadata, item, { constant: true })
      continue
    }
    if (!rolled.matchedItem) {
      trace.push({ ...metadata, itemId: '', text: '', category: '', topic: '', arcId: '', picked: false, reason: rolled.mode === 'd100' ? '骰值未落入任何区间' : '未命中条目' })
      continue
    }
    consume(metadata, rolled.matchedItem)
  }

  return {
    pickedEvents,
    trace,
    nextSceneValue: currentSceneValue,
    sceneAutoPaused
  }
}

/**
 * 回合正式结算推进：递减冷却/屏蔽计数，登记本轮 push 主题冷却，复位暂停标记并刷新场景快照。
 */
export function advanceDirectorOnSettled(gameState = {}, turnRecord = {}, currentVariables = null) {
  const state = normalizeDirectorState(gameState)
  const dec = map => {
    const out = {}
    for (const [key, value] of Object.entries(map || {})) {
      const next = toInt(value, 0) - 1
      if (next > 0) out[key] = next
    }
    return out
  }

  state.topicCooldowns = dec(state.topicCooldowns)
  state.blockedTopics = dec(state.blockedTopics)

  const cooldownTurns = Math.max(0, toInt(turnRecord?.cooldownTurns ?? state.cooldownTurns, DIRECTOR_DEFAULTS.cooldownTurns))
  const picked = Array.isArray(turnRecord?.pickedEvents) ? turnRecord.pickedEvents : []
  if (cooldownTurns > 0) {
    for (const item of picked) {
      if (!item || item.category === 'constant') continue
      if (item.category === 'push' && item.topic) state.topicCooldowns[item.topic] = cooldownTurns
    }
  }

  state.pauseNextPush = false
  if (turnRecord?.sceneAutoPaused !== undefined) {
    state.sceneGroupPaused = Boolean(turnRecord.sceneAutoPaused)
  }
  const sceneVarPath = String(turnRecord?.sceneVarPath || state.sceneVarPath || '').trim()
  if (sceneVarPath && currentVariables) {
    const value = readVariablePath(currentVariables, sceneVarPath)
    if (value !== undefined) state.lastSceneValue = value
  } else if (turnRecord?.nextSceneValue !== undefined && turnRecord?.nextSceneValue !== null) {
    state.lastSceneValue = turnRecord.nextSceneValue
  }
  state.lastTurn = Math.max(state.lastTurn, toInt(turnRecord?.turn, 0))
  if (Array.isArray(turnRecord?.arcs)) state.arcs = normalizeArcs(turnRecord.arcs)
  return state
}

function mergeArcFields(arc, payload, turn) {
  const next = { ...arc }
  if (payload.title !== undefined || payload.name !== undefined) {
    next.title = String(payload.title ?? payload.name ?? next.title).slice(0, 60)
  }
  if (payload.origin !== undefined || payload.cause !== undefined) {
    next.origin = String(payload.origin ?? payload.cause ?? next.origin ?? '').slice(0, 200)
  }
  if (payload.progress !== undefined) {
    next.progress = String(payload.progress ?? next.progress ?? '').slice(0, 300)
  }
  if (payload.summary !== undefined || payload.description !== undefined) {
    next.summary = String(payload.summary ?? payload.description ?? next.summary).slice(0, 400)
    if (payload.progress === undefined) next.progress = next.summary.slice(0, 300)
  } else if (payload.origin !== undefined || payload.progress !== undefined) {
    next.summary = (next.origin && next.progress ? `${next.origin}｜${next.progress}` : (next.progress || next.origin || next.summary || '')).slice(0, 400)
  }
  if (payload.anchors !== undefined) {
    next.anchors = (Array.isArray(payload.anchors) ? payload.anchors : [payload.anchors])
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 6)
  }
  next.updatedTurn = toInt(turn, next.updatedTurn)
  next.updatedAt = Date.now()
  return next
}

/**
 * 剧情线操作：create / update / pause / resume / complete / remove / rename。
 * 活跃线上限 3 条，不挤占旧线。
 */
export function applyArcOp(arcs, opPayload = {}) {
  const list = normalizeArcs(arcs)
  const payload = opPayload && typeof opPayload === 'object' ? opPayload : {}
  const rawOp = String(payload.op || payload.action || (payload.arc ? 'create' : 'update')).toLowerCase()
  const op = rawOp === 'add' || rawOp === 'new' ? 'create' : rawOp
  const turn = toInt(payload.turn, 0)
  const arcId = String(payload.arcId || payload.id || payload.arc?.id || '')
  const findIndex = () => list.findIndex(item => String(item.id) === arcId)

  if (op === 'create') {
    const source = payload.arc && typeof payload.arc === 'object' ? payload.arc : payload
    const candidate = normalizeArc({ ...source, id: source.id || arcId || newArcId() }, turn)
    if (!candidate) return { ok: false, op, arcs: list, arc: null, reason: '缺少剧情线内容' }
    if (candidate.status === 'active' && countActiveArcs(list) >= MAX_ACTIVE_ARCS) {
      return { ok: false, op, arcs: list, arc: null, reason: `活跃剧情线已达上限 ${MAX_ACTIVE_ARCS} 条，请先完结或暂停旧线` }
    }
    list.push(candidate)
    return { ok: true, op, arcs: list, arc: candidate, reason: '' }
  }

  const index = findIndex()
  if (index < 0) return { ok: false, op, arcs: list, arc: null, reason: '剧情线不存在' }

  if (op === 'remove' || op === 'delete') {
    const [removed] = list.splice(findIndex(), 1)
    return { ok: true, op: 'remove', arcs: list, arc: removed, reason: '' }
  }

  if (op === 'complete' || op === 'pause' || op === 'resume') {
    const status = op === 'resume' ? 'active' : (op === 'pause' ? 'paused' : 'completed')
    if (status === 'active') {
      const others = list.filter(item => String(item.id) !== arcId && item.status === 'active').length
      if (list[findIndex()].status !== 'active' && others >= MAX_ACTIVE_ARCS) {
        return { ok: false, op, arcs: list, arc: null, reason: `活跃剧情线已达上限 ${MAX_ACTIVE_ARCS} 条` }
      }
    }
    const next = mergeArcFields(list[findIndex()], { ...payload, status }, turn)
    next.status = status
    list[findIndex()] = next
    return { ok: true, op, arcs: list, arc: next, reason: '' }
  }

  if (op === 'update' || op === 'rename' || op === 'edit') {
    const next = mergeArcFields(list[findIndex()], payload, turn)
    if (payload.status && ARC_STATUSES.includes(payload.status)) {
      if (payload.status === 'active') {
        const others = list.filter(item => String(item.id) !== arcId && item.status === 'active').length
        if (others >= MAX_ACTIVE_ARCS) {
          return { ok: false, op, arcs: list, arc: null, reason: `活跃剧情线已达上限 ${MAX_ACTIVE_ARCS} 条` }
        }
      }
      next.status = payload.status
    }
    list[findIndex()] = next
    return { ok: true, op: 'update', arcs: list, arc: next, reason: '' }
  }

  return { ok: false, op, arcs: list, arc: null, reason: `未知剧情线操作 ${rawOp}` }
}

/**
 * 合并后台结算回报：先完结/暂停释放槽位，再更新，最后至多新增 1 条活跃线。
 */
export function mergeSettlementArcReport(arcs, report, turn = 0) {
  let list = normalizeArcs(arcs)
  const rawUpdates = Array.isArray(report)
    ? report
    : (Array.isArray(report?.updates) ? report.updates
      : (Array.isArray(report?.arcs) ? report.arcs
        : (Array.isArray(report?.reports) ? report.reports : (report && typeof report === 'object' ? [report] : []))))
  const applied = []
  const rejected = []
  const created = []

  const rank = item => {
    const op = String(item?.op || item?.action || '').toLowerCase()
    if (op === 'complete' || op === 'finish' || op === 'close') return 0
    if (op === 'pause') return 1
    if (op === 'update' || op === 'edit' || op === 'resume' || op === 'rename') return 2
    if (op === 'create' || op === 'add' || op === 'new' || item?.title || item?.summary) return 3
    return 2
  }
  const sorted = rawUpdates.map((item, index) => ({ item, index })).sort((a, b) => (rank(a.item) - rank(b.item)) || (a.index - b.index))
  let createdThisTurn = 0

  for (const { item } of sorted) {
    if (!item || typeof item !== 'object') continue
    let op = String(item.op || item.action || '').toLowerCase()
    if (!op) op = item.arcId || item.id ? 'update' : 'create'
    if (op === 'finish' || op === 'close') op = 'complete'
    if (op === 'add' || op === 'new') op = 'create'
    let payload = { ...item, op, turn }
    if (op === 'create' || op === 'add') {
      if (createdThisTurn >= 1) {
        rejected.push({ arc: item, reason: '每个用户回合最多新增 1 条剧情线' })
        continue
      }
      payload = { ...payload, id: item.id || newArcId(), status: item.status || 'active' }
    }
    const res = applyArcOp(list, payload)
    if (!res.ok) {
      rejected.push({ arc: item, reason: res.reason })
      continue
    }
    list = res.arcs
    applied.push({ op: res.op, arcId: res.arc?.id || '', title: res.arc?.title || '' })
    if (res.op === 'create') {
      if (res.arc) created.push(res.arc)
      createdThisTurn += 1
    }
  }

  return { arcs: list, applied, rejected, created }
}

export function blockTopic(gameState = {}, topic, turns = DIRECTOR_DEFAULTS.blockedTopicTurns) {
  const state = normalizeDirectorState(gameState)
  const key = String(topic || '').trim()
  if (!key) return state
  state.blockedTopics[key] = Math.max(1, toInt(turns, DIRECTOR_DEFAULTS.blockedTopicTurns))
  return state
}

export function unblockTopic(gameState = {}, topic) {
  const state = normalizeDirectorState(gameState)
  delete state.blockedTopics[String(topic || '').trim()]
  return state
}

export function pauseNextPush(gameState = {}, paused = true) {
  const state = normalizeDirectorState(gameState)
  state.pauseNextPush = Boolean(paused)
  return state
}
