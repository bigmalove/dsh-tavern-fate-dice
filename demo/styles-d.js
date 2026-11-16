// ============================================================================
// demo/styles-d.js — 视觉风格分片 D：
// 7. eldritch（深渊诡秘暗骰 — 契合 CoC d100 / 暗骰封印揭晓）
// 8. arcade  （街机像素爆燃 — 1/3 低分辨率像素缓冲 + Hit-Stop 打击顿帧）
// 全热路径零大对象分配，styleFace 原地修改并返回 info.out。
// ============================================================================

const TAU = Math.PI * 2

// 预制色彩表，避免字符串拼接垃圾回收压力
const ELDRITCH_SHADES = [
  '#0d191b', '#102124', '#142b2e', '#19363a',
  '#1e4246', '#244e52', '#2b5b5f', '#346a6d'
]

const ARCADE_PALETTES = {
  normal: ['#1b1f4a', '#28357a', '#3a56b4', '#5282e8', '#7eb0ff'],
  critical: ['#592300', '#964200', '#d46e00', '#ffaa00', '#ffe866'],
  fumble: ['#2e0b1f', '#571236', '#8a1c50', '#c42b6e', '#ff5992'],
  costly: ['#3b2108', '#6b3b0e', '#a35b15', '#dc851f', '#ffb84d']
}

const ARCADE_WORDS_BOUNCE = ['CLACK!', 'BAM!', 'POW!', 'TAK!']
const ARCADE_WORDS_TIER = {
  critical: '★ SUPER CRIT! ★',
  success: 'CLEAR! GOOD!',
  costly: 'GRAZE! HIT!',
  failure: 'MISS...',
  fumble: '× KO FUMBLE! ×'
}

