/* ------------------------------------------------------------------ *
 * bridge.js —— 宿主 RPC 安全桥、本地持久化、工作台视图模型归一化、导入导出
 * 所有宿主调用均经 fdCall 包裹：宿主未实现该接口时返回 { ok:false }，绝不抛错。
 * ------------------------------------------------------------------ */

function fdNoop() {}

function fdSafe(fn, fallback) {
  try {
    return fn()
  } catch {
    return fallback
  }
}

/* 别名表：宿主侧若采用不同命名仍可命中；主名始终优先 */
const FD_RPC_ALIASES = {
  'fate-dice:workbench': ['fate-dice:read-workbench', 'fate-dice:workbench-state'],
  'fate-dice:save-global-settings': ['fate-dice:save-settings', 'fate-dice:global-settings'],
  'fate-dice:save-skill-groups': ['fate-dice:skill-groups-save', 'fate-dice:save-skills'],
  'fate-dice:save-event-groups': ['fate-dice:event-groups-save', 'fate-dice:save-events'],
  'fate-dice:save-binding': ['fate-dice:bind-groups', 'fate-dice:save-bind'],
  'fate-dice:plotline': ['fate-dice:plotlines', 'fate-dice:plot-line'],
  'fate-dice:pause-next-roll': ['fate-dice:pause-next', 'fate-dice:pause-events'],
  'fate-dice:block-theme': ['fate-dice:theme-block'],
  'fate-dice:unblock-theme': ['fate-dice:theme-unblock'],
  'fate-dice:clear-cooldown': ['fate-dice:clear-cooldowns'],
  'fate-dice:scene-resume': ['fate-dice:resume-scene'],
  'fate-dice:import-preview': ['fate-dice:preview-import'],
  'fate-dice:import-apply': ['fate-dice:apply-import']
}

function fdCall(ui, rpc, payload) {
  if (!ui || typeof ui.callHost !== 'function') return Promise.resolve({ ok: false, error: '宿主未提供 callHost' })
  const names = [rpc].concat(FD_RPC_ALIASES[rpc] || [])
  let lastError = '宿主调用失败'
  const attempt = index => {
    if (index >= names.length) return Promise.resolve({ ok: false, error: lastError })
    return Promise.resolve()
      .then(() => ui.callHost(names[index], payload))
      .then(data => ({ ok: true, data, rpc: names[index] }))
      .catch(error => {
        lastError = (error && error.message) || String(error || '宿主调用失败')
        return attempt(index + 1)
      })
  }
  return attempt(0)
}

function fdWatch(ui, gameId, name, handler) {
  if (!ui || typeof ui.watchState !== 'function') return fdNoop
  try {
    const off = ui.watchState(gameId, name, handler)
    return typeof off === 'function' ? off : fdNoop
  } catch {
    return fdNoop
  }
}

function fdStoreGet(key, fallback) {
  return fdSafe(() => {
    if (typeof window === 'undefined' || !window.localStorage) return fallback
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed === null || parsed === undefined ? fallback : parsed
  }, fallback)
}

function fdStoreSet(key, value) {
  return fdSafe(() => {
    if (typeof window === 'undefined' || !window.localStorage) return false
    window.localStorage.setItem(key, JSON.stringify(value))
    return true
  }, false)
}

function fdEnsureStyleInjected() {
  fdSafe(() => {
    if (typeof document === 'undefined' || !document.head) return
    if (document.getElementById(FD_STYLE_ID)) return
    const el = document.createElement('style')
    el.id = FD_STYLE_ID
    el.textContent = CSS_TEXT
    document.head.appendChild(el)
  })
}

function fdNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function fdNormalizeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const settings = { ...FD_DEFAULT_SETTINGS }
  if (FD_SENSITIVITY_OPTIONS.some(o => o.value === src.sensitivity)) settings.sensitivity = src.sensitivity
  if (FD_TONE_OPTIONS.some(o => o.value === src.toneBias)) settings.toneBias = src.toneBias
  if (FD_ANIMATION_OPTIONS.some(o => o.value === src.animation)) settings.animation = src.animation
  if (typeof src.autoHidden === 'boolean') settings.autoHidden = src.autoHidden
  else if (typeof src.allowHidden === 'boolean') settings.autoHidden = src.allowHidden
  if (typeof src.damperLinkage === 'boolean') settings.damperLinkage = src.damperLinkage
  settings.maxPlotPush = fdClamp(fdNumber(src.maxPlotPush, FD_DEFAULT_SETTINGS.maxPlotPush), 0, 3)
  settings.maxAmbience = fdClamp(fdNumber(src.maxAmbience, FD_DEFAULT_SETTINGS.maxAmbience), 0, 3)
  settings.themeCooldown = fdClamp(fdNumber(src.themeCooldown, FD_DEFAULT_SETTINGS.themeCooldown), 0, 5)
  settings.scenePath = String(src.scenePath || settings.scenePath || '')
  return settings
}

function fdNormalizeThemeList(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw
      .map(item => (typeof item === 'string' ? { theme: item, rounds: 0 } : {
        theme: String((item && (item.theme || item.name || item.key)) || ''),
        rounds: fdClamp(fdNumber(item && (item.rounds ?? item.left ?? item.remaining), 0), 0, 99)
      }))
      .filter(item => item.theme)
  }
  if (typeof raw === 'object') {
    return Object.keys(raw).map(theme => {
      const value = raw[theme]
      const rounds = typeof value === 'object' && value !== null ? fdNumber(value.rounds ?? value.left, 0) : fdNumber(value, 0)
      return { theme, rounds: fdClamp(rounds, 0, 99) }
    }).filter(item => item.theme)
  }
  return []
}

function fdNormalizeRecent(raw) {
  if (!Array.isArray(raw)) return []
  return raw.filter(item => item && typeof item === 'object').map(item => {
    const eventCount = fdNumber(
      item.eventCount ?? item.eventsCount ?? (Array.isArray(item.events) ? item.events.length : undefined),
      0
    )
    return {
      turn: fdNumber(item.turn, 0),
      check: String(item.check || item.skill || '检定'),
      total: fdNumber(item.total, 0),
      tier: String(item.tier || 'success'),
      tierLabel: String(item.tierLabel || item.tier || '结果'),
      hidden: Boolean(item.hidden),
      eventCount: Math.max(0, eventCount),
      damper: Boolean(item.damperSynced ?? item.damper ?? false),
      rolledAt: fdNumber(item.rolledAt, 0)
    }
  })
}

function fdBindStatusSummary(view, status) {
  if (!status || typeof status !== 'object') return view
  const next = { ...view }
  if (status.judgeStatus) next.judgeStatus = status.judgeStatus
  const summary = status.summary
  if (summary && typeof summary === 'object') {
    const counts = summary.counts && typeof summary.counts === 'object' ? summary.counts : {}
    next.summary = summary
    next.stats = {
      total: fdNumber(summary.total, 0),
      good: fdNumber(counts.critical, 0) + fdNumber(counts.success, 0),
      bad: fdNumber(counts.costly, 0) + fdNumber(counts.failure, 0) + fdNumber(counts.fumble, 0)
    }
    if (Array.isArray(summary.recent) && summary.recent.length) next.recent = fdNormalizeRecent(summary.recent)
  }
  return next
}

function fdEmptyWorkbench() {
  const cachedSettings = fdNormalizeSettings(fdStoreGet(FD_STORAGE_KEYS.settings, FD_DEFAULT_SETTINGS))
  const cachedSkills = fdStoreGet(FD_STORAGE_KEYS.skillGroups, [])
  const cachedEvents = fdStoreGet(FD_STORAGE_KEYS.eventGroups, [])
  return {
    settings: cachedSettings,
    rule: '2d6',
    autoCheck: true,
    multiTrack: true,
    enhanced: false,
    paused: false,
    skillGroups: Array.isArray(cachedSkills) ? cachedSkills.map(fdNormalizeSkillGroup) : [],
    eventGroups: Array.isArray(cachedEvents) ? cachedEvents.map(fdNormalizeEventGroup) : [],
    skillTemplates: FD_SKILL_TEMPLATES.map(item => ({ id: item.id, name: item.name, rule: item.rule, note: item.note, count: item.skills.length })),
    binding: { skillGroupId: '', eventGroupId: '', sceneEventGroupId: '', sceneSuspended: false },
    plotlines: [],
    blockedThemes: [],
    cooldowns: [],
    damper: { available: false, linkage: cachedSettings.damperLinkage },
    judgeStatus: { available: false },
    summary: { total: 0, counts: {}, recent: [] },
    stats: { total: 0, good: 0, bad: 0 },
    recent: [],
    source: 'local'
  }
}

