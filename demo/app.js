// ============================================================================
// demo/app.js — 命运之骰 · 次世代 WebGL2 HDR 3D 投掷动效工坊主控逻辑
// 涵盖三大视图：
//   1. 🎭 主舞台沉浸工坊（支持按住聚能旋涡 + 任意方向划动甩投 + 弹簧推镜慢动作）
//   2. 🏮 酒馆聊天内嵌预览（楼层顶栏折叠胶囊重投舞台 + 发送栏上方 80px 微舞台）
//   3. 🚀 六大 HDR 主题同屏齐投（6 路独立 WebGL2 管线同步起跳与自动 0% GPU 休眠对比）
// ============================================================================

import { ProceduralDiceAudio } from './audio.js'
import { CinematicDiceStage, NEXTGEN_THEMES } from './physics-choreo.js'

const DICE_PRESETS = [
  { id: 'd20', label: '1d20 圣晶检定', tag: '跑团旗舰', desc: '二十面正多面体 + 皇冠 20 点雕文' },
  { id: '2d6', label: '2d6 叙事渐进', tag: '酒馆默认', desc: '双六面骰同投互撞 + 支持切换传统圆点' },
  { id: 'd100', label: '1d100 百分双骰', tag: 'CoC 诡秘', desc: '十位(00-90) + 个位(0-9)双五角偏方面体' },
  { id: 'd10', label: '1d10 技能阶梯', tag: '轻快检定', desc: '单颗十面五角偏方面体' },
  { id: '4df', label: '4dF 命运四骰', tag: 'FATE 核心', desc: '4 颗正负空白符号骰 (+ / − / ◯)' },
  { id: 'poly6', label: '全多面体合击', tag: 'D4~D20', desc: 'D4+D6+D8+D10+D12+D20 六颗同台齐投' },
  { id: 'stress12', label: '12 颗星雨齐投', tag: '多体碰撞', desc: '高密度空中互撞弹开与火星飞溅' },
  { id: 'stress24', label: '24 颗极限压测', tag: 'HDR 狂飙', desc: '24 颗倒角多面体 + 900 粒子 + 4级辉光压测' }
]

const TIER_META = {
  random: { label: '🎲 真随机裁定', color: '#a6b2c8' },
  critical: { label: '🌟 大成功', color: '#ffca4b' },
  success: { label: '✅ 成功', color: '#39df94' },
  costly: { label: '⚠️ 代价成功', color: '#ff9838' },
  failure: { label: '❌ 失败', color: '#f25c54' },
  fumble: { label: '💀 大失败', color: '#d946ef' }
}

const CHECK_NAMES = ['潜行暗杀', '星盘破译', '交涉话术', '绝壁飞渡', '古神直视', '孤身破阵', '禁咒吟唱']

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

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
    summary = `[${a} + ${b}] = ${total} (DC 8)`
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
    const set = [['d4', 4], ['d6', 6], ['d8', 8], ['d10', 10], ['d12', 12], ['d20', 20]]
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
    summary = `${count} 颗多面体星雨总计 = ${total}`
  }

  return { diceSpecs, tier, mode, total, checkName, summary }
}

