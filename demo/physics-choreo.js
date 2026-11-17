// ============================================================================
// demo/physics-choreo.js — 次世代 3D 投骰物理、交互蓄力甩投 & 电影级弹簧镜头编导器
// 核心能力：
// 1. 交互式“按住蓄力旋涡 + 鼠标/触屏拖拽任意方向甩投” (Interactive Hold & Slingshot)
// 2. 120Hz 刚体碰撞预烘焙 + 四元数逆向精确对齐指定密码学真骰点数 (SO(3) 零磁吸跳变)
// 3. 电影级二阶弹簧摄像机 (Spring Camera)：蓄力拉远蓄势 -> 空中追踪 -> 临落定子弹时间推镜特写 -> 落地震屏冲击！
// 4. 零 GC 粒子与冲天光柱发射器 + 屏幕空间光学冲击波折射驱动 + 2D 矢量战术准星/朱砂印章叠层
// ============================================================================

import { GL_MESHES } from './gl-meshes.js'
import { WebGLDiceRenderer } from './gl-renderer.js'

export const NEXTGEN_THEMES = Object.freeze([
  {
    id: 'astral',
    themeIndex: 0,
    name: '星穹秘法 · 天命司南',
    subtitle: 'Astral Chronometer',
    badge: '✦ 24K 鎏金星盘',
    desc: '三重深度视差旋转黄金星盘 + 内部深空星云黑曜石 + 24K 凹凸鎏金刻槽，大成功降下冲天圣金光柱与径向折射冲击波。',
    accent: '#f5b942',
    swatch: 'radial-gradient(circle at 30% 25%, #5c3d99 0%, #170f2e 55%, #070510 100%)',
    soundPreset: 'astral'
  },
  {
    id: 'prism',
    themeIndex: 1,
    name: '时停棱镜 · 碎星圣晶',
    subtitle: 'Chrono-Crystal Prism',
    badge: '⏳ 子弹时间慢镜',
    desc: '薄膜干涉彩虹色散圣晶 + 极光菱形焦散镜湖；临落定自动开启 0.22x 子弹时间推镜特写，折射七彩流光丝带。',
    accent: '#6be6ff',
    swatch: 'linear-gradient(135deg, #0b3954 0%, #1c7c9c 50%, #a8ffef 100%)',
    soundPreset: 'prism'
  },
  {
    id: 'inferno',
    themeIndex: 2,
    name: '焚天熔炉 · 孤注一掷',
    subtitle: 'Hellforge Overdrive',
    badge: '🔥 孤注一掷专属',
    desc: '锻打陨铁外壳包裹炽白涌动岩浆核，重砸玄武岩铁砧迸发放射状熔岩裂痕、速度拉伸飞溅火星与火山熔柱！',
    accent: '#ff6426',
    swatch: 'radial-gradient(circle at 40% 35%, #ff7b1c 0%, #591406 58%, #140604 100%)',
    soundPreset: 'inferno'
  },
  {
    id: 'cyber',
    themeIndex: 3,
    name: '赛博超频 · 霓虹矩阵',
    subtitle: 'Cyberpunk Overdrive',
    badge: '⚡ 全息锁定 HUD',
    desc: '烟熏全息激光扫描切面 + 霓虹透视网格，撞击触发强烈 RGB 光学色差，落定实时追踪多面体锁定战术遥测准星。',
    accent: '#00f5d4',
    swatch: 'linear-gradient(135deg, #081229 0%, #007f8c 52%, #ff007f 100%)',
    soundPreset: 'cyber'
  },
  {
    id: 'jianxin',
    themeIndex: 4,
    name: '水墨剑心 · 太虚玉简',
    subtitle: 'Jade & Cinnabar',
    badge: '🗡️ 飞白剑气朱印',
    desc: '次表面散射温润羊脂白玉鎏金骰 + 宣纸远山水墨分形晕染 + 书法“飞白”浓墨拖尾，落定横贯剑气并拍下斑驳朱砂方印！',
    accent: '#e03c31',
    swatch: 'linear-gradient(135deg, #dcd4c4 0%, #8f9491 62%, #2b2f33 100%)',
    soundPreset: 'jianxin'
  },
  {
    id: 'singularity',
    themeIndex: 5,
    name: '虚空星噬 · 诡秘奇点',
    subtitle: 'Eldritch Singularity',
    badge: '👁️ 引力透镜暗骰',
    desc: '黑洞吸积盘实时引力透镜扭曲舞台 + 古神荧光骨晶脉络，暗骰模式悬浮诡秘全视秘眼封印，点击撕裂空间揭晓真身。',
    accent: '#39e5b6',
    swatch: 'radial-gradient(circle at 50% 45%, #25a18e 0%, #241038 55%, #05050a 100%)',
    soundPreset: 'singularity'
  }
])

const TIER_CODE_MAP = {
  normal: 0,
  critical: 1,
  success: 2,
  costly: 3,
  failure: 4,
  fumble: 5
}

const SEAL_TEXT_BY_TIER = {
  normal: '定局',
  critical: '天命',
  success: '破局',
  costly: '险胜',
  failure: '失手',
  fumble: '劫数'
}

