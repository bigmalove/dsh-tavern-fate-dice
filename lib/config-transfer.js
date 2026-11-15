import { normalizeRule } from './dice-engine.js'
import {
  createSkillGroup,
  createSkillsFromTemplate,
  normalizeSkills,
  recommendedSkillBudget
} from './skill-system.js'
import {
  createEventGroup,
  createEventItem,
  createEventTrack,
  createGeneralPlotTemplateGroup,
  normalizeEventGroup
} from './event-pool.js'

export const EXPORT_FORMAT = 'dsh-fate-dice-v2'
export const EXPORT_VERSION = 2

const RULE_ALIASES = Object.freeze({
  '2d6': '2d6',
  d6: '2d6',
  '1d6': '2d6',
  d10: 'd10',
  '1d10': 'd10',
  d20: 'd20',
  '1d20': 'd20',
  d100: 'd100',
  '1d100': 'd100'
})

function normalizeRuleAlias(value, fallback = '2d6') {
  const key = String(value || '').trim().toLowerCase()
  return RULE_ALIASES[key] || normalizeRule(value) || fallback
}

function normalizeCategory(value, fallback = 'push') {
  const raw = String(value || '').trim().toLowerCase()
  if (['push', 'vibe', 'constant'].includes(raw)) return raw
  if (/常驻|constant|always|permanent/.test(raw)) return 'constant'
  if (/氛围|情绪|vibe|mood|atmosphere/.test(raw)) return 'vibe'
  if (/推动|剧情|plot|push|event/.test(raw)) return 'push'
  return fallback
}

function safeArray(value) {
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object') return Object.values(value)
  return []
}

function normalizeConditions(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter(item => item && typeof item === 'object')
  if (typeof value === 'object') return [value]
  return []
}

function normalizeRanges(value) {
  const out = []
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (raw && typeof raw === 'object') out.push(raw)
    }
    return out
  }
  if (value && typeof value === 'object') {
    for (const [key, raw] of Object.entries(value)) {
      if (raw === null || raw === undefined) continue
      if (raw && typeof raw === 'object') {
        const parts = String(key).split(/[-~,，]/)
        out.push({ ...raw, min: raw.min ?? parts[0], max: raw.max ?? (parts[1] ?? parts[0]) })
      } else {
        const parts = String(key).split(/[-~,，]/)
        out.push({ min: parts[0], max: parts[1] ?? parts[0], content: String(raw) })
      }
    }
  }
  return out
}

function pickText(entry) {
  if (typeof entry === 'string') return entry
  if (!entry || typeof entry !== 'object') return ''
  return String(
    entry.text ?? entry.content ?? entry.value ?? entry.label ?? entry.result ??
    entry.description ?? entry.command ?? entry.name ?? ''
  ).trim()
}

function pickNumber(entry, keys) {
  if (!entry || typeof entry !== 'object') return null
  for (const key of keys) {
    const num = Number(entry[key])
    if (Number.isFinite(num)) return num
  }
  return null
}

function normalizeSkillGroupLoose(raw, ruleFallback = '2d6') {
  if (!raw || typeof raw !== 'object') return null
  const rule = normalizeRuleAlias(raw.rule ?? raw.diceType ?? raw.diceRule ?? raw.dice, ruleFallback)
  const skills = normalizeSkills(safeArray(raw.skills ?? raw.list ?? raw.items), rule)
  if (!skills.length) return null
  const custom = raw.customBudget ?? raw.budget ?? null
  return {
    id: String(raw.id || ''),
    name: String(raw.name || '导入技能组').slice(0, 60),
    rule,
    customBudget: custom === null ? null : recommendedSkillBudget(rule, skills.length, custom),
    templateId: raw.templateId || null,
    skills,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Date.now()
  }
}

function normalizeNativeEventGroup(raw, index) {
  return normalizeEventGroup(raw, `导入事件组 ${index + 1}`)
}

