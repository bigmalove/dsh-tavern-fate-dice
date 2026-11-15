/* ------------------------------------------------------------------ *
 * workbench.js —— 右侧栏「插件」卡片区工作台外壳 + 总览标签页
 * 注册点：ui.registerPanel({ id: 'fate-dice', title: '命运之骰', render })
 * ------------------------------------------------------------------ */

function fdToastResult(res, localNote) {
  if (!res) return localNote || '已保存'
  if (res.ok) return '已保存并同步宿主'
  return (localNote || '已保存到本地浏览器') + '（宿主接口不可用：' + String(res.error || '未实现') + '）'
}

function fdLocalRollExpression(expression) {
  const text = String(expression || '').trim().toLowerCase().replace(/\s+/g, '')
  const match = /^(\d*)d(\d+)([+-]\d+)?$/.exec(text)
  if (!match) return { ok: false, error: '表达式格式应为 NdM±K，例如 2d6+1 / 1d20 / 1d100' }
  const count = fdClamp(match[1] === '' ? 1 : Number(match[1]), 1, 20)
  const sides = fdClamp(Number(match[2]), 2, 100)
  const bonus = match[3] ? Number(match[3]) : 0
  const dice = []
  let sum = 0
  for (let i = 0; i < count; i += 1) {
    const face = 1 + Math.floor(Math.random() * sides)
    dice.push(face)
    sum += face
  }
  return {
    ok: true,
    result: { expression: `${count}d${sides}${bonus ? (bonus > 0 ? '+' + bonus : bonus) : ''}`, dice, sides, bonus, total: sum + bonus, rolledAt: Date.now(), local: true }
  }
}

function FreeRollCard(props) {
  const { gameId, notify } = props || {}
  const [expr, setExpr] = useState('2d6')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const roll = value => {
    const expression = String(value || expr || '').trim()
    if (!expression) return
    setBusy(true)
    fdFreeRoll(props.ui, gameId, expression).then(res => {
      if (res.ok && res.data && res.data.result) setResult(res.data.result)
      else {
        const local = fdLocalRollExpression(expression)
        if (local.ok) {
          setResult(local.result)
          if (notify) notify('宿主未响应，已用本地真随机模拟投掷')
        } else if (notify) notify(local.error)
      }
    }).finally(() => setBusy(false))
  }

  return h('div', { className: 'fd-section' },
    h('div', { className: 'fd-section-head' },
      h('span', { className: 'fd-section-title' }, '🎲 自由骰小工具'),
      h('div', { className: 'fd-btn-row' },
        h(FdChip, { onClick: () => setOpen(prev => !prev) }, open ? '收起' : '展开'))),
    open
      ? h(Fragment, null,
        h('div', { className: 'fd-btn-row' },
          ['2d6', '1d20', '1d100', '1d6', '2d10'].map(item => h(FdChip, {
            key: item,
            onClick: () => { setExpr(item); roll(item) }
          }, item))),
        h('div', { className: 'fd-btn-row' },
          h('div', { style: { flex: '1 1 140px' } }, h(FdText, {
            value: expr,
            placeholder: '骰子表达式，如 2d6+1 / 1d20 / 1d100',
            mono: true,
            onChange: setExpr
          })),
          h(FdBtn, { primary: true, disabled: busy, onClick: () => roll() }, busy ? '投掷中…' : '投掷')),
        result
          ? h('div', { className: 'fd-row' },
            h('div', { className: 'fd-row-main' },
              h('span', { className: 'fd-row-title' }, `${result.expression} = ${result.total}`),
              h('span', { className: 'fd-row-sub' }, `骰面 [${(result.dice || []).join(', ')}]${result.bonus ? (result.bonus > 0 ? ' +' : ' ') + result.bonus : ''}${result.local ? ' · 本地模拟' : ''}`)),
            h('div', { className: 'fd-die-stage' },
              (result.dice || []).slice(0, 3).map((face, idx) => h(DieGlyph, {
                key: idx,
                sides: result.sides || 6,
                label: face,
                tier: 'success'
              }))))
          : h('div', { className: 'fd-hint' }, '仅输入骰子表达式，不涉及剧情行动文本'))
      : h('div', { className: 'fd-hint' }, '支持 2d6+1 / 1d20 / 1d100 等表达式'))
}

