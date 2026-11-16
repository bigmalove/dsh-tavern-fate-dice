// ============================================================================
// demo/gl-meshes.js — 高精度倒角多面体 WebGL2 网格库 + 高对比抗眩光雕文图集生成器
// 图集 RGBA 四通道编码（2048x2048，专为极致数字可读性与 PBR 凹凸光影设计）：
//   R = 锐利超粗字形核心蒙版 (Crisp Extra-Bold Mask)
//   G = 暗槽描边衬底环 (High-Contrast Outline Moat) —— 彻底隔绝背景花纹干扰！
//   B = 凹槽斜向受光凹凸偏导 (Directional Bevel Slope -> 0..1)
//   A = 柔和外发光能量晕 (Soft Outer Halo)
// ============================================================================

function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s] }
function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function vCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
}
function vNorm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

export const ATLAS_GRID = 8
export const TILE_PX = 256

export const GLYPH_TILE_MAP = Object.freeze({
  '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, '11': 11, '12': 12, '13': 13, '14': 14, '15': 15,
  '16': 16, '17': 17, '18': 18, '19': 19, '20': 20,
  '00': 21, '20_d': 22, '30': 23, '40': 24, '50': 25, '60': 26, '70': 27, '80': 28, '90': 29, '10_d': 30,
  'pip_1': 31, 'pip_2': 32, 'pip_3': 33, 'pip_4': 34, 'pip_5': 35, 'pip_6': 36,
  '+': 37, '−': 38, '◯': 39,
  '?': 40
})

