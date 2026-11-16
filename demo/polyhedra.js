// ============================================================================
// demo/polyhedra.js — 零分配高精度 3D 多面体几何库
// 支持：D4 / D6(点数与数字双模) / D8 / D10 / D100(十位00-90 + 个位0-9) / D12 / D20 / 4dF(命运骰)
// 所有多面体预计算：单位外接球顶点、严格逆时针外法线面、3D 面内正交切空间基 (uAxis, vAxis)
// 以支持利用 Canvas 2D 仿射矩阵将数字/点数真实透视贴合在旋转的 3D 棱面上。
// ============================================================================

function vSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function vAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function vScale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function vDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function vCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
}

function vLen(a) {
  return Math.hypot(a[0], a[1], a[2])
}

function vNorm(a) {
  const l = vLen(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

/**
 * 构建标准化多面体网格并预烘焙 Float32Array，供渲染器热路径零分配读取。
 */
function finalizeMesh(kind, rawVerts, rawFaces, labels, faceValues, glyphScale = 0.42) {
  const vCount = rawVerts.length
  const vertices = new Float32Array(vCount * 3)
  for (let i = 0; i < vCount; i++) {
    const v = vNorm(rawVerts[i])
    vertices[i * 3] = v[0]
    vertices[i * 3 + 1] = v[1]
    vertices[i * 3 + 2] = v[2]
  }

  const fCount = rawFaces.length
  const faces = []

  for (let f = 0; f < fCount; f++) {
    const indices = rawFaces[f].slice()
    // 计算面质心
    let cx = 0, cy = 0, cz = 0
    for (let i = 0; i < indices.length; i++) {
      const vi = indices[i] * 3
      cx += vertices[vi]
      cy += vertices[vi + 1]
      cz += vertices[vi + 2]
    }
    cx /= indices.length
    cy /= indices.length
    cz /= indices.length
    const center = [cx, cy, cz]

    // 确保顶点顺序满足外法线朝外
    const i0 = indices[0] * 3
    const i1 = indices[1] * 3
    const i2 = indices[2] * 3
    const p0 = [vertices[i0], vertices[i0 + 1], vertices[i0 + 2]]
    const p1 = [vertices[i1], vertices[i1 + 1], vertices[i1 + 2]]
    const p2 = [vertices[i2], vertices[i2 + 1], vertices[i2 + 2]]
    let n = vNorm(vCross(vSub(p1, p0), vSub(p2, p0)))
    if (vDot(n, center) < 0) {
      indices.reverse()
      n = vScale(n, -1)
    }

    // 计算面内切空间正交基：使数字顶端朝向面首个主顶点方向，保证排版端正
    const topIdx = indices[0] * 3
    const topVert = [vertices[topIdx], vertices[topIdx + 1], vertices[topIdx + 2]]
    let upVec = vSub(topVert, center)
    // 投影到切平面并取反（Canvas Y 轴向下，vAxis 指向面底部）
    upVec = vSub(upVec, vScale(n, vDot(upVec, n)))
    if (vLen(upVec) < 1e-5) {
      upVec = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0]
      upVec = vSub(upVec, vScale(n, vDot(upVec, n)))
    }
    const vAxis = vScale(vNorm(upVec), -1) // Canvas +Y 朝下
    // 右手系：uAxis (+X 朝右) × vAxis (+Y 朝下) = +n (朝相机外侧) => uAxis = vAxis × n
    const uAxis = vNorm(vCross(vAxis, n))

    // 计算内切半径估计（中心到各边中点的最小距离）
    let inRadius = Infinity
    for (let i = 0; i < indices.length; i++) {
      const aIdx = indices[i] * 3
      const bIdx = indices[(i + 1) % indices.length] * 3
      const mx = 0.5 * (vertices[aIdx] + vertices[bIdx])
      const my = 0.5 * (vertices[aIdx + 1] + vertices[bIdx + 1])
      const mz = 0.5 * (vertices[aIdx + 2] + vertices[bIdx + 2])
      const d = Math.hypot(mx - cx, my - cy, mz - cz)
      if (d < inRadius) inRadius = d
    }

    faces.push({
      index: f,
      indices: new Uint16Array(indices),
      normal: new Float32Array(n),
      center: new Float32Array(center),
      uAxis: new Float32Array(uAxis),
      vAxis: new Float32Array(vAxis),
      inRadius,
      glyphRadius: inRadius * glyphScale,
      label: String(labels[f]),
      value: faceValues[f],
      needsUnderline: labels[f] === '6' || labels[f] === '9'
    })
  }

  return {
    kind,
    vertexCount: vCount,
    faceCount: fCount,
    vertices,
    faces
  }
}

// 1. D4 正四面体
function buildD4() {
  const verts = [
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1]
  ]
  const faces = [
    [0, 2, 1],
    [0, 1, 3],
    [0, 3, 2],
    [1, 2, 3]
  ]
  const vals = [1, 2, 3, 4]
  return finalizeMesh('d4', verts, faces, vals, vals, 0.72)
}

