import { randomInt, randomBytes } from 'node:crypto'
import { readVariablePath } from './dice-engine.js'

export const EVENT_CATEGORIES = Object.freeze(['push', 'vibe', 'constant'])
export const EVENT_CATEGORY_LABELS = Object.freeze({
  push: '剧情推动',
  vibe: '氛围描写',
  constant: '常驻要求'
})
export const TRACK_MODES = Object.freeze(['d1', 'dn', 'd100', 'weighted'])
export const TRACK_MODE_LABELS = Object.freeze({
  d1: '固定常驻 d1',
  dn: '等权骰 dn',
  d100: '百分区间 d100',
  weighted: '权重池'
})

const newId = prefix => `${prefix}_${randomBytes(5).toString('hex')}`

function toInt(value, fallback = 0) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.trunc(num) : fallback
}

export function createEventItem({
  id,
  text = '',
  category = 'push',
  topic = '',
  weight = 1,
  min = null,
  max = null,
  arcId = '',
  conditions = []
} = {}) {
  return {
    id: id || newId('ei'),
    text: String(text || '').trim().slice(0, 600),
    category: EVENT_CATEGORIES.includes(category) ? category : 'push',
    topic: String(topic || '').trim().slice(0, 40),
    weight: Math.max(0, toInt(weight, 1)),
    min: min === null || min === undefined ? null : toInt(min, 1),
    max: max === null || max === undefined ? null : toInt(max, 100),
    arcId: String(arcId || '').trim().slice(0, 60),
    conditions: Array.isArray(conditions)
      ? conditions.filter(c => c && typeof c === 'object').map(c => ({ ...c }))
      : (conditions && typeof conditions === 'object' ? [{ ...conditions }] : [])
  }
}

export function createEventTrack({ id, name = '', mode = 'dn', sides = null, items = [], enabled = true } = {}) {
  const normalizedItems = (Array.isArray(items) ? items : []).map(item => createEventItem(item))
  const activeMode = TRACK_MODES.includes(mode) ? mode : 'dn'
  let activeSides = sides === null || sides === undefined ? null : Math.max(1, Math.min(100, toInt(sides, normalizedItems.length || 6)))
  if (activeMode === 'd1') activeSides = 1
  if (activeMode === 'd100') activeSides = 100
  return {
    id: id || newId('et'),
    name: String(name || '事件轨').slice(0, 60),
    enabled: enabled !== false,
    mode: activeMode,
    sides: activeSides,
    items: normalizedItems
  }
}

export function createEventGroup({ id, name = '', description = '', tracks = [] } = {}) {
  return {
    id: id || newId('eg'),
    name: String(name || '未命名事件组').slice(0, 60),
    description: String(description || '').slice(0, 200),
    tracks: (Array.isArray(tracks) ? tracks : []).map(track => createEventTrack(track))
  }
}

const CONSTANT_ITEMS = [
  '保持角色言行与既有设定、前情记忆和当前处境一致，不得为了迎合玩家而失真。',
  '严禁元叙述：正文不出现规则术语、面板字段名、系统提示、选项列表或对玩家说话的口吻。',
  '用五感细节承载场景：光线、气味、温度、声响与身体感受至少落两处，避免通篇抽象概括。',
  '任何行动都必须留下可追踪的后果或新信息，推进局势而非原地打转。'
]

const PUSH_ITEMS = [
  { text: '抛出一个意料之外的阻碍：环境变化、第三方介入或原计划的关键条件失效。', topic: 'complication' },
  { text: '给出一条可推进调查/目标的关键线索，但线索本身带有歧义或代价。', topic: 'clue' },
  { text: '让一个边缘人物主动介入，带来帮助的同时附带新的要求或立场。', topic: 'ally' },
  { text: '兑现一次资源或状态的损耗：体力、时间、金钱、信任或装备出现实质缺口。', topic: 'cost' },
  { text: '让局势中的流言或误解放大，制造角色必须回应的压力。', topic: 'rumor' },
  { text: '让潜在威胁向前逼近一步：对方察觉、提前行动或收紧控制。', topic: 'threat' }
]

