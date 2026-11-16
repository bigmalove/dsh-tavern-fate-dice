/* ------------------------------------------------------------------ *
 * widgets.js —— 聊天流挂件：输入栏揭晓动效条 / 楼层折叠检定胶囊 / 状态卡
 * 三处挂载点在无数据时均返回 null 或原 children（零占位、零样式污染）
 * ------------------------------------------------------------------ */

function DieGlyph(props) {
  const { sides, label, rolling, tier, hidden } = props || {}
  const faceCount = fdNumber(sides, 6)
  const tierValue = hidden ? 'hidden' : fdTierOf(tier)
  const cls = 'fd-die-svg' + (rolling ? ' is-rolling' : ' is-settled')
  const stroke = hidden ? 'currentColor' : fdTierColor(tier)
  const fill = hidden ? 'rgba(128,128,142,0.14)' : fdTierColor(tier) + '22'
  let points = null
  if (faceCount >= 20) points = '20,3 35,11 35,29 20,37 5,29 5,11'
  else if (faceCount >= 10) points = '20,3 36,20 20,37 4,20'
  else if (faceCount === 8) points = '20,3 34,13 34,27 20,37 6,27 6,13'
  else if (faceCount === 4) points = '20,4 36,34 4,34'

  const shape = points
    ? h('polygon', { points, fill, stroke, strokeWidth: 2, strokeLinejoin: 'round', opacity: hidden ? 0.7 : 1 })
    : h('rect', { x: 4, y: 4, width: 32, height: 32, rx: 7, fill, stroke, strokeWidth: 2, opacity: hidden ? 0.7 : 1 })

  const text = hidden ? '?' : String(label === undefined || label === null ? '?' : label)
  return h('svg', {
    className: cls,
    'data-tier': tierValue,
    viewBox: '0 0 40 40',
    'aria-hidden': 'true',
    focusable: 'false'
  },
  shape,
  h('text', {
    x: 20,
    y: 21,
    textAnchor: 'middle',
    dominantBaseline: 'central',
    fill: stroke,
    fontSize: text.length >= 3 ? 10 : 14,
    fontWeight: 700
  }, text))
}

function formatRollSummary(roll, revealed) {
  if (!roll) return ''
  if (roll.hidden && !revealed) return `${roll.check}暗骰 · 等待揭晓`
  const mod = roll.modifier ? (roll.modifier > 0 ? `+${roll.modifier}` : String(roll.modifier)) : ''
  const dicePart = Array.isArray(roll.dice) && roll.dice.length > 1
    ? `[${roll.dice.join('+')}]${mod}=${roll.total}`
    : `${roll.total}${mod ? `(${mod})` : ''}`
  return `${roll.check}检定 · ${dicePart} · ${roll.tierLabel}`
}

function fdDamperChip(roll) {
  if (!roll) return null
  const damper = roll.damper || roll.damperLink || roll.linkage
  if (!damper) return null
  const applied = damper.applied !== false
  const text = damper.quotaLabel || damper.label || (applied ? '阻尼联动' : '阻尼未联动')
  return h('span', {
    className: 'fd-event-pill',
    title: damper.reason || '叙事阻尼器联动标记'
  }, `${applied ? '⛓' : '⛓̶'} ${text}`)
}