function fdMergeWorkbench(base, raw) {
  if (!raw || typeof raw !== 'object') return base
  const view = { ...base }
  const payload = raw.workbench || raw.state || raw.data || raw

  const settingsSrc = payload.settings || payload.globalSettings || (payload.global && payload.global.settings) || null
  if (settingsSrc || payload.sensitivity || payload.animation) {
    view.settings = fdNormalizeSettings({ ...view.settings, ...(settingsSrc || {}), ...(settingsSrc ? {} : payload) })
  }
  if (payload.rule) view.rule = FD_RULES.some(r => r.id === payload.rule) ? payload.rule : view.rule
  if (typeof payload.autoCheck === 'boolean') view.autoCheck = payload.autoCheck
  else if (typeof payload.autoSkillCheck === 'boolean') view.autoCheck = payload.autoSkillCheck
  if (typeof payload.multiTrack === 'boolean') view.multiTrack = payload.multiTrack
  else if (typeof payload.multiTrackEvents === 'boolean') view.multiTrack = payload.multiTrackEvents
  if (typeof payload.enhanced === 'boolean') view.enhanced = payload.enhanced
  else if (typeof payload.enhanceMode === 'boolean') view.enhanced = payload.enhanceMode
  if (typeof payload.paused === 'boolean') view.paused = payload.paused
  else if (typeof payload.pauseNext === 'boolean') view.paused = payload.pauseNext

  const skillGroups = payload.skillGroups || (payload.groups && payload.groups.skillGroups)
  if (Array.isArray(skillGroups)) view.skillGroups = skillGroups.map(fdNormalizeSkillGroup)
  const eventGroups = payload.eventGroups || (payload.groups && payload.groups.eventGroups)
  if (Array.isArray(eventGroups)) view.eventGroups = eventGroups.map(fdNormalizeEventGroup)
  const templates = payload.skillTemplates || payload.templates
  if (Array.isArray(templates) && templates.length) {
    view.skillTemplates = templates.map(item => ({
      id: item.id || fdUid('tpl'),
      name: String(item.name || '样板技能组'),
      rule: FD_RULES.some(r => r.id === item.rule) ? item.rule : '2d6',
      note: String(item.note || item.description || ''),
      count: Array.isArray(item.skills) ? item.skills.length : fdNumber(item.count, 0),
      skills: Array.isArray(item.skills) ? fdNormalizeSkill(item.skills) : []
    }))
  }

  const binding = payload.binding || payload.bind || null
  if (binding && typeof binding === 'object') {
    view.binding = {
      skillGroupId: String(binding.skillGroupId || binding.skill || ''),
      eventGroupId: String(binding.eventGroupId || binding.events || ''),
      sceneEventGroupId: String(binding.sceneEventGroupId || binding.sceneEvent || ''),
      sceneSuspended: Boolean(binding.sceneSuspended ?? binding.sceneDisabled ?? false)
    }
  }
  if (Array.isArray(payload.plotlines)) view.plotlines = payload.plotlines.map(fdNormalizePlotline)
  else if (Array.isArray(payload.plotLines)) view.plotlines = payload.plotLines.map(fdNormalizePlotline)
  if (payload.blockedThemes || payload.blocked) view.blockedThemes = fdNormalizeThemeList(payload.blockedThemes || payload.blocked)
  if (payload.cooldowns || payload.cooldownThemes) view.cooldowns = fdNormalizeThemeList(payload.cooldowns || payload.cooldownThemes)

  const damper = payload.damper || payload.damperBridge || {}
  view.damper = {
    available: Boolean(payload.damperBridgeAvailable ?? damper.available ?? view.damper.available),
    linkage: Boolean(payload.damperLinkage ?? damper.linkage ?? view.settings.damperLinkage)
  }
  if (payload.judgeStatus) view.judgeStatus = payload.judgeStatus
  if (payload.summary) {
    const summary = payload.summary
    const counts = summary.counts && typeof summary.counts === 'object' ? summary.counts : {}
    view.stats = {
      total: fdNumber(summary.total, 0),
      good: fdNumber(counts.critical, 0) + fdNumber(counts.success, 0),
      bad: fdNumber(counts.costly, 0) + fdNumber(counts.failure, 0) + fdNumber(counts.fumble, 0)
    }
    view.recent = Array.isArray(summary.recent) ? fdNormalizeRecent(summary.recent) : view.recent
  }
  if (Array.isArray(payload.recent)) view.recent = fdNormalizeRecent(payload.recent)
  view.source = payload.source === 'local' ? 'local' : 'host'
  return view
}

