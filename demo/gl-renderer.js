// ============================================================================
// demo/gl-renderer.js — 零依赖原生 WebGL2 HDR 多通道渲染管线
// 渲染通道：
//   Pass 1: Scene HDR FBO (RGBA16F + Depth24)
//     1a. Ray-Plane 3D 视差舞台 + 软接触阴影 AO + 近场漫反射 Bounce GI + 落地贴花
//     1b. 圆角倒角 + 4通道法线凹凸雕文 + 内部视差 PBR/SSS 多面体
//     1c. 3D 摄像机朝向扭转丝带（星尘彗尾 / 书法飞白 / 凌空弧形剑气）
//     1d. 速度拉伸动态模糊火星粒子 & 冲天圣光柱 / 熔岩柱
//   Pass 2: 4 级 Mipmap Dual-Kawase HDR 辉光降采样与 Tent 升采样链
//   Pass 3: 屏幕空间径向冲击波透镜折射 + 动态色差 + 子弹时间冷焦 + ACES 色调映射
// ============================================================================

import { buildEngravedAtlasCanvas, GL_MESHES, GLYPH_TILE_MAP, VERTEX_FLOATS } from './gl-meshes.js'
import {
  ARENA_FRAG,
  BLOOM_DOWN_FRAG,
  BLOOM_UP_FRAG,
  COMPOSITE_FRAG,
  DICE_FRAG,
  DICE_VERT,
  FULLSCREEN_VERT,
  PARTICLE_FRAG,
  PARTICLE_VERT,
  RIBBON_FRAG,
  RIBBON_VERT
} from './gl-shaders.js'

// 轻量无分配 4x4 矩阵工具（列主序 Float32Array(16)）
export function mat4Perspective(out, fovyRad, aspect, near, far) {
  const f = 1.0 / Math.tan(fovyRad * 0.5)
  const nf = 1.0 / (near - far)
  out.fill(0)
  out[0] = f / aspect
  out[5] = f
  out[10] = (far + near) * nf
  out[11] = -1
  out[14] = 2 * far * near * nf
  return out
}

export function mat4LookAt(out, eye, target, up) {
  let zx = eye[0] - target[0]
  let zy = eye[1] - target[1]
  let zz = eye[2] - target[2]
  let len = Math.hypot(zx, zy, zz) || 1
  zx /= len; zy /= len; zz /= len

  let xx = up[1] * zz - up[2] * zy
  let xy = up[2] * zx - up[0] * zz
  let xz = up[0] * zy - up[1] * zx
  len = Math.hypot(xx, xy, xz) || 1
  xx /= len; xy /= len; xz /= len

  const yx = zy * xz - zz * xy
  const yy = zz * xx - zx * xz
  const yz = zx * xy - zy * xx

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2])
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2])
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2])
  out[15] = 1
  return out
}

