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
    h(FdSection, {
      title: '🎲 检定骰制',
      note: meta.hint,
      help: [
        '本节只决定「骰点如何换算成结果档位」，不会改动你已有的技能名与加值。四档结果统一为：大成功 / 成功 / 代价成功 / 失败 / 大失败。',
        '2d6 叙事渐进（默认）：两枚六面相加，再加技能加值与修正得到合计。合计 ≥10 → 成功；7~9 → 代价成功（事情办成了但附带代价）；≤6 → 失败。难度会整体平移分界线（成功线 10+平移、代价线 7+平移，平移量 = 难度目标值 − 7）。另外双 6 或合计 ≥12 直接判大成功，双 1 直接判大失败。曲线居中、失败温和，适合长线文字 RP。',
        'd10 轻量阶梯：单骰 1~10，合计（骰点 + 加值 + 修正）≥ 目标值 → 成功；差 1~2 点 → 代价成功；掷出满值且逼近目标、或合计超出目标约四分之一面数 → 大成功；掷出天然 1 且未达标 → 大失败。档位少、节奏快，适合轻量日常与快节奏互动。',
        'd20 经典跑团：单骰 1~20，合计 ≥ 目标值 → 成功，差 1~2 点 → 代价成功；天然 20 必大成功、天然 1 必大失败（各 5%），与桌面 DC 判定思维一致，适合规则化跑团与战斗。',
        'd100 百分阈值：目标是百分制——目标值 = 难度目标 + 技能加值 + 修正×5（结果夹在 5~99），出点 ≤ 目标 → 成功；比目标多出 10 点以内 → 代价成功；出点 ≤5 大成功、≥96 大失败。注意 d100 的加值尺度是个位到两位数（推荐净加值 +10 量级），把 d20 的 +4 直接搬过来会几乎无感。',
        '切换骰制后建议顺手点一次「恢复推荐默认」，否则原来的净加值可能远超（或远低于）新骰制的推荐预算。'
      ].join('\n')
    },
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
      note: '载入后成为独立共享组，可继续微调',
      help: [
        '下拉框里是 12 套题材成品：每套自带骰制偏好、6 条常用技能和一套设计意图加值（如 d20 系列的净加值约 +4、d100 系列约 +50），另有宿主下发的扩展样板会排在前面。',
        '点「载入样板到本局并存组」做三件事：① 把该样板复制成一个独立技能组写进你的共享组库（复制品，与样板本身脱钩，随便改不会污染其他组）；② 立即绑定为本局当前技能组并同步骰制；③ 同名的旧副本会被这次载入顶替，不同名的组一律不覆盖、不删除。',
        '载入之后就是普通技能组：技能可以随意增、删、改名、改加值、改明骰/暗骰，也可以再「另存为新组」派生出变体。样板只是起点，不是模版锁。',
        '若下拉框为空或想改宿主提供的样板，请检查宿主侧技能组样板接口；面板内的 12 套始终可用。'
      ].join('\n')
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
      note: hasGame ? '切换后立即绑定本局' : '未进入对话：仅维护共享库',
      help: [
        '「共享技能组库」是跨对话共用的：这里出现的每个组都存在本地库里，任何对话都能挑同一个组来用，编辑后所有引用它的对话同步生效。',
        '「当前对话绑定」只是指向其中一个组的指针（binding.skillGroupId）：切换下拉项立即改绑，但不会复制、不会影响组库内容。未进入对话时只能维护组库，切换不会产生绑定。',
        '「保存本局修改到当前组」＝就地覆盖（覆盖对象是下拉选中的那个共享组，其他对话也会看到新数值，属于全局修改）。',
        '「另存为新组」＝派生副本，名字自动加「 · 副本」，原组一字不动——想为某个对话单独调参就用这个，避免污染共享库。',
        '「删除组」会把该组从共享库移除；若正被本局或其他对话绑定，绑定会变成空指向，回到本页重新选一个组即可。'
      ].join('\n')
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
    h(FdField, {
      label: '组名（保存时生效）',
      help: '组名只在你点「保存本局修改到当前组」或「另存为新组」时写回；输入过程中仅改草稿，误输入不会污染已经存在的共用组。名字留空时会落成「未命名技能组」。同名不会自动合并——库允许重名，靠下拉里的技能数量区分，建议带题材后缀（如「克苏鲁调查组 · 团A」）。'
    },
      h(FdText, { value: nameDraft, onChange: value => { setNameDraft(value); updateDraft(() => ({ name: value })) }, placeholder: '例如：克苏鲁调查组' }))),

    h(FdSection, {
      title: '⚖️ 加值预算',
      note: `${meta.label} 建议范围 ${meta.budget}`,
      help: [
        '「净加值」＝清单里所有技能加值的代数和（含负数）。它不直接决定成败，而是整体抬高或压低这个角色在该骰制下的成功率。',
        '每套骰制有推荐净加值（2d6 推荐 +1、d10 推荐 +2、d20 推荐 +4、d100 推荐 +10）与允许区间（见右上角）；净加值落在推荐值附近最好玩，明显超出会让检定变成走过场，明显偏低会让角色处处碰壁。卡片里的「超出/低于」只是提示，不会强制封顶。',
        '负加值就是弱项，是刻意保留的：写一个 −1 的「潜行」等于把这个角色的天花板压低，同时把省下来的预算额度让给别的技能——所以想强化主技能时，先给一两个技能填负数是最省预算的做法。',
        '「🎲 随机分配加值」：在骰制允许区间内给每条技能掷一个随机加值（打乱强弱分布），适合快速起草，不满意可反复点。',
        '「↺ 恢复推荐默认」：按清单顺序做递减权重分配（第一条最高、越往后越低），总和正好落在推荐净加值上——这是最稳的起手方案，改完骰制或增删技能后建议点一次。',
        '两个按钮都只改当前草稿，必须再点「保存本局修改到当前组」才会写入共享库。'
      ].join('\n')
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
      help: [
        '每一行是一个技能：左边填名字（写清动作语义最容易被模型判对，如「听风辨位」优于「感知2」），中间 −／数字／＋ 直接改加值，右侧胶囊切换明骰与暗骰，最右删除该技能。',
        '「🎴 暗骰 / 👁 明骰」是这个技能的默认可见性：标记为暗骰后，凡是用它做的检定（观察、察觉、侦查、识破谎言、微表情洞察这类），对受控角色一律隐藏具体点数与加值，正文只输出角色主观能感知到的表象，防止玩家用元视角反推出 NPC 的数值、藏了什么或是否在撒谎；结算胶囊里仍可点击偷看真实点数。明骰则照常把点数写进正文。',
        '加值输入框的软上下限跟着当前骰制走（例如 d100 可填 1~100 量级），但硬上限是 −20 ~ +60，防止误输入把成功率拉爆。',
        '「＋ 添加技能」插入一条空白技能（加值 0、明骰）；清单为空时整个检定流程不会触发，记得至少留一条。'
      ].join('\n'),
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

    h(FdSection, {
      title: '🔗 MVU 变量联动',
      note: '可选：把技能加值与角色变量绑定',
      help: [
        '这里填角色卡「变量」（MVU / stat_data）里的字段，作用是把剧情数值折算成本次检定的附加修正，而不是把加值写死。',
        '三种写法：① 直接写字段名，如 `敏捷`、`潜行`——会在 stat_data 里所有数字字段中做「字段名相同或包含该词」的模糊匹配；② 写斜杠或点路径，如 `场景.位置`、`/主角/意志`——按层级精确定位；③ 多条并列，用逗号/分号分隔，如 `敏捷,潜行`——逐条折算后求和（最多取前 6 条）。',
        '单条折算规则：数值 ≥25 时修正 = round((值−50)/15)；9~24 时修正 = floor((值−10)/2)；更小的数值直接取整数部分；每条修正夹在 −3 ~ +4。多条合计后再整体夹在 −5 ~ +5，所以变量爆表也不会把成功率拉满。',
        '留空＝不联动，回落到设置里的全局「修正公式」；两者都空则不加任何变量修正。没有 MVU 变量系统的人物卡保持留空即可，检定完全不受影响。',
        '只读不写：本面板不会反向修改角色卡的 stat_data，要改数值请在角色卡或 MVU 面板里操作。改完路径必须点右侧「保存路径」（等价于保存当前组）才写入共享库。'
      ].join('\n')
    },
      h('div', { className: 'fd-inline-fields' },
        h(FdText, {
          value: current.mvuPath || '',
          placeholder: '变量路径（如 敏捷,潜行 或 /主角/意志）',
          onChange: value => updateDraft(() => ({ mvuPath: value }))
        }),
        h('div', { style: { flex: '0 0 auto' } }, h(FdBtn, { small: true, onClick: saveCurrent }, '保存路径')))))
}

/* 便捷导出：避免 FragBtnSave 之外再次定义 */