/* 初次装载：宿主提供工作台快照则用宿主，否则以本地缓存 + 状态接口拼装（保证无宿主接口也可用） */
function fdLoadWorkbench(ui, gameId) {
  const base = fdEmptyWorkbench()
  return fdCall(ui, FD_RPC.workbench, { gameId: gameId || null })
    .then(res => {
      let view = base
      if (res.ok && res.data) view = fdMergeWorkbench(base, res.data)
      return fdCall(ui, FD_RPC.status, { gameId: gameId || undefined }).then(status => {
        if (status.ok && status.data) {
          view = fdBindStatusSummary(view, status.data)
          if (!gameId) view.judgeStatus = status.data.judgeStatus || view.judgeStatus
        }
        if (!gameId) view.source = 'local'
        return view
      })
    })
    .catch(() => base)
}

function fdPersistSettings(ui, settings) {
  const normalized = fdNormalizeSettings(settings)
  fdStoreSet(FD_STORAGE_KEYS.settings, normalized)
  return fdCall(ui, FD_RPC.saveSettings, { settings: normalized }).then(res => ({ ...res, local: true }))
}

function fdPersistSkillGroups(ui, gameId, groups) {
  const list = (Array.isArray(groups) ? groups : []).map(fdNormalizeSkillGroup)
  fdStoreSet(FD_STORAGE_KEYS.skillGroups, list)
  return fdCall(ui, FD_RPC.saveSkillGroups, { gameId: gameId || null, skillGroups: list }).then(res => ({ ...res, local: true }))
}

function fdPersistEventGroups(ui, gameId, groups) {
  const list = (Array.isArray(groups) ? groups : []).map(fdNormalizeEventGroup)
  fdStoreSet(FD_STORAGE_KEYS.eventGroups, list)
  return fdCall(ui, FD_RPC.saveEventGroups, { gameId: gameId || null, eventGroups: list }).then(res => ({ ...res, local: true }))
}

function fdPersistBinding(ui, gameId, binding) {
  if (!gameId) return Promise.resolve({ ok: false, error: '需要进入对话后绑定' })
  return fdCall(ui, FD_RPC.saveBinding, { gameId, binding })
}

function fdPlotlineAction(ui, gameId, action, line) {
  if (!gameId) return Promise.resolve({ ok: false, error: '需要进入对话后管理剧情线' })
  return fdCall(ui, FD_RPC.plotline, { gameId, action, plotline: line || null })
}

function fdPauseNextRoll(ui, gameId, paused) {
  if (!gameId) return Promise.resolve({ ok: false, error: '需要进入对话后使用' })
  return fdCall(ui, FD_RPC.pauseNext, { gameId, paused: Boolean(paused) })
}

function fdBlockTheme(ui, gameId, theme, rounds) {
  if (!gameId) return Promise.resolve({ ok: false, error: '需要进入对话后使用' })
  return fdCall(ui, FD_RPC.blockTheme, { gameId, theme, rounds: fdClamp(rounds, 1, 5) })
}

function fdUnblockTheme(ui, gameId, theme) {
  if (!gameId) return Promise.resolve({ ok: false, error: '需要进入对话后使用' })
  return fdCall(ui, FD_RPC.unblockTheme, { gameId, theme })
}