function LiveRollBanner(props) {
  const { event, onDismiss } = props || {}
  const [rolling, setRolling] = useState(true)
  const [tickFace, setTickFace] = useState('?')
  const [revealed, setRevealed] = useState(false)

  const animation = event && event.animation ? event.animation : 'bounce'
  const isSetup = Boolean(event && event.kind === 'setup-required')
  const isSkipped = Boolean(event && event.kind === 'skipped')
  const isFree = Boolean(event && event.kind === 'free')
  const roll = isFree ? null : (event && event.roll) || null
  const freeResult = isFree ? (event && event.result) || null : null
  const hidden = Boolean(roll && roll.hidden && !revealed)
  const eventId = event ? event.id : null

  useEffect(() => {
    setRevealed(false)
    if (!eventId) return undefined
    /* 未配置决策模型：不投骰、不抖动，5 秒后自动收起，轻触亦可关闭 */
    if (isSetup) {
      const closer = setTimeout(() => {
        if (typeof onDismiss === 'function') onDismiss()
      }, 5000)
      return () => clearTimeout(closer)
    }
    /* 本轮无需检定：只留一行浅提示，6 秒后自动收起，不播骰子动画 */
    if (isSkipped) {
      setRolling(false)
      const closer = setTimeout(() => {
        if (typeof onDismiss === 'function') onDismiss()
      }, 6000)
      return () => clearTimeout(closer)
    }
    const reduced = fdSafe(() => typeof window !== 'undefined' && Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches), false)
    if (animation === 'none' || reduced) {
      setRolling(false)
      return undefined
    }
    setRolling(true)
    const sides = fdNumber(roll && roll.sides, fdNumber(freeResult && freeResult.sides, 6))
    const ticker = setInterval(() => {
      setTickFace(String(1 + Math.floor(Math.random() * Math.max(2, sides))))
    }, 70)
    const stopper = setTimeout(() => {
      clearInterval(ticker)
      setRolling(false)
    }, animation === 'compact' ? 320 : 760)
    const hider = setTimeout(() => {
      if (typeof onDismiss === 'function') onDismiss()
    }, 4200)
    return () => {
      clearInterval(ticker)
      clearTimeout(stopper)
      clearTimeout(hider)
    }
  }, [eventId])

  if (!event) return null

  if (isSetup) {
    return h('div', {
      className: 'fd-root',
      style: { padding: '2px 0' }
    },
    h('div', {
      className: 'fd-guide-banner is-lite',
      role: 'status',
      'aria-live': 'polite',
      onClick: () => {
        if (typeof onDismiss === 'function') onDismiss()
      }
    },
    h('div', { className: 'fd-guide-banner-head' },
      h('span', { className: 'fd-guide-banner-icon', 'aria-hidden': 'true' }, '⚠️'),
      h('span', { className: 'fd-guide-banner-title' }, '命运之骰尚未配置决策模型')),
    h('div', { className: 'fd-guide-banner-step' },
      '请前往酒馆「设置 › 叙事阻尼器」填写决策模型与 API Key（轻触收起）')))
  }

  if (isSkipped) {
    return h('div', { className: 'fd-root', style: { padding: '2px 0' } },
      h('div', {
        className: 'fd-skip-note',
        role: 'status',
        'aria-live': 'polite',
        title: event.reason ? String(event.reason) : '本轮未被判定为需要检定',
        onClick: () => {
          if (typeof onDismiss === 'function') onDismiss()
        }
      },
      h('span', { className: 'fd-skip-icon', 'aria-hidden': 'true' }, '🎲'),
      h('span', { className: 'fd-skip-text' }, event.message || '本轮无需检定'),
      event.check ? h('span', { className: 'fd-skip-check' }, `· ${event.check}`) : null))
  }

  if (!roll && !freeResult) return null

  const tier = hidden ? 'hidden' : fdTierOf(isFree ? 'success' : (roll ? roll.tier : 'success'))
  const faces = isFree
    ? ((freeResult && Array.isArray(freeResult.dice) && freeResult.dice.length) ? freeResult.dice : [freeResult && freeResult.total])
    : (hidden ? ['?'] : ((roll && Array.isArray(roll.dice) && roll.dice.length) ? roll.dice : [roll ? roll.total : '?']))
  const sides = fdNumber(roll && roll.sides, fdNumber(freeResult && freeResult.sides, 6))

  const titleText = isFree
    ? `自由骰 ${freeResult.expression || ''}`
    : `${roll.check}检定（${roll.difficultyLabel || '判定'}）`

  const subText = rolling
    ? '正在投掷命运真骰…'
    : isFree
      ? `骰面 [${(freeResult.dice || []).join(', ')}]${freeResult.bonus ? (freeResult.bonus > 0 ? ' +' : ' ') + freeResult.bonus : ''} · 轻触收起`
      : hidden
        ? '结果已暗中注入本轮裁定（轻触偷看）'
        : `${formatRollSummary(roll, true)} · 轻触收起`

  return h('div', {
    className: 'fd-root',
    style: { padding: '2px 0' }
  },
  h('div', {
    className: 'fd-live-card',
    'data-tier': tier,
    role: 'status',
    'aria-live': 'polite',
    onClick: () => {
      if (hidden && !rolling) setRevealed(true)
      else if (typeof onDismiss === 'function') onDismiss()
    }
  },
  h('div', { className: 'fd-die-stage' },
    (faces.length ? faces : ['?']).slice(0, 3).map((face, idx) => h(DieGlyph, {
      key: idx,
      sides,
      label: rolling && !hidden ? tickFace : face,
      rolling,
      tier,
      hidden
    }))),
  h('div', { className: 'fd-live-body' },
    h('div', { className: 'fd-live-title' },
      h('span', { className: 'fd-turn-summary', style: { minWidth: 0 } }, titleText),
      !rolling
        ? h('span', { className: 'fd-tier-pill', 'data-tier': tier },
          isFree
            ? `总计 ${freeResult.total}`
            : hidden
              ? '暗骰 · 点按揭晓'
              : `${roll.tierLabel || ''} · ${roll.total}`)
        : null,
      !rolling ? fdDamperChip(roll) : null),
    h('div', { className: 'fd-live-sub' }, subText))))
}