export function mat4Multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3]
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7]
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11]
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15]

  for (let c = 0; c < 4; c++) {
    const bo = c * 4
    const b0 = b[bo], b1 = b[bo + 1], b2 = b[bo + 2], b3 = b[bo + 3]
    out[bo]     = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3
    out[bo + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3
    out[bo + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3
    out[bo + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3
  }
  return out
}

export function mat4Invert(out, m) {
  const m00 = m[0], m01 = m[1], m02 = m[2], m03 = m[3]
  const m10 = m[4], m11 = m[5], m12 = m[6], m13 = m[7]
  const m20 = m[8], m21 = m[9], m22 = m[10], m23 = m[11]
  const m30 = m[12], m31 = m[13], m32 = m[14], m33 = m[15]

  const b00 = m00 * m11 - m01 * m10
  const b01 = m00 * m12 - m02 * m10
  const b02 = m00 * m13 - m03 * m10
  const b03 = m01 * m12 - m02 * m11
  const b04 = m01 * m13 - m03 * m11
  const b05 = m02 * m13 - m03 * m12
  const b06 = m20 * m31 - m21 * m30
  const b07 = m20 * m32 - m22 * m30
  const b08 = m20 * m33 - m23 * m30
  const b09 = m21 * m32 - m22 * m31
  const b10 = m21 * m33 - m23 * m31
  const b11 = m22 * m33 - m23 * m32

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (Math.abs(det) < 1e-10) {
    out.fill(0)
    out[0] = out[5] = out[10] = out[15] = 1
    return out
  }
  det = 1.0 / det

  out[0]  = (m11 * b11 - m12 * b10 + m13 * b09) * det
  out[1]  = (m02 * b10 - m01 * b11 - m03 * b09) * det
  out[2]  = (m31 * b05 - m32 * b04 + m33 * b03) * det
  out[3]  = (m22 * b04 - m21 * b05 - m23 * b03) * det
  out[4]  = (m12 * b08 - m10 * b11 - m13 * b07) * det
  out[5]  = (m00 * b11 - m02 * b08 + m03 * b07) * det
  out[6]  = (m32 * b02 - m30 * b05 - m33 * b01) * det
  out[7]  = (m20 * b05 - m22 * b02 + m23 * b01) * det
  out[8]  = (m10 * b10 - m11 * b08 + m13 * b06) * det
  out[9]  = (m01 * b08 - m00 * b10 - m03 * b06) * det
  out[10] = (m30 * b04 - m31 * b02 + m33 * b00) * det
  out[11] = (m21 * b02 - m20 * b04 - m23 * b00) * det
  out[12] = (m11 * b07 - m10 * b09 - m12 * b06) * det
  out[13] = (m00 * b09 - m01 * b07 + m02 * b06) * det
  out[14] = (m31 * b01 - m30 * b03 - m32 * b00) * det
  out[15] = (m20 * b03 - m21 * b01 + m22 * b00) * det
  return out
}

// 四元数 [x,y,z,w] 转列主序 3x3 旋转矩阵（适配 GLSL mat3）
export function quatToMat3ColMajor(qx, qy, qz, qw, out) {
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz
  const xx = qx * x2, xy = qx * y2, xz = qx * z2
  const yy = qy * y2, yz = qy * z2, zz = qz * z2
  const wx = qw * x2, wy = qw * y2, wz = qw * z2

  // Column 0
  out[0] = 1 - (yy + zz)
  out[1] = xy + wz
  out[2] = xz - wy
  // Column 1
  out[3] = xy - wz
  out[4] = 1 - (xx + zz)
  out[5] = yz + wx
  // Column 2
  out[6] = xz + wy
  out[7] = yz - wx
  out[8] = 1 - (xx + yy)
}

function compileShader(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`GLSL Compile Error: ${log}`)
  }
  return sh
}

function linkProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc)
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc)
  const prog = gl.createProgram()
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog)
    gl.deleteProgram(prog)
    throw new Error(`GLSL Link Error: ${log}`)
  }
  return prog
}

// 共享雕文图集缓存（多画布复用同一张 2048x2048 Canvas，零重复烘焙开销！）
let sharedAtlasCanvas = null
function getSharedAtlasCanvas() {
  if (!sharedAtlasCanvas) sharedAtlasCanvas = buildEngravedAtlasCanvas()
  return sharedAtlasCanvas
}

const MAX_RIBBON_VERTS = 4096 // 每个顶点 9 floats: pos(3)+uv(2)+color(4)
const MAX_PARTICLE_VERTS = 6144 // 每个粒子 6 个顶点，每顶点 14 floats => 最多 1024 个活跃粒子/光柱

export class WebGLDiceRenderer {
  constructor(canvas) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false, // 我们在 HDR 离屏缓冲超采样并经后处理合成，更快更锐利
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl

    // 检测浮点渲染目标扩展
    this.hasFloatFBO = Boolean(gl.getExtension('EXT_color_buffer_float'))
    gl.getExtension('OES_texture_float_linear')

    this.width = 1
    this.height = 1
    this.fbos = null

    this._initPrograms()
    this._initAtlasTexture()
    this._initMeshVAOs()
    this._initDynamicBuffers()