const VIBE_ITEMS = [
  { text: '补写一段细腻的感官氛围，让读者能“看见”此刻的空间质感与人物距离。' },
  { text: '让气氛短暂转冷：沉默、视线回避或一句不合时宜的话留下余味。' },
  { text: '安排一个短促而克制的温情/暧昧瞬间，不打断主线但拉近关系。' },
  { text: '用一段压抑的静默或环境音（雨声、钟摆、远处脚步）收束当前段落。' }
]

const PACING_ITEMS = [
  { text: '加快叙事节奏：压缩过场，直接跳到关键冲突或决策点。' },
  { text: '放慢节奏，给角色一次喘息与内心权衡的机会，用细节替代结论。' },
  { text: '在段落末尾留白或悬念，避免把局势一次性说透。' }
]

/**
 * 通用剧情样板事件组：常驻演绎准则 d1 / 进展波折 d6 / 情绪氛围 d4 / 叙事节奏 d3。
 */
export function createGeneralPlotTemplateGroup(suffix = '') {
  const tail = String(suffix || '').trim()
  const tag = tail ? `-${tail.replace(/\s+/g, '_')}` : ''
  return {
    id: `eg-general-plot${tag}`,
    name: `通用剧情样板${tail ? ' ' + tail : ''}`,
    description: '内置通用剧情线程：常驻演绎准则 + 进展波折 + 情绪氛围 + 叙事节奏，可直接启用或复制改造。',
    tracks: [
      createEventTrack({
        id: `et-constant${tag}`,
        name: '常驻演绎准则',
        mode: 'd1',
        sides: 1,
        items: CONSTANT_ITEMS.map((text, index) => ({
          id: `ei-constant-${index + 1}${tag}`,
          text,
          category: 'constant',
          topic: ''
        }))
      }),
      createEventTrack({
        id: `et-push${tag}`,
        name: '进展波折',
        mode: 'dn',
        sides: 6,
        items: PUSH_ITEMS.map((item, index) => ({
          id: `ei-push-${index + 1}${tag}`,
          text: item.text,
          category: 'push',
          topic: item.topic
        }))
      }),
      createEventTrack({
        id: `et-vibe${tag}`,
        name: '情绪氛围',
        mode: 'dn',
        sides: 4,
        items: VIBE_ITEMS.map((item, index) => ({
          id: `ei-vibe-${index + 1}${tag}`,
          text: item.text,
          category: 'vibe',
          topic: ''
        }))
      }),
      createEventTrack({
        id: `et-pacing${tag}`,
        name: '叙事节奏',
        mode: 'dn',
        sides: 3,
        items: PACING_ITEMS.map((item, index) => ({
          id: `ei-pacing-${index + 1}${tag}`,
          text: item.text,
          category: 'push',
          topic: 'pacing'
        }))
      })
    ]
  }
}

export function isConstantTrack(track) {
  return track?.mode === 'd1' || (Array.isArray(track?.items) && track.items.length > 0 && track.items.every(item => item.category === 'constant'))
}

function compareValues(actual, expected, op) {
  const operators = ['==', '!=', '>=', '<=', '>', '<', 'contains', 'not_contains']
  const activeOp = operators.includes(op) ? op : '=='
  if (actual === undefined || actual === null) return { ok: false, reason: '变量缺失' }
  if (activeOp === 'contains' || activeOp === 'not_contains') {
    let contains = false
    if (typeof actual === 'string') contains = actual.includes(String(expected))
    else if (Array.isArray(actual)) contains = actual.some(item => String(item) === String(expected) || item === expected)
    else return { ok: false, reason: '变量类型不支持包含判断' }
    return { ok: activeOp === 'contains' ? contains : !contains }
  }
  const numericOps = ['>=', '<=', '>', '<']
  if (numericOps.includes(activeOp)) {
    const a = Number(actual)
    const b = Number(expected)
    if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: false, reason: '数值比较失败' }
    if (activeOp === '>=') return { ok: a >= b }
    if (activeOp === '<=') return { ok: a <= b }
    if (activeOp === '>') return { ok: a > b }
    return { ok: a < b }
  }
  const bothNumeric = typeof actual === 'number' && Number.isFinite(Number(expected))
  const equal = bothNumeric ? Number(actual) === Number(expected) : String(actual) === String(expected)
  if (activeOp === '!=') return { ok: !equal }
  return { ok: equal }
}

