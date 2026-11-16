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

function fdRerollChip(roll) {
  const meta = roll && roll.rerollMeta
  if (!meta || !meta.mode) return null
  if (meta.mode === 'push') {
    return h('span', {
      className: 'fd-event-pill',
      title: roll.pushedFumble
        ? '孤注一掷失手：普通失败已强制恶化为大失败'
        : '孤注一掷：强行逆转亦须承受挂彩/透支等叙事代价'
    }, '🔥 孤注一掷')
  }
  return h('span', {
    className: 'fd-event-pill',
    title: '消耗 1 点命运点发动的逆命重投'
  }, '✦ 逆命重投')
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
  const isReused = Boolean((event && event.reused) || (roll && roll.reusedOnRegenerate))
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
    /* 重新生成复用本轮已锁定的首次真骰结果：直接展示原骰面，不再假播滚动随机点数 */
    if (isReused) {
      setRolling(false)
      const hider = setTimeout(() => {
        if (typeof onDismiss === 'function') onDismiss()
      }, 3600)
      return () => clearTimeout(hider)
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
        ? (isReused ? '已复用本轮首次暗骰结果（轻触偷看）' : '结果已暗中注入本轮裁定（轻触偷看）')
        : (isReused ? `已锁定复用首次真骰 · ${formatRollSummary(roll, true)}` : `${formatRollSummary(roll, true)} · 轻触收起`)

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
      !rolling && isReused
        ? h('span', { className: 'fd-event-pill', title: '同一楼层输入未变，重新生成已强制复用首次已结算的真骰结果' }, '🔒 锁骰复用')
        : null,
      !rolling ? fdRerollChip(roll) : null,
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

const fdMountedTurnViews = new Set()

function TurnRollCapsule(props) {
  const { ui, gameId, turn, children, defaultOpen, fromTurnView, emptyFallback } = props || {}
  const [record, setRecord] = useState(undefined)
  const [open, setOpen] = useState(Boolean(defaultOpen))
  const [peeked, setPeeked] = useState(false)
  const [rerolling, setRerolling] = useState(false)
  const [rerollHint, setRerollHint] = useState('')

  useEffect(() => {
    if (!fromTurnView || !gameId || !turn) return undefined
    const key = `${gameId}:${turn}`
    fdMountedTurnViews.add(key)
    return () => {
      fdMountedTurnViews.delete(key)
    }
  }, [fromTurnView, gameId, turn])

  useEffect(() => {
    if (!gameId || !turn) {
      setRecord(null)
      return undefined
    }
    let alive = true
    const reload = () => {
      fdCall(ui, FD_RPC.readTurn, { gameId, turn }).then(res => {
        if (!alive) return
        const data = res && res.ok ? res.data : null
        setRecord(data && typeof data === 'object' ? data : null)
      })
    }
    setRecord(undefined)
    setPeeked(false)
    setRerollHint('')
    reload()
    const offSync = fdWatch(ui, gameId, 'workbench-sync', () => {
      if (alive) reload()
    })
    return () => {
      alive = false
      offSync()
    }
  }, [gameId, turn])

  const roll = record && record.roll ? record.roll : null
  if (record === undefined) return children || null
  if (!record || !roll) return emptyFallback || children || null

  const covered = Boolean(roll.hidden && !peeked)
  const tier = covered ? 'hidden' : fdTierOf(roll.tier)
  const summary = formatRollSummary(roll, peeked)
  const fate = fdNormalizeFate(record.fate)
  const rerollState = record.rerollState && typeof record.rerollState === 'object'
    ? record.rerollState
    : {
      allowed: !roll.hidden
        && !(roll.rerollMeta && roll.rerollMeta.count >= 1)
        && roll.tier !== 'critical'
        && roll.tier !== 'success',
      canFate: fate.points > 0,
      canPush: true,
      fatePoints: fate.points,
      fateMax: fate.max,
      reason: roll.hidden
        ? '感知/洞察类暗骰不可重投'
        : (roll.rerollMeta && roll.rerollMeta.count >= 1
          ? '本轮已重投锁定（每轮限 1 次）'
          : ((roll.tier === 'critical' || roll.tier === 'success') ? '检定已达成成功，无需重投' : ''))
    }

  const manualReroll = mode => {
    if (rerolling || !gameId || !turn) return
    setRerolling(true)
    setRerollHint('')
    fdCall(ui, FD_RPC.rerollTurn, { gameId, turn, mode: mode || 'auto' })
      .then(res => {
        const data = res && res.ok ? res.data : null
        const nextRoll = data && data.ok !== false && data.roll ? data.roll : null
        if (nextRoll) {
          setRecord(prev => ({
            ...(prev || {}),
            roll: nextRoll,
            fate: data.fate || (prev && prev.fate) || fate,
            rerollState: data.rerollState || { allowed: false, reason: '本轮已重投锁定（每轮限 1 次）' }
          }))
          setRerollHint(data.mode === 'push'
            ? '已孤注一掷并同步配额（点酒馆「重新生成」按新结果与代价重写正文）'
            : '已消耗 1 点命运点逆命重投（点酒馆「重新生成」按新点数重写正文）')
        } else {
          if (data && data.rerollState) {
            setRecord(prev => ({ ...(prev || {}), fate: data.fate || (prev && prev.fate), rerollState: data.rerollState }))
          }
          setRerollHint((data && data.error) || (res && res.error) || '当前条件不允许重投')
        }
      })
      .catch(() => setRerollHint('手动重投失败'))
      .finally(() => setRerolling(false))
  }

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
          roll.reusedOnRegenerate ? h('span', { className: 'fd-event-pill', title: '重新生成已复用本轮已锁定的真骰结果' }, '🔒 锁骰') : null,
          fdRerollChip(roll),
          roll.damper ? h('span', { className: 'fd-event-pill' }, '⛓ 阻尼') : null),
        h('span', { className: 'fd-tier-pill', 'data-tier': tier },
          covered ? '点按揭晓' : (roll.tierLabel || '结果'))),
        open
          ? h(Fragment, null,
            fdBuildTurnDetails(record, peeked),
            !covered
              ? h('div', { className: 'fd-btn-row', style: { padding: '4px 10px 8px' } },
                rerollState.allowed
                  ? h(Fragment, null,
                    rerollState.canFate
                      ? h(FdBtn, {
                        small: true,
                        primary: true,
                        disabled: rerolling,
                        title: '消耗 1 点命运点，无额外恶化惩罚重投本轮真骰（每轮限 1 次）',
                        onClick: () => manualReroll('fate')
                      }, rerolling ? '重投中…' : `✦ 逆命重投 (-1 点 · 余 ${fdNumber(rerollState.fatePoints, fate.points)}/${fdNumber(rerollState.fateMax, fate.max)})`)
                      : null,
                    h(FdBtn, {
                      small: true,
                      danger: true,
                      disabled: rerolling,
                      title: '不耗命运点强行一搏（每轮限 1 次）：若仍失败强制恶化为大失败，就算逆转成功也必须承受挂彩/透支代价',
                      onClick: () => manualReroll('push')
                    }, rerolling ? '搏命中…' : (rerollState.canFate ? '🔥 孤注一掷' : '🔥 孤注一掷（败则大失败 · 成亦带伤）')))
                  : null,
                h('span', { className: 'fd-hint' },
                  rerollHint || (rerollState.allowed
                    ? '直接重新生成正文将自动复用原骰点'
                    : `🔒 ${rerollState.reason || '本轮骰点已锁定'}`)))
              : null)
          : null)),
    children || null)
}