    // 预分配 Uniform 上传缓冲（热路径零分配）
    this._proj = new Float32Array(16)
    this._view = new Float32Array(16)
    this._viewProj = new Float32Array(16)
    this._invViewProj = new Float32Array(16)
    this._rot3 = new Float32Array(9)
    this._diceSpheres = new Float32Array(24 * 4)
    this._impacts = new Float32Array(8 * 4)
    this._faceTiles = new Int32Array(20)
  }

  _initPrograms() {
    const gl = this.gl
    const cacheUniforms = (prog, names) => {
      const map = {}
      for (const n of names) map[n] = gl.getUniformLocation(prog, n)
      return { prog, u: map }
    }

    this.arenaProg = cacheUniforms(linkProgram(gl, FULLSCREEN_VERT, ARENA_FRAG), [
      'u_invViewProj', 'u_camPos', 'u_time', 'u_theme', 'u_tier',
      'u_climax', 'u_charge', 'u_diceCount', 'u_diceSpheres[0]', 'u_impacts[0]'
    ])

    this.diceProg = cacheUniforms(linkProgram(gl, DICE_VERT, DICE_FRAG), [
      'u_viewProj', 'u_rotMat', 'u_diePos', 'u_dieRadius',
      'u_atlas', 'u_camPos', 'u_time', 'u_theme', 'u_tier',
      'u_winningFace', 'u_settled', 'u_climax', 'u_faceTiles[0]'
    ])

    this.ribbonProg = cacheUniforms(linkProgram(gl, RIBBON_VERT, RIBBON_FRAG), [
      'u_viewProj', 'u_time', 'u_isInk'
    ])

    this.particleProg = cacheUniforms(linkProgram(gl, PARTICLE_VERT, PARTICLE_FRAG), [
      'u_viewProj', 'u_camPos'
    ])

    this.bloomDownProg = cacheUniforms(linkProgram(gl, FULLSCREEN_VERT, BLOOM_DOWN_FRAG), [
      'u_tex', 'u_texelSize', 'u_threshold'
    ])

    this.bloomUpProg = cacheUniforms(linkProgram(gl, FULLSCREEN_VERT, BLOOM_UP_FRAG), [
      'u_tex', 'u_texelSize', 'u_intensity'
    ])

    this.compositeProg = cacheUniforms(linkProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG), [
      'u_sceneTex', 'u_bloomTex', 'u_resolution', 'u_shockwave',
      'u_chroma', 'u_bulletTime', 'u_bloomStrength', 'u_time'
    ])

    this.emptyVAO = gl.createVertexArray()
  }

  _initAtlasTexture() {
    const gl = this.gl
    const atlasCanvas = getSharedAtlasCanvas()
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlasCanvas)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    // 倾斜顶面在 mipmap 下会把笔画糊成灰边，各向异性过滤救回锐度
    const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
      gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
    if (anisoExt) {
      const maxAniso = Math.min(16, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1)
      if (maxAniso > 1) gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso)
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.atlasTex = tex
  }

  _initMeshVAOs() {
    const gl = this.gl
    this.meshGPU = {}
    const stride = VERTEX_FLOATS * 4

    for (const [key, mesh] of Object.entries(GL_MESHES)) {
      const vao = gl.createVertexArray()
      const vbo = gl.createBuffer()
      gl.bindVertexArray(vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertexBufferData, gl.STATIC_DRAW)

      // 0: pos(3), 1: faceN(3), 2: smoothN(3), 3: tan(3), 4: bitan(3), 5: uv(2), 6: edge(1), 7: faceIdx(1)
      const attrs = [
        [0, 3, 0],
        [1, 3, 12],
        [2, 3, 24],
        [3, 3, 36],
        [4, 3, 48],
        [5, 2, 60],
        [6, 1, 68],
        [7, 1, 72]
      ]
      for (const [loc, size, offset] of attrs) {
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset)
      }
      gl.bindVertexArray(null)
      this.meshGPU[key] = { vao, vbo, vertexCount: mesh.vertexCount, mesh }
    }
  }

  _initDynamicBuffers() {
    const gl = this.gl

    // Ribbon VAO (pos:3, uv:2, color:4 => 9 floats = 36 bytes)
    this.ribbonData = new Float32Array(MAX_RIBBON_VERTS * 9)
    this.ribbonVAO = gl.createVertexArray()
    this.ribbonVBO = gl.createBuffer()
    gl.bindVertexArray(this.ribbonVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonVBO)
    gl.bufferData(gl.ARRAY_BUFFER, this.ribbonData.byteLength, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 20)

    // Particle VAO (center:3, vel:3, corner:2, color:4, sizeMode:2 => 14 floats = 56 bytes)
    this.particleData = new Float32Array(MAX_PARTICLE_VERTS * 14)
    this.particleVAO = gl.createVertexArray()
    this.particleVBO = gl.createBuffer()
    gl.bindVertexArray(this.particleVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVBO)
    gl.bufferData(gl.ARRAY_BUFFER, this.particleData.byteLength, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 56, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 56, 12)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 56, 24)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 56, 32)
    gl.enableVertexAttribArray(4)
    gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 56, 48)

    gl.bindVertexArray(null)
  }

  _createColorTarget(w, h, withDepth) {
    const gl = this.gl
    const tryCreate = useFloat => {
      const tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, tex)
      if (useFloat) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
      } else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

      const fbo = gl.createFramebuffer()
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)

      let depthRb = null
      if (withDepth) {
        depthRb = gl.createRenderbuffer()
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthRb)
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h)
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRb)
      }

      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      if (!ok) {
        gl.deleteFramebuffer(fbo)
        gl.deleteTexture(tex)
        if (depthRb) gl.deleteRenderbuffer(depthRb)
        return null
      }
      return { fbo, tex, depthRb, w, h }
    }

    if (this.hasFloatFBO) {
      const res = tryCreate(true)
      if (res) return res
      this.hasFloatFBO = false
    }
    return tryCreate(false)
  }

  _destroyFBOs() {
    if (!this.fbos) return
    const gl = this.gl
    const list = [this.fbos.scene, ...this.fbos.bloomMips]
    for (const item of list) {
      if (!item) continue
      gl.deleteFramebuffer(item.fbo)
      gl.deleteTexture(item.tex)
      if (item.depthRb) gl.deleteRenderbuffer(item.depthRb)
    }
    this.fbos = null
  }

  resize(pixelW, pixelH) {
    const w = Math.max(64, pixelW | 0)
    const h = Math.max(48, pixelH | 0)
    if (this.width === w && this.height === h && this.fbos) return

    this.width = w
    this.height = h
    this.canvas.width = w
    this.canvas.height = h
    this._destroyFBOs()

    const scene = this._createColorTarget(w, h, true)
    const bloomMips = []
    let bw = Math.max(16, w >> 1)
    let bh = Math.max(16, h >> 1)
    for (let i = 0; i < 4; i++) {
      bloomMips.push(this._createColorTarget(bw, bh, false))
      bw = Math.max(8, bw >> 1)
      bh = Math.max(8, bh >> 1)
    }
    this.fbos = { scene, bloomMips }
  }

  /**
   * 投影世界坐标到归一化屏幕 UV [0..1, 0..1]（供冲击波与 2D 印章/准星对齐）
   */
  projectToUV(wx, wy, wz, out) {
    const vp = this._viewProj
    const cx = vp[0] * wx + vp[4] * wy + vp[8] * wz + vp[12]
    const cy = vp[1] * wx + vp[5] * wy + vp[9] * wz + vp[13]
    const cw = vp[3] * wx + vp[7] * wy + vp[11] * wz + vp[15]
    if (cw <= 0.001) {
      out.u = -1; out.v = -1; out.visible = false
      return out
    }
    out.u = (cx / cw) * 0.5 + 0.5
    out.v = (cy / cw) * 0.5 + 0.5
    out.visible = true
    return out
  }

  /**
   * 反投影屏幕归一化坐标 (ndcX ∈ [-1,1], ndcY ∈ [-1,1]) 到指定世界高度平面 z = planeZ
   */
  unprojectToPlane(ndcX, ndcY, planeZ, out) {
    const ivp = this._invViewProj
    const transform = (zNdc, dst) => {
      const x = ivp[0] * ndcX + ivp[4] * ndcY + ivp[8] * zNdc + ivp[12]
      const y = ivp[1] * ndcX + ivp[5] * ndcY + ivp[9] * zNdc + ivp[13]
      const z = ivp[2] * ndcX + ivp[6] * ndcY + ivp[10] * zNdc + ivp[14]
      const w = ivp[3] * ndcX + ivp[7] * ndcY + ivp[11] * zNdc + ivp[15] || 1
      dst[0] = x / w; dst[1] = y / w; dst[2] = z / w
    }
    const nearP = [0, 0, 0], farP = [0, 0, 0]
    transform(-1, nearP)
    transform(1, farP)
    const dz = farP[2] - nearP[2]
    const t = Math.abs(dz) > 1e-5 ? (planeZ - nearP[2]) / dz : 0
    out.x = nearP[0] + (farP[0] - nearP[0]) * t
    out.y = nearP[1] + (farP[1] - nearP[1]) * t
    out.z = planeZ
    return out
  }

  /**
   * 渲染完整 HDR 帧！
   */
  render(frame) {
    const gl = this.gl
    if (!this.fbos || !this.fbos.scene) return

    const {
      time, themeId, tierCode, climax, charge,
      camEye, camTarget, camFovRad,
      dice, impacts, slashes,
      particles, shockwave, chroma, bulletTime,
      usePipsForD6, hiddenMask, bloomEnabled
    } = frame

    const aspect = this.width / Math.max(1, this.height)
    mat4Perspective(this._proj, camFovRad, aspect, 18.0, 2600.0)
    mat4LookAt(this._view, camEye, camTarget, [0, 0, 1])
    mat4Multiply(this._viewProj, this._proj, this._view)
    mat4Invert(this._invViewProj, this._viewProj)

    // ========================================================================
    // PASS 1: 渲染 3D HDR 场景到离屏浮点帧缓冲
    // ========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.scene.fbo)
    gl.viewport(0, 0, this.width, this.height)
    gl.clear(gl.DEPTH_BUFFER_BIT)

    // 1A. 3D 光线投射程序化舞台 + 软接触阴影 + 落地涟漪
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.useProgram(this.arenaProg.prog)
    const au = this.arenaProg.u
    gl.uniformMatrix4fv(au.u_invViewProj, false, this._invViewProj)
    gl.uniform3f(au.u_camPos, camEye[0], camEye[1], camEye[2])
    gl.uniform1f(au.u_time, time)
    gl.uniform1i(au.u_theme, themeId)
    gl.uniform1i(au.u_tier, tierCode)
    gl.uniform1f(au.u_climax, climax)
    gl.uniform1f(au.u_charge, charge)

    const dCount = Math.min(24, dice.length)
    gl.uniform1i(au.u_diceCount, dCount)
    this._diceSpheres.fill(0)
    for (let i = 0; i < dCount; i++) {
      const d = dice[i]
      const o = i * 4
      this._diceSpheres[o] = d.x
      this._diceSpheres[o + 1] = d.y
      this._diceSpheres[o + 2] = d.z
      this._diceSpheres[o + 3] = d.radius
    }
    gl.uniform4fv(au['u_diceSpheres[0]'], this._diceSpheres)

    this._impacts.fill(0)
    for (let i = 0; i < 8; i++) {
      const imp = impacts[i]
      if (!imp || imp.strength <= 0) continue
      const o = i * 4
      this._impacts[o] = imp.x
      this._impacts[o + 1] = imp.y
      this._impacts[o + 2] = imp.age
      this._impacts[o + 3] = imp.strength
    }
    gl.uniform4fv(au['u_impacts[0]'], this._impacts)

    gl.bindVertexArray(this.emptyVAO)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    // 1B. 渲染高精度倒角 + 4通道法线凹凸雕文 + 内部视差多面体
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.depthMask(true)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)

    gl.useProgram(this.diceProg.prog)
    const du = this.diceProg.u
    gl.uniformMatrix4fv(du.u_viewProj, false, this._viewProj)
    gl.uniform3f(du.u_camPos, camEye[0], camEye[1], camEye[2])
    gl.uniform1f(du.u_time, time)
    gl.uniform1i(du.u_theme, themeId)
    gl.uniform1i(du.u_tier, tierCode)
    gl.uniform1f(du.u_climax, climax)

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
    gl.uniform1i(du.u_atlas, 0)

    const eyeSealTile = GLYPH_TILE_MAP['?']

    for (let i = 0; i < dice.length; i++) {
      const d = dice[i]
      const gpu = this.meshGPU[d.meshKey] || this.meshGPU.d20
      gl.bindVertexArray(gpu.vao)

      quatToMat3ColMajor(d.qx, d.qy, d.qz, d.qw, this._rot3)
      gl.uniformMatrix3fv(du.u_rotMat, false, this._rot3)
      gl.uniform3f(du.u_diePos, d.x, d.y, d.z)
      gl.uniform1f(du.u_dieRadius, d.radius)
      gl.uniform1i(du.u_winningFace, d.targetFace ? d.targetFace.index : 0)
      gl.uniform1f(du.u_settled, d.settled ? 1.0 : 0.0)

      const faces = gpu.mesh.faces
      for (let f = 0; f < 20; f++) {
        if (f < faces.length) {
          if (hiddenMask) {
            this._faceTiles[f] = eyeSealTile
          } else if (usePipsForD6 && d.meshKey === 'd6') {
            this._faceTiles[f] = faces[f].pipTile
          } else {
            this._faceTiles[f] = faces[f].defaultTile
          }
        } else {
          this._faceTiles[f] = 0
        }
      }
      gl.uniform1iv(du['u_faceTiles[0]'], this._faceTiles)
      gl.drawArrays(gl.TRIANGLES, 0, gpu.vertexCount)
    }

    gl.disable(gl.CULL_FACE)

    // 1C. 渲染 3D 体积拖尾丝带 + 水墨飞白 + 凌空剑气斩痕
    gl.depthMask(false)
    gl.enable(gl.BLEND)
    const isShuimo = themeId === 4
    if (isShuimo) {
      // 水墨浓墨正常 Alpha 混合；大成功金剑气仍可高亮
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    } else {
      gl.blendFunc(gl.ONE, gl.ONE)
    }
    this._drawRibbonsAndSlashes(dice, slashes, camEye, time, themeId, tierCode)

    // 1D. 渲染速度拉伸火星粒子与冲天光柱（始终使用 HDR 加法混合以触发璀璨辉光）
    gl.blendFunc(gl.ONE, gl.ONE)
    this._drawParticlesAndPillars(particles, camEye)

    gl.depthMask(true)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)

    // ========================================================================
    // PASS 2: Dual-Kawase 4 级 HDR Bloom 辉光提取与扩散
    // ========================================================================
    const mips = this.fbos.bloomMips
    if (bloomEnabled && mips.length > 0 && mips[0]) {
      gl.useProgram(this.bloomDownProg.prog)
      gl.bindVertexArray(this.emptyVAO)
      const bdu = this.bloomDownProg.u
      gl.uniform1i(bdu.u_tex, 0)

      let srcTex = this.fbos.scene.tex
      let srcW = this.width
      let srcH = this.height

      for (let i = 0; i < mips.length; i++) {
        const dst = mips[i]
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
        gl.viewport(0, 0, dst.w, dst.h)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, srcTex)
        gl.uniform2f(bdu.u_texelSize, 1.0 / srcW, 1.0 / srcH)
        gl.uniform1f(bdu.u_threshold, i === 0 ? (isShuimo ? 1.25 : 1.18) : -1.0)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        srcTex = dst.tex
        srcW = dst.w
        srcH = dst.h
      }

      // Tent 9-tap 逐级向上叠加融合
      gl.useProgram(this.bloomUpProg.prog)
      const buu = this.bloomUpProg.u
      gl.uniform1i(buu.u_tex, 0)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)

      for (let i = mips.length - 1; i >= 1; i--) {
        const src = mips[i]
        const dst = mips[i - 1]
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo)
        gl.viewport(0, 0, dst.w, dst.h)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, src.tex)
        gl.uniform2f(buu.u_texelSize, 1.0 / src.w, 1.0 / src.h)
        gl.uniform1f(buu.u_intensity, 0.85)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
      }
      gl.disable(gl.BLEND)
    }

    // ========================================================================
    // PASS 3: 最终屏幕光学扭曲 + 色差 + ACES Filmic 色调映射输出
    // ========================================================================
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.width, this.height)
    gl.useProgram(this.compositeProg.prog)
    const cu = this.compositeProg.u

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.fbos.scene.tex)
    gl.uniform1i(cu.u_sceneTex, 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, (bloomEnabled && mips[0]) ? mips[0].tex : this.fbos.scene.tex)
    gl.uniform1i(cu.u_bloomTex, 1)

    gl.uniform2f(cu.u_resolution, this.width, this.height)
    gl.uniform4f(cu.u_shockwave, shockwave[0], shockwave[1], shockwave[2], shockwave[3])
    gl.uniform1f(cu.u_chroma, chroma)
    gl.uniform1f(cu.u_bulletTime, bulletTime)
    gl.uniform1f(cu.u_bloomStrength, bloomEnabled ? (isShuimo ? 0.35 : 0.52) : 0.0)
    gl.uniform1f(cu.u_time, time)

    gl.bindVertexArray(this.emptyVAO)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  _drawRibbonsAndSlashes(dice, slashes, camEye, time, themeId, tierCode) {
    const buf = this.ribbonData
    let vCount = 0

    // 主题拖尾色彩预设 (HDR RGB + Alpha)
    let rCol = [2.6, 1.7, 0.45, 0.9]
    if (themeId === 1) rCol = [0.65, 2.2, 3.2, 0.95]
    else if (themeId === 2) rCol = [4.2, 1.25, 0.15, 0.95]
    else if (themeId === 3) rCol = [0.1, 2.5, 2.8, 0.92]
    else if (themeId === 4) rCol = [0.06, 0.07, 0.09, 0.88] // 浓墨飞白
    else if (themeId === 5) rCol = [0.35, 2.4, 1.85, 0.9]

    const pushQuadStripPoint = (px, py, pz, sx, sy, sz, u, cr, cg, cb, ca, prev) => {
      const lX = px - sx, lY = py - sy, lZ = pz - sz
      const rX = px + sx, rY = py + sy, rZ = pz + sz
      if (prev.has && vCount + 6 <= MAX_RIBBON_VERTS) {
        const writeV = (x, y, z, uCoord, vCoord, aVal) => {
          const o = vCount * 9
          buf[o] = x; buf[o + 1] = y; buf[o + 2] = z
          buf[o + 3] = uCoord; buf[o + 4] = vCoord
          buf[o + 5] = cr; buf[o + 6] = cg; buf[o + 7] = cb; buf[o + 8] = aVal
          vCount++
        }
        writeV(prev.lx, prev.ly, prev.lz, prev.u, -1, prev.a)
        writeV(prev.rx, prev.ry, prev.rz, prev.u, +1, prev.a)
        writeV(lX, lY, lZ, u, -1, ca)

        writeV(prev.rx, prev.ry, prev.rz, prev.u, +1, prev.a)
        writeV(rX, rY, rZ, u, +1, ca)
        writeV(lX, lY, lZ, u, -1, ca)
      }
      prev.lx = lX; prev.ly = lY; prev.lz = lZ
      prev.rx = rX; prev.ry = rY; prev.rz = rZ
      prev.u = u; prev.a = ca; prev.has = true
    }

    const prev = { has: false, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, u: 0, a: 1 }

    // 1. 每颗运动骰子的 3D 摄像机朝向流光/墨韵飘带
    for (let dIdx = 0; dIdx < dice.length; dIdx++) {
      const d = dice[dIdx]
      if (d.trailCount < 3) continue
      prev.has = false
      const n = d.trailCount

      // 赛博双色或棱镜彩虹偏移
      let cr = rCol[0], cg = rCol[1], cb = rCol[2]
      if (themeId === 3 && (dIdx & 1) === 1) { cr = 2.8; cg = 0.2; cb = 1.9 }
      if (themeId === 1) {
        const hue = dIdx * 1.1 + time * 2.0
        cr = 1.4 + Math.cos(hue) * 1.1
        cg = 1.5 + Math.cos(hue + 2.1) * 1.1
        cb = 1.8 + Math.cos(hue + 4.2) * 1.1
      }

      for (let i = 0; i < n; i++) {
        const curIdx = (d.trailHead - i + 28) % 28
        const nxtIdx = (d.trailHead - Math.min(n - 1, i + 1) + 28) % 28
        const prvIdx = (d.trailHead - Math.max(0, i - 1) + 28) % 28

        const px = d.trailX[curIdx], py = d.trailY[curIdx], pz = d.trailZ[curIdx]
        let tx = d.trailX[prvIdx] - d.trailX[nxtIdx]
        let ty = d.trailY[prvIdx] - d.trailY[nxtIdx]
        let tz = d.trailZ[prvIdx] - d.trailZ[nxtIdx]
        const tLen = Math.hypot(tx, ty, tz)
        if (tLen < 0.05) continue
        tx /= tLen; ty /= tLen; tz /= tLen

        const vx = camEye[0] - px, vy = camEye[1] - py, vz = camEye[2] - pz
        let sx = ty * vz - tz * vy
        let sy = tz * vx - tx * vz
        let sz = tx * vy - ty * vx
        const sLen = Math.hypot(sx, sy, sz) || 1
        const u = i / (n - 1)
        const halfW = d.radius * (themeId === 4 ? 0.72 : 0.58) * (1 - u * 0.82)
        sx = (sx / sLen) * halfW
        sy = (sy / sLen) * halfW
        sz = (sz / sLen) * halfW

        pushQuadStripPoint(px, py, pz, sx, sy, sz, u, cr, cg, cb, rCol[3], prev)
      }
    }

    // 2. 结算时的 3D 弧形剑气斩痕 / 黄金命运星环轨 (slashes)
    if (slashes && slashes.length) {
      for (let s = 0; s < slashes.length; s++) {
        const sl = slashes[s]
        if (!sl.active) continue
        const p = sl.age / sl.life
        if (p >= 1) continue
        prev.has = false
        const segs = 22
        const arcSpan = Math.PI * 1.15
        const startA = sl.angle - arcSpan * 0.5 + p * 0.65
        const fade = (1 - p) * (1 - p)
        const scr = tierCode === 1 && themeId === 4 ? 0.82 : sl.r
        const scg = tierCode === 1 && themeId === 4 ? 0.12 : sl.g
        const scb = tierCode === 1 && themeId === 4 ? 0.10 : sl.b

        for (let k = 0; k <= segs; k++) {
          const u = k / segs
          const a = startA + u * arcSpan
          const ca = Math.cos(a), sa = Math.sin(a)
          // 倾斜 3D 圆弧平面
          const lx = ca * sl.radius
          const ly = sa * sl.radius * Math.cos(sl.tilt)
          const lz = sa * sl.radius * Math.sin(sl.tilt)
          const px = sl.cx + lx
          const py = sl.cy + ly
          const pz = Math.max(4, sl.cz + lz)

          const env = Math.sin(u * Math.PI)
          const w = sl.width * env * (1 - p * 0.4)
          pushQuadStripPoint(px, py, pz, 0, 0, w, 1 - env, scr, scg, scb, fade * 0.95, prev)
        }
      }
    }

    if (vCount === 0) return
    const gl = this.gl
    gl.useProgram(this.ribbonProg.prog)
    gl.uniformMatrix4fv(this.ribbonProg.u.u_viewProj, false, this._viewProj)
    gl.uniform1f(this.ribbonProg.u.u_time, time)
    gl.uniform1i(this.ribbonProg.u.u_isInk, themeId === 4 ? 1 : 0)

    gl.bindVertexArray(this.ribbonVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonVBO)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.subarray(0, vCount * 9))
    gl.drawArrays(gl.TRIANGLES, 0, vCount)
  }

  _drawParticlesAndPillars(particles, camEye) {
    if (!particles || particles.aliveCount === 0) return
    const buf = this.particleData
    let vCount = 0

    const corners = [
      [-1, -1], [1, -1], [-1, 1],
      [1, -1], [1, 1], [-1, 1]
    ]

    const { active, x, y, z, vx, vy, vz, size, age, life, r, g, b, a, mode, capacity } = particles
    for (let i = 0; i < capacity; i++) {
      if (!active[i]) continue
      if (vCount + 6 > MAX_PARTICLE_VERTS) break

      const p = age[i] / life[i]
      const fade = mode[i] > 0.5
        ? Math.sin(Math.min(1, p * 4.5) * Math.PI * 0.5) * Math.pow(1 - p, 1.35)
        : (1 - p * p)
      const alpha = a[i] * fade
      if (alpha <= 0.005) continue

      const sz = mode[i] > 0.5 ? size[i] * (0.7 + 0.5 * p) : size[i] * (1 - p * 0.65)
      const px = x[i], py = y[i], pz = z[i]
      const pvx = vx[i], pvy = vy[i], pvz = vz[i]
      const cr = r[i], cg = g[i], cb = b[i]
      const pm = mode[i]

      for (let c = 0; c < 6; c++) {
        const o = vCount * 14
        buf[o] = px; buf[o + 1] = py; buf[o + 2] = pz
        buf[o + 3] = pvx; buf[o + 4] = pvy; buf[o + 5] = pvz
        buf[o + 6] = corners[c][0]; buf[o + 7] = corners[c][1]
        buf[o + 8] = cr; buf[o + 9] = cg; buf[o + 10] = cb; buf[o + 11] = alpha
        buf[o + 12] = sz; buf[o + 13] = pm
        vCount++
      }
    }

    if (vCount === 0) return
    const gl = this.gl
    gl.useProgram(this.particleProg.prog)
    gl.uniformMatrix4fv(this.particleProg.u.u_viewProj, false, this._viewProj)
    gl.uniform3f(this.particleProg.u.u_camPos, camEye[0], camEye[1], camEye[2])

    gl.bindVertexArray(this.particleVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleVBO)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.subarray(0, vCount * 14))
    gl.drawArrays(gl.TRIANGLES, 0, vCount)
  }
}