function drawThemeSealOverlay(ctx, { themeIndex, tier, settleTime, sx, sy, scaleMul = 1 }) {
  const sealWord = SEAL_TEXT_BY_TIER[tier] || '破局'
  const slamT = Math.min(1, settleTime / 0.14)
  const scale = (slamT < 1 ? (2.1 - 1.1 * slamT) : 1.0) * scaleMul
  const fade = settleTime > 1.9 ? Math.max(0, 1 - (settleTime - 1.9) / 0.6) : 1.0

  ctx.save()
  ctx.translate(sx, sy)
  ctx.scale(scale, scale)
  ctx.globalAlpha = fade * 0.94

  if (themeIndex === 4) {
    // 水墨剑心：落定拍案篆体「朱砂红印」
    ctx.rotate(-0.08)
    ctx.fillStyle = '#b91c1c'
    ctx.strokeStyle = '#fef2f2'
    ctx.beginPath()
    ctx.roundRect(-34, -42, 68, 84, 4)
    ctx.fill()
    ctx.lineWidth = 2.4
    ctx.strokeRect(-29, -37, 58, 74)

    ctx.fillStyle = '#fff8f1'
    ctx.font = '900 28px "STKaiti", "KaiTi", "Songti SC", "Noto Serif SC", serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(sealWord[0], 0, -17)
    ctx.fillText(sealWord[1], 0, 18)
  } else if (themeIndex === 0) {
    // 星穹秘法：24K 鎏金星盘天命印
    ctx.rotate(-0.04)
    ctx.fillStyle = 'rgba(14, 9, 34, 0.92)'
    ctx.beginPath()
    ctx.arc(0, 0, 44, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = '#f5b942'
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.arc(0, 0, 44, 0, Math.PI * 2)
    ctx.stroke()

    ctx.save()
    ctx.setLineDash([4, 4])
    ctx.strokeStyle = 'rgba(245, 185, 66, 0.72)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.arc(0, 0, 37, 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()

    ctx.fillStyle = '#f5b942'
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI * 0.5
      const px = Math.cos(a) * 44
      const py = Math.sin(a) * 44
      ctx.beginPath()
      ctx.arc(px, py, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#f5b942'
    ctx.font = '700 9.5px "Songti SC", "Noto Serif SC", serif'
    ctx.fillText('星穹司南', 0, -21)

    ctx.shadowColor = 'rgba(245, 185, 66, 0.65)'
    ctx.shadowBlur = 10
    ctx.fillStyle = '#ffe699'
    ctx.font = '900 26px "Songti SC", "Noto Serif SC", "STKaiti", serif'
    ctx.fillText(sealWord, 0, 2)

    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(245, 185, 66, 0.82)'
    ctx.font = '700 8.5px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText((tier || 'normal').toUpperCase(), 0, 23)
  } else if (themeIndex === 1) {
    // 时停棱镜：碎星圣晶棱形徽章
    ctx.fillStyle = 'rgba(8, 36, 56, 0.88)'
    ctx.beginPath()
    ctx.moveTo(0, -47)
    ctx.lineTo(44, -14)
    ctx.lineTo(36, 36)
    ctx.lineTo(0, 47)
    ctx.lineTo(-36, 36)
    ctx.lineTo(-44, -14)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = '#a8ffef'
    ctx.lineWidth = 2.2
    ctx.stroke()

    ctx.strokeStyle = 'rgba(107, 230, 255, 0.65)'
    ctx.lineWidth = 1.1
    ctx.beginPath()
    ctx.moveTo(0, -40)
    ctx.lineTo(37, -11)
    ctx.lineTo(30, 31)
    ctx.lineTo(0, 40)
    ctx.lineTo(-30, 31)
    ctx.lineTo(-37, -11)
    ctx.closePath()
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#a8ffef'
    ctx.font = '700 9.5px system-ui, sans-serif'
    ctx.fillText('时停圣晶', 0, -20)

    ctx.shadowColor = 'rgba(107, 230, 255, 0.75)'
    ctx.shadowBlur = 10
    ctx.fillStyle = '#ffffff'
    ctx.font = '900 26px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    ctx.fillText(sealWord, 0, 2)

    ctx.shadowBlur = 0
    ctx.fillStyle = '#6be6ff'
    ctx.font = '700 8.5px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText('CHRONO', 0, 24)
  } else if (themeIndex === 2) {
    // 焚天熔炉：锻铁熔岩六角徽记
    ctx.rotate(-0.04)
    ctx.fillStyle = 'rgba(26, 8, 5, 0.93)'
    ctx.beginPath()
    ctx.moveTo(-36, -38)
    ctx.lineTo(36, -38)
    ctx.lineTo(46, 0)
    ctx.lineTo(36, 38)
    ctx.lineTo(-36, 38)
    ctx.lineTo(-46, 0)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = '#ff6426'
    ctx.lineWidth = 2.6
    ctx.stroke()

    ctx.strokeStyle = 'rgba(255, 179, 71, 0.75)'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.moveTo(-31, -32)
    ctx.lineTo(31, -32)
    ctx.lineTo(39, 0)
    ctx.lineTo(31, 32)
    ctx.lineTo(-31, 32)
    ctx.lineTo(-39, 0)
    ctx.closePath()
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffb347'
    ctx.font = '800 9.5px system-ui, sans-serif'
    ctx.fillText('焚天熔炉', 0, -19)

    ctx.shadowColor = 'rgba(255, 100, 38, 0.85)'
    ctx.shadowBlur = 12
    ctx.fillStyle = '#fff1e0'
    ctx.font = '900 26px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    ctx.fillText(sealWord, 0, 2)

    ctx.shadowBlur = 0
    ctx.fillStyle = '#ff8c42'
    ctx.font = '700 8.5px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText('HELLFORGE', 0, 22)
  } else if (themeIndex === 3) {
    // 赛博超频：霓虹全息战术铭牌
    const neon = tier === 'fumble' ? '#ff2a85' : '#00f5d4'
    const cut = 10
    const hw = 44
    const hh = 38
    ctx.fillStyle = 'rgba(6, 16, 32, 0.90)'
    ctx.beginPath()
    ctx.moveTo(-hw + cut, -hh)
    ctx.lineTo(hw, -hh)
    ctx.lineTo(hw, hh - cut)
    ctx.lineTo(hw - cut, hh)
    ctx.lineTo(-hw, hh)
    ctx.lineTo(-hw, -hh + cut)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = neon
    ctx.lineWidth = 2.0
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = neon
    ctx.font = '700 9px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText('SYS // 霓虹矩阵', 0, -22)

    ctx.shadowColor = neon
    ctx.shadowBlur = 10
    ctx.fillStyle = '#ffffff'
    ctx.font = '900 26px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
    ctx.fillText(sealWord, 0, 1)

    ctx.shadowBlur = 0
    ctx.fillStyle = neon
    ctx.font = '700 8.5px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText((tier || 'normal').toUpperCase(), 0, 23)
  } else {
    // 虚空星噬：诡秘奇点蚀环印
    ctx.fillStyle = 'rgba(8, 6, 18, 0.94)'
    ctx.beginPath()
    ctx.arc(0, 0, 44, 0, Math.PI * 2)
    ctx.fill()

    ctx.strokeStyle = '#a855f7'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.arc(0, 0, 44, 0, Math.PI * 2)
    ctx.stroke()

    ctx.strokeStyle = '#39e5b6'
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.arc(0, 0, 38, 0, Math.PI * 2)
    ctx.stroke()

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#7afcd6'
    ctx.font = '700 9.5px "Songti SC", "Noto Serif SC", serif'
    ctx.fillText('虚空奇点', 0, -21)

    ctx.shadowColor = 'rgba(57, 229, 182, 0.72)'
    ctx.shadowBlur = 12
    ctx.fillStyle = '#e8fff9'
    ctx.font = '900 26px "Songti SC", "Noto Serif SC", "STKaiti", serif'
    ctx.fillText(sealWord, 0, 2)

    ctx.shadowBlur = 0
    ctx.fillStyle = '#c084fc'
    ctx.font = '700 8.5px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText('SINGULARITY', 0, 23)
  }

  ctx.restore()
}

const SIM_DT = 1 / 120
const MAX_STEPS = 240 // 2.0s 120Hz 高精度轨迹
const PARTICLE_CAP = 900

function qMul(ax, ay, az, aw, bx, by, bz, bw, out) {
  out[0] = aw * bx + ax * bw + ay * bz - az * by
  out[1] = aw * by - ax * bz + ay * bw + az * bx
  out[2] = aw * bz + ax * by - ay * bx + az * bw
  out[3] = aw * bw - ax * bx - ay * by - az * bz
}

function qNorm(q) {
  const inv = 1 / (Math.hypot(q[0], q[1], q[2], q[3]) || 1)
  q[0] *= inv; q[1] *= inv; q[2] *= inv; q[3] *= inv
}

function qSlerp(a, ao, b, bo, t, out) {
  let ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3]
  let bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3]
  let dot = ax * bx + ay * by + az * bz + aw * bw
  if (dot < 0) {
    dot = -dot
    bx = -bx; by = -by; bz = -bz; bw = -bw
  }
  if (dot > 0.9995) {
    out[0] = ax + (bx - ax) * t
    out[1] = ay + (by - ay) * t
    out[2] = az + (bz - az) * t
    out[3] = aw + (bw - aw) * t
    qNorm(out)
    return
  }
  const theta = Math.acos(dot)
  const sinT = Math.sin(theta)
  const wa = Math.sin((1 - t) * theta) / sinT
  const wb = Math.sin(t * theta) / sinT
  out[0] = ax * wa + bx * wb
  out[1] = ay * wa + by * wb
  out[2] = az * wa + bz * wb
  out[3] = aw * wa + bz * 0 + bw * wb
}

function mat3ToQuat(m00, m10, m20, m01, m11, m21, m02, m12, m22, out) {
  const tr = m00 + m11 + m22
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1.0)
    out[3] = 0.25 / s
    out[0] = (m21 - m12) * s
    out[1] = (m02 - m20) * s
    out[2] = (m10 - m01) * s
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22)
    out[3] = (m21 - m12) / s
    out[0] = 0.25 * s
    out[1] = (m01 + m10) / s
    out[2] = (m02 + m20) / s
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22)
    out[3] = (m02 - m20) / s
    out[0] = (m01 + m10) / s
    out[1] = 0.25 * s
    out[2] = (m12 + m21) / s
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11)
    out[3] = (m10 - m01) / s
    out[0] = (m02 + m20) / s
    out[1] = (m12 + m21) / s
    out[2] = 0.25 * s
  }
  qNorm(out)
}