// 2. D6 正六面体 & 4dF 命运骰（对立面点数和 = 7）
function buildCube(kind, labels, values) {
  const verts = [
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1]
  ]
  // 每面第一个点置于上方边，方便数字朝向一致
  const faces = [
    [3, 2, 1, 0], // +Z (6)
    [6, 7, 4, 5], // -Z (1)
    [2, 6, 5, 1], // +X (2)
    [7, 3, 0, 4], // -X (5)
    [7, 6, 2, 3], // +Y (3)
    [0, 1, 5, 4]  // -Y (4)
  ]
  return finalizeMesh(kind, verts, faces, labels, values, 0.68)
}

// 3. D8 正八面体（对立面点数和 = 9）
function buildD8() {
  const verts = [
    [0, 0, 1],  // 0 top
    [0, 0, -1], // 1 bottom
    [1, 0, 0],  // 2 +X
    [0, 1, 0],  // 3 +Y
    [-1, 0, 0], // 4 -X
    [0, -1, 0]  // 5 -Y
  ]
  const faces = [
    [0, 2, 3], // 8
    [1, 4, 5], // 1 (opposite to 0,2,3)
    [0, 3, 4], // 2
    [1, 5, 2], // 7
    [0, 4, 5], // 6
    [1, 2, 3], // 3
    [0, 5, 2], // 4
    [1, 3, 4]  // 5
  ]
  const vals = [8, 1, 2, 7, 6, 3, 4, 5]
  return finalizeMesh('d8', verts, faces, vals, vals, 0.74)
}

// 4. D10 / D100 五角偏方面体（10 个严格共面的风筝形四边面！）
function buildTrapezohedron(kind, labels, values) {
  const cos36 = Math.cos(Math.PI / 5)
  const H = 1.04
  const R = 0.96
  // 严格共面解析解：h = H * (1 - cos36) / (1 + cos36)
  const h = H * ((1 - cos36) / (1 + cos36))

  const verts = [
    [0, 0, H],  // 0: 北极顶点
    [0, 0, -H]  // 1: 南极顶点
  ]
  // 2..6: 北半球五边形环
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5
    verts.push([R * Math.cos(a), R * Math.sin(a), h])
  }
  // 7..11: 南半球交错 36° 五边形环
  for (let k = 0; k < 5; k++) {
    const a = ((k + 0.5) * 2 * Math.PI) / 5
    verts.push([R * Math.cos(a), R * Math.sin(a), -h])
  }

  const faces = []
  // 北半球 5 个风筝面 (顶点 0 为尖端)
  for (let k = 0; k < 5; k++) {
    const u0 = 2 + k
    const u1 = 2 + ((k + 1) % 5)
    const l0 = 7 + k
    faces.push([0, u0, l0, u1])
  }
  // 南半球 5 个风筝面 (顶点 1 为尖端)
  for (let k = 0; k < 5; k++) {
    const l0 = 7 + k
    const l1 = 7 + ((k + 1) % 5)
    const u1 = 2 + ((k + 1) % 5)
    faces.push([1, l1, u1, l0])
  }

  // finalizeMesh 会将顶点归一化至单位球；为保持五角偏方面体的严格共面性，
  // 我们此处直接让极点与赤道半径相等 R_sphere = 1：
  // 设 H = 1, R = sqrt(1 - h^2)，此时所有 12 个顶点天然位于单位球面上且 100% 共面！
  const hUnit = (1 - cos36) / (1 + cos36)
  const rUnit = Math.sqrt(1 - hUnit * hUnit)
  verts[0] = [0, 0, 1]
  verts[1] = [0, 0, -1]
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5
    verts[2 + k] = [rUnit * Math.cos(a), rUnit * Math.sin(a), hUnit]
    const b = ((k + 0.5) * 2 * Math.PI) / 5
    verts[7 + k] = [rUnit * Math.cos(b), rUnit * Math.sin(b), -hUnit]
  }

  return finalizeMesh(kind, verts, faces, labels, values, 0.72)
}

// 5. D20 正二十面体 & 对偶生成 D12 正十二面体
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