function evaluateMvuCondition(condition, { variables }) {
  const path = condition.path || condition.key || condition.field || ''
  if (!path) return { ok: false, reason: 'mvu 条件缺少变量路径' }
  const expected = condition.value !== undefined
    ? condition.value
    : (condition.equals !== undefined ? condition.equals : condition.target)
  if (condition.op === 'exists' || condition.exists === true) {
    const value = readVariablePath(variables, path)
    return value === undefined || value === null
      ? { ok: false, reason: `变量 ${path} 不存在` }
      : { ok: true, actual: value }
  }
  if (expected === undefined) return { ok: false, reason: `mvu 条件 ${path} 缺少比较值` }
  const actual = readVariablePath(variables, path)
  const expectedType = typeof expected
  const actualType = Array.isArray(actual) ? 'array' : typeof actual
  const comparable = ['number', 'string', 'boolean'].includes(expectedType)
  if (comparable && actual !== undefined && actual !== null && actualType !== expectedType && !['contains', 'not_contains'].includes(condition.op)) {
    return { ok: false, reason: `变量 ${path} 类型不符（期望 ${expectedType}，实际 ${actualType}）` }
  }
  const res = compareValues(actual, expected, condition.op || condition.operator)
  if (!res.ok) {
    return { ok: false, reason: res.reason || `变量 ${path} 不满足 ${condition.op || '=='} ${String(expected)}`, actual }
  }
  return { ok: true, actual }
}

function evaluateInputCondition(condition, { input }) {
  const rawKeywords = condition.keywords !== undefined
    ? condition.keywords
    : (condition.contains !== undefined ? condition.contains : (condition.value !== undefined ? condition.value : condition.text))
  const list = (Array.isArray(rawKeywords) ? rawKeywords : [rawKeywords])
    .filter(item => item !== undefined && item !== null)
    .map(item => String(item).trim())
    .filter(Boolean)
  if (!list.length) return { ok: false, reason: 'input 条件缺少关键词' }
  const text = String(input || '')
  const excluded = condition.mode === 'exclude' || condition.op === 'not_contains' || condition.negate === true || condition.not === true || condition.invert === true
  const requireAll = condition.match === 'all'
  const hits = list.filter(word => text.includes(word))
  if (excluded) {
    return hits.length === 0
      ? { ok: true, hits }
      : { ok: false, reason: `玩家输入包含屏蔽关键词「${hits[0]}」`, hits }
  }
  const ok = requireAll ? hits.length === list.length : hits.length > 0
  return ok ? { ok: true, hits } : { ok: false, reason: `玩家输入缺少关键词「${list[0]}」`, hits }
}

function evaluateArcCondition(condition, { arcs }) {
  const arcId = condition.arcId || condition.id || condition.arc || ''
  if (!arcId) return { ok: false, reason: 'arc 条件缺少剧情线 id' }
  const pool = Array.isArray(arcs) ? arcs : []
  const arc = pool.find(item => String(item?.id || '') === String(arcId))
  if (!arc) return { ok: false, reason: `剧情线 ${arcId} 不存在` }
  const rawStatus = condition.status !== undefined ? condition.status : (condition.state !== undefined ? condition.state : 'active')
  const allowed = Array.isArray(rawStatus) ? rawStatus.map(String) : [String(rawStatus)]
  const ok = allowed.includes(String(arc.status || ''))
  return ok
    ? { ok: true, status: arc.status }
    : { ok: false, reason: `剧情线「${arc.title || arc.id}」当前为 ${arc.status}，不满足 ${allowed.join('/')}` }
}

/**
 * 条件求值（AND 组合）。支持 mvu 变量 / 玩家输入 / 持续剧情线状态三类条件。
 */
export function evaluateEventConditions(conditions, { variables = null, input = '', arcs = [] } = {}) {
  const list = Array.isArray(conditions)
    ? conditions
    : (conditions && typeof conditions === 'object' ? [conditions] : (conditions ? [{ kind: 'input', contains: String(conditions) }] : []))
  if (!list.length) return { ok: true, details: [] }
  const details = []
  for (const condition of list) {
    if (!condition || typeof condition !== 'object') continue
    const kind = condition.kind || condition.type || 'mvu'
    let res
    if (kind === 'mvu' || kind === 'variable' || kind === 'var') res = evaluateMvuCondition(condition, { variables })
    else if (kind === 'input' || kind === 'keyword') res = evaluateInputCondition(condition, { input })
    else if (kind === 'arc' || kind === 'storyline') res = evaluateArcCondition(condition, { arcs })
    else res = { ok: false, reason: `未知条件类型 ${kind}` }
    details.push({ kind, ok: Boolean(res.ok), reason: res.reason || null })
    if (!res.ok) return { ok: false, reason: res.reason || '条件未满足', details }
  }
  return { ok: true, details }
}

