// ============================================================================
// demo/app.js — 命运之骰 8 大高性能投掷动画交互工坊主控逻辑
// 涵盖三大视图：1) 主舞台沉浸工坊  2) 酒馆聊天流实景内嵌预览  3) 八大风格同屏齐投对比矩阵
// ============================================================================

import { ProceduralDiceAudio } from './audio.js'
import { DiceStageEngine } from './engine.js'
import { STYLES as STYLES_A } from './styles-a.js'
import { STYLES as STYLES_B } from './styles-b.js'
import { STYLES as STYLES_C } from './styles-c.js'
import { STYLES as STYLES_D } from './styles-d.js'

const ALL_STYLES = [...STYLES_A, ...STYLES_B, ...STYLES_C, ...STYLES_D]

const DICE_PRESETS = [
  { id: '2d6', label: '2d6 叙事渐进', tag: '酒馆默认', desc: '双六面骰 + 能力修正' },
  { id: 'd20', label: '1d20 经典跑团', tag: 'D&D / 博德', desc: '二十面正多面体检定' },
  { id: 'd100', label: '1d100 百分双骰', tag: 'CoC 诡秘', desc: '十位(00-90) + 个位(0-9)偏方面体同投' },
  { id: 'd10', label: '1d10 轻量阶梯', tag: '酒馆内置', desc: '单颗十面五角偏方面体' },
  { id: '4df', label: '4dF 命运四骰', tag: 'FATE 核心', desc: '4 颗正负空白符号骰 (+ / − / ◯)' },
  { id: 'poly6', label: '全多面体全家福', tag: 'D4~D20', desc: 'D4+D6+D8+D10+D12+D20 六颗齐投' },
  { id: 'stress12', label: '12 颗混编齐投', tag: '多体碰撞', desc: '检验多骰空中互撞弹开与帧率稳定性' },
  { id: 'stress24', label: '24 颗极限压测', tag: '性能狂飙', desc: '满屏刚体碰撞 + 512 粒子池零 GC 压测' }
]

const TIER_META = {
  random: { label: '🎲 真随机裁定', color: '#9aa5b8' },
  critical: { label: '🌟 大成功', color: '#f5b942' },
  success: { label: '✅ 成功', color: '#38c988' },
  costly: { label: '⚠️ 代价成功', color: '#f09336' },
  failure: { label: '❌ 失败', color: '#e85d56' },
  fumble: { label: '💀 大失败', color: '#d946ef' }
}

const CHECK_NAMES = ['潜行暗杀', '奥术破译', '话术交涉', '绝壁攀援', '古神直视', '孤身破阵', '机关拆解']

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * 根据所选骰制与强制结果档位，生成契合点数的骰面数组与真实五档语义
 */