export function buildEngravedAtlasCanvas() {
  const size = ATLAS_GRID * TILE_PX
  const maskCv = document.createElement('canvas')
  maskCv.width = size
  maskCv.height = size
  const mctx = maskCv.getContext('2d', { willReadFrequently: true })

  const moatCv = document.createElement('canvas')
  moatCv.width = size
  moatCv.height = size
  const octx = moatCv.getContext('2d', { willReadFrequently: true })

  const haloCv = document.createElement('canvas')
  haloCv.width = size
  haloCv.height = size
  const hctx = haloCv.getContext('2d', { willReadFrequently: true })

  mctx.clearRect(0, 0, size, size)
  octx.clearRect(0, 0, size, size)
  hctx.clearRect(0, 0, size, size)

  const entries = [
    ...Array.from({ length: 21 }, (_, i) => ({ id: i, text: String(i), underline: i === 6 || i === 9, crown: i === 20 })),
    { id: 21, text: '00' }, { id: 22, text: '20' }, { id: 23, text: '30' }, { id: 24, text: '40' },
    { id: 25, text: '50' }, { id: 26, text: '60' }, { id: 27, text: '70' }, { id: 28, text: '80' },
    { id: 29, text: '90' }, { id: 30, text: '10' },
    { id: 31, pip: 1 }, { id: 32, pip: 2 }, { id: 33, pip: 3 },
    { id: 34, pip: 4 }, { id: 35, pip: 5 }, { id: 36, pip: 6 },
    { id: 37, text: '+' }, { id: 38, text: '−' }, { id: 39, fateBlank: true },
    { id: 40, eyeSeal: true }
  ]

  const PIP_COORDS = {
    1: [[0, 0]],
    2: [[-0.44, -0.44], [0.44, 0.44]],
    3: [[-0.48, -0.48], [0, 0], [0.48, 0.48]],
    4: [[-0.44, -0.44], [0.44, -0.44], [-0.44, 0.44], [0.44, 0.44]],
    5: [[-0.46, -0.46], [0.46, -0.46], [0, 0], [-0.46, 0.46], [0.46, 0.46]],
    6: [[-0.42, -0.50], [0.42, -0.50], [-0.42, 0], [0.42, 0], [-0.42, 0.50], [0.42, 0.50]]
  }

  // mode: 'mask' | 'moat' | 'halo'
  function drawGlyphPass(ctx, mode) {
    ctx.save()
    const isMoat = mode === 'moat'
    const isHalo = mode === 'halo'
    if (isHalo) {
      ctx.shadowColor = '#ffffff'
      ctx.shadowBlur = 24
    }
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = '#ffffff'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const item of entries) {
      const col = item.id % ATLAS_GRID
      const row = Math.floor(item.id / ATLAS_GRID)
      const cx = col * TILE_PX + TILE_PX * 0.5
      const cy = row * TILE_PX + TILE_PX * 0.5

      ctx.save()
      ctx.translate(cx, cy)

      if (item.pip) {
        const pts = PIP_COORDS[item.pip]
        const span = TILE_PX * 0.30
        const pad = isMoat ? 11 : 0
        for (const [px, py] of pts) {
          const x = px * span
          const y = py * span
          if (item.pip === 1) {
            ctx.beginPath()
            ctx.arc(x, y, TILE_PX * 0.145 + pad, 0, Math.PI * 2)
            ctx.fill()
          } else {
            ctx.beginPath()
            ctx.arc(x, y, TILE_PX * 0.082 + pad, 0, Math.PI * 2)
            ctx.fill()
          }
        }
      } else if (item.fateBlank) {
        ctx.lineWidth = isMoat ? 32 : 14
        ctx.beginPath()
        ctx.arc(0, 0, TILE_PX * 0.16, 0, Math.PI * 2)
        ctx.stroke()
      } else if (item.eyeSeal) {
        ctx.lineWidth = isMoat ? 28 : 12
        ctx.beginPath()
        ctx.moveTo(-72, 0)
        ctx.quadraticCurveTo(0, -54, 72, 0)
        ctx.quadraticCurveTo(0, 54, -72, 0)
        ctx.closePath()
        ctx.stroke()
        ctx.beginPath()
        ctx.ellipse(0, 0, isMoat ? 24 : 15, isMoat ? 40 : 32, 0, 0, Math.PI * 2)
        ctx.fill()
      } else {
        const txt = item.text
        const fontSize = txt.length >= 2 ? 124 : 152
        // 采用高开口、超粗无衬线几何字形，小尺寸与倾斜视角下依然清晰锐利
        ctx.font = `900 ${fontSize}px system-ui, -apple-system, "Segoe UI", "Arial Black", "PingFang SC", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const yOff = item.crown ? 8 : (item.underline ? -4 : 2)

        if (isMoat) {
          ctx.lineWidth = 26
          ctx.strokeText(txt, 0, yOff)
        } else {
          ctx.lineWidth = 4
          ctx.strokeText(txt, 0, yOff)
        }
        ctx.fillText(txt, 0, yOff)

        if (item.underline) {
          const pad = isMoat ? 9 : 0
          ctx.beginPath()
          ctx.roundRect(-34 - pad, 62 - pad, 68 + pad * 2, 12 + pad * 2, 6)
          ctx.fill()
        }
        if (item.crown) {
          ctx.lineWidth = isMoat ? 20 : 8
          ctx.beginPath()
          ctx.moveTo(-38, -60)
          ctx.lineTo(-18, -76)
          ctx.lineTo(0, -60)
          ctx.lineTo(18, -76)
          ctx.lineTo(38, -60)
          ctx.stroke()
        }
      }
      ctx.restore()
    }
    ctx.restore()
  }

  drawGlyphPass(mctx, 'mask')
  drawGlyphPass(octx, 'moat')
  drawGlyphPass(hctx, 'halo')

  const maskData = mctx.getImageData(0, 0, size, size).data
  const moatData = octx.getImageData(0, 0, size, size).data
  const haloData = hctx.getImageData(0, 0, size, size).data
  const outImg = mctx.createImageData(size, size)
  const dst = outImg.data

  const stride = size * 4
  for (let y = 0; y < size; y++) {
    const yPrev = Math.max(0, y - 2)
    const yNext = Math.min(size - 1, y + 2)
    for (let x = 0; x < size; x++) {
      const idx = y * stride + x * 4
      const xPrev = Math.max(0, x - 2)
      const xNext = Math.min(size - 1, x + 2)

      const hL = maskData[y * stride + xPrev * 4 + 3]
      const hR = maskData[y * stride + xNext * 4 + 3]
      const hU = maskData[yPrev * stride + x * 4 + 3]
      const hD = maskData[yNext * stride + x * 4 + 3]

      // 左上受光凹槽斜率合成单通道法线高度偏导
      const bevel = ((hR - hL) * 0.707 + (hD - hU) * 0.707) / 255

      dst[idx] = maskData[idx + 3]     // R: 超清锐利字芯蒙版
      dst[idx + 1] = moatData[idx + 3] // G: 外扩暗槽描边保护环
      dst[idx + 2] = Math.max(0, Math.min(255, Math.round((bevel * 0.5 + 0.5) * 255))) // B: 刻槽立体凹凸受光
      dst[idx + 3] = haloData[idx + 3] // A: 柔和能量外晕
    }
  }

  mctx.putImageData(outImg, 0, 0)
  return maskCv
}

export const VERTEX_FLOATS = 19

function buildBeveledPolyhedron(kind, rawVerts, rawFaces, labels, faceValues, uvScale = 1.18) {
  const normVerts = rawVerts.map(vNorm)
  const faces = []
  const triData = []

  for (let f = 0; f < rawFaces.length; f++) {
    const indices = rawFaces[f].slice()
    let cx = 0, cy = 0, cz = 0
    for (const vi of indices) {
      cx += normVerts[vi][0]
      cy += normVerts[vi][1]
      cz += normVerts[vi][2]
    }
    cx /= indices.length
    cy /= indices.length
    cz /= indices.length
    const center = [cx, cy, cz]

    const p0 = normVerts[indices[0]]
    const p1 = normVerts[indices[1]]
    const p2 = normVerts[indices[2]]
    let n = vNorm(vCross(vSub(p1, p0), vSub(p2, p0)))
    if (vDot(n, center) < 0) {
      indices.reverse()
      n = vScale(n, -1)
    }

    const pTop = normVerts[indices[0]]
    let up = vSub(pTop, center)
    up = vSub(up, vScale(n, vDot(up, n)))
    if (Math.hypot(up[0], up[1], up[2]) < 1e-5) {
      up = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]
      up = vSub(up, vScale(n, vDot(up, n)))
    }
    const vAxis = vScale(vNorm(up), -1)
    const uAxis = vNorm(vCross(n, vAxis))

    let inRadius = Infinity
    for (let i = 0; i < indices.length; i++) {
      const va = normVerts[indices[i]]
      const vb = normVerts[indices[(i + 1) % indices.length]]
      const mid = vScale(vAdd(va, vb), 0.5)
      const d = Math.hypot(mid[0] - cx, mid[1] - cy, mid[2] - cz)
      if (d < inRadius) inRadius = d
    }

    const invSpan = 1 / (inRadius * uvScale)
    const labelStr = String(labels[f])
    let tileKey = labelStr
    if (kind === 'd100_tens' && labelStr === '20') tileKey = '20_d'
    if (kind === 'd100_tens' && labelStr === '10') tileKey = '10_d'
    const defaultTile = GLYPH_TILE_MAP[tileKey] !== undefined ? GLYPH_TILE_MAP[tileKey] : 20
    const pipTile = kind === 'd6' ? (GLYPH_TILE_MAP[`pip_${faceValues[f]}`] ?? defaultTile) : defaultTile

    faces.push({
      index: f,
      normal: new Float32Array(n),
      center: new Float32Array(center),
      uAxis: new Float32Array(uAxis),
      vAxis: new Float32Array(vAxis),
      inRadius,
      label: labelStr,
      value: faceValues[f],
      defaultTile,
      pipTile
    })

    const pushVert = (pos, smoothN, edgeDist) => {
      const rel = vSub(pos, center)
      const lu = vDot(rel, uAxis) * invSpan * 0.5 + 0.5
      const lv = vDot(rel, vAxis) * invSpan * 0.5 + 0.5
      triData.push(
        pos[0], pos[1], pos[2],
        n[0], n[1], n[2],
        smoothN[0], smoothN[1], smoothN[2],
        uAxis[0], uAxis[1], uAxis[2],
        vAxis[0], vAxis[1], vAxis[2],
        lu, lv,
        edgeDist,
        f
      )
    }

    for (let i = 0; i < indices.length; i++) {
      const va = normVerts[indices[i]]
      const vb = normVerts[indices[(i + 1) % indices.length]]
      pushVert(center, n, 1.0)
      pushVert(va, va, 0.0)
      pushVert(vb, vb, 0.0)
    }
  }

  return {
    kind,
    faceCount: faces.length,
    faces,
    vertexBufferData: new Float32Array(triData),
    vertexCount: triData.length / VERTEX_FLOATS
  }
}

function buildIcosahedronRaw() {
  const phi = (1 + Math.sqrt(5)) / 2
  const verts = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1]
  ].map(vNorm)

  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]
  ]
  return { verts, faces }
}

function assignOppositeNumbers(faces, verts, maxNum) {
  const centroids = faces.map(idx => {
    let x = 0, y = 0, z = 0
    for (const i of idx) { x += verts[i][0]; y += verts[i][1]; z += verts[i][2] }
    return vNorm([x, y, z])
  })
  const values = new Array(faces.length).fill(0)
  const used = new Uint8Array(faces.length)
  let hi = maxNum, lo = 1
  for (let i = 0; i < faces.length; i++) {
    if (used[i]) continue
    used[i] = 1
    let bestJ = -1, bestDot = 2
    for (let j = i + 1; j < faces.length; j++) {
      if (used[j]) continue
      const d = vDot(centroids[i], centroids[j])
      if (d < bestDot) { bestDot = d; bestJ = j }
    }
    values[i] = hi--
    if (bestJ >= 0) { used[bestJ] = 1; values[bestJ] = lo++ }
  }
  return values
}

function createTrapezohedron(kind, labels, values) {
  const cos36 = Math.cos(Math.PI / 5)
  const hUnit = (1 - cos36) / (1 + cos36)
  const rUnit = Math.sqrt(1 - hUnit * hUnit)
  const verts = [[0, 0, 1], [0, 0, -1]]
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5
    verts.push([rUnit * Math.cos(a), rUnit * Math.sin(a), hUnit])
  }
  for (let k = 0; k < 5; k++) {
    const b = ((k + 0.5) * 2 * Math.PI) / 5
    verts.push([rUnit * Math.cos(b), rUnit * Math.sin(b), -hUnit])
  }
  const faces = []
  for (let k = 0; k < 5; k++) faces.push([0, 2 + k, 7 + k, 2 + ((k + 1) % 5)])
  for (let k = 0; k < 5; k++) faces.push([1, 7 + ((k + 1) % 5), 2 + ((k + 1) % 5), 7 + k])
  return buildBeveledPolyhedron(kind, verts, faces, labels, values, 1.16)
}

function createD12() {
  const ico = buildIcosahedronRaw()
  const d12Verts = ico.faces.map(f => {
    let x = 0, y = 0, z = 0
    for (const vi of f) { x += ico.verts[vi][0]; y += ico.verts[vi][1]; z += ico.verts[vi][2] }
    return vNorm([x, y, z])
  })
  const d12Faces = []
  for (let vi = 0; vi < ico.verts.length; vi++) {
    const inc = []
    for (let fi = 0; fi < ico.faces.length; fi++) {
      if (ico.faces[fi].includes(vi)) inc.push(fi)
    }
    const axis = ico.verts[vi]
    const ref = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
    const t1 = vNorm(vCross(axis, ref))
    const t2 = vNorm(vCross(axis, t1))
    inc.sort((a, b) => {
      const pa = vSub(d12Verts[a], vScale(axis, vDot(d12Verts[a], axis)))
      const pb = vSub(d12Verts[b], vScale(axis, vDot(d12Verts[b], axis)))
      return Math.atan2(vDot(pa, t2), vDot(pa, t1)) - Math.atan2(vDot(pb, t2), vDot(pb, t1))
    })
    d12Faces.push(inc)
  }
  const vals = assignOppositeNumbers(d12Faces, d12Verts, 12)
  return buildBeveledPolyhedron('d12', d12Verts, d12Faces, vals, vals, 1.22)
}

export const GL_MESHES = Object.freeze({
  d4: buildBeveledPolyhedron(
    'd4',
    [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]],
    [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]],
    [1, 2, 3, 4], [1, 2, 3, 4], 1.18
  ),
  d6: buildBeveledPolyhedron(
    'd6',
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]],
    [[3, 2, 1, 0], [6, 7, 4, 5], [2, 6, 5, 1], [7, 3, 0, 4], [7, 6, 2, 3], [0, 1, 5, 4]],
    ['6', '1', '2', '5', '3', '4'], [6, 1, 2, 5, 3, 4], 1.24
  ),
  df: buildBeveledPolyhedron(
    'df',
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]],
    [[3, 2, 1, 0], [6, 7, 4, 5], [2, 6, 5, 1], [7, 3, 0, 4], [7, 6, 2, 3], [0, 1, 5, 4]],
    ['+', '−', '+', '−', '◯', '◯'], [1, -1, 1, -1, 0, 0], 1.24
  ),
  d8: buildBeveledPolyhedron(
    'd8',
    [[0, 0, 1], [0, 0, -1], [1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]],
    [[0, 2, 3], [1, 4, 5], [0, 3, 4], [1, 5, 2], [0, 4, 5], [1, 2, 3], [0, 5, 2], [1, 3, 4]],
    [8, 1, 2, 7, 6, 3, 4, 5], [8, 1, 2, 7, 6, 3, 4, 5], 1.18
  ),
  d10: createTrapezohedron('d10', ['10', '2', '4', '6', '8', '1', '9', '7', '5', '3'], [10, 2, 4, 6, 8, 1, 9, 7, 5, 3]),
  d100_tens: createTrapezohedron('d100_tens', ['00', '20', '40', '60', '80', '10', '90', '70', '50', '30'], [0, 20, 40, 60, 80, 10, 90, 70, 50, 30]),
  d100_ones: createTrapezohedron('d100_ones', ['0', '2', '4', '6', '8', '1', '9', '7', '5', '3'], [0, 2, 4, 6, 8, 1, 9, 7, 5, 3]),
  d12: createD12(),
  d20: (() => {
    const ico = buildIcosahedronRaw()
    const vals = assignOppositeNumbers(ico.faces, ico.verts, 20)
    return buildBeveledPolyhedron('d20', ico.verts, ico.faces, vals, vals, 1.16)
  })()
})