function PlotlineList(props) {
  const { view, onCreate, onUpdate, onRemove, onStatus } = props || {}
  const [editing, setEditing] = useState('')
  const [draft, setDraft] = useState({ title: '', origin: '', progress: '' })
  const all = view.plotlines || []
  const active = all.filter(line => line.status === 'active').slice(0, 3)
  const others = all.filter(line => !active.includes(line))

  const beginEdit = line => {
    setEditing(line.id)
    setDraft({ title: line.title, origin: line.origin, progress: line.progress })
  }
  const commit = () => {
    if (!editing) return
    onUpdate && onUpdate(editing, { title: draft.title.trim() || '未命名剧情线', origin: draft.origin, progress: draft.progress })
    setEditing('')
  }

  const renderLine = line => {
    const isEditing = editing === line.id
    const statusLabel = (FD_PLOT_STATUS.find(s => s.value === line.status) || FD_PLOT_STATUS[0]).label
    return h('div', { key: line.id, className: 'fd-row', style: { alignItems: 'flex-start' } },
      h('div', { className: 'fd-row-main' },
        isEditing
          ? h(Fragment, null,
            h(FdText, { value: draft.title, onChange: v => setDraft({ ...draft, title: v }), placeholder: '剧情线标题' }),
            h(FdText, { value: draft.origin, onChange: v => setDraft({ ...draft, origin: v }), placeholder: '起因' }),
            h(FdText, { value: draft.progress, onChange: v => setDraft({ ...draft, progress: v }), placeholder: '当前进展' }))
          : h(Fragment, null,
            h('span', { className: 'fd-row-title' }, '📖 ' + line.title),
            h('span', { className: 'fd-row-sub' }, `起因：${line.origin || '未填写'}`),
            h('span', { className: 'fd-row-sub' }, `进展：${line.progress || '尚未推进'}`))),
      h('div', { className: 'fd-row-end' },
        h(FdBadge, { tone: line.status === 'active' ? 'ok' : (line.status === 'paused' ? 'warn' : 'off') }, statusLabel),
        isEditing
          ? h(FragBtnSave, { onSave: commit, onCancel: () => setEditing('') })
          : h('div', { className: 'fd-btn-row' },
            h(FdBtn, { small: true, onClick: () => beginEdit(line) }, '纠偏'),
            line.status === 'active'
              ? h(FdBtn, { small: true, onClick: () => onStatus && onStatus(line.id, 'paused') }, '暂停')
              : line.status === 'paused'
                ? h(FdBtn, { small: true, onClick: () => onStatus && onStatus(line.id, 'active') }, '恢复')
                : null,
            line.status !== 'closed'
              ? h(FdBtn, { small: true, onClick: () => onStatus && onStatus(line.id, 'closed') }, '完结')
              : null,
            h(FdBtn, { small: true, danger: true, onClick: () => onRemove && onRemove(line.id) }, '删除'))))
  }

  return h('div', { className: 'fd-section' },
    h('div', { className: 'fd-section-head' },
      h('span', { className: 'fd-section-title' }, '📖 正在跟进的持续剧情线'),
      h('div', { className: 'fd-btn-row' },
        h(FdBtn, { small: true, primary: true, onClick: () => onCreate && onCreate() }, '＋ 新增剧情线'))),
    active.length
      ? h('div', { className: 'fd-list' }, active.map(renderLine))
      : h('div', { className: 'fd-hint' }, '尚无活跃剧情线：新增后模型会在每轮推进并保持前后一致'),
    others.length
      ? h(FdCollapse, { title: `其他剧情线（${others.length}）`, sub: '暂停 / 已完结' }, others.map(renderLine))
      : null)
}

function FragBtnSave(props) {
  const { onSave, onCancel } = props || {}
  return h('div', { className: 'fd-btn-row' },
    h(FdBtn, { small: true, primary: true, onClick: onSave }, '保存'),
    h(FdBtn, { small: true, onClick: onCancel }, '取消'))
}