export function bootDemoApp() {
  const audio = new ProceduralDiceAudio()

  let currentView = 'arena' // 'arena' | 'tavern' | 'matrix'
  let activeThemeIdx = 0
  let activePreset = 'poly6'
  let forcedTier = 'critical'
  let rollMode = 'normal'
  let quality = 'ultra'
  let usePips = false
  let cinematicCam = true
  let tavernLight = false
  let fatePoints = 2
  let lastRollSpec = null

  const telemetryEl = document.getElementById('telemetry-pill')
  const outcomeBannerEl = document.getElementById('outcome-banner')
  const revealHintEl = document.getElementById('reveal-hint')

  const makeCurrentSpec = () => {
    const spec = buildRollSpec(activePreset, forcedTier, rollMode)
    lastRollSpec = spec
    revealHintEl.hidden = true
    outcomeBannerEl.dataset.tier = 'rolling'
    outcomeBannerEl.innerHTML = `<span class="ob-check">🎲 正在裁定 · ${spec.checkName}检定…</span>`
    return spec
  }

  // 1. 初始化主舞台 WebGL2 HDR 引擎
  const heroStage = new CinematicDiceStage(
    document.getElementById('hero-gl-canvas'),
    document.getElementById('hero-hud-canvas'),
    {
      audio,
      interactive: true,
      buildSpecOnDragRelease: makeCurrentSpec,
      onTelemetry(stat) {
        if (currentView !== 'arena') return
        if (stat.sleeping) {
          telemetryEl.innerHTML = `<span class="dot idle"></span><span>IDLE · 0% GPU 静默休眠</span><span class="sep">|</span><span>末帧 ${stat.avgMs.toFixed(2)}ms</span>`
        } else {
          telemetryEl.innerHTML = `<span class="dot live"></span><span>WebGL2 HDR · <b>${stat.fps}</b> FPS</span><span class="sep">|</span><span>CPU <b>${stat.avgMs.toFixed(2)}</b>ms</span><span class="sep">|</span><span>粒子 <b>${stat.particles}</b></span><span class="sep">|</span><span>骰数 <b>${stat.diceCount}</b></span>`
        }
      },
      onRollSettled(st) {
        updateHeroBanner(st)
      }
    }
  )

  // 2. 酒馆内嵌预览双引擎（懒启动，切到酒馆标签才初始化 WebGL 上下文，节省显存）
  let tavernCapsuleStage = null
  let tavernBannerStage = null

  function ensureTavernStages() {
    if (tavernCapsuleStage) return
    tavernCapsuleStage = new CinematicDiceStage(
      document.getElementById('tavern-capsule-gl'),
      document.getElementById('tavern-capsule-hud'),
      {
        audio,
        compact: false,
        interactive: true,
        buildSpecOnDragRelease: makeCurrentSpec,
        onRollSettled(st) {
          updateTavernCapsuleText(st)
        }
      }
    )
    tavernBannerStage = new CinematicDiceStage(
      document.getElementById('tavern-banner-gl'),
      null,
      { audio: null, compact: true, interactive: false }
    )
    tavernCapsuleStage.setTheme(NEXTGEN_THEMES[activeThemeIdx])
    tavernBannerStage.setTheme(NEXTGEN_THEMES[activeThemeIdx])
    tavernCapsuleStage.setQuality(quality)
    tavernBannerStage.setQuality(quality)
    tavernCapsuleStage.setUsePipsForD6(usePips)
    tavernBannerStage.setUsePipsForD6(usePips)
  }

  // 3. 六大 HDR 主题同屏齐投矩阵（懒启动）
  const matrixStages = []
  const matrixGridEl = document.getElementById('matrix-grid')

  function ensureMatrixStages() {
    if (matrixStages.length > 0) return
    NEXTGEN_THEMES.forEach((th, idx) => {
      const cell = document.createElement('div')
      cell.className = 'matrix-cell'
      cell.innerHTML = `
        <canvas class="matrix-gl"></canvas>
        <canvas class="matrix-hud"></canvas>
        <div class="matrix-head">
          <span class="matrix-title">${idx + 1}. ${th.name}</span>
          <span class="matrix-badge" style="border-color:${th.accent}77;color:${th.accent}">${th.badge}</span>
        </div>
        <div class="matrix-stat">初始化…</div>
      `
      matrixGridEl.appendChild(cell)
      const statNode = cell.querySelector('.matrix-stat')
      const stg = new CinematicDiceStage(
        cell.querySelector('.matrix-gl'),
        cell.querySelector('.matrix-hud'),
        {
          audio: idx === 0 ? audio : null,
          compact: true,
          interactive: true,
          buildSpecOnDragRelease: () => buildRollSpec(activePreset, forcedTier, rollMode),
          onTelemetry(info) {
            statNode.textContent = info.sleeping
              ? `💤 IDLE 0% GPU (${info.avgMs.toFixed(2)}ms)`
              : `${info.fps} FPS · ${info.avgMs.toFixed(2)}ms`
            statNode.classList.toggle('is-sleeping', info.sleeping)
          }
        }
      )
      stg.setTheme(th)
      stg.setQuality(quality)
      stg.setUsePipsForD6(usePips)
      matrixStages.push(stg)
    })
  }

  function updateHeroBanner(stage) {
    if (!lastRollSpec) return
    const isHidden = stage.mode === 'hidden' && !stage.revealed
    revealHintEl.hidden = !isHidden
    if (isHidden) {
      outcomeBannerEl.dataset.tier = 'hidden'
      outcomeBannerEl.innerHTML = `
        <span class="ob-check">👁️ ${lastRollSpec.checkName} · 诡秘暗骰已落定</span>
        <span class="ob-chip">点击舞台撕裂封印揭晓</span>
      `
      return
    }
    const meta = TIER_META[stage.tier] || TIER_META.success
    const modeChip = stage.mode === 'fate'
      ? '<span class="ob-chip fate">✦ 逆命重投</span>'
      : stage.mode === 'push'
        ? '<span class="ob-chip push">🔥 孤注一掷</span>'
        : '<span class="ob-chip">⛓ 阻尼配额已同步</span>'
    outcomeBannerEl.dataset.tier = stage.tier
    outcomeBannerEl.innerHTML = `
      <span class="ob-check">${lastRollSpec.checkName}检定 · <b>${lastRollSpec.summary}</b></span>
      <span class="ob-tier" style="color:${meta.color};font-weight:800">${meta.label}</span>
      ${modeChip}
    `
  }

  function updateTavernCapsuleText(stage) {
    const spec = lastRollSpec || { checkName: '潜行暗杀', summary: '1d20 = 20' }
    const meta = TIER_META[stage.tier] || TIER_META.success
    document.getElementById('tv-cap-summary').innerHTML =
      `🎲 ${spec.checkName}检定 · <b>${spec.summary}</b> · <span style="color:${meta.color};font-weight:800">${meta.label}</span>`
    document.getElementById('tv-banner-title').innerHTML =
      `${spec.checkName}检定 · ${spec.summary} · <span style="color:${meta.color}">${meta.label}</span>`
    document.getElementById('tv-fate-pts').textContent = `✦ 命运点 ${fatePoints}/3`
  }

  function triggerRoll() {
    const spec = makeCurrentSpec()
    if (currentView === 'arena') {
      heroStage.throwDice(spec)
    } else if (currentView === 'tavern') {
      ensureTavernStages()
      tavernCapsuleStage.setTheme(NEXTGEN_THEMES[activeThemeIdx])
      tavernBannerStage.setTheme(NEXTGEN_THEMES[activeThemeIdx])
      tavernCapsuleStage.throwDice(spec)
      tavernBannerStage.throwDice(spec)
      document.getElementById('tv-banner-title').textContent = `${spec.checkName}检定 · 3D 实时裁定中…`
      document.getElementById('tv-banner-sub').textContent = `当前风格：${NEXTGEN_THEMES[activeThemeIdx].name} · 规则：${activePreset.toUpperCase()}`
    } else if (currentView === 'matrix') {
      ensureMatrixStages()
      for (const stg of matrixStages) {
        stg.resize()
        stg.throwDice(spec)
      }
    }
  }

  // 构建左侧 6 大次世代 HDR 主题卡片
  const styleCardsEl = document.getElementById('style-cards')
  NEXTGEN_THEMES.forEach((th, idx) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'style-card' + (idx === activeThemeIdx ? ' is-active' : '')
    btn.style.setProperty('--card-accent', th.accent)
    btn.innerHTML = `
      <div class="sc-swatch" style="background:${th.swatch}">
        <span class="sc-num">${idx + 1}</span>
        <span class="sc-badge">${th.badge}</span>
      </div>
      <div class="sc-body">
        <div class="sc-title">${th.name}</div>
        <div class="sc-desc">${th.desc}</div>
      </div>
    `
    btn.addEventListener('click', () => selectTheme(idx, true))
    styleCardsEl.appendChild(btn)
  })

  function selectTheme(idx, autoRoll = true) {
    activeThemeIdx = (idx + NEXTGEN_THEMES.length) % NEXTGEN_THEMES.length
    const th = NEXTGEN_THEMES[activeThemeIdx]
    document.querySelectorAll('.style-card').forEach((el, i) => {
      el.classList.toggle('is-active', i === activeThemeIdx)
    })
    document.getElementById('active-style-title').textContent = `${th.name} · ${th.subtitle}`
    document.getElementById('active-style-desc').textContent = th.desc
    heroStage.setTheme(th)
    if (tavernCapsuleStage) {
      tavernCapsuleStage.setTheme(th)
      tavernBannerStage.setTheme(th)
    }
    if (autoRoll) triggerRoll()
  }

  // 骰制按钮
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

  // 五档结果演出按钮
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

  // 酒馆博弈模式联动
  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      rollMode = btn.dataset.mode
      document.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('is-active', x.dataset.mode === rollMode))
      if (currentView === 'arena') {
        if (rollMode === 'fate') selectTheme(1, false)       // 时停棱镜
        else if (rollMode === 'push') selectTheme(2, false)  // 焚天熔炉
        else if (rollMode === 'hidden') selectTheme(5, false)// 虚空星噬
      }
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

      if (currentView !== 'arena') heroStage.stop()
      if (currentView !== 'tavern' && tavernCapsuleStage) {
        tavernCapsuleStage.stop()
        tavernBannerStage.stop()
      }
      if (currentView !== 'matrix') matrixStages.forEach(s => s.stop())

      requestAnimationFrame(() => {
        if (currentView === 'arena') {
          heroStage.resize()
          triggerRoll()
        } else if (currentView === 'tavern') {
          ensureTavernStages()
          tavernCapsuleStage.resize()
          tavernBannerStage.resize()
          triggerRoll()
        } else if (currentView === 'matrix') {
          ensureMatrixStages()
          matrixStages.forEach(s => s.resize())
          triggerRoll()
        }
      })
    })
  })

  // 通用长按按钮聚能蓄力绑定器（点按即投 · 长按蓄力旋涡 · 移出无损取消）
  function bindButtonHoldCharge(btn, { mode, getStages, onRelease }) {
    let timer = 0
    let raf = 0
    let downAt = 0
    let charging = false
    let handled = false
    const origHTML = btn.innerHTML

    const resetVisual = () => {
      if (timer) { clearTimeout(timer); timer = 0 }
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      btn.classList.remove('is-charging')
      btn.style.removeProperty('--charge-pct')
      btn.innerHTML = origHTML
    }

    btn.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return
      handled = false
      charging = false
      downAt = performance.now()
      timer = setTimeout(() => {
        charging = true
        btn.classList.add('is-charging')
        const resolvedMode = typeof mode === 'function' ? mode() : mode
        for (const stg of getStages()) stg.startButtonCharge(resolvedMode)
        const loop = () => {
          if (!charging) return
          const pct = Math.min(100, Math.max(5, Math.round(((performance.now() - downAt - 140) / 950) * 100)))
          btn.style.setProperty('--charge-pct', pct + '%')
          btn.textContent = `⚡ 蓄力 ${pct}% · 松手爆发！`
          raf = requestAnimationFrame(loop)
        }
        loop()
      }, 140)
    })

    btn.addEventListener('pointerup', () => {
      if (!downAt) return
      const elapsed = performance.now() - downAt
      downAt = 0
      handled = true
      const wasCharging = charging
      charging = false
      resetVisual()
      const power = wasCharging ? Math.min(1, Math.max(0.2, (elapsed - 140) / 950)) : 0
      onRelease(power)
    })

    const cancel = () => {
      if (!downAt && !charging) return
      downAt = 0
      const wasCharging = charging
      charging = false
      resetVisual()
      if (wasCharging) {
        for (const stg of getStages()) stg.cancelButtonCharge()
      }
    }

    btn.addEventListener('pointerleave', cancel)
    btn.addEventListener('pointercancel', cancel)
    btn.addEventListener('click', e => {
      if (handled) {
        handled = false
        e.preventDefault()
        return
      }
      onRelease(0)
    })
  }

  bindButtonHoldCharge(document.getElementById('btn-roll-now'), {
    mode: () => rollMode,
    getStages: () => {
      if (currentView === 'arena') return [heroStage]
      if (currentView === 'tavern') { ensureTavernStages(); return [tavernCapsuleStage] }
      ensureMatrixStages()
      return matrixStages
    },
    onRelease: power => {
      const spec = makeCurrentSpec()
      if (currentView === 'arena') {
        if (power > 0.1) heroStage.releaseButtonCharge(spec, power)
        else heroStage.throwDice(spec)
      } else if (currentView === 'tavern') {
        ensureTavernStages()
        if (power > 0.1) tavernCapsuleStage.releaseButtonCharge(spec, power)
        else tavernCapsuleStage.throwDice(spec)
        tavernBannerStage.throwDice(spec)
      } else {
        ensureMatrixStages()
        for (const stg of matrixStages) {
          stg.resize()
          if (power > 0.1) stg.releaseButtonCharge(spec, power)
          else stg.throwDice(spec)
        }
      }
    }
  })

  // 酒馆预览内嵌「✦ 逆命重投」与「🔥 孤注一掷」按钮长按蓄力实景交互
  bindButtonHoldCharge(document.getElementById('btn-tv-fate'), {
    mode: 'fate',
    getStages: () => { ensureTavernStages(); return [tavernCapsuleStage] },
    onRelease: power => {
      ensureTavernStages()
      fatePoints = fatePoints > 0 ? fatePoints - 1 : 3
      rollMode = 'fate'
      selectTheme(1, false)
      const spec = buildRollSpec(activePreset, 'critical', 'fate')
      lastRollSpec = spec
      if (power > 0.1) tavernCapsuleStage.releaseButtonCharge(spec, power)
      else tavernCapsuleStage.throwDice(spec)
      tavernBannerStage.throwDice(spec)
    }
  })

  bindButtonHoldCharge(document.getElementById('btn-tv-push'), {
    mode: 'push',
    getStages: () => { ensureTavernStages(); return [tavernCapsuleStage] },
    onRelease: power => {
      ensureTavernStages()
      rollMode = 'push'
      selectTheme(2, false)
      const outcome = Math.random() < 0.55 ? 'costly' : 'fumble'
      const spec = buildRollSpec(activePreset, outcome, 'push')
      lastRollSpec = spec
      if (power > 0.1) tavernCapsuleStage.releaseButtonCharge(spec, power)
      else tavernCapsuleStage.throwDice(spec)
      tavernBannerStage.throwDice(spec)
    }
  })

  document.getElementById('btn-tv-theme').addEventListener('click', e => {
    tavernLight = !tavernLight
    document.getElementById('tavern-mock-shell').classList.toggle('is-light', tavernLight)
    e.currentTarget.textContent = tavernLight ? '🌙 切换深色酒馆' : '☀️ 切换暖白浅色酒馆'
  })

  // 顶栏工具开关
  document.getElementById('btn-toggle-audio').addEventListener('click', e => {
    const next = !audio.enabled
    audio.setEnabled(next)
    e.currentTarget.classList.toggle('is-active', next)
    e.currentTarget.textContent = next ? '🔊 音效：开' : '🔇 音效：关'
  })

  document.getElementById('btn-toggle-cam').addEventListener('click', e => {
    cinematicCam = !cinematicCam
    heroStage.setCinematicCam(cinematicCam)
    e.currentTarget.classList.toggle('is-active', cinematicCam)
    e.currentTarget.textContent = cinematicCam ? '🎥 电影运镜：开' : '🎥 电影运镜：固定'
  })

  document.getElementById('btn-toggle-pips').addEventListener('click', e => {
    usePips = !usePips
    heroStage.setUsePipsForD6(usePips)
    if (tavernCapsuleStage) {
      tavernCapsuleStage.setUsePipsForD6(usePips)
      tavernBannerStage.setUsePipsForD6(usePips)
    }
    matrixStages.forEach(m => m.setUsePipsForD6(usePips))
    e.currentTarget.classList.toggle('is-active', usePips)
    e.currentTarget.textContent = usePips ? '⚀ D6：传统圆点' : '6 D6：鎏金数字'
    if (activePreset !== '2d6') {
      activePreset = '2d6'
      presetBarEl.querySelectorAll('.chip-btn').forEach(x => x.classList.toggle('is-active', x.dataset.preset === '2d6'))
    }
    triggerRoll()
  })

  document.getElementById('select-quality').addEventListener('change', e => {
    quality = e.target.value
    heroStage.setQuality(quality)
    if (tavernCapsuleStage) {
      tavernCapsuleStage.setQuality(quality)
      tavernBannerStage.setQuality(quality)
    }
    matrixStages.forEach(m => m.setQuality(quality))
  })

  const ro = new ResizeObserver(() => {
    if (currentView === 'arena') heroStage.resize()
    else if (currentView === 'tavern' && tavernCapsuleStage) {
      tavernCapsuleStage.resize()
      tavernBannerStage.resize()
    } else if (currentView === 'matrix') {
      matrixStages.forEach(m => m.resize())
    }
  })
  ro.observe(document.getElementById('hero-gl-canvas'))
  ro.observe(matrixGridEl)

  window.addEventListener('keydown', e => {
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return
    if (e.code === 'Space') {
      e.preventDefault()
      triggerRoll()
    } else if (e.key >= '1' && e.key <= '6') {
      selectTheme(Number(e.key) - 1, true)
    }
  })

  // 开场自动演示「星穹秘法 · 全多面体大成功合击」！
  selectTheme(0, true)
}

bootDemoApp()