function buildRollSpec(presetId, forcedTier, mode) {
  const checkName = CHECK_NAMES[randInt(0, CHECK_NAMES.length - 1)]
  let tier = forcedTier === 'random' ? null : forcedTier
  const diceSpecs = []
  let summary = ''
  let total = 0

  if (presetId === '2d6') {
    let a = randInt(1, 6), b = randInt(1, 6)
    if (tier === 'critical') { a = 6; b = 6 }
    else if (tier === 'fumble') { a = 1; b = 1 }
    else if (tier === 'success') { a = 5; b = 4 }
    else if (tier === 'costly') { a = 4; b = 3 }
    else if (tier === 'failure') { a = 2; b = 2 }
    total = a + b
    if (!tier) {
      if (total === 12) tier = 'critical'
      else if (total === 2) tier = 'fumble'
      else if (total >= 9) tier = 'success'
      else if (total >= 7) tier = 'costly'
      else tier = 'failure'
    }
    diceSpecs.push({ meshKey: 'd6', sides: 6, targetValue: a }, { meshKey: 'd6', sides: 6, targetValue: b })
    summary = `[${a}+${b}] = ${total} (DC 8)`
  } else if (presetId === 'd20') {
    let v = randInt(1, 20)
    if (tier === 'critical') v = 20
    else if (tier === 'fumble') v = 1
    else if (tier === 'success') v = randInt(15, 19)
    else if (tier === 'costly') v = randInt(11, 14)
    else if (tier === 'failure') v = randInt(2, 9)
    total = v
    if (!tier) {
      if (v === 20) tier = 'critical'
      else if (v === 1) tier = 'fumble'
      else if (v >= 15) tier = 'success'
      else if (v >= 11) tier = 'costly'
      else tier = 'failure'
    }
    diceSpecs.push({ meshKey: 'd20', sides: 20, targetValue: v })
    summary = `1d20 = ${v} (DC 15)`
  } else if (presetId === 'd100') {
    // CoC 百分阈值：点数越小越强（1~5 大成功，96~100 大失败）
    let pct = randInt(1, 100)
    if (tier === 'critical') pct = randInt(1, 5)
    else if (tier === 'fumble') pct = randInt(96, 100)
    else if (tier === 'success') pct = randInt(6, 45)
    else if (tier === 'costly') pct = randInt(46, 65)
    else if (tier === 'failure') pct = randInt(66, 95)
    total = pct
    if (!tier) {
      if (pct <= 5) tier = 'critical'
      else if (pct >= 96) tier = 'fumble'
      else if (pct <= 45) tier = 'success'
      else if (pct <= 65) tier = 'costly'
      else tier = 'failure'
    }
    const tensVal = pct === 100 ? 0 : Math.floor(pct / 10) * 10
    const onesVal = pct === 100 ? 0 : pct % 10
    diceSpecs.push(
      { meshKey: 'd100_tens', sides: 100, targetValue: tensVal },
      { meshKey: 'd100_ones', sides: 10, targetValue: onesVal }
    )
    const tensStr = tensVal === 0 ? '00' : String(tensVal)
    summary = `[${tensStr} + ${onesVal}] = ${pct} / 阈值 55`
  } else if (presetId === 'd10') {
    let v = randInt(1, 10)
    if (tier === 'critical') v = 10
    else if (tier === 'fumble') v = 1
    else if (tier === 'success') v = randInt(7, 9)
    else if (tier === 'costly') v = randInt(5, 6)
    else if (tier === 'failure') v = randInt(2, 4)
    total = v
    if (!tier) {
      if (v === 10) tier = 'critical'
      else if (v === 1) tier = 'fumble'
      else if (v >= 7) tier = 'success'
      else if (v >= 5) tier = 'costly'
      else tier = 'failure'
    }
    diceSpecs.push({ meshKey: 'd10', sides: 10, targetValue: v })
    summary = `1d10 = ${v} (DC 7)`
  } else if (presetId === '4df') {
    let vals = [randInt(-1, 1), randInt(-1, 1), randInt(-1, 1), randInt(-1, 1)]
    if (tier === 'critical') vals = [1, 1, 1, 1]
    else if (tier === 'fumble') vals = [-1, -1, -1, -1]
    else if (tier === 'success') vals = [1, 1, 0, 1]
    else if (tier === 'costly') vals = [1, 0, 0, -1]
    else if (tier === 'failure') vals = [-1, -1, 0, 0]
    total = vals.reduce((a, b) => a + b, 0)
    if (!tier) {
      if (total >= 3) tier = 'critical'
      else if (total <= -3) tier = 'fumble'
      else if (total >= 1) tier = 'success'
      else if (total === 0) tier = 'costly'
      else tier = 'failure'
    }
    for (const v of vals) diceSpecs.push({ meshKey: 'df', sides: 6, targetValue: v })
    const sym = vals.map(v => (v > 0 ? '+' : v < 0 ? '−' : '◯')).join(' ')
    summary = `4dF [${sym}] = ${total >= 0 ? '+' + total : total}`
  } else if (presetId === 'poly6') {
    const set = [
      ['d4', 4], ['d6', 6], ['d8', 8], ['d10', 10], ['d12', 12], ['d20', 20]
    ]
    const rolled = []
    for (const [mk, maxV] of set) {
      const v = tier === 'critical' ? maxV : tier === 'fumble' ? 1 : randInt(1, maxV)
      rolled.push(v)
      total += v
      diceSpecs.push({ meshKey: mk, sides: maxV, targetValue: v })
    }
    if (!tier) tier = total >= 46 ? 'critical' : total >= 34 ? 'success' : total >= 25 ? 'costly' : 'failure'
    summary = `全多面体合击 [${rolled.join('+')}] = ${total}`
  } else {
    const count = presetId === 'stress24' ? 24 : 12
    const pool = ['d20', 'd12', 'd10', 'd8', 'd6', 'd4']
    const maxMap = { d20: 20, d12: 12, d10: 10, d8: 8, d6: 6, d4: 4 }
    for (let i = 0; i < count; i++) {
      const mk = pool[i % pool.length]
      const mv = maxMap[mk]
      const v = tier === 'critical' ? mv : tier === 'fumble' ? 1 : randInt(1, mv)
      total += v
      diceSpecs.push({ meshKey: mk, sides: mv, targetValue: v })
    }
    if (!tier) tier = 'critical'
    summary = `${count} 颗多面体齐投总计 = ${total}`
  }

  return {
    diceSpecs,
    tier,
    mode,
    total,
    checkName,
    summary
  }
}