export class CinematicDiceStage {
  constructor(glCanvas, hudCanvas, options = {}) {
    this.glCanvas = glCanvas
    this.hudCanvas = hudCanvas || null
    this.hudCtx = hudCanvas ? hudCanvas.getContext('2d') : null
    this.renderer = new WebGLDiceRenderer(glCanvas)

    this.audio = options.audio || null
    this.onTelemetry = options.onTelemetry || null
    this.onRollSettled = options.onRollSettled || null
    this.compactMode = Boolean(options.compact)

    this.theme = NEXTGEN_THEMES[0]
    this.quality = 'ultra' // 'ultra' | 'balanced' | 'lite'
    this.usePipsForD6 = false
    this.cinematicCamEnabled = !this.compactMode

    this.cssW = 800
    this.cssH = 520
    this.dpr = 1

    // 引擎运行与帧率遥测
    this.running = false
    this.rafId = 0
    this.clock = 0
    this.lastNow = 0
    this.frameTimes = new Float32Array(60)
    this.ftCursor = 0
    this.fpsAccum = 0
    this.fpsFrames = 0
    this.fps = 60

    // 投掷状态与模式
    this.dice = []
    this.tier = 'success'
    this.mode = 'normal' // 'normal' | 'fate' | 'push' | 'hidden'
    this.revealed = false
    this.total = 20
    this.checkName = '命运裁定'
    this.settled = true
    this.settleTime = 10
    this.rollTime = 0
    this.simTime = 0
    this.maxSimDuration = 1.2
    this.climax = 0
    this.bulletTimeAmount = 0
    this.bulletSoundPlayed = false

    // 交互式按住蓄力旋涡 & 拖拽甩投状态
    this.charging = false
    this.chargeTime = 0
    this.chargeWorld = { x: 0, y: -60, z: 95 }
    this.dragHistory = [] // [{ x, y, t }]
    this.pendingSpecBuilder = options.buildSpecOnDragRelease || null

    // 电影级弹簧摄像机状态
    this.baseEye = [0, -395, 435]
    this.camEye = [0, -395, 435]
    this.camTarget = [0, 8, 14]
    this.camFov = (38 * Math.PI) / 180
    this.shakeAmp = 0
    this.chroma = 0.06
    this.shockwave = [0.5, 0.5, 0, 0] // u, v, radius, strength
    this.shockAge = 99

    // 桌面撞击贴花槽 (8个)
    this.impacts = Array.from({ length: 8 }, () => ({ x: 0, y: 0, age: 0, strength: 0 }))
    this.impactCursor = 0
    this.bounceQueue = []
    this.bouncePlayCursor = 0

    // 3D 弧形剑气 / 星环轨槽 (8条)
    this.slashes = Array.from({ length: 8 }, () => ({
      active: false, cx: 0, cy: 0, cz: 20, radius: 90, tilt: 0.4, angle: 0, width: 10, age: 0, life: 0.6, r: 1, g: 1, b: 1
    }))
    this.slashCursor = 0

    // SoA GPU 粒子与冲天光柱池
    this.particles = {
      capacity: PARTICLE_CAP,
      aliveCount: 0,
      cursor: 0,
      active: new Uint8Array(PARTICLE_CAP),
      x: new Float32Array(PARTICLE_CAP),
      y: new Float32Array(PARTICLE_CAP),
      z: new Float32Array(PARTICLE_CAP),
      vx: new Float32Array(PARTICLE_CAP),
      vy: new Float32Array(PARTICLE_CAP),
      vz: new Float32Array(PARTICLE_CAP),
      size: new Float32Array(PARTICLE_CAP),
      age: new Float32Array(PARTICLE_CAP),
      life: new Float32Array(PARTICLE_CAP),
      grav: new Float32Array(PARTICLE_CAP),
      drag: new Float32Array(PARTICLE_CAP),
      r: new Float32Array(PARTICLE_CAP),
      g: new Float32Array(PARTICLE_CAP),
      b: new Float32Array(PARTICLE_CAP),
      a: new Float32Array(PARTICLE_CAP),
      mode: new Float32Array(PARTICLE_CAP) // 0: 速度拉伸火星, 1: 冲天光柱
    }

    this._qTmp = new Float32Array(4)
    this._uvTmp = { u: 0.5, v: 0.5, visible: true }

    this.resize()
    if (options.interactive !== false) {
      this._bindInteractiveSlingshot()
    }
  }

  resize() {
    const rect = this.glCanvas.getBoundingClientRect()
    const w = Math.max(120, Math.round(rect.width || this.glCanvas.clientWidth || 800))
    const h = Math.max(68, Math.round(rect.height || this.glCanvas.clientHeight || 480))
    const maxDpr = this.quality === 'lite' ? 1.0 : this.quality === 'balanced' ? 1.5 : 2.0
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)

    this.cssW = w
    this.cssH = h
    this.dpr = dpr
    this.renderer.resize(Math.round(w * dpr), Math.round(h * dpr))

    if (this.hudCanvas) {
      this.hudCanvas.width = Math.round(w * dpr)
      this.hudCanvas.height = Math.round(h * dpr)
    }

