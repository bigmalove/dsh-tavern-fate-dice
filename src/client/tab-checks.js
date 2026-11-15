/* ------------------------------------------------------------------ *
 * tab-checks.js —— 技能检定标签页：骰制切换 / 12 套样板 / 共享技能组 / 加值预算 / 清单编辑
 * ------------------------------------------------------------------ */

function fdSkillNet(skills) {
  return (skills || []).reduce((sum, skill) => sum + fdNumber(skill.bonus, 0), 0)
}

function fdDistributeBonuses(skills, meta, mode) {
  const total = Math.max(0, skills.length)
  if (!total) return []
  const target = Number(meta.recommendedNet) || 0
  const weights = skills.map((_, idx) => Math.max(1, total - idx))
  const weightSum = weights.reduce((a, b) => a + b, 0)
  if (mode === 'reset') {
    return skills.map((skill, idx) => ({
      ...skill,
      bonus: fdClamp(Math.round((target * weights[idx]) / weightSum), meta.budgetMin, meta.budgetMax)
    }))
  }
  return skills.map(skill => ({
    ...skill,
    bonus: fdClamp(
      fdNumber(meta.budgetMin, -2) + Math.floor(Math.random() * (Number(meta.budgetMax) - Number(meta.budgetMin) + 1)),
      meta.budgetMin,
      meta.budgetMax
    )
  }))
}