function OverviewTab(props) {
  const { ui, gameId, view, hasGame, notify, actions } = props || {}
  const judge = view.judgeStatus || { available: false }
  const damper = view.damper || { available: false, linkage: false }
  const stats = view.stats || { total: 0, good: 0, bad: 0 }
  const recent = (view.recent || []).slice(0, 8)

  const toggle = (key, next) => actions && actions.setGameFlags({ [key]: next })

  return h(Fragment, null,
    h('div', { className: 'fd-badge-row' },
      h(FdBadge, { tone: judge.available ? 'ok' : 'off' },
        judge.available ? `⚡ 决策模型：${judge.provider || '已就绪'}` : '🧭 本地启发式快判'),
      h(FdBadge, { tone: damper.available ? (damper.linkage ? 'ok' : 'warn') : 'off' },
        damper.available
          ? (damper.linkage ? '⛓ 叙事阻尼器双向联动' : '⛓ 阻尼器可用 · 未联动')
          : '⛓ 未检测到叙事阻尼器'),
      view.source === 'local' ? h(FdBadge, { tone: 'off' }, '🖥 本地配置模式') : null),

    h('div', { className: 'fd-card-grid' },
      h('div', { className: 'fd-card' },
        h('div', { className: 'fd-row-main' },
          h('span', { className: 'fd-card-title' }, '自动技能检定'),
          h('span', { className: 'fd-card-sub' }, '发送前毫秒定难并投掷真骰')),
        h(FdSwitch, { on: view.autoCheck, label: '自动技能检定', onChange: next => toggle('autoCheck', next) })),
      h('div', { className: 'fd-card' },
        h('div', { className: 'fd-row-main' },
          h('span', { className: 'fd-card-title' }, '多轨随机事件'),
          h('span', { className: 'fd-card-sub' }, '多条轨道同时抽取并注入本轮')),
        h(FdSwitch, { on: view.multiTrack, label: '多轨随机事件', onChange: next => toggle('multiTrack', next) })),
      h('div', { className: 'fd-card' },
        h('div', { className: 'fd-row-main' },
          h('span', { className: 'fd-card-title' }, '剧情增强 3.2 双轨模式'),
          h('span', { className: 'fd-card-sub' }, '长期事件组 + 当前场景追加事件组')),
        h(FdSwitch, { on: view.enhanced, label: '剧情增强双轨', onChange: next => toggle('enhanced', next) })),
      h('div', { className: 'fd-card' },
        h('div', { className: 'fd-row-main' },
          h('span', { className: 'fd-card-title' }, '下一次发送暂停随机推动'),
          h('span', { className: 'fd-card-sub' }, hasGame ? '本轮只投检定，不抽随机事件' : '进入对话后可用')),
        h(FdBtn, {
          small: true,
          primary: view.paused,
          disabled: !hasGame,
          onClick: () => actions && actions.pauseNext(!view.paused)
        }, view.paused ? '已暂停 · 点按恢复' : '暂停一次'))),

    h(PlotlineList, {
      view,
      onCreate: () => actions && actions.createPlotline(),
      onUpdate: (id, patch) => actions && actions.updatePlotline(id, patch),
      onStatus: (id, status) => actions && actions.setPlotlineStatus(id, status),
      onRemove: id => actions && actions.removePlotline(id)
    }),

    h('div', { className: 'fd-section' },
      h('div', { className: 'fd-section-head' },
        h('span', { className: 'fd-section-title' }, '📊 本局统计与最近记录'),
        h('span', { className: 'fd-section-note' }, hasGame ? '最近 8 轮' : '需要进入对话')),
      h('div', { className: 'fd-stat-grid' },
        h('div', { className: 'fd-stat-cell' },
          h('span', { className: 'fd-stat-num' }, String(stats.total || 0)),
          h('span', { className: 'fd-stat-lbl' }, '累计检定')),
        h('div', { className: 'fd-stat-cell' },
          h('span', { className: 'fd-stat-num' }, String(stats.good || 0)),
          h('span', { className: 'fd-stat-lbl' }, '大成功/成功')),
        h('div', { className: 'fd-stat-cell' },
          h('span', { className: 'fd-stat-num' }, String(stats.bad || 0)),
          h('span', { className: 'fd-stat-lbl' }, '代价/失手'))),
      recent.length
        ? h('div', { className: 'fd-list' },
          recent.map(item => h('div', { key: `${item.turn}-${item.rolledAt}`, className: 'fd-list-item' },
            h('span', null, `第 ${item.turn} 轮 · ${item.check}`),
            h('span', { className: 'fd-btn-row' },
              item.eventCount ? h('span', { className: 'fd-event-pill' }, `事件 ${item.eventCount}`) : null,
              item.damper ? h('span', { className: 'fd-event-pill' }, '⛓ 阻尼') : null,
              h('span', { className: 'fd-hint' }, item.hidden ? '暗骰' : `${item.total} ${item.tierLabel}`)))))
        : h('div', { className: 'fd-hint' }, '本局尚无检定记录')),

    h(FreeRollCard, { ui, gameId, notify }))
}