function assignOppositePairedNumbers(faces, verts, maxNum) {
  const centroids = faces.map(idx => {
    let x = 0, y = 0, z = 0
    for (const i of idx) {
      x += verts[i][0]; y += verts[i][1]; z += verts[i][2]
    }
    return vNorm([x, y, z])
  })
  const values = new Array(faces.length).fill(0)
  const used = new Uint8Array(faces.length)
  let high = maxNum
  let low = 1
  for (let i = 0; i < faces.length; i++) {
    if (used[i]) continue
    used[i] = 1
    // 找法线最反向的对立面
    let bestJ = -1
    let bestDot = 2
    for (let j = i + 1; j < faces.length; j++) {
      if (used[j]) continue
      const d = vDot(centroids[i], centroids[j])
      if (d < bestDot) {
        bestDot = d
        bestJ = j
      }
    }
    values[i] = high
    if (bestJ >= 0) {
      used[bestJ] = 1
      values[bestJ] = low
    }
    high--
    low++
  }
  return values
}

function buildD20() {
  const { verts, faces } = buildIcosahedronRaw()
  const vals = assignOppositePairedNumbers(faces, verts, 20)
  return finalizeMesh('d20', verts, faces, vals, vals, 0.78)
}

function buildD12() {
  const ico = buildIcosahedronRaw()
  // 对偶顶点 = D20 的 20 个面中心归一化
  const d12Verts = ico.faces.map(f => {
    let x = 0, y = 0, z = 0
    for (const vi of f) {
      x += ico.verts[vi][0]
      y += ico.verts[vi][1]
      z += ico.verts[vi][2]
    }
    return vNorm([x, y, z])
  })

  // D20 的每个顶点周围恰好环绕 5 个面 -> 构成 D12 的一个正五边形面
  const d12Faces = []
  for (let vi = 0; vi < ico.verts.length; vi++) {
    const incident = []
    for (let fi = 0; fi < ico.faces.length; fi++) {
      if (ico.faces[fi].includes(vi)) incident.push(fi)
    }
    const axis = ico.verts[vi]
    const ref = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
    const t1 = vNorm(vCross(axis, ref))
    const t2 = vNorm(vCross(axis, t1))
    incident.sort((a, b) => {
      const pa = vSub(d12Verts[a], vScale(axis, vDot(d12Verts[a], axis)))
      const pb = vSub(d12Verts[b], vScale(axis, vDot(d12Verts[b], axis)))
      return Math.atan2(vDot(pa, t2), vDot(pa, t1)) - Math.atan2(vDot(pb, t2), vDot(pb, t1))
    })
    d12Faces.push(incident)
  }

  const vals = assignOppositePairedNumbers(d12Faces, d12Verts, 12)
  return finalizeMesh('d12', d12Verts, d12Faces, vals, vals, 0.68)
}

export const MESH_LIBRARY = Object.freeze({
  d4: buildD4(),
  d6: buildCube('d6', ['6', '1', '2', '5', '3', '4'], [6, 1, 2, 5, 3, 4]),
  df: buildCube('df', ['+', '−', '+', '−', '◯', '◯'], [1, -1, 1, -1, 0, 0]),
  d8: buildD8(),
  d10: buildTrapezohedron(
    'd10',
    ['10', '2', '4', '6', '8', '1', '9', '7', '5', '3'],
    [10, 2, 4, 6, 8, 1, 9, 7, 5, 3]
  ),
  d100_tens: buildTrapezohedron(
    'd100_tens',
    ['00', '20', '40', '60', '80', '10', '90', '70', '50', '30'],
    [0, 20, 40, 60, 80, 10, 90, 70, 50, 30]
  ),
  d100_ones: buildTrapezohedron(
    'd100_ones',
    ['0', '2', '4', '6', '8', '1', '9', '7', '5', '3'],
    [0, 2, 4, 6, 8, 1, 9, 7, 5, 3]
  ),
  d12: buildD12(),
  d20: buildD20()
})

// D6 经典六面圆点布局（归一化在 [-1, 1]^2 切空间内）
export const D6_PIPS = Object.freeze({
  1: [[0, 0]],
  2: [[-0.52, -0.52], [0.52, 0.52]],
  3: [[-0.56, -0.56], [0, 0], [0.56, 0.56]],
  4: [[-0.52, -0.52], [0.52, -0.52], [-0.52, 0.52], [0.52, 0.52]],
  5: [[-0.54, -0.54], [0.54, -0.54], [0, 0], [-0.54, 0.54], [0.54, 0.54]],
  6: [[-0.52, -0.58], [0.52, -0.58], [-0.52, 0], [0.52, 0], [-0.52, 0.58], [0.52, 0.58]]
})

export function getMesh(meshKey) {
  return MESH_LIBRARY[meshKey] || MESH_LIBRARY.d20
}