function buildTrackFromConfig(config, group, index) {
  const items = []
  const diceList = safeArray(config?.diceList ?? config?.dice ?? config?.entries ?? config?.list)
  const ranges = normalizeRanges(
    config?.d100Ranges ?? config?.ranges ?? config?.rangeList ?? config?.ranges100 ??
    group?.d100Ranges ?? group?.ranges ?? group?.ranges100
  )
  const commands = safeArray(config?.commands ?? group?.commands)
  const configCategory = config?.category ?? config?.type ?? group?.category
  const configTopic = config?.topic ?? group?.topic ?? ''
  const conditions = normalizeConditions(config?.conditions ?? group?.conditions)

  let mode = String(config?.mode || config?.diceMode || '').toLowerCase()
  const diceType = String(config?.diceType ?? config?.dice_type ?? config?.diceRule ?? '').toLowerCase()
  if (mode === 'd1' || /^d1$|constant|常驻/.test(diceType)) mode = 'd1'
  else if (ranges.length) mode = 'd100'
  else if (diceType === 'weighted' || config?.weighted === true) mode = 'weighted'
  else if (mode !== 'weighted' && mode !== 'dn' && mode !== 'd100') mode = ''

  const sidesFromType = Number((diceType.match(/d(\d+)/) || [])[1])
  const sides = Number(config?.sides ?? config?.diceSides ?? sidesFromType) || 0

  for (const raw of diceList) {
    const text = pickText(raw)
    if (!text) continue
    const category = normalizeCategory(raw?.category ?? configCategory, mode === 'd1' ? 'constant' : 'push')
    items.push(createEventItem({
      id: raw?.id,
      text,
      category,
      topic: raw?.topic ?? configTopic,
      weight: pickNumber(raw, ['weight', 'probability', 'chance']) ?? 1,
      min: pickNumber(raw, ['min', 'from', 'start']),
      max: pickNumber(raw, ['max', 'to', 'end']),
      arcId: raw?.arcId ?? config?.arcId ?? '',
      conditions: normalizeConditions(raw?.conditions ?? conditions)
    }))
  }

  for (const raw of ranges) {
    const text = pickText(raw)
    if (!text) continue
    items.push(createEventItem({
      id: raw?.id,
      text,
      category: normalizeCategory(raw?.category ?? configCategory, 'push'),
      topic: raw?.topic ?? configTopic,
      weight: pickNumber(raw, ['weight', 'probability', 'chance']) ?? 1,
      min: pickNumber(raw, ['min', 'from', 'start']) ?? 1,
      max: pickNumber(raw, ['max', 'to', 'end']) ?? 100,
      arcId: raw?.arcId ?? config?.arcId ?? '',
      conditions: normalizeConditions(raw?.conditions ?? conditions)
    }))
  }

  for (const raw of commands) {
    const text = pickText(raw)
    if (!text) continue
    items.push(createEventItem({
      id: raw?.id,
      text,
      category: normalizeCategory(raw?.category ?? configCategory, 'push'),
      topic: raw?.topic ?? configTopic,
      weight: 1,
      conditions: normalizeConditions(raw?.conditions ?? conditions)
    }))
  }

  if (!items.length) return null

  if (!mode) {
    const hasRanges = items.every(item => item.min !== null && item.max !== null)
    if (items.length === 1 && normalizeCategory(configCategory) === 'constant') mode = 'd1'
    else if (hasRanges) mode = 'd100'
    else if (sides === 1) mode = 'd1'
    else if (items.some(item => item.weight !== 1)) mode = 'weighted'
    else mode = 'dn'
  }

  let activeSides = sides
  if (mode === 'd1') activeSides = 1
  else if (mode === 'd100') activeSides = 100
  else if (!activeSides) activeSides = items.length || 6
  if (mode === 'd100' && !ranges.length) {
    const step = 100 / items.length
    items.forEach((item, i) => {
      if (item.min === null) item.min = Math.floor(i * step) + 1
      if (item.max === null) item.max = i === items.length - 1 ? 100 : Math.floor((i + 1) * step)
    })
  }
  if (mode === 'd1') items.forEach(item => { item.category = 'constant' })

  return createEventTrack({
    id: config?.id || (group?.id ? `${group.id}-track-${index + 1}` : undefined),
    name: String(config?.name || config?.title || group?.name || `事件轨 ${index + 1}`),
    mode,
    sides: activeSides,
    items,
    enabled: config?.enabled !== false && group?.enabled !== false
  })
}