const fdMountedHeaderTurns = new Set()
const fdHeaderMountListeners = new Set()

function fdNotifyHeaderTurns() {
  fdHeaderMountListeners.forEach(fn => {
    try { fn() } catch {}
  })
}

function MediaTurnRollCapsule(props) {
  const { ui, gameId, turn, item } = props || {}
  const resolvedTurn = fdNumber(turn || (item && item.data && item.data.turn), 0)
  const [, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(v => v + 1)
    fdHeaderMountListeners.add(bump)
    return () => { fdHeaderMountListeners.delete(bump) }
  }, [])
  if (!gameId || !resolvedTurn) return null
  fdNoteActiveGameId(gameId)
  const key = `${gameId}:${resolvedTurn}`
  if (fdMountedTurnViews.has(key) || fdMountedHeaderTurns.has(key)) return null
  return h(TurnRollCapsule, { ui, gameId, turn: resolvedTurn })
}

function fdFormatCompactDice(roll) {
  if (!roll) return ''
  if (roll.rule === 'd100') {
    return `${roll.total}/${roll.target === undefined ? 100 : roll.target}`
  }
  const totalMod = fdNumber(roll.totalModifier ?? ((Number(roll.skillBonus) || 0) + (Number(roll.modifier) || 0)), 0)
  const modStr = totalMod ? (totalMod > 0 ? `+${totalMod}` : String(totalMod)) : ''
  if (Array.isArray(roll.dice) && roll.dice.length > 1) {
    return `[${roll.dice.join('+')}]${modStr}=${roll.total}`
  }
  const raw = Array.isArray(roll.dice) && roll.dice.length === 1 ? roll.dice[0] : (roll.rawTotal ?? roll.total)
  return modStr ? `${raw}${modStr}=${roll.total}` : String(roll.total)
}