function WorkbenchPanel(props) {
  const { ui, gameId } = props || {}
  const hasGame = Boolean(gameId)
  const [tab, setTab] = useState('overview')
  const [view, setView] = useState(fdEmptyWorkbench)
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)

  const notify = text => {
    setToast(String(text || ''))
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4200)
  }

  useEffect(() => {
    let alive = true
    fdLoadWorkbench(ui, gameId).then(data => {
      if (alive) setView(data)
    })
    const offSync = fdWatch(ui, gameId, 'workbench-sync', payload => {
      if (!alive || !payload) return
      setView(prev => fdMergeWorkbench(prev || fdEmptyWorkbench(), payload))
    })
    const offSummary = fdWatch(ui, gameId, 'summary', summary => {
      if (!alive || !summary) return
      setView(prev => fdBindStatusSummary(prev || fdEmptyWorkbench(), { summary }))
    })
    return () => {
      alive = false
      offSync()
      offSummary()
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [gameId])

  const patch = patchView => setView(prev => ({ ...(prev || fdEmptyWorkbench()), ...patchView(prev || fdEmptyWorkbench()) }))

  const persistSettings = nextSettings => {
    const merged = fdNormalizeSettings({ ...view.settings, ...nextSettings })
    patch(prev => ({ settings: merged, damper: { ...prev.damper, linkage: merged.damperLinkage } }))
    return fdPersistSettings(ui, merged).then(res => {
      notify(fdToastResult(res, '全局设置已保存在本地'))
      return merged
    })
  }

  const persistGroups = (kind, list) => {
    patch(() => ({ [kind]: list }))
    const save = kind === 'skillGroups' ? fdPersistSkillGroups : fdPersistEventGroups
    return save(ui, gameId, list).then(res => {
      notify(fdToastResult(res, kind === 'skillGroups' ? '技能组已保存在本地' : '事件组已保存在本地'))
      return list
    })
  }

  const actions = {
    persistSettings,
    persistGroups,
    setRule(rule) {
      patch(() => ({ rule }))
      notify(`检定骰制已切换为 ${fdRuleMeta(rule).label}`)
    },
    setGameFlags(flags) {
      patch(prev => {
        const next = { ...prev, ...flags }
        if (flags.autoCheck !== undefined || flags.multiTrack !== undefined || flags.enhanced !== undefined) {
          if (hasGame) {
            fdPersistBinding(ui, gameId, { ...prev.binding, autoCheck: next.autoCheck, multiTrack: next.multiTrack, enhanced: next.enhanced })
              .then(res => notify(fdToastResult(res, '开关已记录，进入对话后由宿主生效')))
          } else {
            notify('开关已记录：进入任意对话后生效')
          }
        }
        return next
      })
    },
    pauseNext(paused) {
      patch(() => ({ paused }))
      fdPauseNextRoll(ui, gameId, paused).then(res => {
        notify(res.ok ? (paused ? '下一次发送已暂停随机推动' : '已恢复随机推动') : '仅本地面板已标记：' + String(res.error || '宿主接口不可用'))
      })
    },
    createPlotline() {
      const activeCount = (view.plotlines || []).filter(line => line.status === 'active').length
      if (activeCount >= 3) {
        notify('活跃剧情线已达 3 条上限，请先暂停或完结一条')
        return
      }
      const line = fdCreatePlotline()
      patch(prev => ({ plotlines: [...(prev.plotlines || []), line] }))
      fdPlotlineAction(ui, gameId, 'add', line).then(res => {
        if (!res.ok) notify('新剧情线已添加到本地面板（宿主接口不可用）')
        else notify('剧情线已创建，模型将逐轮推进')
      })
    },
    updatePlotline(id, linePatch) {
      patch(prev => ({
        plotlines: (prev.plotlines || []).map(line => (line.id === id ? { ...line, ...linePatch } : line))
      }))
      fdPlotlineAction(ui, gameId, 'update', { id, ...linePatch }).then(res => {
        notify(res.ok ? '剧情线已纠偏并保存' : '剧情线已在本地面板纠偏')
      })
    },
    setPlotlineStatus(id, status) {
      patch(prev => ({
        plotlines: (prev.plotlines || []).map(line => (line.id === id ? { ...line, status } : line))
      }))
      fdPlotlineAction(ui, gameId, 'status', { id, status }).then(res => {
        if (!res.ok) notify('状态已更新（仅本地）')
      })
    },
    removePlotline(id) {
      patch(prev => ({ plotlines: (prev.plotlines || []).filter(line => line.id !== id) }))
      fdPlotlineAction(ui, gameId, 'remove', { id }).then(res => {
        notify(res.ok ? '剧情线已删除' : '剧情线已从本地面板删除')
      })
    },
    binding() {
      return view.binding || {}
    },
    setBinding(nextBinding) {
      patch(prev => ({ binding: { ...prev.binding, ...nextBinding } }))
      if (!hasGame) {
        notify('绑定已记录：进入对话后生效')
        return Promise.resolve({ ok: false, error: '需要进入对话' })
      }
      return fdPersistBinding(ui, gameId, { ...view.binding, ...nextBinding }).then(res => {
        notify(fdToastResult(res, '绑定已保存到本地'))
        return res
      })
    }
  }

  const tabs = [
    ['overview', '总览'],
    ['checks', '技能检定'],
    ['events', '随机事件'],
    ['settings', '设置与导入导出']
  ]

  const body = tab === 'checks'
    ? h(ChecksTab, { ui, gameId, hasGame, view, actions, notify })
    : tab === 'events'
      ? h(EventsTab, { ui, gameId, hasGame, view, actions, notify })
      : tab === 'settings'
        ? h(SettingsTab, { ui, gameId, hasGame, view, actions, notify })
        : h(OverviewTab, { ui, gameId, hasGame, view, actions, notify })

  return h('div', { className: 'fd-root' },
    h('div', { className: 'fd-wb-head' },
      h('div', null,
        h('h3', { className: 'fd-wb-title' }, '🎲 命运之骰'),
        h('p', { className: 'fd-wb-sub' }, hasGame
          ? '本局工作台：骰制、技能组、随机事件与阻尼联动'
          : '全局设置与共享库可随时编辑；进入任意对话后可配置本局绑定与剧情线')), 
      h('div', { className: 'fd-btn-row' },
        h(FdBadge, { tone: hasGame ? 'ok' : 'off' }, hasGame ? '已绑定本局' : '未进入对话'))),
    h('div', { className: 'fd-tabbar', role: 'tablist' },
      tabs.map(([value, label]) => h('button', {
        key: value,
        type: 'button',
        role: 'tab',
        'aria-selected': tab === value ? 'true' : 'false',
        className: 'fd-tab' + (tab === value ? ' is-active' : ''),
        onClick: () => setTab(value)
      }, label))),
    body,
    toast ? h('div', { className: 'fd-toast', role: 'status' }, toast) : null)
}