function convertAutoRandomInput(data) {
  if (Array.isArray(data)) data = { groups: data }
  const warnings = []
  const skillGroups = []
  const eventGroups = []
  const topRule = normalizeRuleAlias(data?.diceType ?? data?.diceRule ?? data?.dice, '2d6')

  const rawSkillGroups = safeArray(data?.skillGroups)
  for (const raw of rawSkillGroups) {
    const group = normalizeSkillGroupLoose(raw, topRule)
    if (group) skillGroups.push(group)
    else warnings.push('跳过一个缺少技能条目的技能组')
  }
  if (!rawSkillGroups.length && Array.isArray(data?.skills) && data.skills.length) {
    const group = normalizeSkillGroupLoose({
      name: data.name || data.title || '导入技能组',
      rule: topRule,
      skills: data.skills,
      budget: data.budget ?? data.customBudget
    }, topRule)
    if (group) skillGroups.push(group)
  }

  const groupsIn = safeArray(data?.groups ?? data?.groupList)
  for (const rawGroup of groupsIn) {
    if (!rawGroup || typeof rawGroup !== 'object') continue
    const gName = String(rawGroup.name || rawGroup.title || `导入事件组 ${eventGroups.length + 1}`)
    const configs = safeArray(rawGroup.configs ?? rawGroup.entries ?? rawGroup.config ?? rawGroup.children)
    const tracks = []
    const sourceConfigs = configs.length ? configs : [rawGroup]
    sourceConfigs.forEach((config, index) => {
      const track = buildTrackFromConfig(config, rawGroup, index)
      if (track) tracks.push(track)
    })
    if (!tracks.length) {
      warnings.push(`事件组「${gName}」没有可用条目，已跳过`)
      continue
    }
    eventGroups.push(createEventGroup({
      id: rawGroup.id,
      name: gName,
      description: rawGroup.description ?? rawGroup.desc ?? '',
      tracks
    }))
  }

  if (!groupsIn.length && (Array.isArray(data?.diceList) || Array.isArray(data?.configs))) {
    const tracks = []
    const configs = safeArray(data?.configs)
    if (configs.length) {
      configs.forEach((config, index) => {
        const track = buildTrackFromConfig(config, { name: data?.name }, index)
        if (track) tracks.push(track)
      })
    } else {
      const track = buildTrackFromConfig(data, { name: data?.name }, 0)
      if (track) tracks.push(track)
    }
    if (tracks.length) {
      eventGroups.push(createEventGroup({
        id: data?.id,
        name: data?.name || data?.title || '导入事件组',
        description: data?.description || '',
        tracks
      }))
    }
  }

  const version = Number(data?.version) || (String(data?.format || '').toLowerCase().includes('v2') ? 2 : 1)
  return { skillGroups, eventGroups, warnings, version }
}

function detectSource(data) {
  if (Array.isArray(data)) return 'auto-random-input'
  if (!data || typeof data !== 'object') return 'unknown'
  if (data.data && typeof data.data === 'object') {
    const inner = data.data
    if (Array.isArray(inner.groups) || Array.isArray(inner.skillGroups) || Array.isArray(inner.eventGroups)) {
      return detectSource(inner)
    }
  }
  if (data.format === EXPORT_FORMAT) return 'native'
  if (Array.isArray(data.skillGroups) || Array.isArray(data.eventGroups)) {
    if (!data.groups && !data.configs && !data.diceList) return 'native'
  }
  if (Array.isArray(data.groups) || Array.isArray(data.configs) || Array.isArray(data.diceList)) return 'auto-random-input'
  if (Array.isArray(data.skills) || data.skillGroups || data.d100Ranges || data.ranges) return 'auto-random-input'
  return 'unknown'
}

function normalizeNativeConfig(data) {
  const skillGroups = safeArray(data?.skillGroups)
    .map(raw => normalizeSkillGroupLoose(raw))
    .filter(Boolean)
  const eventGroups = safeArray(data?.eventGroups)
    .map((raw, index) => normalizeNativeEventGroup(raw, index))
    .filter(Boolean)
  const warnings = []
  if (!skillGroups.length && !eventGroups.length) warnings.push('配置中没有任何技能组或事件组')
  return { skillGroups, eventGroups, warnings, version: Number(data?.version) || EXPORT_VERSION }
}