function StoryFloorDiceItem(props) {
  const { ui, gameId, turn, streaming, headSlot, panelSlot } = props || {}
  const [record, setRecord] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [peeked, setPeeked] = useState(false)
  const [rerolling, setRerolling] = useState(false)
  const [rerollHint, setRerollHint] = useState('')

  useEffect(() => {
    if (!turn) return undefined
    let alive = true
    const load = () => {
      fdCall(ui, FD_RPC.readTurn, {
        gameId: gameId || '',
        turn,
        streaming: Boolean(streaming)
      }).then(res => {
        if (!alive) return
        const data = res && res.ok ? res.data : null
        setRecord(data && typeof data === 'object' ? data : null)
      })
    }
    load()
    const watchKey = gameId || fdGetActiveGameId()
    const offCheck = watchKey ? fdWatch(ui, watchKey, 'turn-check', () => { if (alive) load() }) : fdNoop
    const offSync = watchKey ? fdWatch(ui, watchKey, 'workbench-sync', () => { if (alive) load() }) : fdNoop
    const offLive = watchKey ? fdWatch(ui, watchKey, 'live-roll', () => { if (alive) load() }) : fdNoop
    return () => {
      alive = false
      offCheck()
      offSync()
      offLive()
    }
  }, [gameId, turn, streaming])

  const effectiveTurn = fdNumber((record && record.turn) || turn, 0)
  const hasVisibleContent = Boolean(record && (record.roll || record.setupRequiredReason || (record.judged && record.judged.shouldRoll === false)))

  useEffect(() => {
    const activeId = gameId || fdGetActiveGameId()
    if (!hasVisibleContent || !activeId || !effectiveTurn) return undefined
    const key = `${activeId}:${effectiveTurn}`
    fdMountedHeaderTurns.add(key)
    fdNotifyHeaderTurns()
    return () => {
      fdMountedHeaderTurns.delete(key)
      fdNotifyHeaderTurns()
    }
  }, [hasVisibleContent, gameId, effectiveTurn])

  if (!hasVisibleContent || !ReactDOM || typeof ReactDOM.createPortal !== 'function' || !headSlot) return null

  const roll = record.roll || null
  const judged = record.judged || null
  const setupReason = record.setupRequiredReason || ''
  const fate = fdNormalizeFate(record.fate)
  const covered = Boolean(roll && roll.hidden && !peeked)
  const isStreaming = Boolean(streaming || record.streaming)

  let tone = 'skipped'
  let pillText = '骰子 · 免检定'
  let tooltip = '点击展开命运之骰本轮详情'

  if (roll) {
    tone = covered ? 'hidden' : fdTierOf(roll.tier)
    if (covered) {
      pillText = `暗骰 · ${roll.check || '感知'} · 点按偷看`
      tooltip = '感知/洞察暗骰（点击揭晓并展开详情）'
    } else {
      const suffix = roll.rerollMeta && roll.rerollMeta.mode === 'push'
        ? ' · 孤注'
        : (roll.rerollMeta && roll.rerollMeta.mode === 'fate'
          ? ' · 逆命'
          : (roll.reusedOnRegenerate ? ' · 锁骰' : ''))
      pillText = `真骰 · ${roll.check || '检定'} ${fdFormatCompactDice(roll)} · ${roll.tierLabel || ''}${suffix}`
      tooltip = `${roll.rule || '2d6'} ${roll.check || '检定'}（难度：${roll.difficultyLabel || '普通'}）· 命运点 ${fate.points}/${fate.max}（点击展开详情与重投）`
    }
  } else if (setupReason) {
    tone = 'skipped'
    pillText = '真骰 · 待配决策模型'
    tooltip = '尚未配置决策模型 API Key（点击查看指引）'
  } else if (judged && judged.shouldRoll === false) {
    tone = 'skipped'
    const prob = Number(judged.needProbability)
    const probPart = judged.damperSync && judged.damperSync.skipped === 'scene-shift'
      ? '场景放行'
      : (Number.isFinite(prob) ? `免检定 ${Math.round(prob * 100)}%` : '免检定')
    pillText = `真骰 · ${probPart}`
    tooltip = `${judged.reason || '本轮行动无显著不确定性，免于投骰'}（点击展开详情）`
  }

  const rerollState = record.rerollState && typeof record.rerollState === 'object'
    ? record.rerollState
    : { allowed: false, reason: '本轮无重投项' }

  const runManualReroll = mode => {
    if (rerolling || !effectiveTurn) return
    setRerolling(true)
    setRerollHint('')
    fdCall(ui, FD_RPC.rerollTurn, { gameId: gameId || '', turn: effectiveTurn, mode: mode || 'auto' })
      .then(res => {
        const data = res && res.ok ? res.data : null
        const nextRoll = data && data.ok !== false && data.roll ? data.roll : null
        if (nextRoll) {
          setRecord(prev => ({
            ...(prev || {}),
            roll: nextRoll,
            fate: data.fate || (prev && prev.fate) || fate,
            rerollState: data.rerollState || { allowed: false, reason: '本轮已重投锁定（每轮限 1 次）' }
          }))
          setRerollHint(data.mode === 'push'
            ? '已孤注一掷并同步阻尼配额！点击下方「重新生成正文」即可按新结果与代价改写剧情'
            : '已消耗 1 点命运点逆命重投！点击下方「重新生成正文」即可按新点数改写剧情')
        } else {
          if (data && data.rerollState) {
            setRecord(prev => ({ ...(prev || {}), fate: data.fate || (prev && prev.fate), rerollState: data.rerollState }))
          }
          setRerollHint((data && data.error) || (res && res.error) || '当前条件不允许重投')
        }
      })
      .catch(() => setRerollHint('手动重投失败'))
      .finally(() => setRerolling(false))
  }

  const pillNode = h('button', {
    type: 'button',
    className: 'fd-floor-pill',
    'data-tone': tone,
    'data-expanded': expanded ? 'true' : undefined,
    'aria-expanded': Boolean(expanded),
    title: tooltip,
    onClick: e => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
      if (covered && !peeked) {
        setPeeked(true)
        setExpanded(true)
      } else {
        setExpanded(prev => !prev)
      }
    }
  },
  h('span', { className: 'fd-floor-dot', 'aria-hidden': 'true' }),
  h('span', null, pillText))

  const panelNode = expanded && panelSlot
    ? ReactDOM.createPortal(
      h('section', {
        className: 'fd-root fd-floor-panel',
        'data-tone': tone,
        'aria-label': '命运之骰本轮裁定详情'
      },
      h('div', { className: 'fd-floor-panel-head' },
        h('strong', { className: 'fd-floor-panel-title' },
          roll
            ? `命运之骰裁定 · ${roll.check || '行动'}检定（${covered ? '暗骰已揭晓' : (roll.tierLabel || '判定')}）`
            : (setupReason ? '命运之骰 · 待配置决策模型' : '命运之骰 · 本轮免检定')),
        h('div', { className: 'fd-floor-panel-tags' },
          roll ? h('span', { className: 'fd-floor-tag' }, String(roll.rule || '2d6')) : null,
          roll && roll.difficultyLabel ? h('span', { className: 'fd-floor-tag' }, `难度：${roll.difficultyLabel}`) : null,
          roll && roll.damper ? h('span', { className: 'fd-floor-tag' }, `⛓ ${roll.damper.quotaLabel || '阻尼联动'}`) : null,
          h('span', { className: 'fd-floor-tag' }, `✦ 命运点 ${fate.points}/${fate.max}`))),
      roll
        ? fdBuildTurnDetails(record, true)
        : h('div', { className: 'fd-hint' },
          setupReason
            ? '请前往酒馆「设置 › 叙事阻尼器」填写决策模型与 API Key，配置后即可自动定难并投掷真骰。'
            : ((judged && judged.reason) || '本轮行动无显著不确定性，免于投骰。')),
      roll
        ? h('div', { className: 'fd-floor-panel-actions' },
          isStreaming
            ? h('span', { className: 'fd-hint' }, '⏳ 正文正在按上述真骰结果生成；待本轮生成落盘后，可在此执行逆命重投或孤注一掷')
            : rerollState.allowed
              ? h(Fragment, null,
                rerollState.canFate
                  ? h(FdBtn, {
                    small: true,
                    primary: true,
                    disabled: rerolling,
                    title: '消耗 1 点命运点，无额外恶化惩罚重投本轮真骰（每轮限 1 次）',
                    onClick: () => runManualReroll('fate')
                  }, rerolling ? '重投中…' : `✦ 逆命重投 (-1 点 · 余 ${fdNumber(rerollState.fatePoints, fate.points)}/${fdNumber(rerollState.fateMax, fate.max)})`)
                  : null,
                h(FdBtn, {
                  small: true,
                  danger: true,
                  disabled: rerolling,
                  title: '不耗命运点强行一搏（每轮限 1 次）：若仍失败强制恶化为大失败，就算逆转成功也必须承受挂彩/透支代价',
                  onClick: () => runManualReroll('push')
                }, rerolling ? '搏命中…' : (rerollState.canFate ? '🔥 孤注一掷' : '🔥 孤注一掷（败则大失败 · 成亦带伤）')),
                h('span', { className: 'fd-hint' }, rerollHint || '直接点「重新生成正文」将强制复用原骰点'))
              : h('span', { className: 'fd-hint' }, rerollHint || `🔒 ${rerollState.reason || '本轮骰点已锁定'}`))
        : null),
      panelSlot
    )
    : null

  return h(Fragment, null, ReactDOM.createPortal(pillNode, headSlot), panelNode)
}

