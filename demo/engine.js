// ============================================================================
// demo/engine.js — 零分配 3D 刚体四元数精确落点物理引擎 + 多面体透视渲染器 + SoA 粒子池
// 核心技术亮点：
// 1. 四元数结合律逆向预补偿：Q_end * (Q_end^-1 * Q_desired) = Q_desired，
//    100% 保留多体弹性碰撞与桌面多次弹跳的真实角动量，同时毫秒不差自然停在指定密码学真骰点数！
// 2. 预分配 TypedArray 轨迹缓冲 + SoA 512 粒子池 + 插入排序面片缓冲：稳态热路径零 GC 分配。
// 3. 动效与粒子消散后自动挂起 requestAnimationFrame（0% 空闲功耗），交互即刻唤醒。
// ============================================================================

import { D6_PIPS, getMesh } from './polyhedra.js'

const CAM_TILT = 0.36 // ~20.6° 经典跑团俯视倾角
const SIN_TILT = Math.sin(CAM_TILT)
const COS_TILT = Math.cos(CAM_TILT)

// 主光源方向（左前上方暖主光）
const LIGHT_DIR = (() => {
  const lx = -0.38, ly = -0.44, lz = 0.813
  const len = Math.hypot(lx, ly, lz)
  return [lx / len, ly / len, lz / len]
})()

// 四元数工具 [x, y, z, w]
function qMul(ax, ay, az, aw, bx, by, bz, bw, out) {
  out[0] = aw * bx + ax * bw + ay * bz - az * by
  out[1] = aw * by - ax * bz + ay * bw + az * bx
  out[2] = aw * bz + ax * by - ay * bx + az * bw
  out[3] = aw * bw - ax * bx - ay * by - az * bz
}

function qNormalize(q) {
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
    qNormalize(out)
    return
  }
  const theta = Math.acos(dot)
  const sinT = Math.sin(theta)
  const wA = Math.sin((1 - t) * theta) / sinT
  const wB = Math.sin(t * theta) / sinT
  out[0] = ax * wA + bx * wB
  out[1] = ay * wA + by * wB
  out[2] = az * wA + bz * wB
  out[3] = aw * wA + bw * wB
}

// 由 3x3 正交旋转矩阵列向量（col0, col1, col2）提取单位四元数
function mat3ToQuat(m00, m10, m20, m01, m11, m21, m02, m12, m22, out) {
  const trace = m00 + m11 + m22
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0)
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
  qNormalize(out)
}

// 四元数转 3x3 旋转矩阵（行主序写入 9 元素 Float32Array）
function quatToMat3(qx, qy, qz, qw, m) {
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz
  const xx = qx * x2, xy = qx * y2, xz = qx * z2
  const yy = qy * y2, yz = qy * z2, zz = qz * z2
  const wx = qw * x2, wy = qw * y2, wz = qw * z2

  m[0] = 1 - (yy + zz); m[1] = xy - wz;       m[2] = xz + wy
  m[3] = xy + wz;       m[4] = 1 - (xx + zz); m[5] = yz - wx
  m[6] = xz - wy;       m[7] = yz + wx;       m[8] = 1 - (xx + yy)
}

const MAX_STEPS = 220 // 120Hz 下最长约 1.83s 物理轨迹
const SIM_DT = 1 / 120
const MAX_PARTICLES = 512
const MAX_SHOCKWAVES = 32