function fdClearCooldown(ui, gameId) {
  if (!gameId) return Promise.resolve({ ok: false, error: '需要进入对话后使用' })
  return fdCall(ui, FD_RPC.clearCooldown, { gameId })
}

function fdSceneResume(ui, gameId) {
  if (!gameId) return Promise.resolve({ ok: false, error: '需要进入对话后使用' })
  return fdCall(ui, FD_RPC.sceneResume, { gameId })
}

function fdFreeRoll(ui, gameId, expression) {
  return fdCall(ui, FD_RPC.freeRoll, { gameId: gameId || null, expression })
}

/* ---------------- 导入导出 ---------------- */

function fdLocalParseConfig(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) return { ok: false, error: '内容为空' }
  let obj = null
  try {
    obj = JSON.parse(trimmed)
  } catch (error) {
    return { ok: false, error: 'JSON 解析失败：' + ((error && error.message) || '格式错误') }
  }
  const skillGroups = []
  const eventGroups = []
  const warnings = []

  const pushSkills = raw => {
    if (!Array.isArray(raw)) return
    raw.forEach(item => {
      if (!item || typeof item !== 'object') return
      const group = fdNormalizeSkillGroup(item)
      if (group.skills.length) skillGroups.push(group)
      else if (Array.isArray(item.skills) && item.skills.length) skillGroups.push(group)
    })
  }
  const pushEvents = raw => {
    if (!Array.isArray(raw)) return
    raw.forEach(item => {
      if (!item || typeof item !== 'object') return
      eventGroups.push(fdNormalizeEventGroup(item))
    })
  }

  let format = '未知格式'
  let node = obj
  if (obj && typeof obj === 'object' && obj.plugin === 'auto-random-input') {
    format = 'AutoRandomInput 配置包'
    node = obj.config || obj.data || obj
  } else if (obj && typeof obj === 'object' && obj.config && typeof obj.config === 'object') {
    format = 'AutoRandomInput 配置包'
    node = { ...obj.config, skillGroups: obj.skillGroups || obj.skills }
  }
  if (Array.isArray(node)) {
    const looksLikeTracks = node.some(item => item && (item.tracks || item.entries || item.name))
    if (looksLikeTracks) {
      format = format === '未知格式' ? '事件组片段' : format
      node.forEach(item => {
        if (item && item.tracks) eventGroups.push(fdNormalizeEventGroup(item))
        else if (item && Array.isArray(item.entries)) {
          eventGroups.push(fdNormalizeEventGroup({
            name: item.name || '导入事件组',
            tracks: [{ name: item.name || '主轨', mode: 'dn', sides: item.sides || 6, entries: item.entries }]
          }))
        }
      })
    }
  } else if (node && typeof node === 'object') {
    const versioned = node.version || (node.meta && node.meta.version)
    pushSkills(node.skillGroups || node.skills || node.skillPools || node.skillGroupPool)
    pushEvents(node.eventGroups || node.events || node.eventPools || node.eventGroupPool)
    if (node.tracks && Array.isArray(node.tracks)) {
      eventGroups.push(fdNormalizeEventGroup({ name: node.name || '导入事件组', tracks: node.tracks }))
    }
    if (!skillGroups.length && !eventGroups.length && node.data) {
      const inner = fdLocalParseConfig(JSON.stringify(node.data))
      if (inner.ok) {
        skillGroups.push(...inner.skillGroups)
        eventGroups.push(...inner.eventGroups)
        inner.warnings.forEach(w => warnings.push(w))
        format = inner.format
      }
    }
    if (format === '未知格式') {
      if (versioned || node.skillGroups || node.eventGroups) format = '命运之骰 v2 原生配置'
    }
  }

  if (!skillGroups.length && !eventGroups.length) {
    return { ok: false, error: '未在文件中识别到技能组或事件组', format, skillGroups, eventGroups, warnings }
  }
  if (!skillGroups.length) warnings.push('未识别到技能组')
  if (!eventGroups.length) warnings.push('未识别到事件组')
  return { ok: true, format, skillGroups, eventGroups, warnings }
}