function ChecksTab(props) {
  const { ui, gameId, hasGame, view, actions, notify } = props || {}
  const groups = view.skillGroups || []
  const [workingId, setWorkingId] = useState('')
  const [draft, setDraft] = useState(null)
  const [templateId, setTemplateId] = useState(FD_SKILL_TEMPLATES[0].id)
  const [nameDraft, setNameDraft] = useState('')

  useEffect(() => {
    if (workingId) return
    const preset = (view.binding && view.binding.skillGroupId) || (groups[0] && groups[0].id) || ''
    if (preset) setWorkingId(preset)
  }, [view.binding && view.binding.skillGroupId, groups.length])

  useEffect(() => {
    const found = groups.find(group => group.id === workingId)
    if (found) {
      setDraft(fdClone(found))
      setNameDraft(found.name)
    } else if (!workingId) {
      setDraft({ id: '', name: '未命名技能组', rule: view.rule || '2d6', mvuPath: '', skills: [] })
      setNameDraft('')
    }
  }, [workingId, groups.length, view.rule])

  const hostTemplates = (view.skillTemplates || []).filter(item => Array.isArray(item.skills) && item.skills.length)
  const templateOptions = hostTemplates
    .concat(FD_SKILL_TEMPLATES.filter(item => !hostTemplates.some(host => host.name === item.name)))
    .map(item => ({ id: item.id, name: item.name, rule: item.rule, note: item.note, skills: item.skills }))

  const current = draft || { id: '', name: '未命名技能组', rule: view.rule || '2d6', mvuPath: '', skills: [] }
  const meta = fdRuleMeta(current.rule || view.rule)
  const net = fdSkillNet(current.skills)
  const recommended = meta.recommendedNet
  const delta = net - recommended

  const updateDraft = patchDraft => setDraft({ ...current, ...patchDraft(current) })
  const updateSkill = (idx, patchSkill) => updateDraft(src => ({
    skills: src.skills.map((skill, i) => (i === idx ? { ...skill, ...patchSkill } : skill))
  }))

  const commitGroup = (list, id) => {
    actions.persistGroups('skillGroups', list).then(() => {
      if (hasGame && id) actions.setBinding({ skillGroupId: id })
    })
  }

  const loadTemplate = () => {
    const template = templateOptions.find(item => item.id === templateId) || templateOptions[0] || FD_SKILL_TEMPLATES[0]
    const group = fdNormalizeSkillGroup(fdSkillGroupFromTemplate(template))
    const list = [...groups.filter(item => item.name !== group.name), group]
    setWorkingId(group.id)
    actions.persistGroups('skillGroups', list)
    if (hasGame) actions.setBinding({ skillGroupId: group.id })
    actions.setRule(group.rule)
    if (notify) notify(`已载入样板「${template.name}」并存为独立技能组`)
  }

  const saveCurrent = () => {
    if (!current.skills.length) {
      if (notify) notify('技能清单为空，请先添加技能')
      return
    }
    const target = workingId || fdUid('skg')
    const group = fdNormalizeSkillGroup({ ...current, id: target, name: current.name.trim() || '未命名技能组' })
    const list = groups.some(item => item.id === target)
      ? groups.map(item => (item.id === target ? group : item))
      : [...groups, group]
    setWorkingId(target)
    commitGroup(list, target)
  }

  const saveAsNew = () => {
    const group = fdNormalizeSkillGroup({
      ...current,
      id: fdUid('skg'),
      name: (current.name || '技能组') + ' · 副本'
    })
    setWorkingId(group.id)
    actions.persistGroups('skillGroups', [...groups, group])
    if (notify) notify('已另存为新技能组')
  }

  const removeGroup = () => {
    if (!workingId) return
    setWorkingId('')
    actions.persistGroups('skillGroups', groups.filter(item => item.id !== workingId))
    if (notify) notify('技能组已删除')
  }

  return h(Fragment, null,
    h(FdSection, { title: '🎲 检定骰制', note: meta.hint },
      h('div', { className: 'fd-chip-group' },
        FD_RULES.map(rule => h(FdChip, {
          key: rule.id,
          active: (current.rule || view.rule) === rule.id,
          onClick: () => {
            updateDraft(() => ({ rule: rule.id }))
            actions.setRule(rule.id)
          }
        }, rule.label)))),

    h(FdSection, {
      title: '📚 世界观样板（12 套）',
      note: '载入后成为独立共享组，可继续微调'
    },
    h('div', { className: 'fd-inline-fields' },
      h(FdSelect, {
        value: templateId,
        onChange: setTemplateId,
        options: templateOptions.map(item => ({ value: item.id, label: `${item.name} · ${item.skills.length} 技能 · ${item.rule}` }))
      }),
      h('div', { style: { flex: '0 0 auto' } },
        h(FdBtn, { primary: true, onClick: loadTemplate }, '载入样板到本局并存组')))),

    h(FdSection, {
      title: '🗂 共享技能组',
      note: hasGame ? '切换后立即绑定本局' : '未进入对话：仅维护共享库'
    },
    h('div', { className: 'fd-inline-fields' },
      h(FdSelect, {
        value: workingId,
        onChange: next => { setWorkingId(next); if (hasGame && next) actions.setBinding({ skillGroupId: next }) },
        options: groups.map(item => ({ value: item.id, label: `${item.name}（${item.skills.length} 技能）` })),
        placeholder: groups.length ? '选择技能组…' : '暂无技能组'
      })),
    h('div', { className: 'fd-btn-row' },
      h(FdBtn, { small: true, primary: true, onClick: saveCurrent }, '保存本局修改到当前组'),
      h(FdBtn, { small: true, onClick: saveAsNew }, '另存为新组'),
      h(FdBtn, { small: true, disabled: !workingId, onClick: removeGroup, danger: true }, '删除组')),
    h(FdField, { label: '组名（保存时生效）' },
      h(FdText, { value: nameDraft, onChange: value => { setNameDraft(value); updateDraft(() => ({ name: value })) }, placeholder: '例如：克苏鲁调查组' }))),

    h(FdSection, {
      title: '⚖️ 加值预算',
      note: `${meta.label} 建议范围 ${meta.budget}`
    },
    h('div', { className: 'fd-card-grid' },
      h('div', { className: 'fd-card' },
        h('span', { className: 'fd-card-title' }, '当前净加值'),
        h('span', { className: 'fd-stat-num' }, (net >= 0 ? '+' : '') + net),
        h('span', { className: 'fd-card-sub' }, `推荐 ${recommended >= 0 ? '+' : ''}${recommended} · ${delta === 0 ? '正好在预算内' : (delta > 0 ? `超出 ${delta}` : `低于 ${Math.abs(delta)}`)}`)),
      h('div', { className: 'fd-card' },
        h('span', { className: 'fd-card-title' }, '技能数量'),
        h('span', { className: 'fd-stat-num' }, String(current.skills.length)),
        h('span', { className: 'fd-card-sub' }, `暗骰技能 ${current.skills.filter(skill => skill.hidden).length} 个`))),
    h('div', { className: 'fd-btn-row' },
      h(FdBtn, {
        small: true,
        onClick: () => updateDraft(src => ({ skills: fdDistributeBonuses(src.skills, meta, 'random') }))
      }, '🎲 随机分配加值'),
      h(FdBtn, {
        small: true,
        onClick: () => updateDraft(src => ({ skills: fdDistributeBonuses(src.skills, meta, 'reset') }))
      }, '↺ 恢复推荐默认'))),

    h(FdSection, {
      title: '🧾 技能清单',
      note: `净加值 ${net >= 0 ? '+' : ''}${net}`,
      actions: [h(FdBtn, {
        key: 'add',
        small: true,
        primary: true,
        onClick: () => updateDraft(src => ({ skills: [...src.skills, { id: fdUid('sk'), name: '新技能', bonus: 0, hidden: false }] }))
      }, '＋ 添加技能')]
    },
    current.skills.length
      ? h('div', { className: 'fd-list' }, current.skills.map((skill, idx) => h('div', { key: skill.id || idx, className: 'fd-entry' },
        h('div', { className: 'fd-entry-row' },
          h('div', { style: { flex: '1 1 130px' } }, h(FdText, {
            value: skill.name,
            placeholder: '技能名称',
            onChange: value => updateSkill(idx, { name: value })
          })),
          h(FdBtn, { small: true, onClick: () => updateSkill(idx, { bonus: fdNumber(skill.bonus, 0) - 1 }) }, '−'),
          h(FdNum, {
            value: skill.bonus,
            min: meta.budgetMin - 10,
            max: meta.budgetMax + 20,
            ariaLabel: '加值',
            onChange: value => updateSkill(idx, { bonus: fdClamp(value, -20, 60) })
          }),
          h(FdBtn, { small: true, onClick: () => updateSkill(idx, { bonus: fdNumber(skill.bonus, 0) + 1 }) }, '＋'),
          h(FdChip, {
            active: skill.hidden,
            title: '感知类技能自动暗骰',
            onClick: () => updateSkill(idx, { hidden: !skill.hidden })
          }, skill.hidden ? '🎴 暗骰' : '👁 明骰'),
          h(FdBtn, {
            small: true,
            danger: true,
            onClick: () => updateDraft(src => ({ skills: src.skills.filter((_, i) => i !== idx) }))
          }, '删除')))))
      : h(FdEmpty, null, '清单为空：可载入样板或手动添加技能')),

    h(FdSection, { title: '🔗 MVU 变量联动', note: '可选：把技能加值与角色变量绑定' },
      h('div', { className: 'fd-inline-fields' },
        h(FdText, {
          value: current.mvuPath || '',
          placeholder: '变量路径（如 敏捷,潜行 或 /主角/意志）',
          onChange: value => updateDraft(() => ({ mvuPath: value }))
        }),
        h('div', { style: { flex: '0 0 auto' } }, h(FdBtn, { small: true, onClick: saveCurrent }, '保存路径')))))
}

/* 便捷导出：避免 FragBtnSave 之外再次定义 */