export function previewImportConfig(jsonText) {
  let data
  try {
    data = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText
  } catch (err) {
    return { ok: false, error: `JSON 解析失败：${err.message}` }
  }
  if (!data || typeof data !== 'object') return { ok: false, error: '配置内容不是合法的 JSON 对象' }
  if (!Array.isArray(data) && data.data && typeof data.data === 'object' &&
      !Array.isArray(data.groups) && !Array.isArray(data.skillGroups) && !Array.isArray(data.eventGroups) &&
      (Array.isArray(data.data.groups) || Array.isArray(data.data.skillGroups) || Array.isArray(data.data.eventGroups))) {
    data = data.data
  }
  const source = detectSource(data)
  if (source === 'unknown') return { ok: false, error: '无法识别配置格式：既不是 dsh-fate-dice-v2，也不是 AutoRandomInput v1/v2' }
  const converted = source === 'native' ? normalizeNativeConfig(data) : convertAutoRandomInput(data)
  const skillGroups = converted.skillGroups
  const eventGroups = converted.eventGroups
  const trackCount = eventGroups.reduce((sum, group) => sum + group.tracks.length, 0)
  const itemCount = eventGroups.reduce((sum, group) => sum + group.tracks.reduce((n, track) => n + track.items.length, 0), 0)
  return {
    ok: true,
    source,
    format: source === 'native' ? EXPORT_FORMAT : 'AutoRandomInput',
    version: converted.version,
    formatLabel: source === 'native' ? `命运之骰 v${converted.version}` : `AutoRandomInput v${converted.version}`,
    stats: {
      skillGroups: skillGroups.length,
      eventGroups: eventGroups.length,
      skills: skillGroups.reduce((sum, group) => sum + group.skills.length, 0),
      tracks: trackCount,
      items: itemCount
    },
    groups: [
      ...skillGroups.map(group => ({ kind: 'skill', name: group.name, detail: `${group.rule} · ${group.skills.length} 项技能` })),
      ...eventGroups.map(group => ({
        kind: 'event',
        name: group.name,
        detail: `${group.tracks.length} 轨 · ${group.tracks.reduce((n, track) => n + track.items.length, 0)} 条`
      }))
    ],
    warnings: converted.warnings,
    skillGroups,
    eventGroups,
    data: { skillGroups, eventGroups }
  }
}