    const aspect = w / Math.max(1, h)
    // 宽扁横幅或竖窄屏幕自适应视野距离（拉近约 22%，让多面体与数字饱满清晰）
    const distScale = aspect > 2.1 ? 0.66 : aspect < 0.9 ? 1.15 : 0.88
    this.baseEye[0] = 0
    this.baseEye[1] = -335 * distScale
    this.baseEye[2] = 395 * distScale
    this.renderSingleFrame()
  }

  setTheme(themeObj) {
    if (!themeObj) return
    this.theme = themeObj
    this.wake()
  }

  setQuality(q) {
    this.quality = q || 'ultra'
    this.resize()
    this.wake()
  }

  setUsePipsForD6(flag) {
    this.usePipsForD6 = Boolean(flag)
    this.renderSingleFrame()
  }

  setCinematicCam(flag) {
    this.cinematicCamEnabled = Boolean(flag)
    this.wake()
  }

  /**
   * 手动按钮长按蓄力 API：按住重投/投掷按钮时，骰群升空进入中心引力聚能旋涡！
   */
  startButtonCharge(modeHint) {
    if (this.charging) return
    if (modeHint === 'fate') this.setTheme(NEXTGEN_THEMES[1])
    else if (modeHint === 'push') this.setTheme(NEXTGEN_THEMES[2])
    // 若舞台当前尚无骰子，先放置一颗默认多面体参与蓄力旋涡演出
    if (!this.dice || this.dice.length === 0) {
      this.setStaticRoll({ diceSpecs: [{ meshKey: 'd20', sides: 20, targetValue: 20 }], tier: 'success', mode: 'normal' })
    }
    this.charging = true
    this.buttonCharging = true
    this.chargeTime = 0
    this.chargeWorld.x = 0
    this.chargeWorld.y = -12
    this.chargeWorld.z = 92
    if (this.audio) this.audio.startChargeHum(this.theme.soundPreset)
    this.wake()
  }

  /**
   * 移出按钮取消蓄力：不消耗命运点或重投次数，平稳落回原状
   */
  cancelButtonCharge() {
    if (!this.charging) return
    this.charging = false
    this.buttonCharging = false
    if (this.audio) this.audio.stopChargeHum()
    // 恢复落定态原坐标与姿态
    for (let i = 0; i < this.dice.length; i++) {
      const d = this.dice[i]
      const ep = (MAX_STEPS - 1) * 3
      const eq = (MAX_STEPS - 1) * 4
      d.x = d.trajPos[ep]; d.y = d.trajPos[ep + 1]; d.z = d.trajPos[ep + 2]
      d.qx = d.trajQuat[eq]; d.qy = d.trajQuat[eq + 1]; d.qz = d.trajQuat[eq + 2]; d.qw = d.trajQuat[eq + 3]
      d.trailCount = 0
      d.settled = true
    }
    this.settled = true
    this.wake()
  }

  /**
   * 松开蓄力按钮：带着蓄力能量将旋涡中的骰群爆发砸向指定真骰结果！
   */
  releaseButtonCharge(spec, charge01 = 0.6) {
    const power = Math.max(0, Math.min(1, Number(charge01) || 0))
    this.charging = false
    this.buttonCharging = false
    if (this.audio) this.audio.stopChargeHum()
    const enriched = { ...(spec || {}) }
    if (power > 0.12) {
      const angle = (Math.random() - 0.5) * 1.1 + Math.PI * 0.5
      const spd = 220 + power * 420
      enriched.launchOrigin = { x: 0, y: -24, z: 98 + power * 48 }
      enriched.launchVelocity = {
        vx: Math.cos(angle) * spd * 0.55,
        vy: Math.sin(angle) * spd * 0.55
      }
    }
    this.throwDice(enriched)
  }

  /**
   * 静态摆盘（打开已有楼层检定面板时直接展示已落定真骰，不重复假投）
   */
  setStaticRoll(spec = {}) {
    this.throwDice({ ...spec, silentStatic: true })
    this.settled = true
    this.settleTime = 3.0
    this.simTime = this.maxSimDuration
    this.climax = 0
    for (let i = 0; i < this.dice.length; i++) {
      const d = this.dice[i]
      const ep = (MAX_STEPS - 1) * 3
      const eq = (MAX_STEPS - 1) * 4
      d.x = d.trajPos[ep]; d.y = d.trajPos[ep + 1]; d.z = d.trajPos[ep + 2]
      d.qx = d.trajQuat[eq]; d.qy = d.trajQuat[eq + 1]; d.qz = d.trajQuat[eq + 2]; d.qw = d.trajQuat[eq + 3]
      d.speed = 0
      d.trailCount = 0
      d.settled = true
    }
    this.particles.active.fill(0)
    this.particles.aliveCount = 0
    this.renderSingleFrame()
  }

  _bindInteractiveSlingshot() {
    const el = this.glCanvas
    const toWorld = (clientX, clientY, planeZ) => {
      const rect = el.getBoundingClientRect()
      const nx = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1
      const ny = 1 - ((clientY - rect.top) / Math.max(1, rect.height)) * 2
      return this.renderer.unprojectToPlane(nx, ny, planeZ, { x: 0, y: 0, z: planeZ })
    }

    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return
      // 若当前处于暗骰落定待揭晓状态，轻点直接撕开封印揭晓！
      if (this.mode === 'hidden' && !this.revealed && this.settled) {
        this.revealHidden()
        return
      }
      el.setPointerCapture(e.pointerId)
      this.charging = true
      this.chargeTime = 0
      const wp = toWorld(e.clientX, e.clientY, 85)
      this.chargeWorld.x = Math.max(-210, Math.min(210, wp.x))
      this.chargeWorld.y = Math.max(-165, Math.min(165, wp.y))
      this.dragHistory = [{ x: this.chargeWorld.x, y: this.chargeWorld.y, t: performance.now() }]
      if (this.audio) this.audio.startChargeHum(this.theme.soundPreset)
      this.wake()
    })

    el.addEventListener('pointermove', e => {
      if (!this.charging) return
      const wp = toWorld(e.clientX, e.clientY, 85)
      this.chargeWorld.x = Math.max(-220, Math.min(220, wp.x))
      this.chargeWorld.y = Math.max(-175, Math.min(175, wp.y))
      const now = performance.now()
      this.dragHistory.push({ x: this.chargeWorld.x, y: this.chargeWorld.y, t: now })
      if (this.dragHistory.length > 8) this.dragHistory.shift()
    })

    const finishDrag = () => {
      if (!this.charging) return
      this.charging = false
      if (this.audio) this.audio.stopChargeHum()

      // 计算甩投初速度向量
      let vx = 0, vy = 0
      if (this.dragHistory.length >= 2) {
        const first = this.dragHistory[0]
        const last = this.dragHistory[this.dragHistory.length - 1]
        const dt = Math.max(0.016, (last.t - first.t) * 0.001)
        vx = ((last.x - first.x) / dt) * 0.68
        vy = ((last.y - first.y) / dt) * 0.68
      }
      const speed = Math.hypot(vx, vy)
      if (speed > 780) {
        vx = (vx / speed) * 780
        vy = (vy / speed) * 780
      }

      const spec = this.pendingSpecBuilder ? this.pendingSpecBuilder() : null
      if (spec) {
        if (speed > 65 || this.chargeTime > 0.18) {
          spec.launchOrigin = { x: this.chargeWorld.x, y: this.chargeWorld.y, z: 95 + Math.min(1, this.chargeTime) * 45 }
          spec.launchVelocity = {
            vx: speed > 65 ? vx : -this.chargeWorld.x * 2.4 + (Math.random() - 0.5) * 180,
            vy: speed > 65 ? vy : -this.chargeWorld.y * 2.4 + (Math.random() - 0.5) * 180
          }
        }
        this.throwDice(spec)
      }
    }

    el.addEventListener('pointerup', finishDrag)
    el.addEventListener('pointercancel', finishDrag)
  }

  revealHidden() {
    if (this.mode !== 'hidden' || this.revealed) return
    this.revealed = true
    this.settleTime = 0
    this.climax = 1.0
    this._triggerClimaxFX()
    if (this.audio) this.audio.playSettle(this.theme.soundPreset, this.tier)
    if (this.onRollSettled) this.onRollSettled(this)
    this.wake()
  }

  _spawnSpark(opts) {
    if (this.quality === 'lite' && (this.particles.cursor & 1) === 1) {
      this.particles.cursor = (this.particles.cursor + 1) % PARTICLE_CAP
      return
    }
    const p = this.particles
    const i = p.cursor
    p.cursor = (i + 1) % PARTICLE_CAP
    if (!p.active[i]) p.aliveCount++
    p.active[i] = 1
    p.x[i] = opts.x || 0
    p.y[i] = opts.y || 0
    p.z[i] = opts.z || 4
    p.vx[i] = opts.vx || 0
    p.vy[i] = opts.vy || 0
    p.vz[i] = opts.vz || 0
    p.size[i] = opts.size || 3.5
    p.age[i] = 0
    p.life[i] = opts.life || 0.55
    p.grav[i] = opts.grav !== undefined ? opts.grav : 420
    p.drag[i] = opts.drag !== undefined ? opts.drag : 1.6
    p.r[i] = opts.r !== undefined ? opts.r : 2.5
    p.g[i] = opts.g !== undefined ? opts.g : 1.6
    p.b[i] = opts.b !== undefined ? opts.b : 0.4
    p.a[i] = opts.a !== undefined ? opts.a : 1.0
    p.mode[i] = opts.pillar ? 1.0 : 0.0
  }

  _spawnSlash(cx, cy, cz, radius, tilt, angle, width, life, r, g, b) {
    const sl = this.slashes[this.slashCursor % this.slashes.length]
    this.slashCursor++
    sl.active = true
    sl.cx = cx; sl.cy = cy; sl.cz = cz
    sl.radius = radius
    sl.tilt = tilt
    sl.angle = angle
    sl.width = width
    sl.age = 0
    sl.life = life
    sl.r = r; sl.g = g; sl.b = b
  }

  _themeHDRColor() {
    const id = this.theme.themeIndex
    if (id === 0) return this.tier === 'fumble' ? [2.2, 0.35, 3.4] : [3.4, 2.1, 0.55]
    if (id === 1) return [0.9, 2.6, 3.8]
    if (id === 2) return [4.8, 1.55, 0.2]
    if (id === 3) return [0.2, 3.0, 3.4]
    if (id === 4) return this.tier === 'critical' ? [2.6, 0.35, 0.22] : [0.9, 0.85, 0.7]
    return this.tier === 'fumble' ? [2.4, 0.3, 3.4] : [0.4, 2.9, 2.2]
  }

  /**
   * 触发一次高精度真骰投掷！
   */
  throwDice(spec = {}) {
    const diceSpecs = spec.diceSpecs && spec.diceSpecs.length
      ? spec.diceSpecs
      : [{ meshKey: 'd20', sides: 20, targetValue: 20 }]
    const count = diceSpecs.length

    this.tier = spec.tier || 'success'
    this.mode = spec.mode || 'normal'
    this.revealed = false
    this.total = spec.total !== undefined ? spec.total : diceSpecs.reduce((s, d) => s + d.targetValue, 0)
    this.checkName = spec.checkName || '命运裁定'

    // 清空上一轮瞬态残迹
    this.particles.active.fill(0)
    this.particles.aliveCount = 0
    for (const imp of this.impacts) imp.strength = 0
    for (const sl of this.slashes) sl.active = false
    this.shockAge = 99
    this.shockwave[3] = 0
    this.climax = 0
    this.bulletTimeAmount = 0
    this.bulletSoundPlayed = false

    const baseR = count <= 1 ? 42 : count <= 2 ? 37 : count <= 4 ? 31 : count <= 8 ? 25 : count <= 14 ? 20 : 16
    const aspect = this.cssW / Math.max(1, this.cssH)
    const boundX = Math.min(225, Math.max(92, 155 * aspect)) - baseR
    const boundY = (this.compactMode ? 88 : 138) - baseR

    const dice = []
    for (let i = 0; i < count; i++) {
      const ds = diceSpecs[i]
      const mesh = GL_MESHES[ds.meshKey] || GL_MESHES.d20
      let targetFace = mesh.faces[0]
      for (let f = 0; f < mesh.faces.length; f++) {
        if (mesh.faces[f].value === ds.targetValue) {
          targetFace = mesh.faces[f]
          break
        }
      }

      let startX, startY, startZ, vx, vy, vz
      if (spec.launchOrigin && spec.launchVelocity) {
        const spreadA = (i / Math.max(1, count)) * Math.PI * 2
        const spreadR = count > 1 ? 18 + (i % 3) * 10 : 0
        startX = spec.launchOrigin.x + Math.cos(spreadA) * spreadR
        startY = spec.launchOrigin.y + Math.sin(spreadA) * spreadR
        startZ = spec.launchOrigin.z + (i % 4) * 12
        vx = spec.launchVelocity.vx + (Math.random() - 0.5) * 95
        vy = spec.launchVelocity.vy + (Math.random() - 0.5) * 95
        vz = 140 + Math.random() * 130
      } else {
        // 默认从近景两侧帅气弧线抛入舞台中央！
        const side = (i % 2 === 0 ? -1 : 1) * (0.72 + Math.random() * 0.28)
        startX = side * boundX * 0.88
        startY = -boundY * (0.75 + Math.random() * 0.35)
        startZ = baseR + 105 + Math.random() * 75 + (i % 4) * 14

        const ringR = count === 1 ? 0 : Math.min(boundX * 0.65, baseR * (1.65 + Math.sqrt(count) * 0.78))
        const slotA = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.45
        const aimX = Math.cos(slotA) * ringR * 0.85
        const aimY = Math.sin(slotA) * ringR * 0.72 + 12
        const tFlight = 0.38 + Math.random() * 0.08
        vx = (aimX - startX) / tFlight + (Math.random() - 0.5) * 65
        vy = (aimY - startY) / tFlight + (Math.random() - 0.5) * 65
        vz = 135 + Math.random() * 115
      }

      dice.push({
        index: i,
        mesh,
        meshKey: ds.meshKey,
        sides: ds.sides || mesh.faceCount,
        faceValue: ds.targetValue,
        targetFace,
        radius: baseR * (ds.meshKey === 'd4' ? 1.12 : 1.0),
        x: startX, y: startY, z: startZ,
        vx, vy, vz,
        wx: (Math.random() < 0.5 ? -1 : 1) * (14 + Math.random() * 12),
        wy: (Math.random() < 0.5 ? -1 : 1) * (13 + Math.random() * 12),
        wz: (Math.random() - 0.5) * 16,
        qx: 0, qy: 0, qz: 0, qw: 1,
        speed: Math.hypot(vx, vy, vz),
        settled: false,
        settleStep: MAX_STEPS - 1,
        bounces: 0,
        trajPos: new Float32Array(MAX_STEPS * 3),
        trajQuat: new Float32Array(MAX_STEPS * 4),
        trajSpeed: new Float32Array(MAX_STEPS),
        trailX: new Float32Array(28),
        trailY: new Float32Array(28),
        trailZ: new Float32Array(28),
        trailCount: 0,
        trailHead: 0
      })
    }

    this._bakeTrajectoriesAndExactLanding(dice, boundX, boundY)

    this.dice = dice
    this.settled = false
    this.settleTime = 0
    this.rollTime = 0
    this.simTime = 0
    this.bouncePlayCursor = 0

    if (this.audio && !spec.silentStatic) {
      this.audio.playThrowWhoosh(this.theme.soundPreset, 1.1)
    }
    if (!spec.silentStatic) this.wake()
  }

  _bakeTrajectoriesAndExactLanding(dice, boundX, boundY) {
    const count = dice.length
    const gravity = 1680
    this.bounceQueue.length = 0
    const dq = new Float32Array(4)
    const qNext = new Float32Array(4)
    let maxSettleStep = 48

    for (let step = 0; step < MAX_STEPS; step++) {
      for (let i = 0; i < count; i++) {
        const d = dice[i]
        // 内切距离使多面体真实贴合 z=0 台面
        const floorZ = d.radius * (d.meshKey === 'd4' ? 0.52 : d.meshKey === 'd6' || d.meshKey === 'df' ? 0.62 : 0.76)

        if (!d._simSettled) {
          d.vz -= gravity * SIM_DT
          d.x += d.vx * SIM_DT
          d.y += d.vy * SIM_DT
          d.z += d.vz * SIM_DT

          d.vx *= 0.996
          d.vy *= 0.996

          if (d.x < -boundX) { d.x = -boundX; d.vx = Math.abs(d.vx) * 0.68; d.wz += 5 }
          else if (d.x > boundX) { d.x = boundX; d.vx = -Math.abs(d.vx) * 0.68; d.wz -= 5 }
          if (d.y < -boundY) { d.y = -boundY; d.vy = Math.abs(d.vy) * 0.68; d.wx += 5 }
          else if (d.y > boundY) { d.y = boundY; d.vy = -Math.abs(d.vy) * 0.68; d.wx -= 5 }

          if (d.z <= floorZ) {
            d.z = floorZ
            const impV = -d.vz
            if (impV > 60 && d.bounces < 5) {
              const rest = Math.max(0.24, 0.58 - d.bounces * 0.09)
              d.vz = impV * rest
              d.vx *= 0.75
              d.vy *= 0.75
              d.wx = d.wx * 0.65 - d.vy * 0.05 + (Math.random() - 0.5) * 6.5
              d.wy = d.wy * 0.65 + d.vx * 0.05 + (Math.random() - 0.5) * 6.5
              d.wz *= 0.72
              this.bounceQueue.push({
                simTime: step * SIM_DT,
                x: d.x,
                y: d.y,
                z: 3,
                strength: Math.min(1, impV / 540),
                bounceIndex: d.bounces,
                dieIndex: i
              })
              d.bounces++
            } else {
              d.vz = 0
              d.vx *= 0.80
              d.vy *= 0.80
              d.wx *= 0.76
              d.wy *= 0.76
              d.wz *= 0.76
              if (Math.hypot(d.vx, d.vy) < 5.5 && Math.hypot(d.wx, d.wy, d.wz) < 0.42 && step > 40) {
                d.vx = 0; d.vy = 0; d.vz = 0
                d.wx = 0; d.wy = 0; d.wz = 0
                d._simSettled = true
                d.settleStep = step
                if (step > maxSettleStep) maxSettleStep = step
              }
            }
          }

          const wMag = Math.hypot(d.wx, d.wy, d.wz)
          if (wMag > 1e-4) {
            const half = 0.5 * wMag * SIM_DT
            const s = Math.sin(half) / wMag
            dq[0] = d.wx * s; dq[1] = d.wy * s; dq[2] = d.wz * s; dq[3] = Math.cos(half)
            qMul(dq[0], dq[1], dq[2], dq[3], d.qx, d.qy, d.qz, d.qw, qNext)
            qNorm(qNext)
            d.qx = qNext[0]; d.qy = qNext[1]; d.qz = qNext[2]; d.qw = qNext[3]
          }
        }
      }

      // 多骰 3D 球体刚性互撞弹开
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const a = dice[i], b = dice[j]
          const minDist = (a.radius + b.radius) * 0.96
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 < minDist * minDist && d2 > 1e-4) {
            const dist = Math.sqrt(d2)
            const nx = dx / dist, ny = dy / dist, nz = dz / dist
            const overlap = (minDist - dist) * 0.52
            a.x -= nx * overlap; a.y -= ny * overlap
            b.x += nx * overlap; b.y += ny * overlap
            const rvx = b.vx - a.vx, rvy = b.vy - a.vy, rvz = b.vz - a.vz
            const vn = rvx * nx + rvy * ny + rvz * nz
            if (vn < 0) {
              const imp = -0.84 * vn
              a.vx -= nx * imp; a.vy -= ny * imp; a.vz -= nz * imp * 0.35
              b.vx += nx * imp; b.vy += ny * imp; b.vz += nz * imp * 0.35
              if (imp > 18) {
                a._simSettled = false
                b._simSettled = false
              }
              const hs = Math.min(1, imp / 260)
              if (hs > 0.25 && this.bounceQueue.length < 96) {
                this.bounceQueue.push({
                  simTime: step * SIM_DT,
                  x: (a.x + b.x) * 0.5,
                  y: (a.y + b.y) * 0.5,
                  z: (a.z + b.z) * 0.5,
                  strength: hs * 0.85,
                  bounceIndex: 1,
                  dieIndex: i
                })
              }
            }
          }
        }
      }

      for (let i = 0; i < count; i++) {
        const d = dice[i]
        const po = step * 3
        d.trajPos[po] = d.x; d.trajPos[po + 1] = d.y; d.trajPos[po + 2] = d.z
        d.trajSpeed[step] = Math.hypot(d.vx, d.vy, d.vz)
        const qo = step * 4
        d.trajQuat[qo] = d.qx; d.trajQuat[qo + 1] = d.qy; d.trajQuat[qo + 2] = d.qz; d.trajQuat[qo + 3] = d.qw
      }
    }

    for (let i = 0; i < count; i++) {
      if (!dice[i]._simSettled) {
        dice[i].settleStep = MAX_STEPS - 2
        maxSettleStep = MAX_STEPS - 2
      }
    }
    this.maxSimDuration = maxSettleStep * SIM_DT
    this.bounceQueue.sort((a, b) => a.simTime - b.simTime)

    // 逆向四元数对齐：确保目标面最终稳稳朝上微倾面向摄像机，且 det(W * L^T) = (-1)*(-1) = +1 严格属于 SO(3)！
    const qDesired = new Float32Array(4)
    const qInit = new Float32Array(4)
    const qBaked = new Float32Array(4)

    for (let i = 0; i < count; i++) {
      const d = dice[i]
      const tf = d.targetFace
      // 落定面法线向摄像机方向适度前倾 (0.28 rad ≈ 16°)，消除透视压缩，让顶面大号数字正对视线！
      const tiltCam = d.meshKey === 'd4' ? 0.44 : 0.28
      const wnX = 0, wnY = -Math.sin(tiltCam), wnZ = Math.cos(tiltCam)

      // 保持极轻微偏航角 (±6°)，端正大气易读
      const yaw = (Math.random() - 0.5) * 0.22
      const cy = Math.cos(yaw), sy = Math.sin(yaw)
      // 基准 Wv 指向屏幕下方 (-Y 侧)，绕 Wn 偏航后并设 Wu = cross(Wn, Wv) 以严格对齐 gl-meshes 切空间手性
      const wvX = sy
      const wvY = -cy * Math.cos(tiltCam)
      const wvZ = -cy * Math.sin(tiltCam)

      const wuX = wnY * wvZ - wnZ * wvY
      const wuY = wnZ * wvX - wnX * wvZ
      const wuZ = wnX * wvY - wnY * wvX

      const ux = tf.uAxis[0], uy = tf.uAxis[1], uz = tf.uAxis[2]
      const vx = tf.vAxis[0], vy = tf.vAxis[1], vz = tf.vAxis[2]
      const nx = tf.normal[0], ny = tf.normal[1], nz = tf.normal[2]

      const m00 = wuX * ux + wvX * vx + wnX * nx
      const m10 = wuY * ux + wvY * vx + wnY * nx
      const m20 = wuZ * ux + wvZ * vx + wnZ * nx

      const m01 = wuX * uy + wvX * vy + wnX * ny
      const m11 = wuY * uy + wvY * vy + wnY * ny
      const m21 = wuZ * uy + wvZ * vy + wnZ * ny

      const m02 = wuX * uz + wvX * vz + wnX * nz
      const m12 = wuY * uz + wvY * vz + wnZ * nz
      const m22 = wuZ * uz + wvZ * vz + wnZ * nz

      mat3ToQuat(m00, m10, m20, m01, m11, m21, m02, m12, m22, qDesired)

      const endO = (MAX_STEPS - 1) * 4
      const qex = d.trajQuat[endO], qey = d.trajQuat[endO + 1], qez = d.trajQuat[endO + 2], qew = d.trajQuat[endO + 3]
      qMul(-qex, -qey, -qez, qew, qDesired[0], qDesired[1], qDesired[2], qDesired[3], qInit)
      qNorm(qInit)

      for (let step = 0; step < MAX_STEPS; step++) {
        const qo = step * 4
        qMul(
          d.trajQuat[qo], d.trajQuat[qo + 1], d.trajQuat[qo + 2], d.trajQuat[qo + 3],
          qInit[0], qInit[1], qInit[2], qInit[3],
          qBaked
        )
        d.trajQuat[qo] = qBaked[0]
        d.trajQuat[qo + 1] = qBaked[1]
        d.trajQuat[qo + 2] = qBaked[2]
        d.trajQuat[qo + 3] = qBaked[3]
      }

      d.x = d.trajPos[0]; d.y = d.trajPos[1]; d.z = d.trajPos[2]
      d.qx = d.trajQuat[0]; d.qy = d.trajQuat[1]; d.qz = d.trajQuat[2]; d.qw = d.trajQuat[3]
      d.trailCount = 1
      d.trailHead = 0
      d.trailX[0] = d.x; d.trailY[0] = d.y; d.trailZ[0] = d.z
    }
  }

  _onBounceEvent(b) {
    // 1. 桌面涟漪 / 熔岩裂痕 / 水墨晕染贴花
    const imp = this.impacts[this.impactCursor % this.impacts.length]
    this.impactCursor++
    imp.x = b.x
    imp.y = b.y
    imp.age = 0.001
    imp.strength = b.strength

    // 2. 镜头物理微震动 + 赛博色差脉冲
    this.shakeAmp = Math.min(18, this.shakeAmp + b.strength * (this.theme.themeIndex === 2 ? 12 : 7))
    if (this.theme.themeIndex === 3) {
      this.chroma = Math.min(1.6, this.chroma + b.strength * 0.9)
    }

    // 3. 迸射速度拉伸 3D 火星粒子
    const col = this._themeHDRColor()
    const sparkCount = (this.quality === 'lite' ? 4 : this.quality === 'balanced' ? 9 : 15) * (b.bounceIndex === 0 ? 1.4 : 0.8)
    for (let i = 0; i < sparkCount; i++) {
      const ang = Math.random() * Math.PI * 2
      const spd = (65 + Math.random() * 220) * b.strength
      this._spawnSpark({
        x: b.x,
        y: b.y,
        z: Math.max(4, b.z),
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        vz: (95 + Math.random() * 240) * b.strength,
        size: 2.2 + Math.random() * 2.8,
        life: 0.32 + Math.random() * 0.36,
        grav: this.theme.themeIndex === 5 ? 90 : 620,
        drag: 1.8,
        r: col[0], g: col[1], b: col[2],
        a: 1.0
      })
    }

    if (this.audio) {
      const pan = Math.max(-0.85, Math.min(0.85, b.x / 220))
      this.audio.playBounce(this.theme.soundPreset, b.strength, pan)
    }
  }

  _triggerClimaxFX() {
    if (!this.dice.length) return
    const isCrit = this.tier === 'critical'
    const isFumble = this.tier === 'fumble'
    const isDramatic = isCrit || isFumble || this.mode === 'fate' || this.mode === 'push'

    // 计算骰群几何中心并投影到屏幕 UV，触发光学径向折射冲击波！
    let cx = 0, cy = 0, cz = 0
    for (const d of this.dice) { cx += d.x; cy += d.y; cz += d.z }
    cx /= this.dice.length; cy /= this.dice.length; cz /= this.dice.length

    const uv = this.renderer.projectToUV(cx, cy, cz, this._uvTmp)
    if (uv.visible && (isDramatic || this.theme.themeIndex === 0 || this.theme.themeIndex === 2)) {
      this.shockwave[0] = uv.u
      this.shockwave[1] = uv.v
      this.shockwave[2] = 0.02
      this.shockwave[3] = isCrit ? 1.0 : isFumble ? 0.85 : 0.45
      this.shockAge = 0
    }

    this.shakeAmp = Math.max(this.shakeAmp, isCrit ? 16 : isFumble ? 14 : 6)
    this.chroma = Math.max(this.chroma, isCrit || isFumble ? 1.15 : 0.35)

    const col = this._themeHDRColor()

    for (let idx = 0; idx < this.dice.length; idx++) {
      const d = this.dice[idx]
      // 在每颗落定骰子底部加一道强烈桌面能量光环
      const imp = this.impacts[this.impactCursor % this.impacts.length]
      this.impactCursor++
      imp.x = d.x; imp.y = d.y; imp.age = 0.001; imp.strength = isCrit ? 1.25 : 0.85

      // 大成功 / 孤注一掷 / 大失败：在骰子后方升起圣光背光柱，衬托轮廓而绝不遮挡正面数字！
      if ((isCrit || isFumble || this.mode === 'push') && idx < 6) {
        this._spawnSpark({
          x: d.x, y: d.y + d.radius * 0.85, z: d.radius * 0.9,
          vx: 0, vy: 0, vz: isCrit ? 320 : 220,
          size: d.radius * (isCrit ? 1.15 : 0.95),
          life: isCrit ? 0.92 : 0.72,
          grav: 0, drag: 0,
          r: col[0], g: col[1], b: col[2],
          a: 0.58,
          pillar: true
        })
      }

      // 水墨剑心 / 星穹秘法 / 时停棱镜：凌空交错 3D 弧形剑气或星轨斩痕！
      if ((this.theme.themeIndex === 4 || isCrit) && idx < 4) {
        const slashCount = isCrit ? 3 : 2
        for (let s = 0; s < slashCount; s++) {
          const isGold = this.theme.themeIndex === 4 && isCrit && s === 0
          this._spawnSlash(
            d.x, d.y, d.z + 10,
            d.radius * (2.6 + s * 0.75),
            0.35 + (s - 0.5) * 0.55,
            s * 2.1 + idx,
            d.radius * 0.32,
            0.72 + s * 0.15,
            isGold ? 2.8 : (this.theme.themeIndex === 4 ? 0.06 : col[0]),
            isGold ? 1.8 : (this.theme.themeIndex === 4 ? 0.07 : col[1]),
            isGold ? 0.3 : (this.theme.themeIndex === 4 ? 0.09 : col[2])
          )
        }
      }

      // 礼花式高速粒子喷泉爆发
      const burstN = isCrit ? (this.quality === 'lite' ? 14 : 38) : (this.quality === 'lite' ? 6 : 16)
      for (let k = 0; k < burstN; k++) {
        const a = (k / burstN) * Math.PI * 2 + Math.random() * 0.25
        const v = 90 + Math.random() * (isCrit ? 320 : 180)
        this._spawnSpark({
          x: d.x, y: d.y, z: d.radius * 0.8,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          vz: 140 + Math.random() * (isCrit ? 360 : 190),
          size: 2.6 + Math.random() * 3.2,
          life: 0.55 + Math.random() * 0.55,
          grav: 480,
          drag: 1.4,
          r: col[0], g: col[1], b: col[2],
          a: 1.0
        })
      }
    }
  }

  wake() {
    if (this.running) return
    this.running = true
    this.lastNow = performance.now()

    const loop = now => {
      if (!this.running) return
      const t0 = performance.now()
      const rawDt = Math.min(0.05, Math.max(0.001, (now - this.lastNow) * 0.001))
      this.lastNow = now

      this._step(rawDt)
      this._renderAll()

      const cpuMs = performance.now() - t0
      this.frameTimes[this.ftCursor] = cpuMs
      this.ftCursor = (this.ftCursor + 1) % this.frameTimes.length
      this.fpsAccum += rawDt
      this.fpsFrames++
      if (this.fpsAccum >= 0.25) {
        this.fps = Math.round(this.fpsFrames / this.fpsAccum)
        this.fpsAccum = 0
        this.fpsFrames = 0
        this._emitTelemetry(true)
      }

      // 智能 0% GPU 休眠门控：落定超过 2.6s 且无蓄力/无存活粒子/无未消散贴花 => 自动休眠！
      const hasImpacts = this.impacts.some(imp => imp.strength > 0.001)
      const hasSlashes = this.slashes.some(sl => sl.active)
      const hiddenIdle = this.mode === 'hidden' && !this.revealed && this.settleTime < 3.2
      if (
        !this.charging &&
        this.settled &&
        this.settleTime > 2.6 &&
        this.particles.aliveCount === 0 &&
        !hasImpacts &&
        !hasSlashes &&
        !hiddenIdle
      ) {
        this.running = false
        this._emitTelemetry(false)
        return
      }

      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  stop() {
    this.running = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
    if (this.audio) this.audio.stopChargeHum()
  }

  renderSingleFrame() {
    this._renderAll()
  }

  _emitTelemetry(active) {
    if (!this.onTelemetry) return
    let sum = 0
    for (let i = 0; i < this.frameTimes.length; i++) sum += this.frameTimes[i]
    this.onTelemetry({
      fps: active ? this.fps : 0,
      avgMs: sum / this.frameTimes.length,
      particles: this.particles.aliveCount,
      diceCount: this.dice.length,
      sleeping: !active
    })
  }

  _step(rawDt) {
    this.clock += rawDt

    // 1. 按住蓄力旋涡交互阶段：骰群围绕光标悬浮高速自旋聚能！
    if (this.charging) {
      this.chargeTime += rawDt
      const c01 = Math.min(1, this.chargeTime / 0.85)
      if (this.audio) this.audio.updateChargeHum(c01)

      const n = this.dice.length
      for (let i = 0; i < n; i++) {
        const d = this.dice[i]
        const orbitR = n === 1 ? 6 : (26 + (1 - c01 * 0.35) * 28)
        const ang = this.clock * (6.5 + c01 * 8.0) + (i / Math.max(1, n)) * Math.PI * 2
        const tx = this.chargeWorld.x + Math.cos(ang) * orbitR
        const ty = this.chargeWorld.y + Math.sin(ang) * orbitR
        const tz = 82 + c01 * 38 + Math.sin(this.clock * 9 + i) * 8
        d.x += (tx - d.x) * Math.min(1, rawDt * 18)
        d.y += (ty - d.y) * Math.min(1, rawDt * 18)
        d.z += (tz - d.z) * Math.min(1, rawDt * 18)
        d.settled = false

        // 高速聚能自转
        const spin = (12 + c01 * 22) * rawDt * 0.5
        qMul(Math.sin(spin) * 0.7, Math.sin(spin) * 0.7, 0, Math.cos(spin), d.qx, d.qy, d.qz, d.qw, this._qTmp)
        qNorm(this._qTmp)
        d.qx = this._qTmp[0]; d.qy = this._qTmp[1]; d.qz = this._qTmp[2]; d.qw = this._qTmp[3]

        const th = (d.trailHead + 1) % 28
        d.trailHead = th
        d.trailX[th] = d.x; d.trailY[th] = d.y; d.trailZ[th] = d.z
        if (d.trailCount < 18) d.trailCount++
      }

      // 蓄力吸入星尘粒子
      const col = this._themeHDRColor()
      if (Math.random() < 0.85) {
        const a = Math.random() * Math.PI * 2
        const rad = 75 + Math.random() * 65
        this._spawnSpark({
          x: this.chargeWorld.x + Math.cos(a) * rad,
          y: this.chargeWorld.y + Math.sin(a) * rad,
          z: 20 + Math.random() * 60,
          vx: -Math.cos(a) * 180,
          vy: -Math.sin(a) * 180,
          vz: 120,
          size: 2.6,
          life: 0.35,
          grav: 0,
          drag: 1.2,
          r: col[0], g: col[1], b: col[2],
          a: 0.9
        })
      }
    } else if (!this.settled) {
      // 2. 子弹时间慢镜判定：时停棱镜主题、✦逆命重投 或 大成功/大失败 临近落定前的最后 0.28s！
      const remainingSim = this.maxSimDuration - this.simTime
      const wantBullet =
        (this.theme.themeIndex === 1 || this.mode === 'fate' || this.tier === 'critical' || this.tier === 'fumble') &&
        remainingSim > 0.03 &&
        remainingSim < 0.30 &&
        this.dice.length <= 6

      const targetBT = wantBullet ? 1.0 : 0.0
      this.bulletTimeAmount += (targetBT - this.bulletTimeAmount) * Math.min(1, rawDt * 12)
      if (wantBullet && !this.bulletSoundPlayed) {
        this.bulletSoundPlayed = true
        if (this.audio && (this.theme.themeIndex === 1 || this.mode === 'fate')) {
          this.audio.playBulletTimeDrop()
        }
      }

      const timeScale = 1.0 - this.bulletTimeAmount * 0.76 // 最低放慢至 0.24x 超清折射慢镜！
      const simDelta = rawDt * timeScale
      this.rollTime += rawDt
      this.simTime += simDelta

      const fStep = this.simTime / SIM_DT
      const s0 = Math.min(MAX_STEPS - 2, Math.max(0, fStep | 0))
      const alpha = Math.max(0, Math.min(1, fStep - s0))
      const s1 = s0 + 1

      let allDone = this.simTime >= this.maxSimDuration
      for (let i = 0; i < this.dice.length; i++) {
        const d = this.dice[i]
        const p0 = s0 * 3, p1 = s1 * 3
        d.x = d.trajPos[p0] + (d.trajPos[p1] - d.trajPos[p0]) * alpha
        d.y = d.trajPos[p0 + 1] + (d.trajPos[p1 + 1] - d.trajPos[p0 + 1]) * alpha
        d.z = d.trajPos[p0 + 2] + (d.trajPos[p1 + 2] - d.trajPos[p0 + 2]) * alpha
        d.speed = d.trajSpeed[s0] + (d.trajSpeed[s1] - d.trajSpeed[s0]) * alpha

        qSlerp(d.trajQuat, s0 * 4, d.trajQuat, s1 * 4, alpha, this._qTmp)
        d.qx = this._qTmp[0]; d.qy = this._qTmp[1]; d.qz = this._qTmp[2]; d.qw = this._qTmp[3]

        d.settled = s0 >= d.settleStep
        if (!d.settled) allDone = false

        const th = (d.trailHead + 1) % 28
        d.trailHead = th
        d.trailX[th] = d.x; d.trailY[th] = d.y; d.trailZ[th] = d.z
        if (d.trailCount < 28) d.trailCount++
      }

      while (this.bouncePlayCursor < this.bounceQueue.length && this.bounceQueue[this.bouncePlayCursor].simTime <= this.simTime) {
        this._onBounceEvent(this.bounceQueue[this.bouncePlayCursor++])
      }

      if (allDone) {
        this.settled = true
        this.settleTime = 0
        this.bulletTimeAmount = 0
        this.climax = 1.0
        for (let i = 0; i < this.dice.length; i++) {
          const d = this.dice[i]
          const ep = (MAX_STEPS - 1) * 3
          const eq = (MAX_STEPS - 1) * 4
          d.x = d.trajPos[ep]; d.y = d.trajPos[ep + 1]; d.z = d.trajPos[ep + 2]
          d.qx = d.trajQuat[eq]; d.qy = d.trajQuat[eq + 1]; d.qz = d.trajQuat[eq + 2]; d.qw = d.trajQuat[eq + 3]
          d.speed = 0
          d.settled = true
        }
        if (this.mode !== 'hidden') {
          this._triggerClimaxFX()
          if (this.audio) this.audio.playSettle(this.theme.soundPreset, this.tier)
        }
        if (this.onRollSettled) this.onRollSettled(this)
      }
    } else {
      this.settleTime += rawDt
      this.climax = Math.max(0, 1.0 - this.settleTime * 0.48)
      this.bulletTimeAmount *= Math.max(0, 1 - rawDt * 10)
      for (let i = 0; i < this.dice.length; i++) {
        if (this.dice[i].trailCount > 0) this.dice[i].trailCount = Math.max(0, this.dice[i].trailCount - 2)
      }
    }

    // 3. 更新贴花、剑气、光学冲击波与粒子池
    for (const imp of this.impacts) {
      if (imp.strength <= 0) continue
      imp.age += rawDt
      const maxL = this.theme.themeIndex === 4 ? 2.4 : 1.15
      if (imp.age > maxL) imp.strength = 0
    }

    for (const sl of this.slashes) {
      if (!sl.active) continue
      sl.age += rawDt
      if (sl.age >= sl.life) sl.active = false
    }

    if (this.shockAge < 1.2) {
      this.shockAge += rawDt
      const p = this.shockAge / 0.85
      if (p >= 1) {
        this.shockwave[3] = 0
        this.shockAge = 99
      } else {
        this.shockwave[2] = 0.02 + p * 0.88
        this.shockwave[3] *= Math.max(0, 1 - rawDt * 2.6)
      }
    }

    this._stepParticles(rawDt * (1 - this.bulletTimeAmount * 0.65))
    this._updateSpringCamera(rawDt)
  }

  _stepParticles(dt) {
    const p = this.particles
    if (p.aliveCount === 0) return
    let alive = 0
    for (let i = 0; i < p.capacity; i++) {
      if (!p.active[i]) continue
      const age = p.age[i] + dt
      if (age >= p.life[i]) {
        p.active[i] = 0
        continue
      }
      alive++
      p.age[i] = age
      if (p.mode[i] < 0.5) {
        const drag = Math.max(0, 1 - p.drag[i] * dt)
        p.vx[i] *= drag
        p.vy[i] *= drag
        p.vz[i] = p.vz[i] * drag - p.grav[i] * dt
        p.x[i] += p.vx[i] * dt
        p.y[i] += p.vy[i] * dt
        p.z[i] += p.vz[i] * dt
        if (p.z[i] < 2) {
          p.z[i] = 2
          p.vz[i] = Math.abs(p.vz[i]) * 0.45
          p.vx[i] *= 0.78
          p.vy[i] *= 0.78
        }
      }
    }
    p.aliveCount = alive
  }

  _updateSpringCamera(dt) {
    let cx = 0, cy = 8, cz = 14
    if (this.dice.length > 0) {
      let sx = 0, sy = 0, sz = 0
      for (const d of this.dice) { sx += d.x; sy += d.y; sz += d.z }
      cx = (sx / this.dice.length) * 0.42
      cy = (sy / this.dice.length) * 0.42
      cz = Math.min(48, (sz / this.dice.length) * 0.35)
    }

    let zoom = 1.0
    if (this.cinematicCamEnabled) {
      if (this.charging) {
        zoom = 1.08 + Math.min(1, this.chargeTime) * 0.08 // 蓄力拉远蓄势
      } else if (this.bulletTimeAmount > 0.05) {
        zoom = 1.0 - this.bulletTimeAmount * 0.24 // 子弹时间戏剧性推镜特写！
      } else if (this.settled && this.settleTime < 1.1 && (this.tier === 'critical' || this.tier === 'fumble') && this.dice.length <= 4) {
        zoom = 0.84 + (this.settleTime / 1.1) * 0.16
      }
    }

    // 震屏衰减
    this.shakeAmp *= Math.max(0, 1 - dt * 14)
    const shakeX = (Math.random() - 0.5) * 2 * this.shakeAmp
    const shakeY = (Math.random() - 0.5) * 2 * this.shakeAmp
    const shakeZ = (Math.random() - 0.5) * 1.4 * this.shakeAmp

    const targetEyeX = cx * 0.35 + shakeX
    const targetEyeY = this.baseEye[1] * zoom + cy * 0.25 + shakeY
    const targetEyeZ = this.baseEye[2] * zoom + shakeZ

    const smooth = Math.min(1, dt * 8.5)
    this.camEye[0] += (targetEyeX - this.camEye[0]) * smooth
    this.camEye[1] += (targetEyeY - this.camEye[1]) * smooth
    this.camEye[2] += (targetEyeZ - this.camEye[2]) * smooth

    this.camTarget[0] += (cx - this.camTarget[0]) * smooth
    this.camTarget[1] += (cy - this.camTarget[1]) * smooth
    this.camTarget[2] += (cz - this.camTarget[2]) * smooth

    const baseChroma = this.theme.themeIndex === 3 ? 0.22 : 0.05
    this.chroma += (baseChroma - this.chroma) * Math.min(1, dt * 6.0)
  }

  _renderAll() {
    const hiddenMask = this.mode === 'hidden' && !this.revealed
    const tierCode = hiddenMask || !this.settled ? 0 : (TIER_CODE_MAP[this.tier] || 2)

    this.renderer.render({
      time: this.clock,
      themeId: this.theme.themeIndex,
      tierCode,
      climax: this.climax,
      charge: this.charging ? Math.min(1, this.chargeTime / 0.8) : 0,
      camEye: this.camEye,
      camTarget: this.camTarget,
      camFovRad: this.camFov,
      dice: this.dice,
      impacts: this.impacts,
      slashes: this.slashes,
      particles: this.particles,
      shockwave: this.shockwave,
      chroma: this.chroma,
      bulletTime: this.bulletTimeAmount,
      usePipsForD6: this.usePipsForD6,
      hiddenMask,
      bloomEnabled: this.quality !== 'lite'
    })

    if (this.hudCtx) {
      this._renderCrispVectorOverlay(hiddenMask)
    }
  }

  _renderCrispVectorOverlay(hiddenMask) {
    const ctx = this.hudCtx
    const W = this.cssW
    const H = this.cssH
    ctx.save()
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)

    // 1. 按住蓄力环与甩投引导提示
    if (this.charging) {
      const uv = this.renderer.projectToUV(this.chargeWorld.x, this.chargeWorld.y, 85, this._uvTmp)
      if (uv.visible) {
        const sx = uv.u * W
        const sy = (1 - uv.v) * H
        const c01 = Math.min(1, this.chargeTime / 0.85)
        const r = 38 + c01 * 22
        ctx.strokeStyle = this.theme.accent
        ctx.lineWidth = 2.2
        ctx.beginPath()
        ctx.arc(sx, sy, r, -Math.PI * 0.5, -Math.PI * 0.5 + Math.PI * 2 * c01)
        ctx.stroke()

        ctx.font = '700 11.5px system-ui, sans-serif'
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'center'
        ctx.fillText(
          this.buttonCharging
            ? `⚡ 聚能蓄力 ${Math.round(c01 * 100)}% · 松开按钮爆发投掷`
            : '松开或划动甩投！',
          sx,
          sy + r + 18
        )
      }
    }

    // 2. 全皮肤专属：落定拍案主题印章 / 铭牌（六套主题各有专属形态与醒目汉字）
    if (this.settled && !hiddenMask && this.settleTime < 2.5 && !this.compactMode) {
      drawThemeSealOverlay(ctx, {
        themeIndex: this.theme.themeIndex,
        tier: this.tier,
        settleTime: this.settleTime,
        sx: W - Math.min(115, W * 0.14),
        sy: Math.min(125, H * 0.25),
        scaleMul: 1
      })
    }

    // 3. 赛博超频专属：实时投影追踪骰子的全息锁定战术准星！
    if (this.theme.themeIndex === 3 && this.settled && !hiddenMask && this.settleTime < 2.4 && this.dice.length <= 6) {
      const fade = this.settleTime > 1.8 ? Math.max(0, 1 - (this.settleTime - 1.8) / 0.6) : Math.min(1, this.settleTime * 5)
      ctx.save()
      ctx.globalAlpha = fade
      ctx.strokeStyle = this.tier === 'fumble' ? '#ff2a85' : '#00f5d4'
      ctx.fillStyle = this.tier === 'fumble' ? '#ff2a85' : '#00f5d4'
      ctx.lineWidth = 1.6
      ctx.font = '700 10px ui-monospace, SFMono-Regular, Menlo, monospace'

      for (let i = 0; i < this.dice.length; i++) {
        const d = this.dice[i]
        const uv = this.renderer.projectToUV(d.x, d.y, d.z, this._uvTmp)
        if (!uv.visible) continue
        const px = uv.u * W
        const py = (1 - uv.v) * H
        const box = this.compactMode ? 22 : 34
        const len = 9

        ctx.beginPath()
        // 四角折线锁定框
        ctx.moveTo(px - box, py - box + len); ctx.lineTo(px - box, py - box); ctx.lineTo(px - box + len, py - box)
        ctx.moveTo(px + box - len, py - box); ctx.lineTo(px + box, py - box); ctx.lineTo(px + box, py - box + len)
        ctx.moveTo(px - box, py + box - len); ctx.lineTo(px - box, py + box); ctx.lineTo(px - box + len, py + box)
        ctx.moveTo(px + box - len, py + box); ctx.lineTo(px + box, py + box); ctx.lineTo(px + box, py + box - len)
        ctx.stroke()

        if (!this.compactMode) {
          ctx.fillText(`VAL:${d.faceValue} // ${this.tier.toUpperCase()}`, px - box, py - box - 6)
        }
      }
      ctx.restore()
    }

    // 4. 暗骰未揭晓：悬浮呼吸全视秘眼环
    if (hiddenMask && this.settled) {
      ctx.save()
      const pulse = 0.55 + 0.45 * Math.sin(this.clock * 4.2)
      ctx.strokeStyle = `rgba(122, 252, 214, ${0.45 + pulse * 0.4})`
      ctx.lineWidth = 1.8
      for (let i = 0; i < Math.min(6, this.dice.length); i++) {
        const d = this.dice[i]
        const uv = this.renderer.projectToUV(d.x, d.y, d.z + d.radius * 1.1, this._uvTmp)
        if (!uv.visible) continue
        const px = uv.u * W
        const py = (1 - uv.v) * H
        ctx.beginPath()
        ctx.arc(px, py, 20 + pulse * 5, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.restore()
    }

    ctx.restore()
  }
}