function pickWeighted(items, draw) {
  const pool = items.map(item => ({ item, weight: Math.max(0, Number(item.weight) || 0) })).filter(entry => entry.weight > 0)
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0)
  if (!pool.length || total <= 0) return { rollValue: 0, matchedItem: null }
  const roll = draw(1, Math.floor(total) + 1)
  let acc = 0
  for (const entry of pool) {
    acc += entry.weight
    if (roll <= acc) return { rollValue: roll, matchedItem: entry.item }
  }
  return { rollValue: roll, matchedItem: pool[pool.length - 1].item }
}

/**
 * 单轨投掷：每轨只投一次真骰，返回命中条目。
 */
export function rollTrack(track, draw = randomInt) {
  const items = Array.isArray(track?.items) ? track.items.filter(item => String(item?.text || '').trim()) : []
  const mode = TRACK_MODES.includes(track?.mode) ? track.mode : 'dn'
  const trackId = track?.id || ''
  const trackName = track?.name || ''
  const base = { trackId, trackName, mode, rollValue: 0, matchedItem: null, sides: track?.sides ?? null }

  if (!items.length) return base

  if (mode === 'd1') {
    return { ...base, rollValue: 1, matchedItem: items[0] }
  }

  if (mode === 'd100') {
    const rollValue = draw(1, 101)
    const matchedItem = items.find(item => {
      const min = item.min === null || item.min === undefined ? 1 : Number(item.min)
      const max = item.max === null || item.max === undefined ? 100 : Number(item.max)
      return rollValue >= min && rollValue <= max
    }) || null
    return { ...base, rollValue, matchedItem }
  }

  if (mode === 'weighted') {
    const res = pickWeighted(items, draw)
    return { ...base, rollValue: res.rollValue, matchedItem: res.matchedItem }
  }

  const sides = Math.max(1, Math.min(100, Number(track?.sides) || items.length))
  const rollValue = draw(1, sides + 1)
  const index = Math.min(items.length - 1, Math.floor((rollValue - 1) * items.length / sides))
  return { ...base, rollValue, sides, matchedItem: items[index] || null }
}

/** 事件组统计：轨数、条目数、分类计数，供面板展示。 */
export function eventGroupStats(group) {
  const tracks = Array.isArray(group?.tracks) ? group.tracks : []
  const items = tracks.flatMap(track => (Array.isArray(track.items) ? track.items : []))
  return {
    tracks: tracks.length,
    items: items.length,
    constant: items.filter(item => item.category === 'constant').length,
    push: items.filter(item => item.category === 'push').length,
    vibe: items.filter(item => item.category === 'vibe').length
  }
}

/** 标准化外部传入的事件组（导入/编辑），保证结构完整。 */
export function normalizeEventGroup(raw, fallbackName = '事件组') {
  if (!raw || typeof raw !== 'object') return null
  const tracks = (Array.isArray(raw.tracks) ? raw.tracks : []).map((track, index) => {
    const mode = TRACK_MODES.includes(track?.mode) ? track.mode : 'dn'
    const items = (Array.isArray(track?.items) ? track.items : []).map(item => createEventItem(item))
    let sides = track?.sides
    if (mode === 'd1') sides = 1
    else if (mode === 'd100') sides = 100
    else if (!Number.isFinite(Number(sides))) sides = items.length || 6
    return {
      id: String(track?.id || `et-${index + 1}`),
      name: String(track?.name || `事件轨 ${index + 1}`).slice(0, 60),
      enabled: track?.enabled !== false,
      mode,
      sides: Math.max(1, Math.min(100, Number(sides) || 1)),
      items
    }
  })
  return {
    id: String(raw.id || newId('eg')),
    name: String(raw.name || fallbackName).slice(0, 60),
    description: String(raw.description || '').slice(0, 200),
    tracks
  }
}