function fdExtractFloorTurn(article) {
  if (!article || typeof article.getAttribute !== 'function') return 0
  const legacy = fdNumber(article.getAttribute('data-legacy-turn'), 0)
  if (legacy > 0) return legacy
  const rowKey = String(article.getAttribute('data-row-key') || '')
  const rkMatch = /^turn:(\d+)$/.exec(rowKey)
  if (rkMatch) {
    const rkTurn = fdNumber(rkMatch[1], 0)
    if (rkTurn > 0) return rkTurn
  }
  return fdNumber(article.getAttribute('data-floor'), 0)
}

function fdEl(doc, tag, className, text) {
  const el = doc.createElement(tag)
  if (className) el.className = className
  if (text !== undefined && text !== null && text !== '') el.textContent = String(text)
  return el
}

/* 纯原生 DOM 楼层顶栏挂载：不依赖宿主未暴露的 react-dom/client，任何浏览器页面加载即刻生效 */
function fdMountImperativeFloorHeaders(ui) {
  if (typeof document === 'undefined' || !document.body || typeof MutationObserver !== 'function') return fdNoop
  const doc = document
  const entries = new Map()
  let rafId = 0
  let disposed = false
  let watchedGameId = ''
  let stopWatches = fdNoop

  const refreshAll = () => {
    if (disposed) return
    entries.forEach(entry => {
      entry.retryCount = 0
      loadEntry(entry)
    })
  }

  const bindGameWatches = nextId => {
    const id = String(nextId || '').trim()
    if (!id || id === watchedGameId || disposed) return
    stopWatches()
    watchedGameId = id
    const off1 = fdWatch(ui, id, 'turn-check', refreshAll)
    const off2 = fdWatch(ui, id, 'live-roll', refreshAll)
    const off3 = fdWatch(ui, id, 'workbench-sync', refreshAll)
    stopWatches = () => {
      off1()
      off2()
      off3()
    }
    refreshAll()
  }

  const offGameSub = fdSubscribeActiveGameId(bindGameWatches)
  const onTavernWindowSession = ev => {
    const sid = ev && ev.detail && ev.detail.sessionId
    if (sid) fdNoteActiveGameId(String(sid))
  }
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('dsh-tavern-session-changed', onTavernWindowSession)
    window.addEventListener('dsh-tavern-story-mutated', onTavernWindowSession)
    window.addEventListener('dsh-tavern-message-rendered', onTavernWindowSession)
  }
  if (fdGetActiveGameId()) {
    bindGameWatches(fdGetActiveGameId())
  } else {
    fdCall(ui, FD_RPC.status, {}).then(res => {
      const active = res && res.ok && res.data && (res.data.activeGameId || res.data.gameId)
      if (active) fdNoteActiveGameId(String(active))
    })
  }

  function clearMountedKey(entry) {
    if (entry.mountedKey) {
      fdMountedHeaderTurns.delete(entry.mountedKey)
      entry.mountedKey = ''
      fdNotifyHeaderTurns()
    }
  }

  function renderEntry(entry) {
    if (disposed) return
    const { headSlot, panelSlot, record } = entry
    headSlot.textContent = ''
    panelSlot.textContent = ''

    const awaitingLiveRoll = Boolean(entry.streaming && (!record || record.streaming !== true))
    const hasContent = awaitingLiveRoll || Boolean(
      record && (record.roll || record.setupRequiredReason || (record.judged && record.judged.shouldRoll === false))
    )
    if (!hasContent) {
      clearMountedKey(entry)
      return
    }

    if (awaitingLiveRoll) {
      const pendingBtn = fdEl(doc, 'button', 'fd-floor-pill')
      pendingBtn.type = 'button'
      pendingBtn.setAttribute('data-tone', 'skipped')
      pendingBtn.title = '命运之骰正在读取本轮情境并投掷真骰…'
      const dot = fdEl(doc, 'span', 'fd-floor-dot')
      dot.setAttribute('aria-hidden', 'true')
      pendingBtn.appendChild(dot)
      pendingBtn.appendChild(fdEl(doc, 'span', '', '🎲 真骰定难中…'))
      headSlot.appendChild(pendingBtn)
      return
    }

    const effectiveTurn = fdNumber((record && record.turn) || entry.turn, 0)
    const activeId = fdGetActiveGameId()
    const nextKey = activeId && effectiveTurn ? `${activeId}:${effectiveTurn}` : ''
    if (nextKey !== entry.mountedKey) {
      clearMountedKey(entry)
      if (nextKey) {
        entry.mountedKey = nextKey
        fdMountedHeaderTurns.add(nextKey)
        fdNotifyHeaderTurns()
      }
    }

    const roll = record.roll || null
    const judged = record.judged || null
    const setupReason = record.setupRequiredReason || ''
    const fate = fdNormalizeFate(record.fate)
    const covered = Boolean(roll && roll.hidden && !entry.peeked)
    const isStreaming = Boolean(entry.streaming || record.streaming)

    let tone = 'skipped'
    let pillText = '真骰 · 免检定'
    let tooltip = '点击展开命运之骰本轮详情'

    if (roll) {
      tone = covered ? 'hidden' : fdTierOf(roll.tier)
      if (covered) {
        pillText = `暗骰 · ${roll.check || '感知'} · 点按偷看`
        tooltip = '感知/洞察暗骰（点击揭晓并展开详情）'
      } else {
        const suffix = roll.rerollMeta && roll.rerollMeta.mode === 'push'
          ? ' · 🔥孤注'
          : (roll.rerollMeta && roll.rerollMeta.mode === 'fate'
            ? ' · ✦逆命'
            : (roll.reusedOnRegenerate ? ' · 🔒锁骰' : ''))
        pillText = `🎲 ${roll.check || '检定'} ${fdFormatCompactDice(roll)} · ${roll.tierLabel || ''}${suffix}`
        tooltip = `${roll.rule || '2d6'} ${roll.check || '检定'}（难度：${roll.difficultyLabel || '普通'}）· ✦ 命运点 ${fate.points}/${fate.max}（点击展开详情与重投）`
      }
    } else if (setupReason) {
      tone = 'skipped'
      pillText = '🎲 待配决策模型'
      tooltip = '尚未配置决策模型 API Key（点击查看指引）'
    } else if (judged && judged.shouldRoll === false) {
      tone = 'skipped'
      const prob = Number(judged.needProbability)
      const probPart = judged.damperSync && judged.damperSync.skipped === 'scene-shift'
        ? '场景放行'
        : (Number.isFinite(prob) ? `免检定 ${Math.round(prob * 100)}%` : '免检定')
      pillText = `🎲 ${probPart}`
      tooltip = `${judged.reason || '本轮行动无显著不确定性，免于投骰'}（点击展开详情）`
    }

    const pillBtn = fdEl(doc, 'button', 'fd-floor-pill')
    pillBtn.type = 'button'
    pillBtn.setAttribute('data-tone', tone)
    if (entry.expanded) pillBtn.setAttribute('data-expanded', 'true')
    pillBtn.setAttribute('aria-expanded', entry.expanded ? 'true' : 'false')
    pillBtn.title = tooltip
    const dot = fdEl(doc, 'span', 'fd-floor-dot')
    dot.setAttribute('aria-hidden', 'true')
    const txt = fdEl(doc, 'span', '', pillText)
    pillBtn.appendChild(dot)
    pillBtn.appendChild(txt)
    pillBtn.addEventListener('click', e => {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
      if (covered && !entry.peeked) {
        entry.peeked = true
        entry.expanded = true
      } else {
        entry.expanded = !entry.expanded
      }
      renderEntry(entry)
    })
    headSlot.appendChild(pillBtn)

    if (!entry.expanded) return

    const panel = fdEl(doc, 'section', 'fd-root fd-floor-panel')
    panel.setAttribute('data-tone', tone)
    panel.setAttribute('aria-label', '命运之骰本轮裁定详情')

    const pHead = fdEl(doc, 'div', 'fd-floor-panel-head')
    const pTitle = fdEl(
      doc,
      'strong',
      'fd-floor-panel-title',
      roll
        ? `命运之骰裁定 · ${roll.check || '行动'}检定（${roll.tierLabel || '判定'}）`
        : (setupReason ? '命运之骰 · 待配置决策模型' : '命运之骰 · 本轮免检定')
    )
    const pTags = fdEl(doc, 'div', 'fd-floor-panel-tags')
    if (roll) pTags.appendChild(fdEl(doc, 'span', 'fd-floor-tag', String(roll.rule || '2d6')))
    if (roll && roll.difficultyLabel) pTags.appendChild(fdEl(doc, 'span', 'fd-floor-tag', `难度：${roll.difficultyLabel}`))
    if (roll && roll.damper) pTags.appendChild(fdEl(doc, 'span', 'fd-floor-tag', `⛓ ${roll.damper.quotaLabel || '阻尼联动'}`))
    pTags.appendChild(fdEl(doc, 'span', 'fd-floor-tag', `✦ 命运点 ${fate.points}/${fate.max}`))
    pHead.appendChild(pTitle)
    pHead.appendChild(pTags)
    panel.appendChild(pHead)

    if (roll) {
      const dl = fdEl(doc, 'dl', 'fd-turn-details')
      const addRow = (label, value) => {
        dl.appendChild(fdEl(doc, 'dt', 'fd-turn-dt', label))
        dl.appendChild(fdEl(doc, 'dd', 'fd-turn-dd', value))
      }
      addRow(
        '骰面算式',
        `${roll.rule || '2d6'} 原骰 [${(roll.dice || []).join(', ')}] = ${roll.total}（目标${roll.rule === 'd100' ? ' ≤ ' : ' ≥ '}${roll.target === undefined ? '—' : roll.target}）`
      )
      const breakdown = roll.modifierBreakdown || {}
      const skillBonus = fdNumber(breakdown.skillBonus ?? roll.skillBonus, 0)
      addRow(
        '能力修正',
        `${roll.check || '检定'} ${skillBonus >= 0 ? '+' : ''}${skillBonus}${roll.modifier ? `（环境/基调修正 ${roll.modifier > 0 ? '+' : ''}${roll.modifier}）` : ''}`
      )
      const damper = roll.damper || roll.damperSync || null
      if (damper) {
        const quota = damper.quota || damper.quotaSync || ''
        addRow(
          '叙事阻尼器',
          `${damper.applied === false ? '未联动' : '双向联动'}${quota ? ` · 配额 ${quota}` : ''}${damper.reason ? ` · ${damper.reason}` : ''}`
        )
      }
      addRow('难度理由', `${roll.difficultyLabel || '判定'} · ${roll.reason || 'AI 综合评定'}`)
      panel.appendChild(dl)

      const actions = fdEl(doc, 'div', 'fd-floor-panel-actions')
      const rerollState = record.rerollState && typeof record.rerollState === 'object'
        ? record.rerollState
        : { allowed: false, reason: '本轮骰点已锁定' }

      if (isStreaming) {
        actions.appendChild(fdEl(doc, 'span', 'fd-hint', '⏳ 正文正在按上述真骰结果生成；生成完成后可在此执行逆命重投或孤注一掷'))
      } else if (rerollState.allowed) {
        const triggerReroll = mode => {
          if (entry.rerolling || !effectiveTurn) return
          entry.rerolling = true
          entry.rerollHint = ''
          renderEntry(entry)
          fdCall(ui, FD_RPC.rerollTurn, { gameId: fdGetActiveGameId(), turn: effectiveTurn, mode })
            .then(res => {
              const data = res && res.ok ? res.data : null
              const nextRoll = data && data.ok !== false && data.roll ? data.roll : null
              if (nextRoll) {
                entry.record = {
                  ...(entry.record || {}),
                  roll: nextRoll,
                  fate: data.fate || fate,
                  rerollState: data.rerollState || { allowed: false, reason: '本轮已重投锁定（每轮限 1 次）' }
                }
                entry.rerollHint = data.mode === 'push'
                  ? '🔥 已孤注一掷并同步配额！现在点下方「重新生成正文」即可按新结果与代价改写剧情'
                  : '✦ 已消耗 1 点命运点逆命重投！现在点下方「重新生成正文」即可按新点数改写剧情'
              } else {
                if (data && data.rerollState) {
                  entry.record = { ...(entry.record || {}), fate: data.fate || fate, rerollState: data.rerollState }
                }
                entry.rerollHint = (data && data.error) || (res && res.error) || '当前条件不允许重投'
              }
            })
            .catch(() => { entry.rerollHint = '手动重投失败' })
            .finally(() => {
              entry.rerolling = false
              renderEntry(entry)
            })
        }

        if (rerollState.canFate) {
          const fateBtn = fdEl(
            doc,
            'button',
            'fd-btn is-primary is-sm',
            entry.rerolling ? '重投中…' : `✦ 逆命重投 (-1 点 · 余 ${fdNumber(rerollState.fatePoints, fate.points)}/${fdNumber(rerollState.fateMax, fate.max)})`
          )
          fateBtn.type = 'button'
          fateBtn.disabled = entry.rerolling
          fateBtn.title = '消耗 1 点命运点，无恶化惩罚重掷本轮真骰（每轮限 1 次）'
          fateBtn.addEventListener('click', () => triggerReroll('fate'))
          actions.appendChild(fateBtn)
        }

        const pushBtn = fdEl(
          doc,
          'button',
          'fd-btn is-danger is-sm',
          entry.rerolling ? '搏命中…' : (rerollState.canFate ? '🔥 孤注一掷（省点硬搏）' : '🔥 孤注一掷（败则大失败 · 成亦带伤）')
        )
        pushBtn.type = 'button'
        pushBtn.disabled = entry.rerolling
        pushBtn.title = '不耗命运点强行一搏（每轮限 1 次）：若仍失败强制恶化为大失败，就算逆转成功也必须承受挂彩/透支代价'
        pushBtn.addEventListener('click', () => triggerReroll('push'))
        actions.appendChild(pushBtn)

        actions.appendChild(fdEl(doc, 'span', 'fd-hint', entry.rerollHint || '直接点「重新生成正文」将强制复用原骰点'))
      } else {
        actions.appendChild(fdEl(doc, 'span', 'fd-hint', entry.rerollHint || `🔒 ${rerollState.reason || '本轮骰点已锁定'}`))
      }
      panel.appendChild(actions)
    } else {
      panel.appendChild(fdEl(
        doc,
        'div',
        'fd-hint',
        setupReason
          ? '请前往酒馆「设置 › 叙事阻尼器」填写决策模型与 API Key，配好后即可自动定难并投掷真骰。'
          : ((judged && judged.reason) || '本轮行动无显著不确定性，免于投骰。')
      ))
    }

    panelSlot.appendChild(panel)
  }

  function loadEntry(entry) {
    if (disposed) return
    if (entry.retryTimer) {
      clearTimeout(entry.retryTimer)
      entry.retryTimer = 0
    }
    const reqSeq = (entry.reqSeq || 0) + 1
    entry.reqSeq = reqSeq
    fdCall(ui, FD_RPC.readTurn, {
      gameId: fdGetActiveGameId(),
      turn: entry.turn,
      streaming: Boolean(entry.streaming)
    }).then(res => {
      if (disposed || entry.disposed || entry.reqSeq !== reqSeq) return
      const data = res && res.ok ? res.data : null
      if (data && data.gameId) fdNoteActiveGameId(String(data.gameId))
      entry.record = data && typeof data === 'object' ? data : null
      renderEntry(entry)
      const awaitingLive = Boolean(entry.streaming && (!entry.record || entry.record.streaming !== true))
      if (awaitingLive && (entry.retryCount || 0) < 40) {
        entry.retryCount = (entry.retryCount || 0) + 1
        entry.retryTimer = setTimeout(() => loadEntry(entry), 500)
      }
    })
  }

  const scan = () => {
    rafId = 0
    if (disposed) return
    const urlId = fdDetectUrlGameId()
    if (urlId) fdNoteActiveGameId(urlId)

    const seenArticles = new Set()
    const articles = doc.querySelectorAll('article.dsh-tavern-story-floor')
    for (let i = 0; i < articles.length; i++) {
      const article = articles[i]
      if (article.hasAttribute('data-greeting') || article.hasAttribute('data-story-held')) continue
      const head = article.querySelector('.dsh-tavern-story-floor-head')
      if (!head || head.parentNode !== article) continue
      const turn = fdExtractFloorTurn(article)
      const streaming = article.classList.contains('dsh-tavern-story-streaming')
      if (turn <= 0 && !streaming) continue

      seenArticles.add(article)
      let entry = entries.get(article)
      if (!entry || entry.head !== head) {
        if (entry) {
          entry.disposed = true
          if (entry.retryTimer) clearTimeout(entry.retryTimer)
          clearMountedKey(entry)
          try { if (entry.headSlot.parentNode) entry.headSlot.parentNode.removeChild(entry.headSlot) } catch {}
          try { if (entry.panelSlot.parentNode) entry.panelSlot.parentNode.removeChild(entry.panelSlot) } catch {}
        }
        const headSlot = fdEl(doc, 'span', 'fd-floor-head-slot')
        const panelSlot = fdEl(doc, 'div', 'fd-floor-panel-slot')
        head.appendChild(headSlot)
        head.appendChild(panelSlot)
        entry = {
          head,
          headSlot,
          panelSlot,
          turn,
          streaming,
          record: null,
          expanded: false,
          peeked: false,
          rerolling: false,
          rerollHint: '',
          mountedKey: '',
          retryCount: 0,
          retryTimer: 0,
          reqSeq: 0,
          disposed: false
        }
        entries.set(article, entry)
        loadEntry(entry)
      } else {
        const changed = entry.turn !== turn || entry.streaming !== streaming
        entry.turn = turn
        entry.streaming = streaming
        if (entry.headSlot.parentNode !== head) head.appendChild(entry.headSlot)
        if (entry.panelSlot.parentNode !== head) head.appendChild(entry.panelSlot)
        else if (head.lastElementChild !== entry.panelSlot) {
          head.appendChild(entry.headSlot)
          head.appendChild(entry.panelSlot)
        }
        if (changed) {
          entry.retryCount = 0
          loadEntry(entry)
        }
      }
    }

    entries.forEach((entry, article) => {
      if (!seenArticles.has(article)) {
        entry.disposed = true
        if (entry.retryTimer) clearTimeout(entry.retryTimer)
        clearMountedKey(entry)
        try { if (entry.headSlot.parentNode) entry.headSlot.parentNode.removeChild(entry.headSlot) } catch {}
        try { if (entry.panelSlot.parentNode) entry.panelSlot.parentNode.removeChild(entry.panelSlot) } catch {}
        entries.delete(article)
      }
    })
  }

  const schedule = () => {
    if (rafId || disposed) return
    rafId = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(scan) : setTimeout(scan, 16)
  }

  scan()
  const observer = new MutationObserver(mutations => {
    for (let i = 0; i < mutations.length; i++) {
      const t = mutations[i].target
      if (t && t.closest && (t.closest('.fd-floor-head-slot') || t.closest('.fd-floor-panel-slot'))) continue
      schedule()
      break
    }
  })
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-legacy-turn', 'data-row-key', 'data-story-held', 'class']
  })

  return () => {
    disposed = true
    observer.disconnect()
    offGameSub()
    stopWatches()
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('dsh-tavern-session-changed', onTavernWindowSession)
      window.removeEventListener('dsh-tavern-story-mutated', onTavernWindowSession)
      window.removeEventListener('dsh-tavern-message-rendered', onTavernWindowSession)
    }
    if (rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
    entries.forEach(entry => {
      entry.disposed = true
      if (entry.retryTimer) clearTimeout(entry.retryTimer)
      clearMountedKey(entry)
      try { if (entry.headSlot.parentNode) entry.headSlot.parentNode.removeChild(entry.headSlot) } catch {}
      try { if (entry.panelSlot.parentNode) entry.panelSlot.parentNode.removeChild(entry.panelSlot) } catch {}
    })
    entries.clear()
  }
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
  const fate = fdNormalizeFate(current.fate)
  const stats = current.stats || { total: 0, good: 0, bad: 0 }
  const recent = (current.recent || []).slice(0, 5)

  return h('div', { className: 'fd-root fd-status' },
    h('div', { className: 'fd-badge-row' },
      h(FdBadge, { tone: judgeReady ? 'ok' : 'warn' },
        judgeReady
          ? `⚡ 决策模型 ${current.judgeStatus.provider || '就绪'}`
          : '⚠️ 待配决策模型'),
      h(FdBadge, { tone: current.damper && current.damper.linkage ? 'ok' : 'off' },
        current.damper && current.damper.linkage ? '⛓ 阻尼联动' : '⛓ 阻尼未联动'),
      h(FdBadge, { tone: fate.points > 0 ? 'ok' : 'warn' }, `✦ 命运点 ${fate.points}/${fate.max}`)),
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