export function dedupeGroupName(name, used) {
  const base = String(name || '导入组').trim() || '导入组'
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base} (${index})`)) index += 1
  return `${base} (${index})`
}

/**
 * 应用导入：绝不覆盖同名旧组，重名自动追加 (2)/(3)。
 */
export function applyImportConfig(jsonText, existingSkillGroups = [], existingEventGroups = []) {
  const preview = previewImportConfig(jsonText)
  if (!preview.ok) return { ok: false, error: preview.error }
  const usedSkill = new Set((Array.isArray(existingSkillGroups) ? existingSkillGroups : []).map(group => String(group?.name || '')))
  const usedEvent = new Set((Array.isArray(existingEventGroups) ? existingEventGroups : []).map(group => String(group?.name || '')))
  const renamed = []
  const addedSkillGroups = []
  const addedEventGroups = []

  for (const raw of preview.data.skillGroups) {
    const name = dedupeGroupName(raw.name, usedSkill)
    if (name !== raw.name) renamed.push({ kind: 'skill', from: raw.name, to: name })
    usedSkill.add(name)
    addedSkillGroups.push({
      ...createSkillGroup({
        name,
        rule: raw.rule,
        skills: raw.skills,
        customBudget: raw.customBudget,
        templateId: raw.templateId
      }),
      importedAt: Date.now()
    })
  }

  for (const raw of preview.data.eventGroups) {
    const name = dedupeGroupName(raw.name, usedEvent)
    if (name !== raw.name) renamed.push({ kind: 'event', from: raw.name, to: name })
    usedEvent.add(name)
    const group = createEventGroup({ name, description: raw.description, tracks: raw.tracks })
    group.importedAt = Date.now()
    addedEventGroups.push(group)
  }

  return {
    ok: true,
    format: preview.format,
    version: preview.version,
    added: { skillGroups: addedSkillGroups, eventGroups: addedEventGroups },
    skillGroups: [...(Array.isArray(existingSkillGroups) ? existingSkillGroups : []), ...addedSkillGroups],
    eventGroups: [...(Array.isArray(existingEventGroups) ? existingEventGroups : []), ...addedEventGroups],
    renamed,
    warnings: preview.warnings,
    stats: preview.stats
  }
}

/** 打包原生 v2 导出格式。 */
export function buildNativeExportBundle({ skillGroups = [], eventGroups = [], exportedAt = new Date().toISOString() } = {}) {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt,
    skillGroups: Array.isArray(skillGroups) ? skillGroups : [],
    eventGroups: Array.isArray(eventGroups) ? eventGroups : []
  }
}

/** 生成可直接下载体验的示例配置包（原生 v2 格式）。 */
export function buildSampleExportBundle() {
  const skillGroup = createSkillGroup({
    name: '日常通用技能组',
    rule: '2d6',
    skills: createSkillsFromTemplate('daily', '2d6'),
    templateId: 'daily'
  })
  skillGroup.id = 'sg-sample-daily'
  skillGroup.description = '示例技能组：日常题材 18 项技能，2d6 叙事渐进。'

  const general = createGeneralPlotTemplateGroup('示例')
  general.id = 'eg-sample-general'
  general.name = '通用剧情样板 示例'

  const mystery = createEventGroup({
    id: 'eg-sample-mystery',
    name: '悬疑调查示例',
    description: '示例事件组：d100 线索区间 + 权重突发事件池 + 常驻推理准则。',
    tracks: [
      createEventTrack({
        id: 'et-sample-mystery-rules',
        name: '推理常驻准则',
        mode: 'd1',
        sides: 1,
        items: [
          createEventItem({ id: 'ei-mystery-1', text: '线索必须可被角色实际接触，禁止凭空推理出未出现的信息。', category: 'constant' }),
          createEventItem({ id: 'ei-mystery-2', text: '至少留下一个误导性细节，让真相需要被验证而非直接奉上。', category: 'constant' })
        ]
      }),
      createEventTrack({
        id: 'et-sample-mystery-clue',
        name: '线索强度 d100',
        mode: 'd100',
        sides: 100,
        items: [
          createEventItem({ id: 'ei-clue-1', text: '发现一枚带血指纹，但无法立刻确认归属。', category: 'push', topic: 'clue', min: 1, max: 35 }),
          createEventItem({ id: 'ei-clue-2', text: '找到一份被撕去半页的账本，缺口正好对应关键日期。', category: 'push', topic: 'clue', min: 36, max: 70 }),
          createEventItem({ id: 'ei-clue-3', text: '目击者主动找上门，却提出一个无法拒绝的条件。', category: 'push', topic: 'witness', min: 71, max: 100 })
        ]
      }),
      createEventTrack({
        id: 'et-sample-mystery-twist',
        name: '突发变数权重池',
        mode: 'weighted',
        items: [
          createEventItem({ id: 'ei-twist-1', text: '警笛声由远及近，现场即将被第三方封锁。', category: 'push', topic: 'threat', weight: 3 }),
          createEventItem({ id: 'ei-twist-2', text: '停电让整条走廊陷入黑暗，只剩应急灯微光。', category: 'vibe', weight: 2 }),
          createEventItem({ id: 'ei-twist-3', text: '手机收到一条匿名短信：别再查下去。', category: 'push', topic: 'warning', weight: 1 })
        ]
      })
    ]
  })

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    skillGroups: [skillGroup],
    eventGroups: [general, mystery]
  }
}

export function serializeExportBundle(bundle) {
  return JSON.stringify(bundle, null, 2)
}

export { buildTrackFromConfig as convertAutoRandomTrack, convertAutoRandomInput as convertAutoRandomInputConfig }