/* 输入栏上方停靠：只消费真骰揭晓状态通道 */
function ComposerLiveDock(props) {
  const { ui, sessionId, gameId } = props || {}
  const [liveEvent, setLiveEvent] = useState(null)
  const lastIdRef = useRef('')
  const stateKey = sessionId || gameId || null
  const keys = stateKey && gameId && gameId !== stateKey ? [stateKey, gameId] : (stateKey ? [stateKey] : [])

  useEffect(() => {
    if (!keys.length) return undefined
    const accept = data => {
      if (!data) {
        setLiveEvent(null)
        return
      }
      /* 关闭动画时不再展示骰面卡，但未配置决策模型的引导提示仍需露面 */
      if (data.animation === 'none' && data.kind !== 'setup-required' && data.kind !== 'skipped') {
        setLiveEvent(null)
        return
      }
      const id = data.id || `${data.kind || 'live'}-${data.turn || 0}-${Date.now()}`
      if (id === lastIdRef.current) return
      lastIdRef.current = id
      setLiveEvent({ ...data, id })
    }
    const offs = keys.map(key => fdWatch(ui, key, 'live-roll', accept))
    return () => {
      offs.forEach(off => off())
    }
  }, [keys.join('|')])

  if (!liveEvent) return null
  return h('div', { className: 'fd-root', style: { padding: '0 2px 4px' } },
    h(LiveRollBanner, { event: liveEvent, onDismiss: () => setLiveEvent(null) }))
}