export function bootDemoApp() {
  const audio = new ProceduralDiceAudio()

  let currentView = 'arena' // 'arena' | 'tavern' | 'matrix'
  let activeStyleIdx = 0
  let activePreset = 'd20'
  let forcedTier = 'random'
  let rollMode = 'normal' // 'normal' | 'fate' | 'push' | 'hidden'
  let quality = 'ultra'
  let usePips = false
  let tavernLightTheme = false
  let fatePoints = 2

  // 1. 挂载主舞台引擎
  const heroCanvas = document.getElementById('hero-canvas')
  const telemetryEl = document.getElementById('telemetry-pill')
  const outcomeBannerEl = document.getElementById('outcome-banner')
  const revealHintEl = document.getElementById('reveal-hint')

  let lastRollSpec = null

  const heroEngine = new DiceStageEngine(heroCanvas, {
    audio,
    onTelemetry(stat) {
      if (currentView !== 'arena') return
      if (stat.sleeping) {
        telemetryEl.innerHTML = `<span class="dot idle"></span><span>IDLE · 0% GPU 休眠省电</span><span class="sep">|</span><span>末帧 ${stat.avgMs.toFixed(2)}ms</span>`
      } else {
        telemetryEl.innerHTML = `<span class="dot live"></span><span><b>${stat.fps}</b> FPS</span><span class="sep">|</span><span>CPU <b>${stat.avgMs.toFixed(2)}</b>ms</span><span class="sep">|</span><span>粒子 <b>${stat.particles}</b></span><span class="sep">|</span><span>骰数 <b>${stat.diceCount}</b></span>`
      }
    },
    onRollSettled(state) {
      updateHeroBanner(state)
    }
  })

  // 2. 酒馆内嵌预览双引擎（输入栏微舞台横幅 + 楼层展开重投舞台）
  const tavernBannerCanvas = document.getElementById('tavern-banner-canvas')
  const tavernCapsuleCanvas = document.getElementById('tavern-capsule-canvas')
  const tavernBannerEngine = new DiceStageEngine(tavernBannerCanvas, { audio })
  const tavernCapsuleEngine = new DiceStageEngine(tavernCapsuleCanvas, {
    audio,
    onRollSettled(st) {
      updateTavernCapsuleText(st)
    }
  })

  // 3. 八大风格同屏矩阵引擎（懒初始化，切换到矩阵视图才创建并运行）
  const matrixEngines = []
  const matrixGridEl = document.getElementById('matrix-grid')

  function ensureMatrixEngines() {
    if (matrixEngines.length > 0) return
    ALL_STYLES.forEach((st, idx) => {
      const cell = document.createElement('div')
      cell.className = 'matrix-cell'
      cell.innerHTML = `
        <canvas class="matrix-canvas"></canvas>
        <div class="matrix-head">
          <span class="matrix-title">${idx + 1}. ${st.name}</span>
          <span class="matrix-badge" style="border-color:${st.accent}66;color:${st.accent}">${st.badge}</span>
        </div>
        <div class="matrix-stat" id="mstat-${st.id}">就绪</div>
      `
      const cv = cell.querySelector('canvas')
      matrixGridEl.appendChild(cell)
      const statNode = cell.querySelector('.matrix-stat')
      const eng = new DiceStageEngine(cv, {
        audio: idx === 0 ? audio : null, // 仅首格发声避免 8 倍音量叠加
        onTelemetry(info) {
          statNode.textContent = info.sleeping
            ? `💤 IDLE 0% GPU (${info.avgMs.toFixed(2)}ms)`
            : `${info.fps} FPS · ${info.avgMs.toFixed(2)}ms`
          statNode.classList.toggle('is-sleeping', info.sleeping)
        }
      })
      eng.setStyle(st)
      cell.addEventListener('click', () => {
        if (eng.state.mode === 'hidden' && !eng.state.revealed && eng.state.settled) {
          eng.revealHidden()
        } else {
          const spec = buildRollSpec(activePreset, forcedTier, rollMode)
          eng.throwDice(spec)
        }
      })
      matrixEngines.push(eng)
    })
  }

  function updateHeroBanner(state) {
    if (!lastRollSpec) return
    const isHidden = state.mode === 'hidden' && !state.revealed
    revealHintEl.hidden = !isHidden
    if (isHidden) {
      outcomeBannerEl.dataset.tier = 'hidden'
      outcomeBannerEl.innerHTML = `
        <span class="ob-check">👁️ ${lastRollSpec.checkName} · 暗骰已落定</span>
        <span class="ob-pill">点击舞台任意处揭晓真身</span>
      `
      return
    }
    const meta = TIER_META[state.tier] || TIER_META.success
    const modeChip = state.mode === 'fate'
      ? '<span class="ob-chip fate">✦ 逆命重投</span>'
      : state.mode === 'push'
        ? '<span class="ob-chip push">🔥 孤注一掷</span>'
        : '<span class="ob-chip">⛓ 阻尼联动</span>'
    outcomeBannerEl.dataset.tier = state.tier
    outcomeBannerEl.innerHTML = `
      <span class="ob-check">${lastRollSpec.checkName}检定 · <b>${lastRollSpec.summary}</b></span>
      <span class="ob-tier" style="color:${meta.color}">${meta.label}</span>
      ${modeChip}
    `
  }

  function triggerRoll() {
    const spec = buildRollSpec(activePreset, forcedTier, rollMode)
    lastRollSpec = spec
    revealHintEl.hidden = true

    if (currentView === 'arena') {
      outcomeBannerEl.dataset.tier = 'rolling'
      outcomeBannerEl.innerHTML = `<span class="ob-check">🎲 正在投掷 · ${spec.checkName}检定…</span>`
      heroEngine.throwDice(spec)
    } else if (currentView === 'tavern') {
      tavernBannerEngine.setStyle(ALL_STYLES[activeStyleIdx])
      tavernCapsuleEngine.setStyle(ALL_STYLES[activeStyleIdx])
      tavernBannerEngine.throwDice(spec)
      tavernCapsuleEngine.throwDice(spec)
      document.getElementById('tv-banner-title').textContent = `${spec.checkName}检定 · 投掷裁定中…`
      document.getElementById('tv-banner-sub').textContent = `风格：${ALL_STYLES[activeStyleIdx].name} · 规则：${activePreset.toUpperCase()}`
    } else if (currentView === 'matrix') {
      ensureMatrixEngines()
      for (const eng of matrixEngines) {
        eng.resize()
        eng.throwDice(spec)
      }
    }
  }

  function updateTavernCapsuleText(state) {
    const spec = lastRollSpec || { checkName: '潜行暗杀', summary: '1d20 = 18' }
    const meta = TIER_META[state.tier] || TIER_META.success
    document.getElementById('tv-cap-summary').innerHTML =
      `🎲 ${spec.checkName}检定 · <b>${spec.summary}</b> · <span style="color:${meta.color};font-weight:700">${meta.label}</span>`
    document.getElementById('tv-banner-title').innerHTML =
      `${spec.checkName}检定 · ${spec.summary} · <span style="color:${meta.color}">${meta.label}</span>`
    document.getElementById('tv-fate-pts').textContent = `✦ 命运点 ${fatePoints}/3`
  }

  // 渲染左侧/底部 8 大风格选择卡片
  const styleListEl = document.getElementById('style-cards')
  ALL_STYLES.forEach((st, idx) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'style-card' + (idx === activeStyleIdx ? ' is-active' : '')
    btn.style.setProperty('--card-accent', st.accent)
    btn.innerHTML = `
      <div class="sc-swatch" style="background:${st.bgPreview}">
        <span class="sc-num">${idx + 1}</span>
        <span class="sc-badge">${st.badge}</span>
      </div>
      <div class="sc-body">
        <div class="sc-title">${st.name}</div>
        <div class="sc-desc">${st.desc}</div>
      </div>
    `
    btn.addEventListener('click', () => selectStyle(idx, true))
    styleListEl.appendChild(btn)
  })

  function selectStyle(idx, autoRoll = true) {
    activeStyleIdx = (idx + ALL_STYLES.length) % ALL_STYLES.length
    const st = ALL_STYLES[activeStyleIdx]
    document.querySelectorAll('.style-card').forEach((el, i) => {
      el.classList.toggle('is-active', i === activeStyleIdx)
    })
    document.getElementById('active-style-title').textContent = `${st.name} · ${st.subtitle}`
    document.getElementById('active-style-desc').textContent = st.desc
    heroEngine.setStyle(st)
    tavernBannerEngine.setStyle(st)
    tavernCapsuleEngine.setStyle(st)
    if (autoRoll) triggerRoll()
  }

  // 渲染骰制预设按钮
  const presetBarEl = document.getElementById('preset-buttons')
  DICE_PRESETS.forEach(p => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'chip-btn' + (p.id === activePreset ? ' is-active' : '')
    b.dataset.preset = p.id
    b.title = p.desc
    b.innerHTML = `<span>${p.label}</span><small>${p.tag}</small>`
    b.addEventListener('click', () => {
      activePreset = p.id
      presetBarEl.querySelectorAll('.chip-btn').forEach(x => x.classList.toggle('is-active', x.dataset.preset === p.id))
      triggerRoll()
    })
    presetBarEl.appendChild(b)
  })

  // 渲染强制裁定档位按钮
  const tierBarEl = document.getElementById('tier-buttons')
  Object.entries(TIER_META).forEach(([key, meta]) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'pill-btn' + (key === forcedTier ? ' is-active' : '')
    b.dataset.tier = key
    b.textContent = meta.label
    b.addEventListener('click', () => {
      forcedTier = key
      tierBarEl.querySelectorAll('.pill-btn').forEach(x => x.classList.toggle('is-active', x.dataset.tier === key))
      triggerRoll()
    })
    tierBarEl.appendChild(b)
  })

  // 投掷模式切换（普通 / 逆命重投 / 孤注一掷 / 暗骰）
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      rollMode = btn.dataset.mode
      document.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('is-active', x.dataset.mode === rollMode))
      // 智能联动推荐风格（用户仍可随时切别的风格）
      if (rollMode === 'push' && currentView === 'arena') selectStyle(2, false) // magma
      else if (rollMode === 'fate' && currentView === 'arena') selectStyle(4, false) // prism
      else if (rollMode === 'hidden' && currentView === 'arena') selectStyle(6, false) // eldritch
      triggerRoll()
    })
  })

  // 三大视图切换
  document.querySelectorAll('[data-view]').forEach(tab => {
    tab.addEventListener('click', () => {
      currentView = tab.dataset.view
      document.querySelectorAll('[data-view]').forEach(t => t.classList.toggle('is-active', t.dataset.view === currentView))
      document.getElementById('view-arena').hidden = currentView !== 'arena'
      document.getElementById('view-tavern').hidden = currentView !== 'tavern'
      document.getElementById('view-matrix').hidden = currentView !== 'matrix'

      if (currentView !== 'arena') heroEngine.stop()
      if (currentView !== 'tavern') {
        tavernBannerEngine.stop()
        tavernCapsuleEngine.stop()
      }
      if (currentView !== 'matrix') {
        matrixEngines.forEach(e => e.stop())
      }

      requestAnimationFrame(() => {
        if (currentView === 'arena') {
          heroEngine.resize()
          triggerRoll()
        } else if (currentView === 'tavern') {
          tavernBannerEngine.resize()
          tavernCapsuleEngine.resize()
          triggerRoll()
        } else if (currentView === 'matrix') {
          ensureMatrixEngines()
          matrixEngines.forEach(e => e.resize())
          triggerRoll()
        }
      })
    })
  })

  // 主投掷按钮 & 舞台点击交互
  document.getElementById('btn-roll-now').addEventListener('click', () => triggerRoll())
  heroCanvas.addEventListener('click', () => {
    if (heroEngine.state.mode === 'hidden' && !heroEngine.state.revealed && heroEngine.state.settled) {
      heroEngine.revealHidden()
      updateHeroBanner(heroEngine.state)
    } else {
      triggerRoll()
    }
  })

  // 酒馆实景预览内的「✦ 逆命重投」与「🔥 孤注一掷」交互
  document.getElementById('btn-tv-fate').addEventListener('click', () => {
    if (fatePoints > 0) fatePoints--
    else fatePoints = 3
    rollMode = 'fate'
    selectStyle(4, false) // prism 星骸水晶子弹时间
    const spec = buildRollSpec(activePreset, 'critical', 'fate')
    lastRollSpec = spec
    tavernBannerEngine.throwDice(spec)
    tavernCapsuleEngine.throwDice(spec)
  })

  document.getElementById('btn-tv-push').addEventListener('click', () => {
    rollMode = 'push'
    selectStyle(2, false) // magma 炼狱熔岩锻造
    const outcome = Math.random() < 0.55 ? 'costly' : 'fumble'
    const spec = buildRollSpec(activePreset, outcome, 'push')
    lastRollSpec = spec
    tavernBannerEngine.throwDice(spec)
    tavernCapsuleEngine.throwDice(spec)
  })

  document.getElementById('btn-tv-theme').addEventListener('click', e => {
    tavernLightTheme = !tavernLightTheme
    document.getElementById('tavern-mock-shell').classList.toggle('is-light', tavernLightTheme)
    e.currentTarget.textContent = tavernLightTheme ? '🌙 切换深色酒馆' : '☀️ 切换暖白浅色酒馆'
  })

  // 顶栏工具开关：音效 / D6圆点 / 画质档位
  document.getElementById('btn-toggle-audio').addEventListener('click', e => {
    const next = !audio.enabled
    audio.setEnabled(next)
    e.currentTarget.classList.toggle('is-active', next)
    e.currentTarget.textContent = next ? '🔊 音效：开' : '🔇 音效：关'
  })

  document.getElementById('btn-toggle-pips').addEventListener('click', e => {
    usePips = !usePips
    heroEngine.setUsePipsForD6(usePips)
    tavernBannerEngine.setUsePipsForD6(usePips)
    tavernCapsuleEngine.setUsePipsForD6(usePips)
    matrixEngines.forEach(m => m.setUsePipsForD6(usePips))
    e.currentTarget.classList.toggle('is-active', usePips)
    e.currentTarget.textContent = usePips ? '⚀ D6：传统圆点' : '6 D6：现代数字'
    if (activePreset !== '2d6') {
      activePreset = '2d6'
      presetBarEl.querySelectorAll('.chip-btn').forEach(x => x.classList.toggle('is-active', x.dataset.preset === '2d6'))
    }
    triggerRoll()
  })

  document.getElementById('select-quality').addEventListener('change', e => {
    quality = e.target.value
    heroEngine.setQuality(quality)
    tavernBannerEngine.setQuality(quality)
    tavernCapsuleEngine.setQuality(quality)
    matrixEngines.forEach(m => m.setQuality(quality))
  })

  // 自适应尺寸观察器
  const ro = new ResizeObserver(() => {
    if (currentView === 'arena') heroEngine.resize()
    else if (currentView === 'tavern') {
      tavernBannerEngine.resize()
      tavernCapsuleEngine.resize()
    } else if (currentView === 'matrix') {
      matrixEngines.forEach(e => e.resize())
    }
  })
  ro.observe(heroCanvas)
  ro.observe(matrixGridEl)

  // 快捷键支持：Space 重投，数字键 1-8 秒切八大风格
  window.addEventListener('keydown', e => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return
    if (e.code === 'Space') {
      e.preventDefault()
      triggerRoll()
    } else if (e.key >= '1' && e.key <= '8') {
      selectStyle(Number(e.key) - 1, true)
    }
  })

  // 初始启动黄金秘法星盘首投！
  selectStyle(0, true)
}

bootDemoApp()
