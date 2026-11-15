/* ------------------------------------------------------------------ *
 * tab-settings.js —— 设置与导入导出：全局参数 / 临时主题屏蔽 / 配置导入导出中心
 * ------------------------------------------------------------------ */

function fdToggleIn(list, id) {
  return list.includes(id) ? list.filter(item => item !== id) : [...list, id]
}

function SettingsTab(props) {
  const { ui, gameId, hasGame, view, actions, notify } = props || {}
  const settings = view.settings || FD_DEFAULT_SETTINGS
  const [draft, setDraft] = useState(settings)
  const [themeInput, setThemeInput] = useState('')
  const [exportSkills, setExportSkills] = useState([])
  const [exportEvents, setExportEvents] = useState([])
  const [importText, setImportText] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const skillGroups = view.skillGroups || []
  const eventGroups = view.eventGroups || []

  useEffect(() => {
    setDraft(settings)
  }, [settings.sensitivity, settings.toneBias, settings.autoHidden, settings.damperLinkage, settings.animation, settings.maxPlotPush, settings.maxAmbience, settings.themeCooldown, settings.scenePath])

  useEffect(() => {
    setExportSkills(skillGroups.map(item => item.id))
  }, [skillGroups.length])

  useEffect(() => {
    setExportEvents(eventGroups.map(item => item.id))
  }, [eventGroups.length])

  const patchDraft = patch => setDraft({ ...draft, ...patch })

  const saveSettings = () => {
    actions.persistSettings(draft)
  }

  const buildExport = () => ({
    version: 2,
    kind: 'dsh-tavern-fate-dice/config',
    exportedAt: new Date().toISOString(),
    settings: { ...draft },
    skillGroups: skillGroups.filter(item => exportSkills.includes(item.id)),
    eventGroups: eventGroups.filter(item => exportEvents.includes(item.id))
  })

  const doExport = () => {
    const payload = buildExport()
    const ok = fdDownloadJson(`fate-dice-config-${Date.now()}.json`, payload)
    if (notify) notify(ok ? `已导出 ${payload.skillGroups.length} 个技能组 / ${payload.eventGroups.length} 个事件组` : '浏览器不允许自动下载，请改用复制 JSON')
  }

  const downloadSample = () => {
    const ok = fdDownloadJson('fate-dice-sample.json', fdSampleConfig())
    if (notify) notify(ok ? '已下载示例模板' : '浏览器不允许自动下载')
  }

  const pickFile = file => {
    if (!file) return
    fdReadFileText(file).then(text => {
      setImportText(text)
      setPreview(null)
      if (notify) notify(`已读取 ${file.name || '文件'}（${text.length} 字符），请点击「预览识别结果」`)
    }).catch(error => {
      if (notify) notify(String((error && error.message) || '文件读取失败'))
    })
  }

  const doPreview = () => {
    if (!importText.trim()) {
      if (notify) notify('请先选择文件或粘贴 JSON 文本')
      return
    }
    setBusy(true)
    fdImportPreview(ui, importText, gameId).then(res => {
      setPreview(res)
      if (!res.ok) {
        if (notify) notify(res.error || '无法识别该配置')
        return
      }
      if (notify) notify(`识别为${res.format}：技能组 ${res.skillCount} / 事件组 ${res.eventCount}（来源：${res.source === 'host' ? '宿主' : '本地解析'}）`)
    }).finally(() => setBusy(false))
  }

  const doApply = () => {
    if (!preview || !preview.ok) {
      if (notify) notify('请先预览并确认识别结果')
      return
    }
    const newSkills = (preview.skillGroups || []).map(group => fdNormalizeSkillGroup({ ...group, id: fdUid('skg'), name: group.name + ' · 导入' }))
    const newEvents = (preview.eventGroups || []).map(group => fdNormalizeEventGroup({ ...group, id: fdUid('evg'), name: group.name + ' · 导入' }))
    if (newSkills.length) actions.persistGroups('skillGroups', [...skillGroups, ...newSkills])
    if (newEvents) actions.persistGroups('eventGroups', [...eventGroups, ...newEvents])
    fdImportApply(ui, gameId, { skillGroups: newSkills, eventGroups: newEvents }).then(res => {
      if (notify) notify(res.ok
        ? `已导入 ${newSkills.length} 个技能组 / ${newEvents.length} 个事件组`
        : `已导入到本地面板：${newSkills.length} 个技能组 / ${newEvents.length} 个事件组（宿主接口不可用）`)
    })
    setPreview(null)
    setImportText('')
  }

  return h(Fragment, null,
    h(FdSection, { title: '⚙️ 全局参数', note: '保存后对全部对话生效' },
      h('div', { className: 'fd-inline-fields' },
        h(FdField, { label: '触发灵敏度' },
          h(FdSelect, { value: draft.sensitivity, options: FD_SENSITIVITY_OPTIONS, onChange: value => patchDraft({ sensitivity: value }) })),
        h(FdField, { label: '叙事基调修正' },
          h(FdSelect, { value: draft.toneBias, options: FD_TONE_OPTIONS, onChange: value => patchDraft({ toneBias: value }) })),
        h(FdField, { label: '掷骰动画档位' },
          h(FdSelect, { value: draft.animation, options: FD_ANIMATION_OPTIONS, onChange: value => patchDraft({ animation: value }) }))),
      h('div', { className: 'fd-card-grid' },
        h('div', { className: 'fd-card' },
          h('div', { className: 'fd-row-main' },
            h('span', { className: 'fd-card-title' }, '感知自动暗骰'),
            h('span', { className: 'fd-card-sub' }, '观察/察觉类行动默认盖罩')),
          h(FdSwitch, { on: draft.autoHidden, label: '感知自动暗骰', onChange: next => patchDraft({ autoHidden: next }) })),
        h('div', { className: 'fd-card' },
          h('div', { className: 'fd-row-main' },
            h('span', { className: 'fd-card-title' }, '叙事阻尼器双向联动'),
            h('span', { className: 'fd-card-sub' }, '检定与事件配额互通，双向反馈')),
          h(FdSwitch, { on: draft.damperLinkage, label: '阻尼双向联动', onChange: next => patchDraft({ damperLinkage: next }) }))),
      h('div', { className: 'fd-inline-fields' },
        h(FdField, { label: '每轮「剧情推动」上限' },
          h(FdSelect, {
            value: String(draft.maxPlotPush),
            options: [0, 1, 2, 3].map(n => ({ value: String(n), label: `${n} 条` })),
            onChange: value => patchDraft({ maxPlotPush: Number(value) })
          })),
        h(FdField, { label: '每轮「氛围描写」上限' },
          h(FdSelect, {
            value: String(draft.maxAmbience),
            options: [0, 1, 2, 3].map(n => ({ value: String(n), label: `${n} 条` })),
            onChange: value => patchDraft({ maxAmbience: Number(value) })
          })),
        h(FdField, { label: '同主题冷却轮数' },
          h(FdSelect, {
            value: String(draft.themeCooldown),
            options: [0, 1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n} 轮` })),
            onChange: value => patchDraft({ themeCooldown: Number(value) })
          }))),
      h(FdField, {
        label: '本局场景位置 MVU 变量路径',
        hint: '例如 场景.位置；用于场景切换时自动停用旧场景追加事件组'
      }, h(FdText, {
        value: draft.scenePath || '',
        placeholder: '场景.位置',
        onChange: value => patchDraft({ scenePath: value })
      })),
      h('div', { className: 'fd-btn-row' },
        h(FdBtn, { primary: true, onClick: saveSettings }, '保存全局设置'),
        h(FdBtn, { onClick: () => setDraft({ ...settings }) }, '还原'))),

    h(FdSection, {
      title: '🚫 临时主题屏蔽器',
      note: hasGame ? '屏蔽期间该主题不会被抽中' : '进入对话后可用'
    },
    hasGame
      ? h(Fragment, null,
        h('div', { className: 'fd-inline-fields' },
          h(FdText, { value: themeInput, placeholder: '主题名（如 阻碍）', onChange: setThemeInput }),
          h('div', { style: { flex: '0 0 auto' } },
            h(FdBtn, {
              small: true,
              primary: true,
              onClick: () => {
                const theme = themeInput.trim()
                if (!theme) {
                  if (notify) notify('请输入要屏蔽的主题名')
                  return
                }
                fdBlockTheme(ui, gameId, theme, 5).then(res => {
                  if (notify) notify(res.ok ? `已屏蔽主题「${theme}」5 轮` : '宿主接口不可用，未能写入屏蔽表')
                })
                setThemeInput('')
              }
            }, '屏蔽 5 轮'))),
        (view.blockedThemes || []).length
          ? h('div', { className: 'fd-list' },
            view.blockedThemes.map(item => h('div', { key: item.theme, className: 'fd-list-item' },
              h('span', null, `🚫 ${item.theme}`),
              h('span', { className: 'fd-btn-row' },
                h('span', { className: 'fd-hint' }, `剩余 ${item.rounds} 轮`),
                h(FdBtn, {
                  small: true,
                  onClick: () => {
                    fdUnblockTheme(ui, gameId, item.theme).then(res => {
                      if (notify) notify(res.ok ? `已撤销屏蔽「${item.theme}」` : '宿主接口不可用')
                    })
                  }
                }, '撤销')))))
          : h('div', { className: 'fd-hint' }, '当前无生效中的屏蔽主题'),
        (view.cooldowns || []).length
          ? h('div', { className: 'fd-list' },
            h('span', { className: 'fd-hint' }, '冷却中的主题'),
            view.cooldowns.map(item => h('div', { key: item.theme, className: 'fd-list-item' },
              h('span', null, `⏳ ${item.theme}`),
              h('span', { className: 'fd-hint' }, `剩余 ${item.rounds} 轮`))),
            h('div', { className: 'fd-btn-row' },
              h(FdBtn, {
                small: true,
                onClick: () => {
                  fdClearCooldown(ui, gameId).then(res => {
                    if (notify) notify(res.ok ? '已清空全部主题冷却' : '宿主接口不可用')
                  })
                }
              }, '一键清空冷却')))
          : h('div', { className: 'fd-hint' }, '当前无冷却中的主题'))
      : h('div', { className: 'fd-hint' }, '未进入对话：无法使用临时屏蔽')),

    h(FdSection, { title: '📤 导出配置', note: '勾选要打包的共享库' },
      h('div', { className: 'fd-card-grid' },
        h('div', { className: 'fd-card' },
          h('span', { className: 'fd-card-title' }, `技能组（${exportSkills.length}/${skillGroups.length}）`),
          skillGroups.length
            ? h('div', { className: 'fd-chip-group' },
              skillGroups.map(group => h(FdChip, {
                key: group.id,
                active: exportSkills.includes(group.id),
                onClick: () => setExportSkills(prev => fdToggleIn(prev, group.id))
              }, group.name)))
            : h('div', { className: 'fd-hint' }, '暂无技能组'),
          h('div', { className: 'fd-btn-row' },
            h(FdBtn, { small: true, onClick: () => setExportSkills(skillGroups.map(item => item.id)) }, '全选'),
            h(FdBtn, { small: true, onClick: () => setExportSkills([]) }, '清空'))),
        h('div', { className: 'fd-card' },
          h('span', { className: 'fd-card-title' }, `事件组（${exportEvents.length}/${eventGroups.length}）`),
          eventGroups.length
            ? h('div', { className: 'fd-chip-group' },
              eventGroups.map(group => h(FdChip, {
                key: group.id,
                active: exportEvents.includes(group.id),
                onClick: () => setExportEvents(prev => fdToggleIn(prev, group.id))
              }, group.name)))
            : h('div', { className: 'fd-hint' }, '暂无事件组'),
          h('div', { className: 'fd-btn-row' },
            h(FdBtn, { small: true, onClick: () => setExportEvents(eventGroups.map(item => item.id)) }, '全选'),
            h(FdBtn, { small: true, onClick: () => setExportEvents([]) }, '清空')))),
      h('div', { className: 'fd-btn-row' },
        h(FdBtn, { primary: true, onClick: doExport }, '导出 JSON 文件'),
        h(FdBtn, { onClick: downloadSample }, '下载示例模板'))),

    h(FdSection, { title: '📥 导入配置', note: '支持原生 v2 与 AutoRandomInput 配置包' },
      h('div', { className: 'fd-btn-row' },
        h('label', { className: 'fd-btn', style: { position: 'relative', overflow: 'hidden' } },
          '选择本地 .json 文件',
          h('input', {
            type: 'file',
            accept: '.json,application/json',
            style: { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' },
            onChange: e => {
              const file = e && e.target && e.target.files ? e.target.files[0] : null
              pickFile(file)
            }
          }))),
      h(FdArea, {
        value: importText,
        rows: 6,
        placeholder: '或直接粘贴 JSON 文本…',
        onChange: value => { setImportText(value); setPreview(null) }
      }),
      h('div', { className: 'fd-btn-row' },
        h(FdBtn, { disabled: busy, onClick: doPreview }, busy ? '识别中…' : '预览识别结果'),
        h(FdBtn, { primary: true, disabled: !preview || !preview.ok, onClick: doApply }, '确认为新组导入')),
      preview && preview.ok
        ? h('div', { className: 'fd-card' },
          h('span', { className: 'fd-card-title' }, `识别格式：${preview.format}`),
          h('span', { className: 'fd-card-sub' }, `将导入 技能组 ${preview.skillCount} 个 / 事件组 ${preview.eventCount} 个 · 来源 ${preview.source === 'host' ? '宿主识别' : '本地解析'}`),
          (preview.warnings || []).length
            ? h('span', { className: 'fd-hint' }, preview.warnings.join(' · '))
            : null,
          (preview.skillGroups || []).length
            ? h('div', { className: 'fd-chip-group' }, preview.skillGroups.map(group => h('span', { key: group.id, className: 'fd-event-pill' }, `${group.name}（${group.skills.length} 技能）`)))
            : null,
          (preview.eventGroups || []).length
            ? h('div', { className: 'fd-chip-group' }, preview.eventGroups.map(group => h('span', { key: group.id, className: 'fd-event-pill' }, `${group.name}（${group.tracks.length} 轨）`)))
            : null)
        : null,
      preview && !preview.ok
        ? h('div', { className: 'fd-error' }, preview.error || '无法识别')
        : null))
}