export class DiceStageEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d', { alpha: false })
    this.pixelCanvas = document.createElement('canvas')
    this.pixelCtx = this.pixelCanvas.getContext('2d', { alpha: false })

    this.audio = options.audio || null
    this.onTelemetry = options.onTelemetry || null
    this.onRollSettled = options.onRollSettled || null

    this.W = 800
    this.H = 500
    this.dpr = 1
    this.camDist = 1100
    this.style = null
    this.usePipsForD6 = false

    this.running = false
    this.rafId = 0
    this.clockSec = 0
    this.lastNow = 0
    this.hitStopRemaining = 0

    // 帧耗时环形统计
    this.frameTimes = new Float32Array(60)
    this.ftIdx = 0
    this.fps = 60
    this.fpsAccum = 0
    this.fpsFrames = 0

    // 状态对象（暴露给 StylePlugin）
    this.state = {
      custom: {},
      dice: [],
      tier: 'success',
      mode: 'normal',
      settled: true,
      settleTime: 10,
      rollTime: 0,
      simTime: 0,
      quality: 'ultra',
      revealed: false,
      total: 0,
      checkName: '命运裁定'
    }

    // 预分配粒子池 (SoA)
    this.pActive = new Uint8Array(MAX_PARTICLES)
    this.px = new Float32Array(MAX_PARTICLES)
    this.py = new Float32Array(MAX_PARTICLES)
    this.pz = new Float32Array(MAX_PARTICLES)
    this.pvx = new Float32Array(MAX_PARTICLES)
    this.pvy = new Float32Array(MAX_PARTICLES)
    this.pvz = new Float32Array(MAX_PARTICLES)
    this.pSize = new Float32Array(MAX_PARTICLES)
    this.pEndSize = new Float32Array(MAX_PARTICLES)
    this.pAge = new Float32Array(MAX_PARTICLES)
    this.pLife = new Float32Array(MAX_PARTICLES)
    this.pGrav = new Float32Array(MAX_PARTICLES)
    this.pDrag = new Float32Array(MAX_PARTICLES)
    this.pAlpha = new Float32Array(MAX_PARTICLES)
    this.pR = new Uint8Array(MAX_PARTICLES)
    this.pG = new Uint8Array(MAX_PARTICLES)
    this.pB = new Uint8Array(MAX_PARTICLES)
    this.pBlend = new Uint8Array(MAX_PARTICLES) // 0: source-over, 1: lighter
    this.pShape = new Uint8Array(MAX_PARTICLES) // 0: circle, 1: spark, 2: square, 3: ring, 4: shard
    this.pCursor = 0
    this.activeParticleCount = 0

    // 预分配冲击波池
    this.swActive = new Uint8Array(MAX_SHOCKWAVES)
    this.swX = new Float32Array(MAX_SHOCKWAVES)
    this.swY = new Float32Array(MAX_SHOCKWAVES)
    this.swMaxR = new Float32Array(MAX_SHOCKWAVES)
    this.swAge = new Float32Array(MAX_SHOCKWAVES)
    this.swLife = new Float32Array(MAX_SHOCKWAVES)
    this.swLW = new Float32Array(MAX_SHOCKWAVES)
    this.swColor = new Array(MAX_SHOCKWAVES).fill('#ffffff')
    this.swCursor = 0
    this.activeShockwaveCount = 0

    // 渲染热路径复用临时缓冲
    this._projOut = { sx: 0, sy: 0, scale: 1 }
    this._rotMat = new Float32Array(9)
    this._qTmp = new Float32Array(4)
    this._vertScreen = new Float32Array(32 * 3) // sx, sy, elev
    this._vertWorld = new Float32Array(32 * 3)
    this._faceOrder = new Int16Array(32)
    this._faceDepth = new Float32Array(32)
    this._polyVerts2D = new Float32Array(16)
    this._dieOrder = new Int16Array(32)
    this._dieDepth = new Float32Array(32)

    this._faceInfo = {
      die: null,
      faceIndex: 0,
      nx: 0, ny: 0, nz: 1,
      lightDot: 0.5,
      isTopFace: false,
      settled: false,
      settleTime: 0,
      tier: 'success',
      mode: 'normal',
      hidden: false,
      time: 0,
      out: {
        fill: '#222',
        stroke: '#888',
        lineWidth: 1.4,
        textFill: '#fff',
        textShadow: '',
        glowColor: '',
        glowBlur: 0,
        sheenAlpha: 0
      }
    }

    this._impactEvent = { x: 0, y: 0, z: 0, strength: 0.5, bounceIndex: 0, dieIndex: 0, sides: 20 }
    this._outcomeEvent = { tier: 'success', mode: 'normal', total: 0, dice: [] }
    this.bounceQueue = []
    this.bouncePlayCursor = 0
    this.maxSimDuration = 1.0

    // 绑定给 StylePlugin 的零分配 helpers
    const self = this
    this.helpers = {
      project(x, y, z, out) {
        const target = out || self._projOut
        const elev = y * SIN_TILT + z * COS_TILT
        const scale = self.camDist / Math.max(140, self.camDist - elev)
        target.sx = self.W * 0.5 + x * scale
        target.sy = self.H * 0.5 + (y * COS_TILT - z * SIN_TILT) * scale
        target.scale = scale
        return target
      },
      spawnParticle(opts) {
        if (!opts) return
        self._spawnParticle(opts)
      },
      spawnShockwave(x, y, maxRadius, life, color, lineWidth) {
        self._spawnShockwave(x, y, maxRadius, life, color, lineWidth)
      },
      clamp(v, min, max) {
        return v < min ? min : v > max ? max : v
      },
      lerp(a, b, t) {
        return a + (b - a) * t
      },
      smoothstep(e0, e1, x) {
        const t = Math.max(0, Math.min(1, (x - e0) / ((e1 - e0) || 1)))
        return t * t * (3 - 2 * t)
      },
      rand(min, max) {
        return min + Math.random() * (max - min)
      }
    }

    this.resize()
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    const w = Math.max(160, Math.round(rect.width || this.canvas.width || 800))
    const h = Math.max(90, Math.round(rect.height || this.canvas.height || 480))
    const dpr = Math.min(window.devicePixelRatio || 1, this.state.quality === 'lite' ? 1.25 : 2)

    if (this.W !== w || this.H !== h || this.dpr !== dpr) {
      this.W = w
      this.H = h
      this.dpr = dpr
      this.canvas.width = Math.round(w * dpr)
      this.canvas.height = Math.round(h * dpr)
      this.camDist = Math.max(w, h) * 1.45 + 360
      if (this.style && typeof this.style.init === 'function') {
        this.state.custom = {}
        this.style.init(this.ctx, this.W, this.H, this.state)
      }
    }
    this.renderSingleFrame()
  }

  setStyle(stylePlugin) {
    this.style = stylePlugin
    this.state.custom = {}
    if (this.style && typeof this.style.init === 'function') {
      this.style.init(this.ctx, this.W, this.H, this.state)
    }
    this.wake()
  }

  setQuality(quality) {
    this.state.quality = quality || 'ultra'
    this.resize()
    this.wake()
  }

  setUsePipsForD6(flag) {
    this.usePipsForD6 = Boolean(flag)
    this.renderSingleFrame()
  }

  revealHidden() {
    if (this.state.mode === 'hidden' && !this.state.revealed) {
      this.state.revealed = true
      this.state.settleTime = 0
      if (this.style && typeof this.style.onSettle === 'function') {
        this._outcomeEvent.tier = this.state.tier
        this._outcomeEvent.mode = 'normal'
        this._outcomeEvent.total = this.state.total
        this._outcomeEvent.dice = this.state.dice
        this.style.onSettle(this._outcomeEvent, this.state, this.helpers)
      }
      if (this.audio && this.style) {
        this.audio.playSettle(this.style.soundPreset || this.style.id, this.state.tier)
      }
      this.wake()
    }
  }

  _spawnParticle(opts) {
    if (this.state.quality === 'lite' && (this.pCursor & 1) === 1) {
      this.pCursor = (this.pCursor + 1) % MAX_PARTICLES
      return
    }
    const i = this.pCursor
    this.pCursor = (i + 1) % MAX_PARTICLES
    if (!this.pActive[i]) this.activeParticleCount++
    this.pActive[i] = 1
    this.px[i] = opts.x || 0
    this.py[i] = opts.y || 0
    this.pz[i] = opts.z || 0
    this.pvx[i] = opts.vx || 0
    this.pvy[i] = opts.vy || 0
    this.pvz[i] = opts.vz || 0
    this.pSize[i] = opts.size > 0 ? opts.size : 3
    this.pEndSize[i] = opts.endSize >= 0 ? opts.endSize : 0.4
    this.pAge[i] = 0
    this.pLife[i] = opts.life > 0.04 ? opts.life : 0.45
    this.pGrav[i] = opts.gravity !== undefined ? opts.gravity : 180
    this.pDrag[i] = opts.drag !== undefined ? opts.drag : 1.5
    this.pAlpha[i] = opts.a !== undefined ? opts.a : 0.9
    this.pR[i] = opts.r & 255
    this.pG[i] = opts.g & 255
    this.pB[i] = opts.b & 255
    this.pBlend[i] = opts.blend === 'source-over' ? 0 : 1
    const sh = opts.shape
    this.pShape[i] = sh === 'spark' ? 1 : sh === 'square' ? 2 : sh === 'ring' ? 3 : sh === 'shard' ? 4 : 0
  }

  _spawnShockwave(x, y, maxRadius, life, color, lineWidth) {
    const i = this.swCursor
    this.swCursor = (i + 1) % MAX_SHOCKWAVES
    if (!this.swActive[i]) this.activeShockwaveCount++
    this.swActive[i] = 1
    this.swX[i] = x || 0
    this.swY[i] = y || 0
    this.swMaxR[i] = maxRadius || 90
    this.swAge[i] = 0
    this.swLife[i] = life > 0.05 ? life : 0.65
    this.swColor[i] = color || '#ffd166'
    this.swLW[i] = lineWidth || 2.2
  }

  /**
   * 发起一次真骰物理投掷！
   * spec = {
   *   diceSpecs: [{ meshKey: 'd20', sides: 20, targetValue: 20 }, ...],
   *   tier: 'critical'|'success'|'costly'|'failure'|'fumble',
   *   mode: 'normal'|'fate'|'push'|'hidden',
   *   total: number,
   *   checkName: string,
   *   compact?: boolean
   * }
   */
  throwDice(spec = {}) {
    const diceSpecs = spec.diceSpecs && spec.diceSpecs.length
      ? spec.diceSpecs
      : [{ meshKey: 'd20', sides: 20, targetValue: 20 }]
    const count = diceSpecs.length

    // 重置瞬态粒子但保留风格背景槽位
    this.pActive.fill(0)
    this.activeParticleCount = 0
    this.swActive.fill(0)
    this.activeShockwaveCount = 0
    this.hitStopRemaining = 0

    const minDim = Math.min(this.W, this.H)
    const sizeFactor = count <= 1 ? 0.125 : count <= 2 ? 0.108 : count <= 4 ? 0.092 : count <= 10 ? 0.072 : 0.056
    const baseRadius = Math.max(13, Math.min(54, minDim * sizeFactor))

    const boundX = Math.max(40, this.W * 0.37 - baseRadius)
    const boundY = Math.max(26, this.H * 0.31 - baseRadius)

    // 复用或扩展骰子对象池
    const dice = []
    for (let i = 0; i < count; i++) {
      const ds = diceSpecs[i]
      const mesh = getMesh(ds.meshKey)
      // 查找与 targetValue 匹配的目标面
      let targetFace = mesh.faces[0]
      for (let f = 0; f < mesh.faces.length; f++) {
        if (mesh.faces[f].value === ds.targetValue) {
          targetFace = mesh.faces[f]
          break
        }
      }

      // 从舞台边缘扇形抛入中心
      const side = (i % 2 === 0 ? -1 : 1) * (0.7 + Math.random() * 0.3)
      const startX = side * boundX * (0.78 + Math.random() * 0.2)
      const startY = boundY * (0.55 + Math.random() * 0.42)
      const startZ = baseRadius + 95 + Math.random() * 75 + (i % 4) * 14

      // 目标落点扇形散开，减少终态堆叠
      const ringR = count === 1 ? 0 : Math.min(boundX * 0.62, baseRadius * (1.55 + Math.sqrt(count) * 0.72))
      const slotAngle = (i / Math.max(1, count)) * Math.PI * 2 + (Math.random() - 0.5) * 0.42
      const aimX = Math.cos(slotAngle) * ringR * (0.55 + Math.random() * 0.45)
      const aimY = Math.sin(slotAngle) * ringR * 0.68 * (0.55 + Math.random() * 0.45)

      const flightT = 0.36 + Math.random() * 0.08
      const vx = (aimX - startX) / flightT + (Math.random() - 0.5) * 60
      const vy = (aimY - startY) / flightT + (Math.random() - 0.5) * 60
      const vz = 90 + Math.random() * 110

      dice.push({
        index: i,
        mesh,
        meshKey: ds.meshKey,
        sides: ds.sides || mesh.faceCount,
        faceValue: ds.targetValue,
        targetFace,
        radius: baseRadius * (ds.meshKey === 'd4' ? 1.08 : 1.0),
        x: startX,
        y: startY,
        z: startZ,
        vx,
        vy,
        vz,
        wx: (Math.random() < 0.5 ? -1 : 1) * (13 + Math.random() * 11),
        wy: (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 11),
        wz: (Math.random() - 0.5) * 14,
        qx: 0, qy: 0, qz: 0, qw: 1,
        speed: Math.hypot(vx, vy, vz),
        settled: false,
        settleStep: MAX_STEPS - 1,
        bounces: 0,
        trajPos: new Float32Array(MAX_STEPS * 3),
        trajQuat: new Float32Array(MAX_STEPS * 4),
        trajSpeed: new Float32Array(MAX_STEPS),
        trailX: new Float32Array(24),
        trailY: new Float32Array(24),
        trailZ: new Float32Array(24),
        trailCount: 0,
        trailHead: 0
      })
    }

    this._bakePhysicsTrajectories(dice, boundX, boundY)

    this.state.dice = dice
    this.state.tier = spec.tier || 'success'
    this.state.mode = spec.mode || 'normal'
    this.state.revealed = false
    this.state.total = spec.total !== undefined ? spec.total : dice.reduce((s, d) => s + d.faceValue, 0)
    this.state.checkName = spec.checkName || '命运检定'
    this.state.settled = false
    this.state.settleTime = 0
    this.state.rollTime = 0
    this.state.simTime = 0
    this.bouncePlayCursor = 0

    if (this.audio && this.style) {
      this.audio.playThrowWhoosh(this.style.soundPreset || this.style.id)
    }

    this.wake()
  }

  /**
   * 120Hz 前向刚体多体碰撞预烘焙 + 四元数逆向精确对齐目标点数面！
   */
  _bakePhysicsTrajectories(dice, boundX, boundY) {
    const count = dice.length
    const gravity = 1580
    this.bounceQueue.length = 0
    const dq = new Float32Array(4)
    const qNext = new Float32Array(4)

    let maxSettleStep = 40

    for (let step = 0; step < MAX_STEPS; step++) {
      // 1. 积分位置与旋转
      for (let i = 0; i < count; i++) {
        const d = dice[i]
        const floorZ = d.radius * 0.68

        if (!d._simSettled) {
          d.vz -= gravity * SIM_DT
          d.x += d.vx * SIM_DT
          d.y += d.vy * SIM_DT
          d.z += d.vz * SIM_DT

          // 空气微阻尼
          d.vx *= 0.996
          d.vy *= 0.996

          // 护栏弹性反弹
          if (d.x < -boundX) { d.x = -boundX; d.vx = Math.abs(d.vx) * 0.68; d.wz += 4 }
          else if (d.x > boundX) { d.x = boundX; d.vx = -Math.abs(d.vx) * 0.68; d.wz -= 4 }
          if (d.y < -boundY) { d.y = -boundY; d.vy = Math.abs(d.vy) * 0.68; d.wx += 4 }
          else if (d.y > boundY) { d.y = boundY; d.vy = -Math.abs(d.vy) * 0.68; d.wx -= 4 }

          // 桌面弹跳碰撞
          if (d.z <= floorZ) {
            d.z = floorZ
            const impactV = -d.vz
            if (impactV > 58 && d.bounces < 5) {
              const rest = Math.max(0.24, 0.56 - d.bounces * 0.09)
              d.vz = impactV * rest
              d.vx *= 0.76
              d.vy *= 0.76
              // 地面摩擦耦合旋转冲击，呈现真实棱角磕碰翻滚感
              d.wx = d.wx * 0.66 - d.vy * 0.045 + (Math.random() - 0.5) * 6
              d.wy = d.wy * 0.66 + d.vx * 0.045 + (Math.random() - 0.5) * 6
              d.wz *= 0.72
              const strength = Math.min(1, impactV / 560)
              this.bounceQueue.push({
                simTime: step * SIM_DT,
                x: d.x,
                y: d.y,
                z: 2,
                strength,
                bounceIndex: d.bounces,
                dieIndex: i,
                sides: d.sides
              })
              d.bounces++
            } else {
              // 贴地滑行阻尼直至静止
              d.vz = 0
              d.vx *= 0.80
              d.vy *= 0.80
              d.wx *= 0.76
              d.wy *= 0.76
              d.wz *= 0.76
              if (Math.hypot(d.vx, d.vy) < 6 && Math.hypot(d.wx, d.wy, d.wz) < 0.45 && step > 36) {
                d.vx = 0; d.vy = 0; d.vz = 0
                d.wx = 0; d.wy = 0; d.wz = 0
                d._simSettled = true
                d.settleStep = step
                if (step > maxSettleStep) maxSettleStep = step
              }
            }
          }

          // 世界空间角速度四元数步进：q_{k+1} = dq(w * dt) * q_k
          const wMag = Math.hypot(d.wx, d.wy, d.wz)
          if (wMag > 1e-4) {
            const half = 0.5 * wMag * SIM_DT
            const s = Math.sin(half) / wMag
            dq[0] = d.wx * s
            dq[1] = d.wy * s
            dq[2] = d.wz * s
            dq[3] = Math.cos(half)
            qMul(dq[0], dq[1], dq[2], dq[3], d.qx, d.qy, d.qz, d.qw, qNext)
            qNormalize(qNext)
            d.qx = qNext[0]; d.qy = qNext[1]; d.qz = qNext[2]; d.qw = qNext[3]
          }
        }
      }

      // 2. 多骰 3D 球体弹性冲量分离（真实互撞弹开！）
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const a = dice[i]
          const b = dice[j]
          const minDist = (a.radius + b.radius) * 0.94
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dz = b.z - a.z
          const distSq = dx * dx + dy * dy + dz * dz
          if (distSq < minDist * minDist && distSq > 1e-4) {
            const dist = Math.sqrt(distSq)
            const nx = dx / dist, ny = dy / dist, nz = dz / dist
            const overlap = (minDist - dist) * 0.52
            a.x -= nx * overlap; a.y -= ny * overlap
            b.x += nx * overlap; b.y += ny * overlap
            if (a.z > a.radius * 0.7) a.z -= nz * overlap * 0.5
            if (b.z > b.radius * 0.7) b.z += nz * overlap * 0.5

            const rvx = b.vx - a.vx
            const rvy = b.vy - a.vy
            const rvz = b.vz - a.vz
            const relNormal = rvx * nx + rvy * ny + rvz * nz
            if (relNormal < 0) {
              const imp = -0.82 * relNormal
              a.vx -= nx * imp; a.vy -= ny * imp; a.vz -= nz * imp * 0.4
              b.vx += nx * imp; b.vy += ny * imp; b.vz += nz * imp * 0.4
              a._simSettled = false
              b._simSettled = false
              const hitStrength = Math.min(1, imp / 280)
              if (hitStrength > 0.25 && this.bounceQueue.length < 96) {
                this.bounceQueue.push({
                  simTime: step * SIM_DT,
                  x: (a.x + b.x) * 0.5,
                  y: (a.y + b.y) * 0.5,
                  z: (a.z + b.z) * 0.5,
                  strength: hitStrength * 0.85,
                  bounceIndex: 1,
                  dieIndex: i,
                  sides: a.sides
                })
              }
            }
          }
        }
      }

      // 3. 记录位置与累计旋转 Q_world(step)
      for (let i = 0; i < count; i++) {
        const d = dice[i]
        const po = step * 3
        d.trajPos[po] = d.x
        d.trajPos[po + 1] = d.y
        d.trajPos[po + 2] = d.z
        d.trajSpeed[step] = Math.hypot(d.vx, d.vy, d.vz)

        const qo = step * 4
        d.trajQuat[qo] = d.qx
        d.trajQuat[qo + 1] = d.qy
        d.trajQuat[qo + 2] = d.qz
        d.trajQuat[qo + 3] = d.qw
      }
    }

    // 兜底收敛步数
    for (let i = 0; i < count; i++) {
      if (!dice[i]._simSettled) {
        dice[i].settleStep = MAX_STEPS - 2
        maxSettleStep = MAX_STEPS - 2
      }
    }
    this.maxSimDuration = maxSettleStep * SIM_DT
    this.bounceQueue.sort((a, b) => a.simTime - b.simTime)

    // 4. 关键魔法：对每颗骰子求 q_init = conj(Q_world_final) * q_desired
    //    然后把整条轨迹更新为 q(step) = Q_world(step) * q_init！
    const qDesired = new Float32Array(4)
    const qInit = new Float32Array(4)
    const qBaked = new Float32Array(4)

    // 期望朝向：目标面法线对准带倾角的观察视线 (0, sin(0.8*tilt), cos(0.8*tilt))，数字正向朝下微带自然偏航
    const viewTilt = CAM_TILT * 0.82
    const wnX = 0, wnY = Math.sin(viewTilt), wnZ = Math.cos(viewTilt)
    const baseWvX = 0, baseWvY = Math.cos(viewTilt), baseWvZ = -Math.sin(viewTilt)

    for (let i = 0; i < count; i++) {
      const d = dice[i]
      const tf = d.targetFace
      // 给每颗骰子 ±9° 微小自然桌面偏航角，既端正易读又不死板平行
      const yaw = (Math.random() - 0.5) * 0.30
      const cy = Math.cos(yaw), sy = Math.sin(yaw)
      // 绕 wn 轴旋转 baseWu=(1,0,0) 与 baseWv
      const wuX = cy, wuY = baseWvY * sy, wuZ = baseWvZ * sy
      const wvX = -sy, wvY = baseWvY * cy, wvZ = baseWvZ * cy

      const ux = tf.uAxis[0], uy = tf.uAxis[1], uz = tf.uAxis[2]
      const vx = tf.vAxis[0], vy = tf.vAxis[1], vz = tf.vAxis[2]
      const nx = tf.normal[0], ny = tf.normal[1], nz = tf.normal[2]

      // R_desired = [Wu, Wv, Wn] * [u^T; v^T; n^T]
      const m00 = wuX * ux + wvX * vx + wnX * nx
      const m10 = wuY * ux + wvY * vx + wnY * nx
      const m20 = wuZ * ux + wvZ * vx + wnZ * nx

      const m01 = wuX * uy + wvX * vy + wnX * ny
      const m11 = wuY * uy + wvY * vy + wnY * ny
      const m21 = wuZ * uy + wvZ * vy + wnZ * ny

      const m02 = wuX * uz + wvX * vz + wnX * nz
      const m12 = wuY * uz + wvY * vz + wnY * nz
      const m22 = wuZ * uz + wvZ * vz + wnZ * nz

      mat3ToQuat(m00, m10, m20, m01, m11, m21, m02, m12, m22, qDesired)

      const endO = (MAX_STEPS - 1) * 4
      const qEndX = d.trajQuat[endO]
      const qEndY = d.trajQuat[endO + 1]
      const qEndZ = d.trajQuat[endO + 2]
      const qEndW = d.trajQuat[endO + 3]

      // qInit = conj(qEnd) * qDesired
      qMul(-qEndX, -qEndY, -qEndZ, qEndW, qDesired[0], qDesired[1], qDesired[2], qDesired[3], qInit)
      qNormalize(qInit)

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

      // 初始化第 0 帧姿态
      d.x = d.trajPos[0]; d.y = d.trajPos[1]; d.z = d.trajPos[2]
      d.qx = d.trajQuat[0]; d.qy = d.trajQuat[1]; d.qz = d.trajQuat[2]; d.qw = d.trajQuat[3]
      d.trailCount = 1
      d.trailHead = 0
      d.trailX[0] = d.x; d.trailY[0] = d.y; d.trailZ[0] = d.z
    }
  }

  wake() {
    if (this.running) return
    this.running = true
    this.lastNow = performance.now()
    const tick = now => {
      if (!this.running) return
      const t0 = performance.now()
      const rawDt = Math.min(0.05, Math.max(0.001, (now - this.lastNow) * 0.001))
      this.lastNow = now

      this._step(rawDt)
      this._render()

      const frameCpu = performance.now() - t0
      this.frameTimes[this.ftIdx] = frameCpu
      this.ftIdx = (this.ftIdx + 1) % this.frameTimes.length
      this.fpsAccum += rawDt
      this.fpsFrames++
      if (this.fpsAccum >= 0.25) {
        this.fps = Math.round(this.fpsFrames / this.fpsAccum)
        this.fpsAccum = 0
        this.fpsFrames = 0
        this._emitTelemetry(true)
      }

      // 自动休眠检测：骰子已落定 + 无存活粒子/冲击波 + 风格后效完毕 => 停止 RAF 零功耗！
      const styleActive = this.style && typeof this.style.hasActiveFX === 'function'
        ? this.style.hasActiveFX(this.state)
        : this.state.settleTime < 2.0

      if (this.state.settled && this.activeParticleCount === 0 && this.activeShockwaveCount === 0 && !styleActive) {
        this.running = false
        this._emitTelemetry(false)
        return
      }

      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  stop() {
    this.running = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
  }

  renderSingleFrame() {
    this._render()
  }

  _emitTelemetry(isActive) {
    if (!this.onTelemetry) return
    let sum = 0, max = 0
    for (let i = 0; i < this.frameTimes.length; i++) {
      const v = this.frameTimes[i]
      sum += v
      if (v > max) max = v
    }
    this.onTelemetry({
      fps: isActive ? this.fps : 0,
      avgMs: sum / this.frameTimes.length,
      maxMs: max,
      particles: this.activeParticleCount,
      diceCount: this.state.dice.length,
      sleeping: !isActive
    })
  }

  _step(rawDt) {
    this.clockSec += rawDt
    const state = this.state
    const style = this.style

    // 街机顿帧 Hit-Stop 支持
    if (this.hitStopRemaining > 0) {
      this.hitStopRemaining--
      this._stepParticles(rawDt * 0.25)
      return
    }

    const scale = style && typeof style.timeScale === 'function' && !state.settled
      ? style.timeScale(state.rollTime, state)
      : 1.0
    const dt = rawDt * Math.max(0.15, Math.min(2.0, scale))

    state.rollTime += rawDt
    if (!state.settled) {
      state.simTime += dt
      const fStep = state.simTime / SIM_DT
      const s0 = Math.min(MAX_STEPS - 2, Math.max(0, fStep | 0))
      const alpha = Math.max(0, Math.min(1, fStep - s0))
      const s1 = s0 + 1

      let allDone = state.simTime >= this.maxSimDuration
      for (let i = 0; i < state.dice.length; i++) {
        const d = state.dice[i]
        const p0 = s0 * 3, p1 = s1 * 3
        d.x = d.trajPos[p0] + (d.trajPos[p1] - d.trajPos[p0]) * alpha
        d.y = d.trajPos[p0 + 1] + (d.trajPos[p1 + 1] - d.trajPos[p0 + 1]) * alpha
        d.z = d.trajPos[p0 + 2] + (d.trajPos[p1 + 2] - d.trajPos[p0 + 2]) * alpha
        d.speed = d.trajSpeed[s0] + (d.trajSpeed[s1] - d.trajSpeed[s0]) * alpha

        qSlerp(d.trajQuat, s0 * 4, d.trajQuat, s1 * 4, alpha, this._qTmp)
        d.qx = this._qTmp[0]; d.qy = this._qTmp[1]; d.qz = this._qTmp[2]; d.qw = this._qTmp[3]

        d.settled = s0 >= d.settleStep
        if (!d.settled) allDone = false

        // 推入拖尾环缓冲
        const th = (d.trailHead + 1) % 24
        d.trailHead = th
        d.trailX[th] = d.x
        d.trailY[th] = d.y
        d.trailZ[th] = d.z
        if (d.trailCount < 24) d.trailCount++
      }

      // 触发到达当前物理时刻的碰撞事件
      while (this.bouncePlayCursor < this.bounceQueue.length && this.bounceQueue[this.bouncePlayCursor].simTime <= state.simTime) {
        const b = this.bounceQueue[this.bouncePlayCursor++]
        if (style && typeof style.onBounce === 'function') {
          this._impactEvent.x = b.x
          this._impactEvent.y = b.y
          this._impactEvent.z = b.z
          this._impactEvent.strength = b.strength
          this._impactEvent.bounceIndex = b.bounceIndex
          this._impactEvent.dieIndex = b.dieIndex
          this._impactEvent.sides = b.sides
          style.onBounce(this._impactEvent, state, this.helpers)
        }
        if (this.audio && style) {
          this.audio.playBounce(style.soundPreset || style.id, b.strength)
        }
        if (style && style.hitStopFrames && b.strength > 0.65 && b.bounceIndex === 0) {
          this.hitStopRemaining = style.hitStopFrames
        }
      }

      if (allDone) {
        state.settled = true
        state.settleTime = 0
        for (let i = 0; i < state.dice.length; i++) {
          const d = state.dice[i]
          const endP = (MAX_STEPS - 1) * 3
          const endQ = (MAX_STEPS - 1) * 4
          d.x = d.trajPos[endP]; d.y = d.trajPos[endP + 1]; d.z = d.trajPos[endP + 2]
          d.qx = d.trajQuat[endQ]; d.qy = d.trajQuat[endQ + 1]; d.qz = d.trajQuat[endQ + 2]; d.qw = d.trajQuat[endQ + 3]
          d.speed = 0
          d.settled = true
        }
        if (style && style.hitStopFrames && (state.tier === 'critical' || state.tier === 'fumble')) {
          this.hitStopRemaining = style.hitStopFrames + 1
        }
        if (style && typeof style.onSettle === 'function') {
          this._outcomeEvent.tier = state.tier
          this._outcomeEvent.mode = state.mode
          this._outcomeEvent.total = state.total
          this._outcomeEvent.dice = state.dice
          style.onSettle(this._outcomeEvent, state, this.helpers)
        }
        if (this.audio && style && state.mode !== 'hidden') {
          this.audio.playSettle(style.soundPreset || style.id, state.tier)
        }
        if (this.onRollSettled) this.onRollSettled(state)
      }
    } else {
      state.settleTime += rawDt
      // 落定后平滑收拢拖尾
      for (let i = 0; i < state.dice.length; i++) {
        if (state.dice[i].trailCount > 0) state.dice[i].trailCount = Math.max(0, state.dice[i].trailCount - 2)
      }
    }

    this._stepParticles(dt)
  }

  _stepParticles(dt) {
    if (this.activeParticleCount > 0) {
      let alive = 0
      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (!this.pActive[i]) continue
        const age = this.pAge[i] + dt
        if (age >= this.pLife[i]) {
          this.pActive[i] = 0
          continue
        }
        alive++
        this.pAge[i] = age
        const drag = Math.max(0, 1 - this.pDrag[i] * dt)
        this.pvx[i] *= drag
        this.pvy[i] *= drag
        this.pvz[i] = this.pvz[i] * drag - this.pGrav[i] * dt
        this.px[i] += this.pvx[i] * dt
        this.py[i] += this.pvy[i] * dt
        this.pz[i] += this.pvz[i] * dt
        if (this.pz[i] < 0) {
          this.pz[i] = 0
          this.pvz[i] = Math.abs(this.pvz[i]) * 0.42
        }
      }
      this.activeParticleCount = alive
    }

    if (this.activeShockwaveCount > 0) {
      let swAlive = 0
      for (let i = 0; i < MAX_SHOCKWAVES; i++) {
        if (!this.swActive[i]) continue
        const age = this.swAge[i] + dt
        if (age >= this.swLife[i]) {
          this.swActive[i] = 0
          continue
        }
        swAlive++
        this.swAge[i] = age
      }
      this.activeShockwaveCount = swAlive
    }
  }

  _render() {
    const style = this.style
    if (!style) return
    const pScale = style.pixelScale || 1
    let ctx = this.ctx
    let scaleFactor = this.dpr

    if (pScale > 1) {
      const pw = Math.max(64, Math.round(this.W / pScale))
      const ph = Math.max(48, Math.round(this.H / pScale))
      if (this.pixelCanvas.width !== pw || this.pixelCanvas.height !== ph) {
        this.pixelCanvas.width = pw
        this.pixelCanvas.height = ph
      }
      ctx = this.pixelCtx
      scaleFactor = 1 / pScale
    }

    ctx.save()
    ctx.setTransform(scaleFactor, 0, 0, scaleFactor, 0, 0)

    // 1. 风格专属背景层
    style.drawBackground(ctx, this.W, this.H, this.clockSec, this.state, this.helpers)

    // 2. 桌面物理冲击波环
    this._drawShockwaves(ctx)

    // 3. 接触软阴影（随离地高度 z 自动柔化缩放）
    this._drawContactShadows(ctx, pScale > 1)

    // 4. 按远近深度排列骰子（画家算法）
    const dice = this.state.dice
    const dCount = dice.length
    for (let i = 0; i < dCount; i++) {
      this._dieOrder[i] = i
      this._dieDepth[i] = dice[i].y * SIN_TILT + dice[i].z * COS_TILT
    }
    for (let i = 1; i < dCount; i++) {
      const keyIdx = this._dieOrder[i]
      const keyDep = this._dieDepth[i]
      let j = i - 1
      while (j >= 0 && this._dieDepth[j] > keyDep) {
        this._dieOrder[j + 1] = this._dieOrder[j]
        this._dieDepth[j + 1] = this._dieDepth[j]
        j--
      }
      this._dieOrder[j + 1] = keyIdx
      this._dieDepth[j + 1] = keyDep
    }

    // 5. 先绘运动拖尾，再绘真实 3D 透视多面体与贴面数字/点数
    for (let k = 0; k < dCount; k++) {
      const die = dice[this._dieOrder[k]]
      if (die.trailCount > 1 && typeof style.drawDieTrail === 'function') {
        style.drawDieTrail(ctx, die, this.clockSec, this.state, this.helpers)
      }
    }
    for (let k = 0; k < dCount; k++) {
      this._draw3DDie(ctx, dice[this._dieOrder[k]], scaleFactor, pScale > 1)
    }

    // 6. 3D 空间粒子池渲染
    this._drawParticles(ctx)

    // 7. 风格专属前景层（星芒光柱 / 朱砂印章 / 赛博准星 / 诡秘封印眼 / 街机爆字）
    if (typeof style.drawForeground === 'function') {
      style.drawForeground(ctx, this.W, this.H, this.clockSec, this.state, this.helpers)
    }

    ctx.restore()

    // 若启用像素风低分缓冲，硬边无损放大回主画布
    if (pScale > 1) {
      this.ctx.save()
      this.ctx.setTransform(1, 0, 0, 1, 0, 0)
      this.ctx.imageSmoothingEnabled = false
      this.ctx.drawImage(this.pixelCanvas, 0, 0, this.canvas.width, this.canvas.height)
      this.ctx.restore()
    }
  }

  _drawContactShadows(ctx, pixelated) {
    const dice = this.state.dice
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    for (let i = 0; i < dice.length; i++) {
      const d = dice[i]
      const height = Math.max(0, d.z - d.radius * 0.68)
      const hRatio = Math.min(1, height / 190)
      const { sx, sy, scale } = this.helpers.project(d.x + height * 0.16, d.y + height * 0.12, 0)
      const rx = d.radius * (0.96 + hRatio * 0.48) * scale
      const ry = rx * COS_TILT * 0.88
      const alpha = (1 - hRatio * 0.72) * 0.46

      if (pixelated) {
        ctx.fillStyle = `rgba(0,0,0,${alpha.toFixed(2)})`
        ctx.beginPath()
        ctx.ellipse(sx, sy, rx * 0.85, ry * 0.85, 0, 0, Math.PI * 2)
        ctx.fill()
      } else {
        const g = ctx.createRadialGradient(sx, sy, rx * 0.12, sx, sy, rx)
        g.addColorStop(0, `rgba(0, 0, 0, ${alpha})`)
        g.addColorStop(0.65, `rgba(0, 0, 0, ${alpha * 0.42})`)
        g.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.ellipse(sx, sy, rx, ry, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  _drawShockwaves(ctx) {
    if (this.activeShockwaveCount === 0) return
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < MAX_SHOCKWAVES; i++) {
      if (!this.swActive[i]) continue
      const p = this.swAge[i] / this.swLife[i]
      const ease = 1 - (1 - p) * (1 - p)
      const { sx, sy, scale } = this.helpers.project(this.swX[i], this.swY[i], 1)
      const r = Math.max(2, this.swMaxR[i] * ease * scale)
      ctx.globalAlpha = (1 - p) * 0.85
      ctx.strokeStyle = this.swColor[i]
      ctx.lineWidth = Math.max(0.8, this.swLW[i] * (1 - p * 0.65))
      ctx.beginPath()
      ctx.ellipse(sx, sy, r, r * COS_TILT, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  _drawParticles(ctx) {
    if (this.activeParticleCount === 0) return
    ctx.save()
    let currentBlend = -1
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!this.pActive[i]) continue
      const blend = this.pBlend[i]
      if (blend !== currentBlend) {
        currentBlend = blend
        ctx.globalCompositeOperation = blend === 1 ? 'lighter' : 'source-over'
      }
      const p = this.pAge[i] / this.pLife[i]
      const alpha = this.pAlpha[i] * (1 - p * p)
      if (alpha <= 0.01) continue

      const { sx, sy, scale } = this.helpers.project(this.px[i], this.py[i], this.pz[i])
      const sz = Math.max(0.6, (this.pSize[i] + (this.pEndSize[i] - this.pSize[i]) * p) * scale)
      ctx.globalAlpha = alpha
      ctx.fillStyle = `rgb(${this.pR[i]},${this.pG[i]},${this.pB[i]})`

      const shape = this.pShape[i]
      if (shape === 2) {
        ctx.fillRect(sx - sz * 0.5, sy - sz * 0.5, sz, sz)
      } else if (shape === 1) {
        // 十字速度星芒火花
        ctx.beginPath()
        ctx.moveTo(sx - sz * 1.4, sy)
        ctx.lineTo(sx, sy - sz * 0.45)
        ctx.lineTo(sx + sz * 1.4, sy)
        ctx.lineTo(sx, sy + sz * 0.45)
        ctx.closePath()
        ctx.fill()
      } else if (shape === 4) {
        // 棱晶三角碎片
        ctx.beginPath()
        ctx.moveTo(sx, sy - sz * 1.2)
        ctx.lineTo(sx + sz, sy + sz * 0.8)
        ctx.lineTo(sx - sz * 0.9, sy + sz * 0.6)
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.beginPath()
        ctx.arc(sx, sy, sz * 0.55, 0, Math.PI * 2)
        ctx.fill()
      }
    }
    ctx.restore()
  }

  _draw3DDie(ctx, die, scaleFactor, pixelated) {
    const mesh = die.mesh
    const m = this._rotMat
    quatToMat3(die.qx, die.qy, die.qz, die.qw, m)

    const r = die.radius
    const vCount = mesh.vertexCount
    const verts = mesh.vertices

    // 1. 顶点世界变换与透视投影
    for (let i = 0; i < vCount; i++) {
      const vo = i * 3
      const lx = verts[vo] * r
      const ly = verts[vo + 1] * r
      const lz = verts[vo + 2] * r

      const wx = die.x + m[0] * lx + m[1] * ly + m[2] * lz
      const wy = die.y + m[3] * lx + m[4] * ly + m[5] * lz
      const wz = die.z + m[6] * lx + m[7] * ly + m[8] * lz

      this._vertWorld[vo] = wx
      this._vertWorld[vo + 1] = wy
      this._vertWorld[vo + 2] = wz

      const pr = this.helpers.project(wx, wy, wz)
      this._vertScreen[vo] = pr.sx
      this._vertScreen[vo + 1] = pr.sy
      this._vertScreen[vo + 2] = wy * SIN_TILT + wz * COS_TILT
    }

    // 2. 筛选朝向相机的可见面并按深度排序
    let visCount = 0
    const faces = mesh.faces
    // 相机位置世界坐标：(0, camDist * SIN_TILT, camDist * COS_TILT)
    const camY = this.camDist * SIN_TILT
    const camZ = this.camDist * COS_TILT

    for (let f = 0; f < faces.length; f++) {
      const face = faces[f]
      const fn = face.normal
      const wnx = m[0] * fn[0] + m[1] * fn[1] + m[2] * fn[2]
      const wny = m[3] * fn[0] + m[4] * fn[1] + m[5] * fn[2]
      const wnz = m[6] * fn[0] + m[7] * fn[1] + m[8] * fn[2]

      const fc = face.center
      const fcx = die.x + (m[0] * fc[0] + m[1] * fc[1] + m[2] * fc[2]) * r
      const fcy = die.y + (m[3] * fc[0] + m[4] * fc[1] + m[5] * fc[2]) * r
      const fcz = die.z + (m[6] * fc[0] + m[7] * fc[1] + m[8] * fc[2]) * r

      // 视线向量 (cam - faceCenter) 与外法线点积 > 0 即正面可见！
      const toCamDot = (-fcx) * wnx + (camY - fcy) * wny + (camZ - fcz) * wnz
      if (toCamDot <= 0) continue

      const idx = visCount++
      this._faceOrder[idx] = f
      this._faceDepth[idx] = fcy * SIN_TILT + fcz * COS_TILT
    }

    // 插入排序（从远到近）
    for (let i = 1; i < visCount; i++) {
      const kf = this._faceOrder[i]
      const kd = this._faceDepth[i]
      let j = i - 1
      while (j >= 0 && this._faceDepth[j] > kd) {
        this._faceOrder[j + 1] = this._faceOrder[j]
        this._faceDepth[j + 1] = this._faceDepth[j]
        j--
      }
      this._faceOrder[j + 1] = kf
      this._faceDepth[j + 1] = kd
    }

    const hiddenMask = this.state.mode === 'hidden' && !this.state.revealed
    const info = this._faceInfo
    info.die = die
    info.settled = die.settled
    info.settleTime = this.state.settleTime
    info.tier = this.state.tier
    info.mode = this.state.mode
    info.hidden = hiddenMask
    info.time = this.clockSec

    // 3. 逐面着色、自定义棱面内雕纹与真实 3D 透视贴面数字！
    for (let k = 0; k < visCount; k++) {
      const face = faces[this._faceOrder[k]]
      const fIndices = face.indices
      const fvCount = fIndices.length

      const fn = face.normal
      const wnx = m[0] * fn[0] + m[1] * fn[1] + m[2] * fn[2]
      const wny = m[3] * fn[0] + m[4] * fn[1] + m[5] * fn[2]
      const wnz = m[6] * fn[0] + m[7] * fn[1] + m[8] * fn[2]

      const rawLight = wnx * LIGHT_DIR[0] + wny * LIGHT_DIR[1] + wnz * LIGHT_DIR[2]
      const lightDot = Math.max(0, Math.min(1, 0.5 + rawLight * 0.5))

      info.faceIndex = face.index
      info.nx = wnx
      info.ny = wny
      info.nz = wny * SIN_TILT + wnz * COS_TILT
      info.lightDot = lightDot
      info.isTopFace = face === die.targetFace && info.nz > 0.72

      const st = this.style.styleFace(info, this.state, this.helpers)

      let polyCx = 0, polyCy = 0
      ctx.beginPath()
      for (let v = 0; v < fvCount; v++) {
        const vi = fIndices[v] * 3
        const sx = this._vertScreen[vi]
        const sy = this._vertScreen[vi + 1]
        this._polyVerts2D[v * 2] = sx
        this._polyVerts2D[v * 2 + 1] = sy
        polyCx += sx
        polyCy += sy
        if (v === 0) ctx.moveTo(sx, sy)
        else ctx.lineTo(sx, sy)
      }
      ctx.closePath()
      polyCx /= fvCount
      polyCy /= fvCount

      ctx.save()
      if (!pixelated && st.glowBlur > 0 && st.glowColor && this.state.quality !== 'lite') {
        ctx.shadowColor = st.glowColor
        ctx.shadowBlur = st.glowBlur
      }
      ctx.fillStyle = st.fill
      ctx.fill()

      if (st.sheenAlpha > 0.01) {
        ctx.fillStyle = `rgba(255,255,255,${st.sheenAlpha.toFixed(3)})`
        ctx.fill()
      }

      ctx.shadowBlur = 0
      ctx.lineJoin = 'round'
      ctx.strokeStyle = st.stroke
      ctx.lineWidth = st.lineWidth || 1.3
      ctx.stroke()
      ctx.restore()

      // 估算屏幕面内半径
      const estRadius = Math.hypot(this._polyVerts2D[0] - polyCx, this._polyVerts2D[1] - polyCy) * 0.75

      // 风格专属面内纹饰钩子
      if (typeof this.style.drawFaceOverlay === 'function' && estRadius > 6) {
        ctx.save()
        this.style.drawFaceOverlay(ctx, polyCx, polyCy, estRadius, this._polyVerts2D, fvCount, info, this.state)
        ctx.restore()
      }

      // 真实 3D 切平面透视贴合文字或圆点！
      if (info.nz > 0.12 && estRadius > 5) {
        const fc = face.center
        const cxW = die.x + (m[0] * fc[0] + m[1] * fc[1] + m[2] * fc[2]) * r
        const cyW = die.y + (m[3] * fc[0] + m[4] * fc[1] + m[5] * fc[2]) * r
        const czW = die.z + (m[6] * fc[0] + m[7] * fc[1] + m[8] * fc[2]) * r

        const pCenter = this.helpers.project(cxW, cyW, czW)
        const pcx = pCenter.sx, pcy = pCenter.sy

        const gSpan = r * face.glyphRadius
        const ua = face.uAxis
        const uxW = cxW + (m[0] * ua[0] + m[1] * ua[1] + m[2] * ua[2]) * gSpan
        const uyW = cyW + (m[3] * ua[0] + m[4] * ua[1] + m[5] * ua[2]) * gSpan
        const uzW = czW + (m[6] * ua[0] + m[7] * ua[1] + m[8] * ua[2]) * gSpan
        const pU = this.helpers.project(uxW, uyW, uzW)
        const ux2d = pU.sx - pcx, uy2d = pU.sy - pcy

        const va = face.vAxis
        const vxW = cxW + (m[0] * va[0] + m[1] * va[1] + m[2] * va[2]) * gSpan
        const vyW = cyW + (m[3] * va[0] + m[4] * va[1] + m[5] * va[2]) * gSpan
        const vzW = czW + (m[6] * va[0] + m[7] * va[1] + m[8] * va[2]) * gSpan
        const pV = this.helpers.project(vxW, vyW, vzW)
        const vx2d = pV.sx - pcx, vy2d = pV.sy - pcy

        ctx.save()
        // 将局部 [-1, 1]^2 贴图坐标直接映射到 3D 旋转切平面屏幕投影！
        ctx.setTransform(
          ux2d * scaleFactor,
          uy2d * scaleFactor,
          vx2d * scaleFactor,
          vy2d * scaleFactor,
          pcx * scaleFactor,
          pcy * scaleFactor
        )

        if (this.usePipsForD6 && die.meshKey === 'd6' && !hiddenMask) {
          const pips = D6_PIPS[face.value] || D6_PIPS[1]
          ctx.fillStyle = face.value === 1 || face.value === 4 ? '#ff595e' : st.textFill
          for (let p = 0; p < pips.length; p++) {
            ctx.beginPath()
            ctx.arc(pips[p][0], pips[p][1], face.value === 1 ? 0.30 : 0.19, 0, Math.PI * 2)
            ctx.fill()
          }
        } else {
          const txt = hiddenMask ? '?' : face.label
          // 在 20x20 局部字体坐标下缩放绘制，避免极小字号抗锯齿失真
          ctx.scale(0.05, 0.05)
          ctx.font = txt.length >= 2
            ? '800 22px system-ui, -apple-system, "Segoe UI", sans-serif'
            : '800 27px system-ui, -apple-system, "Segoe UI", sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = st.textFill || '#ffffff'
          ctx.fillText(txt, 0, 0)

          if (!hiddenMask && face.needsUnderline) {
            ctx.fillRect(-7, 13, 14, 2.4)
          }
        }
        ctx.restore()
      }
    }
  }
}