// ---------------------------------------------------------------------------
// 风格 7：深渊诡秘暗骰 (Eldritch Void & Sanity)
// ---------------------------------------------------------------------------
const eldritchStyle = {
  id: 'eldritch',
  name: '深渊诡秘暗骰',
  subtitle: 'Eldritch Abyss',
  badge: '👁️ 诡秘暗骰',
  desc: '幽邃星渊漩涡与非欧符文触须，古骨青玉骰配诡秘全视之眼暗骰封印与理智震荡波。',
  accent: '#39d8b4',
  bgPreview: 'radial-gradient(circle at 30% 25%, #1c534e 0%, #16182e 55%, #070810 100%)',
  soundPreset: 'eldritch',

  init(_ctx, W, H, state) {
    const spores = new Float32Array(36 * 4) // x, y, speed, phase
    for (let i = 0; i < 36; i++) {
      const o = i * 4
      spores[o] = (Math.random() - 0.5) * W * 0.92
      spores[o + 1] = (Math.random() - 0.5) * H * 0.88
      spores[o + 2] = 6 + Math.random() * 16
      spores[o + 3] = Math.random() * TAU
    }
    const ripples = new Float32Array(12 * 4) // x, y, age, maxAge (maxAge=0 inactive)
    state.custom.spores = spores
    state.custom.ripples = ripples
    state.custom.rippleCursor = 0
    state.custom.sanityPulse = 0
  },

  drawBackground(ctx, W, H, time, state, helpers) {
    if (!state.custom.spores) this.init(ctx, W, H, state)
    const cx = W * 0.5
    const cy = H * 0.5
    const maxR = Math.hypot(W, H) * 0.62

    // 深海幽渊渐变底
    const bg = ctx.createRadialGradient(cx, cy, maxR * 0.04, cx, cy, maxR)
    bg.addColorStop(0, state.tier === 'fumble' && state.settled ? '#23102c' : '#102a2d')
    bg.addColorStop(0.52, '#0b1422')
    bg.addColorStop(1, '#04060c')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)

    // 非欧几里得星渊几何漩涡环
    ctx.save()
    ctx.translate(cx, cy)
    const baseR = Math.min(W, H) * 0.34
    const spin = time * 0.22

    ctx.strokeStyle = 'rgba(57, 216, 180, 0.13)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(0, 0, baseR, 0, TAU)
    ctx.arc(0, 0, baseR * 0.72, 0, TAU)
    ctx.stroke()

    // 七芒异界对称秘印折线
    ctx.save()
    ctx.rotate(spin)
    ctx.strokeStyle = state.settled && state.tier === 'fumble'
      ? 'rgba(196, 82, 255, 0.28)'
      : 'rgba(57, 216, 180, 0.16)'
    ctx.lineWidth = 1.15
    ctx.beginPath()
    const pts = 7
    for (let i = 0; i <= pts * 2; i++) {
      const idx = (i * 3) % pts
      const a = (idx * TAU) / pts
      const r = i % 2 === 0 ? baseR * 0.96 : baseR * 0.44
      const px = Math.cos(a) * r
      const py = Math.sin(a) * r * 0.84
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    ctx.restore()

    // 缓缓蠕动的深渊触须弧线
    const tendrilCount = 6
    ctx.lineWidth = 1.6
    ctx.strokeStyle = 'rgba(118, 76, 212, 0.16)'
    for (let k = 0; k < tendrilCount; k++) {
      const baseAngle = (k * TAU) / tendrilCount - spin * 0.65
      ctx.beginPath()
      for (let s = 0; s <= 10; s++) {
        const t = s / 10
        const r = baseR * (0.28 + t * 0.85)
        const wave = Math.sin(time * 2.1 + k * 1.3 + t * 4.5) * 0.18
        const x = Math.cos(baseAngle + wave) * r
        const y = Math.sin(baseAngle + wave) * r * 0.82
        if (s === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.restore()

    // 落地深渊涟漪（在桌面上渲染）
    const ripples = state.custom.ripples
    for (let i = 0; i < 12; i++) {
      const o = i * 4
      const maxAge = ripples[o + 3]
      if (maxAge <= 0) continue
      const age = time - ripples[o + 2]
      if (age < 0 || age > maxAge) {
        ripples[o + 3] = 0
        continue
      }
      const p = age / maxAge
      const { sx, sy, scale } = helpers.project(ripples[o], ripples[o + 1], 0)
      const rad = (14 + p * 68) * scale
      ctx.save()
      ctx.strokeStyle = `rgba(57, 216, 180, ${(1 - p) * 0.42})`
      ctx.lineWidth = 1.8 * (1 - p * 0.5)
      ctx.beginPath()
      ctx.ellipse(sx, sy, rad, rad * 0.78, 0, 0, TAU)
      ctx.stroke()
      ctx.restore()
    }

    // 幽光孢子浮游
    const spores = state.custom.spores
    ctx.fillStyle = 'rgba(104, 247, 210, 0.28)'
    for (let i = 0; i < 36; i++) {
      const o = i * 4
      const x = cx + spores[o] + Math.sin(time * 0.8 + spores[o + 3]) * 12
      const y = ((cy + spores[o + 1] - time * spores[o + 2]) % H + H) % H
      const r = 1.1 + 0.8 * Math.sin(time * 2.4 + spores[o + 3])
      ctx.beginPath()
      ctx.arc(x, y, r, 0, TAU)
      ctx.fill()
    }
  },

  onBounce(impact, state, helpers) {
    const ripples = state.custom.ripples
    if (ripples) {
      const c = (state.custom.rippleCursor || 0) % 12
      state.custom.rippleCursor = c + 1
      const o = c * 4
      ripples[o] = impact.x
      ripples[o + 1] = impact.y
      ripples[o + 2] = state.rollTime
      ripples[o + 3] = 0.65
    }
    const count = state.quality === 'lite' ? 3 : state.quality === 'balanced' ? 6 : 10
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * TAU
      const spd = (28 + Math.random() * 85) * impact.strength
      const isViolet = (i & 1) === 0
      helpers.spawnParticle({
        x: impact.x,
        y: impact.y,
        z: 4,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        vz: 24 + Math.random() * 68 * impact.strength,
        size: 3.5 + Math.random() * 3,
        endSize: 0.4,
        life: 0.42 + Math.random() * 0.35,
        r: isViolet ? 162 : 57,
        g: isViolet ? 92 : 228,
        b: isViolet ? 255 : 186,
        a: 0.82,
        gravity: 90,
        drag: 2.2,
        blend: 'lighter',
        shape: 'circle'
      })
    }
  },

  onSettle(outcome, state, helpers) {
    state.custom.sanityPulse = 1
    const isCrit = outcome.tier === 'critical'
    const isFumble = outcome.tier === 'fumble'
    if (!isCrit && !isFumble && state.mode !== 'hidden') return

    for (let d = 0; d < state.dice.length; d++) {
      const die = state.dice[d]
      helpers.spawnShockwave(
        die.x,
        die.y,
        isCrit ? 150 : 130,
        0.85,
        isCrit ? '#48ffd5' : '#b84dff',
        isCrit ? 3.2 : 2.6
      )
      const pCount = state.quality === 'lite' ? 10 : 26
      for (let i = 0; i < pCount; i++) {
        const a = (i / pCount) * TAU + Math.random() * 0.2
        const v = 55 + Math.random() * 140
        helpers.spawnParticle({
          x: die.x,
          y: die.y,
          z: 14,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          vz: 45 + Math.random() * 120,
          size: 4.5,
          endSize: 0.5,
          life: 0.65 + Math.random() * 0.45,
          r: isCrit ? 72 : 188,
          g: isCrit ? 255 : 66,
          b: isCrit ? 213 : 255,
          a: 0.92,
          gravity: 80,
          drag: 1.8,
          blend: 'lighter',
          shape: isCrit ? 'spark' : 'shard'
        })
      }
    }
  },

  drawDieTrail(ctx, die, time, _state, helpers) {
    if (die.trailCount < 2) return
    ctx.save()
    ctx.lineCap = 'round'
    for (let i = 0; i < die.trailCount - 1; i++) {
      const idxA = (die.trailHead - i + 24) % 24
      const idxB = (die.trailHead - i - 1 + 24) % 24
      const pA = helpers.project(die.trailX[idxA], die.trailY[idxA], die.trailZ[idxA])
      const ax = pA.sx, ay = pA.sy, as = pA.scale
      const pB = helpers.project(die.trailX[idxB], die.trailY[idxB], die.trailZ[idxB])
      const bx = pB.sx, by = pB.sy
      const ratio = 1 - i / die.trailCount
      const wob = Math.sin(time * 12 + i * 0.7 + die.index) * 2.5 * (1 - ratio)
      ctx.strokeStyle = i % 2 === 0
        ? `rgba(57, 216, 180, ${ratio * 0.48})`
        : `rgba(148, 88, 255, ${ratio * 0.42})`
      ctx.lineWidth = Math.max(1, die.radius * 0.55 * ratio * as)
      ctx.beginPath()
      ctx.moveTo(ax, ay)
      ctx.lineTo(bx + wob, by - wob * 0.6)
      ctx.stroke()
    }
    ctx.restore()
  },

  styleFace(info, _state, helpers) {
    const out = info.out
    const shadeIdx = helpers.clamp(Math.floor(info.lightDot * 7.99), 0, 7)
    out.fill = ELDRITCH_SHADES[shadeIdx]
    const isCritTop = info.settled && info.isTopFace && info.tier === 'critical'
    const isFumbleTop = info.settled && info.isTopFace && info.tier === 'fumble'

    if (isCritTop) {
      out.stroke = '#6bffdf'
      out.lineWidth = 2.2
      out.textFill = '#a8ffec'
      out.glowColor = '#39d8b4'
      out.glowBlur = 14
    } else if (isFumbleTop) {
      out.stroke = '#d06bff'
      out.lineWidth = 2.2
      out.textFill = '#f0b3ff'
      out.glowColor = '#b43cff'
      out.glowBlur = 14
    } else {
      out.stroke = info.isTopFace ? '#39d8b4' : 'rgba(69, 189, 170, 0.52)'
      out.lineWidth = info.isTopFace ? 1.6 : 1.1
      out.textFill = info.hidden ? '#9d7aff' : '#80f5d9'
      out.glowColor = ''
      out.glowBlur = 0
    }
    out.textShadow = ''
    out.sheenAlpha = info.lightDot > 0.78 ? (info.lightDot - 0.78) * 0.5 : 0
    return out
  },

  drawFaceOverlay(ctx, cx, cy, radius, _verts2D, _vertCount, info) {
    if (radius < 9) return
    ctx.save()
    ctx.strokeStyle = info.isTopFace ? 'rgba(104, 247, 210, 0.28)' : 'rgba(92, 168, 160, 0.14)'
    ctx.lineWidth = 0.9
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.62, 0, TAU)
    ctx.stroke()
    ctx.restore()
  },

  drawForeground(ctx, W, H, time, state, helpers) {
    // 暗骰未揭晓：在每颗落定骰子正上方悬浮呼吸眨动的“全视秘眼”封印
    if (state.mode === 'hidden' && !state.revealed && state.settled) {
      ctx.save()
      for (let i = 0; i < state.dice.length; i++) {
        const die = state.dice[i]
        const { sx, sy, scale } = helpers.project(die.x, die.y, die.radius * 1.9)
        const r = die.radius * 0.92 * scale
        const blink = 0.25 + 0.75 * Math.abs(Math.sin(time * 1.9 + i))

        ctx.strokeStyle = 'rgba(166, 115, 255, 0.85)'
        ctx.fillStyle = 'rgba(14, 10, 28, 0.82)'
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.moveTo(sx - r, sy)
        ctx.quadraticCurveTo(sx, sy - r * 0.78 * blink, sx + r, sy)
        ctx.quadraticCurveTo(sx, sy + r * 0.78 * blink, sx - r, sy)
        ctx.fill()
        ctx.stroke()

        // 竖瞳
        ctx.fillStyle = '#39d8b4'
        ctx.beginPath()
        ctx.ellipse(sx, sy, r * 0.16, r * 0.44 * blink, 0, 0, TAU)
        ctx.fill()
      }
      ctx.restore()
    }

    // 大失败 SAN 值震荡暗紫侵蚀暗角
    if (state.settled && state.tier === 'fumble' && state.settleTime < 2.0) {
      const fade = 1 - state.settleTime / 2.0
      const g = ctx.createRadialGradient(W * 0.5, H * 0.5, Math.min(W, H) * 0.25, W * 0.5, H * 0.5, Math.hypot(W, H) * 0.55)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, `rgba(142, 28, 210, ${fade * 0.34})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }
  },

  hasActiveFX(state) {
    if (state.mode === 'hidden' && !state.revealed && state.settleTime < 2.8) return true
    return state.settleTime < 2.1
  }
}

// ---------------------------------------------------------------------------
// 风格 8：街机像素爆燃 (Retro 16-Bit Pixel Hit-Stop)
// ---------------------------------------------------------------------------
const arcadeStyle = {
  id: 'arcade',
  name: '街机像素爆燃',
  subtitle: '16-Bit Hit-Stop',
  badge: '🕹️ 街机暴击',
  desc: '原生 1/3 像素缓冲硬边放大（省 88% 填充率）+ 格斗卡肉顿帧 Hit-Stop + 像素拟声爆字！',
  accent: '#ffbe0b',
  bgPreview: 'linear-gradient(135deg, #240046 0%, #5a189a 52%, #ff6d00 100%)',
  soundPreset: 'arcade',
  pixelScale: 3,
  hitStopFrames: 3,

  init(_ctx, _W, _H, state) {
    // 预分配 8 个漫画像素弹字槽位：x, y, birth, wordIdx, active
    state.custom.popups = new Float32Array(8 * 5)
    state.custom.popupCursor = 0
    state.custom.flashFrames = 0
  },

  drawBackground(ctx, W, H, time, state) {
    if (!state.custom.popups) this.init(ctx, W, H, state)
    ctx.imageSmoothingEnabled = false

    // 街机复古天幕与地平线棋盘格
    ctx.fillStyle = '#120826'
    ctx.fillRect(0, 0, W, H)

    // 远景像素星点（确定性整数取整）
    ctx.fillStyle = '#5e4ae3'
    const step = Math.max(28, Math.floor(W / 14))
    for (let x = 14; x < W; x += step) {
      const y = ((x * 37) % Math.max(40, Math.floor(H * 0.42)))
      ctx.fillRect(x | 0, y | 0, 3, 3)
    }

    // 街机格斗透视地板双色砖块
    const horizon = Math.floor(H * 0.24)
    const rows = 7
    for (let r = 0; r < rows; r++) {
      const t0 = r / rows
      const t1 = (r + 1) / rows
      const y0 = Math.floor(horizon + (H - horizon) * (t0 * t0))
      const y1 = Math.floor(horizon + (H - horizon) * (t1 * t1))
      const cols = 8
      for (let c = -cols; c < cols; c++) {
        const isAlt = ((r + c) & 1) === 0
        ctx.fillStyle = isAlt ? '#211042' : '#180a30'
        const spread0 = 0.45 + t0 * 0.95
        const spread1 = 0.45 + t1 * 0.95
        const cx = W * 0.5
        const colW = W / 10
        ctx.beginPath()
        ctx.moveTo((cx + c * colW * spread0) | 0, y0)
        ctx.lineTo((cx + (c + 1) * colW * spread0) | 0, y0)
        ctx.lineTo((cx + (c + 1) * colW * spread1) | 0, y1)
        ctx.lineTo((cx + c * colW * spread1) | 0, y1)
        ctx.closePath()
        ctx.fill()
      }
    }

    // 街机灯箱像素跑马灯边框
    const isCrit = state.settled && state.tier === 'critical'
    const borderCol = isCrit
      ? ((Math.floor(time * 14) & 1) ? '#ffbe0b' : '#ff006e')
      : '#3a86ff'
    ctx.strokeStyle = borderCol
    ctx.lineWidth = 4
    ctx.strokeRect(4, 4, W - 8, H - 8)
  },

  onBounce(impact, state, helpers) {
    if (impact.strength > 0.32 && state.custom.popups) {
      const idx = (state.custom.popupCursor || 0) % 8
      state.custom.popupCursor = idx + 1
      const o = idx * 5
      state.custom.popups[o] = impact.x
      state.custom.popups[o + 1] = impact.y
      state.custom.popups[o + 2] = state.rollTime
      state.custom.popups[o + 3] = idx % ARCADE_WORDS_BOUNCE.length
      state.custom.popups[o + 4] = 1
    }

    const count = state.quality === 'lite' ? 4 : 9
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + (impact.bounceIndex || 0)
      const spd = (45 + (i % 3) * 42) * impact.strength
      const warm = (i & 1) === 0
      helpers.spawnParticle({
        x: impact.x,
        y: impact.y,
        z: 6,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        vz: 45 + (i % 4) * 28,
        size: 6,
        endSize: 3,
        life: 0.34,
        r: warm ? 255 : 0,
        g: warm ? 190 : 245,
        b: warm ? 11 : 212,
        a: 1,
        gravity: 280,
        drag: 0.8,
        blend: 'source-over',
        shape: 'square'
      })
    }
  },

  onSettle(outcome, state, helpers) {
    if (outcome.tier === 'critical' || outcome.tier === 'fumble') {
      state.custom.flashFrames = 2
    }
    for (let d = 0; d < state.dice.length; d++) {
      const die = state.dice[d]
      const count = state.quality === 'lite' ? 8 : 18
      for (let i = 0; i < count; i++) {
        const a = (i / count) * TAU
        const v = 70 + (i % 3) * 55
        const isCrit = outcome.tier === 'critical'
        helpers.spawnParticle({
          x: die.x,
          y: die.y,
          z: 12,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          vz: 80 + (i % 4) * 35,
          size: 7,
          endSize: 3,
          life: 0.5,
          r: isCrit ? 255 : 255,
          g: isCrit ? 214 : 56,
          b: isCrit ? 10 : 100,
          a: 1,
          gravity: 310,
          drag: 0.9,
          blend: 'source-over',
          shape: 'square'
        })
      }
    }
  },

  drawDieTrail(ctx, die, _time, _state, helpers) {
    if (die.trailCount < 3) return
    ctx.save()
    // 街机硬边离散残影方块（每 3 帧取一格）
    for (let i = 2; i < die.trailCount; i += 3) {
      const idx = (die.trailHead - i + 24) % 24
      const { sx, sy, scale } = helpers.project(die.trailX[idx], die.trailY[idx], die.trailZ[idx])
      const sz = Math.max(4, ((die.radius * (1 - i / die.trailCount) * scale) | 0))
      ctx.fillStyle = i < 8 ? 'rgba(0, 245, 212, 0.55)' : 'rgba(255, 0, 110, 0.38)'
      ctx.fillRect((sx - sz * 0.5) | 0, (sy - sz * 0.5) | 0, sz, sz)
    }
    ctx.restore()
  },

  styleFace(info, _state, helpers) {
    const out = info.out
    let pal = ARCADE_PALETTES.normal
    if (info.settled) {
      if (info.tier === 'critical') pal = ARCADE_PALETTES.critical
      else if (info.tier === 'fumble') pal = ARCADE_PALETTES.fumble
      else if (info.tier === 'costly') pal = ARCADE_PALETTES.costly
    }
    // 硬边 5 阶色板量化，杜绝线性柔糊，呈现纯正像素光影
    const band = helpers.clamp(Math.floor(info.lightDot * 4.99), 0, 4)
    out.fill = pal[band]
    out.stroke = info.isTopFace && info.settled ? '#ffffff' : '#090414'
    out.lineWidth = info.isTopFace ? 2.4 : 1.8
    out.textFill = info.settled && info.tier === 'critical' ? '#fffbe6' : '#ffffff'
    out.textShadow = ''
    out.glowColor = ''
    out.glowBlur = 0
    out.sheenAlpha = 0
    return out
  },

  drawFaceOverlay(ctx, cx, cy, radius, _verts2D, _vertCount, info) {
    if (radius < 10 || info.lightDot < 0.65) return
    // 像素阶梯高光块
    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    const s = Math.max(3, (radius * 0.16) | 0)
    ctx.fillRect((cx - radius * 0.36) | 0, (cy - radius * 0.36) | 0, s, s)
  },

  drawForeground(ctx, W, H, _time, state, helpers) {
    if (state.custom.flashFrames > 0) {
      state.custom.flashFrames--
      ctx.fillStyle = state.tier === 'critical' ? 'rgba(255, 230, 100, 0.45)' : 'rgba(255, 40, 100, 0.4)'
      ctx.fillRect(0, 0, W, H)
    }

    // 弹跳漫画拟声词标签
    const popups = state.custom.popups
    if (popups) {
      ctx.save()
      ctx.font = '900 13px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'center'
      for (let i = 0; i < 8; i++) {
        const o = i * 5
        if (popups[o + 4] <= 0) continue
        const age = state.rollTime - popups[o + 2]
        if (age < 0 || age > 0.46) {
          popups[o + 4] = 0
          continue
        }
        const { sx, sy } = helpers.project(popups[o], popups[o + 1], 24 + age * 65)
        const word = ARCADE_WORDS_BOUNCE[popups[o + 3] | 0] || 'POW!'
        ctx.fillStyle = '#090414'
        ctx.fillText(word, (sx | 0) + 2, (sy | 0) + 2)
        ctx.fillStyle = '#ffbe0b'
        ctx.fillText(word, sx | 0, sy | 0)
      }
      ctx.restore()
    }

    // 结算顶部像素横幅
    if (state.settled && state.settleTime < 1.9) {
      const banner = ARCADE_WORDS_TIER[state.tier] || 'ROLL SET!'
      const bounceY = state.settleTime < 0.16
        ? Math.sin((state.settleTime / 0.16) * Math.PI * 0.5) * 28
        : 28
      const bw = Math.min(W - 24, 230)
      const bx = ((W - bw) * 0.5) | 0
      const by = (bounceY | 0)

      ctx.save()
      ctx.fillStyle = '#090414'
      ctx.fillRect(bx + 4, by + 4, bw, 30)
      ctx.fillStyle = state.tier === 'critical'
        ? '#ffbe0b'
        : state.tier === 'fumble'
          ? '#ff006e'
          : '#3a86ff'
      ctx.fillRect(bx, by, bw, 30)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.strokeRect(bx + 2, by + 2, bw - 4, 26)

      ctx.font = '900 14px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = state.tier === 'critical' ? '#190a28' : '#ffffff'
      ctx.fillText(banner, (W * 0.5) | 0, by + 16)
      ctx.restore()
    }
  },

  hasActiveFX(state) {
    return state.settleTime < 1.95
  }
}

export const STYLES = [eldritchStyle, arcadeStyle]