function fdBuildTurnDetails(record, peeked) {
  const roll = record.roll || {}
  const breakdown = roll.modifierBreakdown || {}
  const covered = Boolean(roll.hidden && !peeked)
  if (covered) {
    return h('dl', { className: 'fd-turn-details' },
      h('dt', { className: 'fd-turn-dt' }, '暗骰'),
      h('dd', { className: 'fd-turn-dd' }, '结果尚未揭晓，点按胶囊头部偷看'))
  }

  const rows = []
  rows.push(h('dt', { key: 'dt-rule', className: 'fd-turn-dt' }, '骰面算式'))
  rows.push(h('dd', { key: 'dd-rule', className: 'fd-turn-dd' },
    `${roll.rule || 'd6'} 原骰 [${(roll.dice || []).join(', ')}]`
    + ` = ${roll.total}（目标${roll.rule === 'd100' ? ' ≤ ' : ' ≥ '}${roll.target === undefined ? '—' : roll.target}）`))

  const skillBonus = fdNumber(breakdown.skillBonus ?? roll.skillBonus, 0)
  rows.push(h('dt', { key: 'dt-skill', className: 'fd-turn-dt' }, '角色能力修正'))
  rows.push(h('dd', { key: 'dd-skill', className: 'fd-turn-dd' },
    `${roll.check || '检定'} ${skillBonus >= 0 ? '+' : ''}${skillBonus}`
    + (roll.modifier ? `（总修正 ${roll.modifier > 0 ? '+' : ''}${roll.modifier}）` : '')))

  if (fdNumber(breakdown.varModifier, 0) || (Array.isArray(breakdown.matchedVars) && breakdown.matchedVars.length)) {
    const matched = Array.isArray(breakdown.matchedVars) ? breakdown.matchedVars : []
    rows.push(h('dt', { key: 'dt-var', className: 'fd-turn-dt' }, 'MVU 变量修正'))
    rows.push(h('dd', { key: 'dd-var', className: 'fd-turn-dd' },
      `${fdNumber(breakdown.varModifier, 0) >= 0 ? '+' : ''}${fdNumber(breakdown.varModifier, 0)}`
      + (matched.length ? ` · ${matched.map(v => `${v.label || v.path || '变量'}(${v.raw ?? v.value ?? ''})`).join('、')}` : '')))
  }

  const damper = roll.damper || roll.damperSync || null
  if (damper) {
    const quota = damper.quota || damper.quotaSync || null
    rows.push(h('dt', { key: 'dt-damper', className: 'fd-turn-dt' }, '叙事阻尼器'))
    rows.push(h('dd', { key: 'dd-damper', className: 'fd-turn-dd' },
      `${damper.applied === false ? '未联动' : '联动'}`
      + (damper.modifier ? ` · 修正 ${damper.modifier > 0 ? '+' : ''}${damper.modifier}` : '')
      + (quota ? ` · 配额同步 ${typeof quota === 'string' ? quota : `推动 ${fdNumber(quota.plotPush, 0)}/${fdNumber(quota.maxPlotPush, 0)}、氛围 ${fdNumber(quota.ambience, 0)}/${fdNumber(quota.maxAmbience, 0)}`}` : '')
      + (damper.reason ? ` · ${damper.reason}` : '')))
  }

  rows.push(h('dt', { key: 'dt-diff', className: 'fd-turn-dt' }, '难度理由'))
  rows.push(h('dd', { key: 'dd-diff', className: 'fd-turn-dd' }, `${roll.difficultyLabel || '判定'} · ${roll.reason || '本地启发式快判'}`))

  return h('dl', { className: 'fd-turn-details' }, rows)
}

function TurnRollCapsule(props) {
  const { ui, gameId, turn, children } = props || {}
  const [record, setRecord] = useState(undefined)
  const [open, setOpen] = useState(false)
  const [peeked, setPeeked] = useState(false)

  useEffect(() => {
    if (!gameId || !turn) {
      setRecord(null)
      return undefined
    }
    let alive = true
    setRecord(undefined)
    setPeeked(false)
    fdCall(ui, FD_RPC.readTurn, { gameId, turn }).then(res => {
      if (!alive) return
      const data = res && res.ok ? res.data : null
      setRecord(data && typeof data === 'object' ? data : null)
    })
    return () => {
      alive = false
    }
  }, [gameId, turn])

  const roll = record && record.roll ? record.roll : null
  if (record === undefined || !record || !roll) return children || null

  const covered = Boolean(roll.hidden && !peeked)
  const tier = covered ? 'hidden' : fdTierOf(roll.tier)
  const summary = formatRollSummary(roll, peeked)

  return h(Fragment, null,
    h('div', { className: 'fd-root', style: { padding: '0 0 2px' } },
      h('div', { className: 'fd-turn-capsule', 'data-tier': tier },
        h('button', {
          type: 'button',
          className: 'fd-turn-head',
          'aria-expanded': open ? 'true' : 'false',
          onClick: e => {
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
            if (covered) setPeeked(true)
            else setOpen(prev => !prev)
          }
        },
        h('span', { className: 'fd-turn-head-left' },
          h('span', { 'aria-hidden': 'true' }, covered ? '🎴' : '🎲'),
          h('span', { className: 'fd-turn-summary' }, summary),
          roll.damper ? h('span', { className: 'fd-event-pill' }, '⛓ 阻尼') : null),
        h('span', { className: 'fd-tier-pill', 'data-tier': tier },
          covered ? '点按揭晓' : (roll.tierLabel || '结果'))),
        open ? fdBuildTurnDetails(record, peeked) : null)),
    children || null)
}

