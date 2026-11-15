/* ------------------------------------------------------------------ *
 * main.js —— 挂载点注册（工作台面板 / 输入栏揭晓条 / 楼层胶囊 / 状态分节）与导出
 * 所有 register* 均包在 try/catch 内：任一宿主版本缺失接口都不会阻断页面加载
 * ------------------------------------------------------------------ */

function FateDicePanel(props) {
  const { ui, gameId } = props || {}
  return h(WorkbenchPanel, { ui, gameId })
}

function fdRegisterSafely(ctx, label, factory) {
  try {
    const disposable = factory()
    if (typeof disposable === 'function' && ctx && typeof ctx.effect === 'function') {
      try {
        ctx.effect(() => disposable, label)
      } catch {}
    }
    return disposable
  } catch (error) {
    fdSafe(() => console.warn('[dsh-tavern-fate-dice] 挂载点注册失败：' + label, error && error.message))
    return null
  }
}

function apply(ctx) {
  const ui = ctx && ctx.tavernUi
  if (!ui) return
  fdEnsureStyleInjected()

  // 1) 右侧栏「插件」卡片区：常驻双页签极简工作台（桌面与手机竖屏单列自适应）
  fdRegisterSafely(ctx, 'fate-dice: workbench panel', () => ui.registerPanel({
    id: FD_PANEL_ID,
    title: '命运之骰',
    render: ({ gameId } = {}) => h(FateDicePanel, { ui, gameId })
  }))

  // 2) 输入栏上方非阻塞揭晓条：检定骰多面体揭晓，平时零占位
  fdRegisterSafely(ctx, 'fate-dice: composer slot', () => ui.registerComposerSlot({
    id: 'fate-dice-live',
    modes: ['play'],
    render: ({ sessionId, gameId } = {}) => h(ComposerLiveDock, { ui, sessionId: sessionId || gameId, gameId })
  }))

  // 3) 楼层折叠胶囊：无检定时原样返回 children（零包裹）
  fdRegisterSafely(ctx, 'fate-dice: turn view', () => ui.registerTurnView({
    id: 'fate-dice-turn',
    label: '检定胶囊',
    render: ({ gameId, turn, settled, greeting, children } = {}) => {
      if (!settled || greeting || !turn) return children || null
      return h(TurnRollCapsule, { ui, gameId, turn, children })
    }
  }))

  // 4) 酒馆状态页精简状态卡
  fdRegisterSafely(ctx, 'fate-dice: status section', () => ui.registerStatusSection({
    id: 'fate-dice-status',
    title: '命运之骰检定',
    render: ({ gameId } = {}) => h(StatusDiceSection, { ui, gameId })
  }))
}

exports.name = FD_PLUGIN_ID
exports.inject = ['tavernUi']
exports.apply = apply
exports.WorkbenchPanel = WorkbenchPanel
exports.__test = { DieGlyph, formatRollSummary, LiveRollBanner, TurnRollCapsule, WorkbenchPanel, DecisionModelGuideBanner, FdHelp }