function fdNormalizePreview(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const pick = value => (Array.isArray(value) ? value : null)
  const skills = pick(src.skillGroups) || pick(src.skills) || []
  const events = pick(src.eventGroups) || pick(src.events) || []
  return {
    format: String(src.format || src.source || src.kind || '宿主识别格式'),
    skillGroups: skills.map(fdNormalizeSkillGroup).filter(group => group.skills.length),
    eventGroups: events.map(fdNormalizeEventGroup),
    skillCount: fdNumber(src.skillGroupCount ?? (Array.isArray(src.skillGroups) ? skills.length : src.skillGroups), skills.length),
    eventCount: fdNumber(src.eventGroupCount ?? (Array.isArray(src.eventGroups) ? events.length : src.eventGroups), events.length),
    warnings: Array.isArray(src.warnings) ? src.warnings.map(String) : []
  }
}

function fdImportPreview(ui, text, gameId) {
  return fdCall(ui, FD_RPC.importPreview, { gameId: gameId || null, text }).then(res => {
    if (res.ok && res.data) {
      const hostView = fdNormalizePreview(res.data)
      if (hostView.skillGroups.length || hostView.eventGroups.length) {
        return { ok: true, source: 'host', ...hostView }
      }
      if (hostView.skillCount || hostView.eventCount) return { ok: true, source: 'host', ...hostView }
    }
    const local = fdLocalParseConfig(text)
    if (!local.ok) return { ok: false, error: local.error, source: 'local', format: local.format, skillGroups: [], eventGroups: [], skillCount: 0, eventCount: 0, warnings: [] }
    return {
      ok: true,
      source: 'local',
      format: local.format,
      skillGroups: local.skillGroups,
      eventGroups: local.eventGroups,
      skillCount: local.skillGroups.length,
      eventCount: local.eventGroups.length,
      warnings: local.warnings
    }
  })
}

function fdImportApply(ui, gameId, preview) {
  const payload = {
    gameId: gameId || null,
    skillGroups: (preview && preview.skillGroups) || [],
    eventGroups: (preview && preview.eventGroups) || []
  }
  return fdCall(ui, FD_RPC.importApply, payload).then(res => ({ ...res, localGroups: payload }))
}

function fdSampleConfig() {
  const sampleEvent = fdCreateGenericEventGroup('示例：通用剧情样板组')
  return {
    version: 2,
    kind: 'dsh-tavern-fate-dice/config',
    exportedAt: new Date().toISOString(),
    skillGroups: [
      fdNormalizeSkillGroup(fdSkillGroupFromTemplate(FD_SKILL_TEMPLATES[0])),
      fdNormalizeSkillGroup(fdSkillGroupFromTemplate(FD_SKILL_TEMPLATES[2]))
    ],
    eventGroups: [fdNormalizeEventGroup(sampleEvent)],
    settings: { ...FD_DEFAULT_SETTINGS }
  }
}

function fdDownloadJson(filename, data) {
  return fdSafe(() => {
    const text = JSON.stringify(data, null, 2)
    if (typeof document === 'undefined') return false
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' })
    const url = (typeof URL !== 'undefined' && URL.createObjectURL) ? URL.createObjectURL(blob) : ''
    if (!url) return false
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    setTimeout(() => {
      fdSafe(() => document.body.removeChild(link))
      fdSafe(() => URL.revokeObjectURL(url))
    }, 0)
    return true
  }, false)
}

function fdReadFileText(file) {
  if (!file) return Promise.reject(new Error('未选择文件'))
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.readAsText(file)
  })
}

function fdTierOf(tier) {
  const value = String(tier || 'success')
  return ['critical', 'success', 'costly', 'failure', 'fumble', 'hidden'].includes(value) ? value : 'success'
}

function fdTierColor(tier) {
  const map = {
    critical: '#c8941f',
    success: '#2f8f66',
    costly: '#b9772f',
    failure: '#bb5044',
    fumble: '#a8402f',
    hidden: '#8a8a95'
  }
  return map[fdTierOf(tier)] || map.success
}