function StatusDiceSection(props) {
  const { ui, gameId } = props || {}
  const [view, setView] = useState(null)

  useEffect(() => {
    let alive = true
    if (!gameId) {
      setView(null)
      return undefined
    }
    fdLoadWorkbench(ui, gameId).then(data => {
      if (alive) setView(data)
    })
    const offSummary = fdWatch(ui, gameId, 'summary', summary => {
      if (!alive || !summary) return
      setView(prev => fdBindStatusSummary(prev || fdEmptyWorkbench(), { summary }))
    })
    const offWorkbench = fdWatch(ui, gameId, 'workbench-sync', payload => {
      if (!alive || !payload) return
      setView(prev => fdMergeWorkbench(prev || fdEmptyWorkbench(), payload))
    })
    return () => {
      alive = false
      offSummary()
      offWorkbench()
    }
  }, [gameId])

  const current = view || fdEmptyWorkbench()
  const judgeReady = Boolean(current.judgeStatus && current.judgeStatus.available)
  const stats = current.stats || { total: 0, good: 0, bad: 0 }
  const recent = (current.recent || []).slice(0, 5)

  return h('div', { className: 'fd-root fd-status' },
    h('div', { className: 'fd-badge-row' },
      h(FdBadge, { tone: judgeReady ? 'ok' : 'warn' },
        judgeReady
          ? `⚡ 决策模型 ${current.judgeStatus.provider || '就绪'}`
          : '⚠️ 待配决策模型'),
      h(FdBadge, { tone: current.damper && current.damper.linkage ? 'ok' : 'off' },
        current.damper && current.damper.linkage ? '⛓ 阻尼联动' : '⛓ 阻尼未联动')),
    judgeReady
      ? null
      : h('div', { className: 'fd-guide-banner is-lite', role: 'note' },
        h('div', { className: 'fd-guide-banner-step' },
          '需前往「设置 › 叙事阻尼器」配置决策模型与 API Key 后方可启用 AI 自动检定')),
    h('div', { className: 'fd-stat-grid' },
      h('div', { className: 'fd-stat-cell' },
        h('span', { className: 'fd-stat-num' }, String(stats.total || 0)),
        h('span', { className: 'fd-stat-lbl' }, '累计检定')),
      h('div', { className: 'fd-stat-cell' },
        h('span', { className: 'fd-stat-num' }, String(stats.good || 0)),
        h('span', { className: 'fd-stat-lbl' }, '大成功+成功')),
      h('div', { className: 'fd-stat-cell' },
        h('span', { className: 'fd-stat-num' }, String(stats.bad || 0)),
        h('span', { className: 'fd-stat-lbl' }, '代价+失手'))),
    recent.length
      ? h('div', { className: 'fd-list' },
        recent.map(item => h('div', { key: `${item.turn}-${item.rolledAt}`, className: 'fd-list-item' },
          h('span', null, `第 ${item.turn} 轮 · ${item.check}`),
          h('span', { className: 'fd-hint' }, item.hidden ? '暗骰' : `${item.total} ${item.tierLabel}`))))
      : h('div', { className: 'fd-hint' }, '本局尚无检定记录，发送一轮行动后开始记录'))
}
