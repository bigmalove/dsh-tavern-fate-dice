/* ==========================================================================
 * styles-b.js —— Fate Dice 桌面骰子 Canvas 视觉风格插件 B 包
 *
 *   magma  · 炼狱熔岩锻造（契合「🔥 孤注一掷」）
 *   shuimo · 水墨丹青剑意（东方武侠 / 修仙）
 *
 * 契约：StylePlugin（见文件底部 STYLES 导出）
 *   init(ctx, W, H, state) / drawBackground / onBounce / onSettle /
 *   drawDieTrail / styleFace / drawFaceOverlay / drawForeground / hasActiveFX
 *
 * 零分配纪律（帧内热路径）：
 *   1. 所有颜色字符串、色阶表、波长表、字体串在模块加载期构建；
 *   2. 所有槽位数组（裂纹 / 余烬 / 墨晕 / 剑气 / 涟漪）在 init() 预分配；
 *   3. 帧内只做数值运算 + ctx 调用，不建对象、不建数组、不拼字符串；
 *   4. helpers.project 返回共享对象 —— 调用后立即解构，绝不持引用；
 *   5. spawnParticle 传入模块级复用的 PARTICLE_SPEC（同步读取语义）。
 * ========================================================================== */

const TAU = Math.PI * 2;

/* --------------------------------------------------------------------------
 * 0. 数值 & 颜色工具（模块级，纯函数，无分配）
 * ------------------------------------------------------------------------ */

function clampN(v, a, b) { return v < a ? a : (v > b ? b : v); }

function lerpN(a, b, t) { return a + (b - a) * t; }

function smoothN(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return t * t * (3 - 2 * t);
}

/* 确定性哈希：同参数跨帧同值，用来做“固定噪声”，不占槽位也不分配 */
function hash1(n) {
  const s = Math.sin(n * 127.1) * 43758.5453123;
  return s - Math.floor(s);
}

function hash2(a, b) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453123;
  return s - Math.floor(s);
}

function rgba(r, g, b, a) {
  const aa = (a === undefined) ? 1 : a;
  return 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',' + aa + ')';
}

/* init 期专用 LCG（闭包只在初始化时创建一次） */
function makeRng(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* 多段落色阶：stops = [[pos, r, g, b, a], ...]，只在模块加载期调用 */
function buildRamp(stops, n) {
  const out = new Array(n);
  const last = stops.length - 1;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    let k = 0;
    while (k < last - 1 && t > stops[k + 1][0]) k++;
    const s0 = stops[k];
    const s1 = stops[k + 1];
    const span = (s1[0] - s0[0]) || 1e-6;
    const f = clampN((t - s0[0]) / span, 0, 1);
    out[i] = rgba(
      lerpN(s0[1], s1[1], f),
      lerpN(s0[2], s1[2], f),
      lerpN(s0[3], s1[3], f),
      Math.round(lerpN(s0[4], s1[4], f) * 1000) / 1000
    );
  }
  return out;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function vertX(vts, flat, k) { return flat ? vts[k * 2] : vts[k].x; }
function vertY(vts, flat, k) { return flat ? vts[k * 2 + 1] : vts[k].y; }

/* --------------------------------------------------------------------------
 * 1. 调色板 / 色阶（模块加载期一次性预计算）
 * ------------------------------------------------------------------------ */

const MAGMA_BASE = '#070506';
const MAGMA_TABLE_FILL = '#150f0e';
const MAGMA_TABLE_EDGE = 'rgba(255,124,38,1)';
const MAGMA_TABLE_INNER = 'rgba(255,72,16,1)';
const STONE_LIGHT = '#2b2320';
const STONE_DARK = '#080607';

const BASALT_BANDS = [
  'rgba(29,23,21,1)', 'rgba(20,16,16,1)', 'rgba(35,27,24,1)', 'rgba(15,12,13,1)',
  'rgba(27,22,21,1)', 'rgba(13,11,12,1)', 'rgba(31,24,22,1)', 'rgba(18,14,14,1)'
];

/* 熔岩色阶：亮黄白 → 橙 → 赤红 → 暗红余烬（冷却用同一张表取下标） */
const LAVA_RAMP = buildRamp([
  [0.00, 255, 252, 216, 1],
  [0.14, 255, 219, 120, 1],
  [0.32, 255, 148, 38, 1],
  [0.52, 219, 62, 10, 1],
  [0.74, 138, 20, 6, 1],
  [1.00, 48, 7, 4, 1]
], 40);

const EMBER_RAMP = buildRamp([
  [0.00, 255, 246, 196, 1],
  [0.38, 255, 178, 62, 1],
  [0.72, 255, 96, 22, 1],
  [1.00, 128, 26, 8, 0.15]
], 18);

const HEAT_TONES = [
  'rgba(255,110,24,1)', 'rgba(255,72,14,1)', 'rgba(190,40,10,1)'
];

/* 水墨：宣纸 / 纤维 / 远山雾 / 墨阶 */
const PAPER_BASE = '#efe7d5';
const PAPER_EDGE = '#f7f1e3';
const PAPER_SPECKS = 'rgba(238,228,206,1)';

const PAPER_MOTTLE = [
  'rgba(198,178,138,1)', 'rgba(176,158,124,1)', 'rgba(214,196,158,1)',
  'rgba(160,146,118,1)', 'rgba(206,188,150,1)', 'rgba(184,168,132,1)'
];

const FIBER_TONES = [
  'rgba(148,134,108,1)', 'rgba(118,108,90,1)',
  'rgba(246,240,222,1)', 'rgba(96,92,84,1)'
];

const MIST_TONES = [
  'rgba(150,152,156,0.20)', 'rgba(122,126,132,0.15)', 'rgba(100,104,112,0.10)'
];

const INK_RAMP = buildRamp([
  [0.00, 26, 27, 32, 1],
  [0.50, 52, 54, 60, 1],
  [1.00, 104, 106, 112, 0.30]
], 20);

const INK_WASH = [
  'rgba(64,66,72,1)', 'rgba(88,90,96,1)', 'rgba(50,52,58,1)'
];

const INK_STRONG = 'rgba(32,33,38,1)';
const INK_MID = 'rgba(58,60,66,1)';
const INK_WET = 'rgba(40,42,48,1)';

const GOLD_RAMP = buildRamp([
  [0.00, 255, 244, 196, 1],
  [0.45, 228, 186, 88, 1],
  [1.00, 176, 126, 42, 0.35]
], 20);

const SEAL_RED = 'rgba(176,48,31,0.95)';
const SEAL_RED_DEEP = 'rgba(140,32,20,0.9)';

const MAGMA_SHOCK_GOLD = 'rgba(255,216,112,1)';
const MAGMA_SHOCK_COLOR = 'rgba(255,132,36,1)';
const MAGMA_SHOCK_DARK = 'rgba(72,66,60,1)';
const SHUIMO_SHOCK = 'rgba(38,40,46,1)';
const SHUIMO_SHOCK_GOLD = 'rgba(226,184,84,1)';

/* 面板常量表：避免热路径数组字面量 */
const FACE_RING_SCALES = [0.82, 0.64];
const SEAL_CHARS = {
  critical: ['天', '命'],
  success: ['破', '局'],
  costly: ['险', '胜'],
  failure: ['失', '手'],
  fumble: ['劫', '数'],
  normal: ['破', '局']
};
const SEAL_TEXT = {
  critical: '天命', success: '破局', costly: '险胜',
  failure: '失手', fumble: '劫数', normal: '破局'
};
const SEAL_FONT = '700 20px "STKaiti","KaiTi","Songti SC","SimSun",serif';

/* --------------------------------------------------------------------------
 * 2. styleFace 面板调色板（预计算常量对象，热路径只取引用）
 * ------------------------------------------------------------------------ */

const MAGMA_PAL = {
  critical: {
    fill: '#120a06', edge: '#ffd45a', lineW: 2.4, glow: 1.0, glowColor: '#ff9a1f',
    text: '#fff3c9', pip: '#fff3c9', accent: '#ff3d00', rim: '#ffe6a2',
    sheen: '#ffb347', crackAlpha: 1.0, hatch: 1
  },
  success: {
    fill: '#14100f', edge: '#ff8a1f', lineW: 2.1, glow: 0.7, glowColor: '#ff7a12',
    text: '#ffe1ad', pip: '#ffe1ad', accent: '#ff5a12', rim: '#ffcf8a',
    sheen: '#ff9d3c', crackAlpha: 0.65, hatch: 1
  },
  costly: {
    fill: '#121010', edge: '#c8501a', lineW: 1.9, glow: 0.45, glowColor: '#b84512',
    text: '#e9ad7c', pip: '#e9ad7c', accent: '#a8380f', rim: '#d9895a',
    sheen: '#b96a33', crackAlpha: 0.4, hatch: 1
  },
  failure: {
    fill: '#111113', edge: '#6c6a70', lineW: 1.7, glow: 0.18, glowColor: '#7a6a5a',
    text: '#b9aaa0', pip: '#a9998e', accent: '#6e6058', rim: '#8b8380',
    sheen: '#6f6862', crackAlpha: 0.18, hatch: 0
  },
  fumble: {
    fill: '#0e0e10', edge: '#3b3f46', lineW: 1.6, glow: 0.1, glowColor: '#4a4038',
    text: '#8c8078', pip: '#776c64', accent: '#4a423c', rim: '#4e4c50',
    sheen: '#3a3835', crackAlpha: 0.1, hatch: 0
  },
  normal: {
    fill: '#131010', edge: '#b8804a', lineW: 1.8, glow: 0.32, glowColor: '#9c5a20',
    text: '#e5c79f', pip: '#dcc09a', accent: '#a3622c', rim: '#c9976a',
    sheen: '#a97a4e', crackAlpha: 0.3, hatch: 1
  }
};

/* 孤注一掷（push）：整体更烫，描边接近熔金 */
const MAGMA_PUSH_PAL = {
  fill: '#150b06', edge: '#ffd979', lineW: 2.5, glow: 1.0, glowColor: '#ff6a00',
  text: '#fff0c0', pip: '#fff0c0', accent: '#ff2d00', rim: '#ffe9b0',
  sheen: '#ff8f2a', crackAlpha: 1.0, hatch: 1
};

const SHUIMO_PAL = {
  critical: {
    fill: '#fbf7ec', edge: '#b8892f', lineW: 1.7, glow: 0.5, glowColor: '#e6c579',
    text: '#2a1f16', pip: '#1f1c19', ink: '#2a2118', accent: '#b0301f',
    seal: 1
  },
  success: {
    fill: '#f7f2e5', edge: '#2c2c31', lineW: 1.5, glow: 0.16, glowColor: '#8d9096',
    text: '#23242a', pip: '#1f2026', ink: '#2c2c31', accent: '#3a3b42',
    seal: 0
  },
  costly: {
    fill: '#f4eee0', edge: '#6b6359', lineW: 1.4, glow: 0.1, glowColor: '#8a8478',
    text: '#3d372f', pip: '#4a443c', ink: '#575049', accent: '#6b6359',
    seal: 0
  },
  failure: {
    fill: '#e9e2d2', edge: '#3a3a40', lineW: 1.3, glow: 0.06, glowColor: '#7c7f84',
    text: '#2e2f34', pip: '#34353a', ink: '#3a3a40', accent: '#4a4b52',
    seal: 0
  },
  fumble: {
    fill: '#23242a', edge: '#8f8a80', lineW: 1.5, glow: 0.12, glowColor: '#5f6268',
    text: '#efe9da', pip: '#e2dccd', ink: '#8f8a80', accent: '#a8a29a',
    seal: 0
  },
  normal: {
    fill: '#f7f1e2', edge: '#34343a', lineW: 1.4, glow: 0.12, glowColor: '#8d9096',
    text: '#26272c', pip: '#222329', ink: '#34343a', accent: '#4c4d54',
    seal: 0
  }
};

/* --------------------------------------------------------------------------
 * 3. 共享粒子描述符（同步写入 → spawnParticle 读取，零对象分配）
 * ------------------------------------------------------------------------ */

const PARTICLE_SPEC = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  size: 1, endSize: 1, life: 1,
  r: 255, g: 255, b: 255, a: 1,
  gravity: 0, drag: 0, blend: 'lighter', shape: 'spark'
};

function emitParticle(helpers, x, y, z, vx, vy, vz, size, endSize, life,
                      r, g, b, a, gravity, drag, blend, shape) {
  const p = PARTICLE_SPEC;
  p.x = x; p.y = y; p.z = z;
  p.vx = vx; p.vy = vy; p.vz = vz;
  p.size = size; p.endSize = endSize; p.life = life;
  p.r = r; p.g = g; p.b = b; p.a = a;
  p.gravity = gravity; p.drag = drag;
  p.blend = blend; p.shape = shape;
  helpers.spawnParticle(p);
}

/* ==========================================================================
 * 4. MAGMA —— 炼狱熔岩锻造
 * ========================================================================== */

const MAGMA_ROOT_N = 22;   /* 桌面固定熔岩龟裂 */
const MAGMA_IMPACT_N = 14; /* 弹跳砸出的放射裂纹槽 */
const MAGMA_EMBER_N = 36;  /* 桌面余烬槽 */

function magmaInit(ctx, W, H, state) {
  const custom = state.custom || (state.custom = {});
  const s = custom.magma || (custom.magma = {});
  const rng = makeRng(0x51ed2701);

  s.W = W;
  s.H = H;
  s.clock = 0;
  s.blastBorn = -1;
  s.blastLife = 1.6;
  s.goldBurst = 0;

  /* 固定龟裂纹槽 */
  const rootX = new Float32Array(MAGMA_ROOT_N);
  const rootY = new Float32Array(MAGMA_ROOT_N);
  const rootLen = new Float32Array(MAGMA_ROOT_N);
  const rootAng = new Float32Array(MAGMA_ROOT_N);
  const rootWidth = new Float32Array(MAGMA_ROOT_N);
  const rootPhase = new Float32Array(MAGMA_ROOT_N);
  for (let i = 0; i < MAGMA_ROOT_N; i++) {
    rootX[i] = (rng() - 0.5) * 2 * W * 0.37;
    rootY[i] = (rng() - 0.5) * 2 * H * 0.33;
    rootLen[i] = 46 + rng() * 132;
    rootAng[i] = rng() * TAU;
    rootWidth[i] = 0.6 + rng() * 1.7;
    rootPhase[i] = rng() * TAU;
  }
  s.rootX = rootX;
  s.rootY = rootY;
  s.rootLen = rootLen;
  s.rootAng = rootAng;
  s.rootWidth = rootWidth;
  s.rootPhase = rootPhase;

  /* 撞击放射裂纹槽（环形缓冲） */
  s.impX = new Float32Array(MAGMA_IMPACT_N);
  s.impY = new Float32Array(MAGMA_IMPACT_N);
  s.impZ = new Float32Array(MAGMA_IMPACT_N);
  s.impBorn = new Float32Array(MAGMA_IMPACT_N);
  s.impLife = new Float32Array(MAGMA_IMPACT_N);
  s.impSeed = new Float32Array(MAGMA_IMPACT_N);
  s.impArms = new Uint8Array(MAGMA_IMPACT_N);
  s.impHead = 0;

  /* 余烬槽 */
  s.emberX = new Float32Array(MAGMA_EMBER_N);
  s.emberY = new Float32Array(MAGMA_EMBER_N);
  s.emberSeed = new Float32Array(MAGMA_EMBER_N);
  s.emberSize = new Float32Array(MAGMA_EMBER_N);
  for (let i = 0; i < MAGMA_EMBER_N; i++) {
    s.emberX[i] = (rng() - 0.5) * 2 * W * 0.4;
    s.emberY[i] = (rng() - 0.5) * 2 * H * 0.35;
    s.emberSeed[i] = rng();
    s.emberSize[i] = 0.8 + rng() * 2.2;
  }
}

function magmaDrawBackground(ctx, W, H, time, state, helpers) {
  const s = state.custom && state.custom.magma;
  if (!s || !s.rootX) return;

  s.clock = time;
  const pulse = 0.5 + 0.5 * Math.sin(time * 0.85);

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = MAGMA_BASE;
  ctx.fillRect(0, 0, W, H);

  /* 玄武岩岩层（边界用固定噪声折线，避免笔直横线） */
  const bandH = H / 8 + 1;
  for (let i = 0; i < 8; i++) {
    const y0 = i * bandH;
    const y1 = (i + 1) * bandH;
    ctx.globalAlpha = 0.55 + 0.22 * hash1(i * 5.13 + 0.7);
    ctx.fillStyle = BASALT_BANDS[i];
    ctx.beginPath();
    ctx.moveTo(0, y0 + (hash2(i + 0.5, 0.5) - 0.5) * 16);
    for (let k = 1; k <= 12; k++) {
      ctx.lineTo((k / 12) * W, y0 + (hash2(i + 0.5, k + 1.5) - 0.5) * 16);
    }
    for (let k = 12; k >= 0; k--) {
      ctx.lineTo((k / 12) * W, y1 + (hash2(i + 1.5, k + 1.5) - 0.5) * 16);
    }
    ctx.closePath();
    ctx.fill();
  }

  /* 岩面颗粒 */
  for (let i = 0; i < 96; i++) {
    const gx = hash1(i * 1.37 + 3.1) * W;
    const gy = hash1(i * 2.71 + 9.2) * H;
    const gr = 1 + hash1(i * 3.11 + 1.7) * 2.4;
    ctx.globalAlpha = 0.06 + 0.09 * hash1(i * 4.7 + 5.3);
    ctx.fillStyle = (i & 1) ? STONE_LIGHT : STONE_DARK;
    ctx.fillRect(gx, gy, gr, gr);
  }

  /* 桌面铁砧台面（世界坐标投影对齐） */
  const tx = W * 0.42;
  const ty = H * 0.38;
  const { sx: ax, sy: ay } = helpers.project(-tx, -ty, 0);
  const { sx: bx, sy: by } = helpers.project(tx, -ty, 0);
  const { sx: cx, sy: cy } = helpers.project(tx, ty, 0);
  const { sx: dx, sy: dy } = helpers.project(-tx, ty, 0);

  const cut = 0.045;
  ctx.globalAlpha = 1;
  ctx.fillStyle = MAGMA_TABLE_FILL;
  ctx.beginPath();
  ctx.moveTo(lerpN(ax, bx, cut), lerpN(ay, by, cut));
  ctx.lineTo(lerpN(ax, bx, 1 - cut), lerpN(ay, by, 1 - cut));
  ctx.lineTo(lerpN(bx, cx, cut), lerpN(by, cy, cut));
  ctx.lineTo(lerpN(bx, cx, 1 - cut), lerpN(by, cy, 1 - cut));
  ctx.lineTo(lerpN(cx, dx, cut), lerpN(cy, dy, cut));
  ctx.lineTo(lerpN(cx, dx, 1 - cut), lerpN(cy, dy, 1 - cut));
  ctx.lineTo(lerpN(dx, ax, cut), lerpN(dy, ay, cut));
  ctx.lineTo(lerpN(dx, ax, 1 - cut), lerpN(dy, ay, 1 - cut));
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.16 + 0.20 * pulse;
  ctx.strokeStyle = MAGMA_TABLE_EDGE;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  ctx.globalAlpha = 0.07 + 0.04 * pulse;
  ctx.strokeStyle = MAGMA_TABLE_INNER;
  ctx.lineWidth = Math.min(W, H) * 0.010;
  ctx.stroke();

  /* 地脉赤金熔岩裂隙：呼吸脉动 */
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 0; i < s.rootX.length; i++) {
    const ph = s.rootPhase[i];
    const glow = 0.30 + 0.50 * (0.5 + 0.5 * Math.sin(time * 0.85 + ph));
    let wx = s.rootX[i];
    let wy = s.rootY[i];
    let ang = s.rootAng[i];
    const seg = s.rootLen[i] / 4;
    const { sx: rsx, sy: rsy } = helpers.project(wx, wy, 0);
    ctx.beginPath();
    ctx.moveTo(rsx, rsy);
    for (let k = 0; k < 4; k++) {
      ang += (hash2(i + 0.5, k + 1.5) - 0.5) * 1.1;
      wx += Math.cos(ang) * seg;
      wy += Math.sin(ang) * seg;
      const { sx: rqx, sy: rqy } = helpers.project(wx, wy, 0);
      ctx.lineTo(rqx, rqy);
    }
    ctx.globalAlpha = glow * 0.22;
    ctx.strokeStyle = LAVA_RAMP[21];
    ctx.lineWidth = s.rootWidth[i] * 4.2;
    ctx.stroke();
    ctx.globalAlpha = glow * 0.95;
    ctx.strokeStyle = LAVA_RAMP[3 + ((i * 3) % 9)];
    ctx.lineWidth = s.rootWidth[i] * 1.35;
    ctx.stroke();
  }

  /* 弹跳砸出的灼热放射状裂纹：亮黄 → 暗红冷却消散 */
  for (let i = 0; i < s.impLife.length; i++) {
    const life = s.impLife[i];
    if (life <= 0) continue;
    let age = time - s.impBorn[i];
    if (age < 0) age = 0;
    if (age > life) continue;
    const t = age / life;
    const arms = s.impArms[i];
    const seed = s.impSeed[i];
    const ci = (t * (LAVA_RAMP.length - 1)) | 0;
    const gi = ci + 7 < LAVA_RAMP.length ? ci + 7 : LAVA_RAMP.length - 1;
    const alpha = (1 - t) * (1 - t * 0.3);
    const czw = s.impZ[i];
    for (let a = 0; a < arms; a++) {
      let ang = (a / arms) * TAU + hash2(seed, a) * 0.9;
      let wx = s.impX[i];
      let wy = s.impY[i];
      const { sx: isx, sy: isy } = helpers.project(wx, wy, czw);
      ctx.beginPath();
      ctx.moveTo(isx, isy);
      for (let k = 1; k <= 3; k++) {
        ang += (hash2(seed + k, a) - 0.5) * 0.9;
        const step = 11 + 9 * hash2(seed + k * 2, a + 1);
        wx += Math.cos(ang) * step;
        wy += Math.sin(ang) * step;
        const { sx: iqx, sy: iqy } = helpers.project(wx, wy, czw * (1 - k * 0.32));
        ctx.lineTo(iqx, iqy);
      }
      ctx.globalAlpha = alpha * 0.32;
      ctx.strokeStyle = LAVA_RAMP[gi];
      ctx.lineWidth = 7.2 * (1 - t * 0.55);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.95;
      ctx.strokeStyle = LAVA_RAMP[ci];
      ctx.lineWidth = 2.6 * (1 - t * 0.55);
      ctx.stroke();
    }
  }

  /* 桌面余烬（预分配槽位，程序化上升） */
  for (let i = 0; i < s.emberX.length; i++) {
    const seed = s.emberSeed[i];
    let t = (time * (0.15 + 0.11 * hash1(i * 2.1)) + seed) % 1;
    if (t < 0) t += 1;
    const z = t * 96;
    const wx = s.emberX[i] + Math.sin(time * 1.7 + i) * 9;
    const wy = s.emberY[i] + Math.cos(time * 1.3 + i * 2.1) * 7;
    const { sx, sy, scale } = helpers.project(wx, wy, z);
    const a = (1 - t) * (0.30 + 0.45 * hash1(i * 3.3));
    const ci = (t * (EMBER_RAMP.length - 1)) | 0;
    const r = s.emberSize[i] * (0.6 + t * 1.5) * scale;
    ctx.globalAlpha = a;
    ctx.fillStyle = EMBER_RAMP[ci];
    ctx.fillRect(sx - r * 0.5, sy - r * 0.5, r, r);
  }

  ctx.restore();
}

function magmaOnBounce(impact, state, helpers) {
  const s = state.custom && state.custom.magma;
  if (!s) return;
  const x = (impact && typeof impact.x === 'number') ? impact.x : 0;
  const y = (impact && typeof impact.y === 'number') ? impact.y : 0;
  const z = (impact && typeof impact.z === 'number') ? impact.z : 0;
  const power = (impact && typeof impact.speed === 'number')
    ? clampN(impact.speed / 900, 0.5, 2) : 1;

  /* 迸射炽白橙红火星（重力弹跳） */
  const n = 9 + ((helpers.rand(0, 4)) | 0);
  for (let i = 0; i < n; i++) {
    const ang = helpers.rand(0, TAU);
    const spd = helpers.rand(40, 180) * power;
    emitParticle(
      helpers,
      x, y, z + helpers.rand(0, 4),
      Math.cos(ang) * spd, Math.sin(ang) * spd, helpers.rand(30, 160) * power,
      helpers.rand(1.6, 3.6), 0.4,
      helpers.rand(0.35, 0.85),
      255, helpers.rand(150, 236) | 0, helpers.rand(30, 92) | 0, 1,
      620, 0.85, 'lighter', 'spark'
    );
  }

  /* 升腾灰烬 */
  for (let i = 0; i < 3; i++) {
    emitParticle(
      helpers,
      x + helpers.rand(-8, 8), y + helpers.rand(-8, 8), z + 2,
      helpers.rand(-18, 18), helpers.rand(-18, 18), helpers.rand(24, 70),
      helpers.rand(1.4, 3), 0.5,
      helpers.rand(0.8, 1.5),
      122, 114, 106, 0.5,
      -22, 0.6, 'source-over', 'ash'
    );
  }

  /* 写入一条放射状熔岩裂纹槽位 */
  const i = s.impHead | 0;
  s.impHead = (i + 1) % s.impLife.length;
  s.impX[i] = x;
  s.impY[i] = y;
  s.impZ[i] = z;
  s.impBorn[i] = s.clock;
  s.impLife[i] = 1.35;
  s.impSeed[i] = helpers.rand(0, 1000);
  s.impArms[i] = 4 + ((helpers.rand(0, 3)) | 0);
}

function magmaOnSettle(outcome, state, helpers) {
  const s = state.custom && state.custom.magma;
  if (!s) return;
  const tier = (typeof outcome === 'string')
    ? outcome
    : ((outcome && outcome.tier) || state.tier || 'normal');
  const mode = state.mode || 'normal';

  s.blastBorn = s.clock;
  s.blastLife = 1.6;
  s.goldBurst = (tier === 'critical' || mode === 'push') ? 1 : 0;

  if (tier === 'critical' || mode === 'push') {
    /* 火山熔柱冲击波 + 漫天金红流火 */
    helpers.spawnShockwave(0, 0, Math.max(s.W, s.H) * 0.55, 1.15, MAGMA_SHOCK_GOLD, 5);
    helpers.spawnShockwave(0, 0, Math.max(s.W, s.H) * 0.36, 0.85, MAGMA_SHOCK_COLOR, 3);
    for (let i = 0; i < 30; i++) {
      const ang = helpers.rand(0, TAU);
      const rad = Math.sqrt(helpers.rand(0, 1)) * 48;
      const px = Math.cos(ang) * rad;
      const py = Math.sin(ang) * rad;
      emitParticle(
        helpers,
        px, py, 6,
        px * 1.6, py * 1.6, helpers.rand(220, 620),
        helpers.rand(2, 5), 0.6,
        helpers.rand(1.1, 2.1),
        255, helpers.rand(170, 236) | 0, helpers.rand(40, 112) | 0, 1,
        260, 0.35, 'lighter', 'spark'
      );
    }
    for (let i = 0; i < 10; i++) {
      emitParticle(
        helpers,
        helpers.rand(-30, 30), helpers.rand(-30, 30), helpers.rand(8, 40),
        helpers.rand(-70, 70), helpers.rand(-70, 70), helpers.rand(160, 420),
        helpers.rand(3, 6), 0.8,
        helpers.rand(1.4, 2.4),
        255, 238, 190, 0.9,
        120, 0.4, 'lighter', 'spark'
      );
    }
  } else if (tier === 'fumble') {
    /* 黑烟碎炭崩裂 */
    helpers.spawnShockwave(0, 0, Math.max(s.W, s.H) * 0.30, 0.9, MAGMA_SHOCK_DARK, 3);
    for (let i = 0; i < 24; i++) {
      const ang = helpers.rand(0, TAU);
      const spd = helpers.rand(30, 170);
      emitParticle(
        helpers,
        Math.cos(ang) * helpers.rand(0, 16), Math.sin(ang) * helpers.rand(0, 16), helpers.rand(0, 14),
        Math.cos(ang) * spd, Math.sin(ang) * spd, helpers.rand(20, 150),
        helpers.rand(2.5, 6), 10,
        helpers.rand(0.9, 1.7),
        52, 48, 46, 0.55,
        -40, 0.8, 'source-over', 'ash'
      );
    }
    for (let i = 0; i < 10; i++) {
      emitParticle(
        helpers,
        helpers.rand(-14, 14), helpers.rand(-14, 14), helpers.rand(0, 10),
        helpers.rand(-120, 120), helpers.rand(-120, 120), helpers.rand(40, 200),
        helpers.rand(2, 4), 1,
        helpers.rand(0.6, 1.2),
        28, 26, 25, 0.9,
        700, 0.4, 'source-over', 'shard'
      );
    }
  } else {
    for (let i = 0; i < 10; i++) {
      const ang = helpers.rand(0, TAU);
      const spd = helpers.rand(24, 120);
      emitParticle(
        helpers,
        0, 0, 4,
        Math.cos(ang) * spd, Math.sin(ang) * spd, helpers.rand(60, 200),
        helpers.rand(1.4, 3), 0.5,
        helpers.rand(0.7, 1.2),
        255, helpers.rand(140, 210) | 0,
        helpers.rand(40, 90) | 0, 0.85,
        320, 0.6, 'lighter', 'spark'
      );
    }
  }
}

function magmaDrawDieTrail(ctx, die, time, state, helpers) {
  const n = Math.min(die.trailCount | 0, 24);
  if (n < 2) return;
  const radius = (typeof die.radius === 'number' && die.radius > 0) ? die.radius : 9;
  const di = die.index | 0;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let px = 0;
  let py = 0;
  let pScale = 1;
  let has = 0;

  for (let i = 0; i < n; i++) {
    const idx = (die.trailHead - i + 24) % 24;
    const { sx, sy, scale } = helpers.project(die.trailX[idx], die.trailY[idx], die.trailZ[idx]);
    if (has) {
      const f = 1 - i / n;
      const flick = 0.62 + 0.38 * Math.sin(time * 22 + idx * 1.7 + di);
      const w = radius * scale * (0.09 + 0.48 * f);
      const ci = ((Math.pow(i / n, 0.62) * (LAVA_RAMP.length - 1)) | 0);
      const breakUp = hash2(idx + 0.7, di * 2.3 + 4.1) < 0.16;

      if (!breakUp) {
        /* 外焰 */
        ctx.globalAlpha = f * 0.22 * flick;
        ctx.strokeStyle = LAVA_RAMP[(ci + 10) < LAVA_RAMP.length ? ci + 10 : LAVA_RAMP.length - 1];
        ctx.lineWidth = w * 1.9;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();

        /* 火舌芯 */
        ctx.globalAlpha = f * 0.90 * flick;
        ctx.strokeStyle = LAVA_RAMP[ci];
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }
    }
    px = sx;
    py = sy;
    pScale = scale;
    has = 1;
  }

  /* 骰体根部余温点 */
  if (has) {
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = LAVA_RAMP[8];
    ctx.beginPath();
    ctx.arc(px, py, radius * pScale * 0.55, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

function magmaStyleFace(info, state, helpers) {
  let out = info.out;
  /* 引擎违约兜底：正常帧内路径 info.out 一定存在，不会走到这里 */
  if (!out) out = info.out = {};

  const tier = state.tier || 'normal';
  const pal = (state.mode === 'push' && tier !== 'failure' && tier !== 'fumble')
    ? MAGMA_PUSH_PAL
    : (MAGMA_PAL[tier] || MAGMA_PAL.normal);

  out.style = 'magma';
  out.skin = 'obsidian';
  out.fill = pal.fill;
  out.faceFill = pal.fill;
  out.faceColor = pal.fill;
  out.edge = pal.edge;
  out.edgeColor = pal.edge;
  out.stroke = pal.edge;
  out.lineWidth = pal.lineW;
  out.strokeWidth = pal.lineW;
  out.glow = pal.glow;
  out.glowStrength = pal.glow;
  out.glowColor = pal.glowColor;
  out.crackAlpha = pal.crackAlpha;
  out.innerGlow = pal.crackAlpha;
  out.hatch = pal.hatch;
  out.text = pal.text;
  out.textColor = pal.text;
  out.pip = pal.pip;
  out.pipColor = pal.pip;
  out.accent = pal.accent;
  out.rim = pal.rim;
  out.rimColor = pal.rim;
  out.sheen = pal.sheen;
  out.overlay = 1;
  out.overlayStyle = 'magma';
  out.seal = 0;
  out.sealText = '';
  out.blend = 'lighter';

  return out;
}

function magmaDrawFaceOverlay(ctx, cx, cy, radius, verts2D, vertCount, info, state) {
  const n = vertCount | 0;
  if (n < 3 || !verts2D) return;
  const flat = typeof verts2D[0] === 'number';
  const pulse = 0.5 + 0.5 * Math.sin((state.rollTime || 0) * 6.0 + (info.index | 0));
  const di = info.index | 0;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /* 棱面内圈岩浆底色 */
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const x = lerpN(cx, vertX(verts2D, flat, k), 0.72);
    const y = lerpN(cy, vertY(verts2D, flat, k), 0.72);
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.globalAlpha = 0.07 + 0.10 * pulse;
  ctx.fillStyle = LAVA_RAMP[26];
  ctx.fill();
  ctx.globalAlpha = 0.30 + 0.22 * pulse;
  ctx.strokeStyle = LAVA_RAMP[8];
  ctx.lineWidth = Math.max(0.8, radius * 0.035);
  ctx.stroke();

  /* 棱面内部发光岩浆裂纹 */
  for (let k = 0; k < 5; k++) {
    const v = (hash1(k * 3.7 + di * 1.91) * n) | 0;
    const ex = lerpN(cx, vertX(verts2D, flat, v % n), 0.66);
    const ey = lerpN(cy, vertY(verts2D, flat, v % n), 0.66);
    const mx = lerpN(cx, ex, 0.46) + (hash2(k + 1, di + 2.1) - 0.5) * radius * 0.22;
    const my = lerpN(cy, ey, 0.46) + (hash2(k + 3, di + 5.3) - 0.5) * radius * 0.22;
    ctx.globalAlpha = 0.28 + 0.40 * pulse;
    ctx.strokeStyle = LAVA_RAMP[3 + ((k * 5) % 12)];
    ctx.lineWidth = 1.0 + hash1(k * 9.1 + di) * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(mx, my);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }

  /* 中心熔核 */
  ctx.globalAlpha = 0.30 + 0.34 * pulse;
  ctx.fillStyle = LAVA_RAMP[1];
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.16, 0, TAU);
  ctx.fill();

  ctx.restore();
}

/* 火舌：底宽顶尖、带摆动，用于火山熔柱本体 */
function flameTongue(ctx, cx, yBase, height, halfW, seed, color, alpha, time) {
  if (alpha <= 0.002) return;
  const sway = Math.sin(time * 5.6 + seed) * halfW * 0.85;
  const sway2 = Math.sin(time * 9.1 + seed * 1.7) * halfW * 0.35;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx - halfW, yBase);
  ctx.quadraticCurveTo(cx - halfW * 1.22 + sway * 0.35, yBase - height * 0.42,
    cx + sway, yBase - height);
  ctx.quadraticCurveTo(cx + halfW * 1.12 + sway2, yBase - height * 0.40,
    cx + halfW, yBase);
  ctx.closePath();
  ctx.fill();
}

function magmaDrawForeground(ctx, W, H, time, state, helpers) {
  const s = state.custom && state.custom.magma;
  const cx = W * 0.5;
  const cy = H * 0.62;
  const pulse = 0.5 + 0.5 * Math.sin(time * 1.2);
  const settleT = state.settleTime || 0;
  const flash = (settleT > 0 && settleT < 0.9) ? clampN(1 - settleT / 0.9, 0, 1) : 0;
  const blast = (s && s.blastBorn >= 0) ? clampN(1 - (time - s.blastBorn) / s.blastLife, 0, 1) : 0;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  /* 热浪光环 */
  const baseR = Math.min(W, H) * 0.30;
  for (let k = 0; k < 3; k++) {
    const rr = baseR * (0.72 + k * 0.19) + Math.sin(time * 0.9 + k * 1.4) * 6;
    ctx.globalAlpha = (0.085 - k * 0.022) * (0.55 + 0.45 * pulse) * (0.4 + 0.6 * blast);
    ctx.strokeStyle = HEAT_TONES[k];
    ctx.lineWidth = 2 + k * 2.6;
    for (let seg = 0; seg < 5; seg++) {
      const a0 = time * 0.35 + seg * (TAU / 5) + k * 1.3;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, a0, a0 + 0.62);
      ctx.stroke();
    }
  }

  /* 铁砧火光晕（底部） */
  for (let k = 0; k < 3; k++) {
    ctx.globalAlpha = (0.10 - k * 0.026) * (0.6 + 0.4 * pulse) + 0.06 * blast;
    ctx.fillStyle = HEAT_TONES[k];
    const rx = W * (0.26 + k * 0.06);
    const ry = H * (0.042 + k * 0.013);
    ctx.beginPath();
    ctx.ellipse(cx, H * 0.96, rx, ry, 0, 0, TAU);
    ctx.fill();
  }

  /* 前景余烬：更高更亮的第二层 */
  if (s && s.emberX) {
    for (let i = 0; i < s.emberX.length; i += 2) {
      const seed = s.emberSeed[i];
      let t = (time * (0.19 + 0.12 * hash1(i * 1.7)) + seed + 0.5) % 1;
      if (t < 0) t += 1;
      const z = 40 + t * 150;
      const wx = s.emberX[i] * 1.08 + Math.sin(time * 2.1 + i) * 12;
      const wy = s.emberY[i] * 1.08 + Math.cos(time * 1.6 + i) * 9;
      const { sx, sy, scale } = helpers.project(wx, wy, z);
      const a = (1 - t) * 0.55;
      const ci = (t * (EMBER_RAMP.length - 1)) | 0;
      const r = s.emberSize[i] * (0.8 + t * 1.6) * scale;
      ctx.globalAlpha = a;
      ctx.fillStyle = EMBER_RAMP[ci];
      ctx.fillRect(sx - r * 0.5, sy - r * 0.5, r, r);
    }
  }

  /* 暴击 / 孤注一掷：火山熔柱（外焰 / 内焰 / 白热芯，三层叠加） */
  if (blast > 0 && s && s.goldBurst) {
    const flick = 0.76 + 0.24 * Math.sin(time * 33.0) + 0.06 * Math.sin(time * 71.0);
    const bottom = H * 0.93;
    const top = H * 0.05;
    flameTongue(ctx, cx, bottom, H * 0.50, W * 0.030, 1.7, LAVA_RAMP[15], blast * 0.34 * flick, time);
    flameTongue(ctx, cx - W * 0.014, bottom, H * 0.38, W * 0.019, 4.3, LAVA_RAMP[9], blast * 0.34 * flick, time);
    flameTongue(ctx, cx + W * 0.010, bottom, H * 0.30, W * 0.010, 6.7, LAVA_RAMP[5], blast * 0.36 * flick, time);
    flameTongue(ctx, cx, bottom, H * 0.22, W * 0.006, 8.1, LAVA_RAMP[1], blast * 0.44 * flick, time);

    /* 柱底熔池光核 */
    ctx.globalAlpha = blast * 0.20;
    ctx.fillStyle = LAVA_RAMP[8];
    ctx.beginPath();
    ctx.ellipse(cx, bottom, W * 0.055, H * 0.024, 0, 0, TAU);
    ctx.fill();
    /* 极轻暖场 */
    ctx.globalAlpha = blast * 0.04;
    ctx.fillStyle = HEAT_TONES[2];
    ctx.fillRect(0, 0, W, H);
  }

  if (flash > 0) {
    ctx.globalAlpha = flash * 0.16;
    ctx.fillStyle = MAGMA_SHOCK_GOLD;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.restore();
}

function magmaHasActiveFX(state) {
  if ((state.settleTime || 0) < 2.2) return true;
  const s = state.custom && state.custom.magma;
  if (!s || !s.impLife) return false;
  for (let i = 0; i < s.impLife.length; i++) {
    if (s.impLife[i] <= 0) continue;
    if ((s.clock - s.impBorn[i]) < s.impLife[i]) return true;
  }
  return false;
}

/* ==========================================================================
 * 5. SHUIMO —— 水墨丹青剑意
 * ========================================================================== */

const SHUIMO_FIBER_N = 140;
const SHUIMO_BLOT_N = 10;
const SHUIMO_RIPPLE_N = 12;
const SHUIMO_STREAK_N = 10;

function shuimoInit(ctx, W, H, state) {
  const custom = state.custom || (state.custom = {});
  const s = custom.shuimo || (custom.shuimo = {});
  const rng = makeRng(0x2f7d3c11);

  s.W = W;
  s.H = H;
  s.clock = 0;
  s.sealBorn = 0;
  s.sealTier = 'success';
  s.goldSlash = 0;
  s.goldBurst = 0;

  /* 宣纸纤维槽（归一化坐标，自适应 W/H） */
  s.fiberX = new Float32Array(SHUIMO_FIBER_N);
  s.fiberY = new Float32Array(SHUIMO_FIBER_N);
  s.fiberLen = new Float32Array(SHUIMO_FIBER_N);
  s.fiberAng = new Float32Array(SHUIMO_FIBER_N);
  s.fiberTone = new Uint8Array(SHUIMO_FIBER_N);
  s.fiberAlpha = new Float32Array(SHUIMO_FIBER_N);
  for (let i = 0; i < SHUIMO_FIBER_N; i++) {
    s.fiberX[i] = rng();
    s.fiberY[i] = rng();
    s.fiberLen[i] = 4 + rng() * 26;
    s.fiberAng[i] = (rng() - 0.5) * 0.55;
    s.fiberTone[i] = (rng() * FIBER_TONES.length) | 0;
    s.fiberAlpha[i] = 0.05 + rng() * 0.12;
  }

  /* 桌面水墨晕染墨点槽 */
  s.blotX = new Float32Array(SHUIMO_BLOT_N);
  s.blotY = new Float32Array(SHUIMO_BLOT_N);
  s.blotR = new Float32Array(SHUIMO_BLOT_N);
  s.blotSeed = new Float32Array(SHUIMO_BLOT_N);
  s.blotTone = new Uint8Array(SHUIMO_BLOT_N);
  for (let i = 0; i < SHUIMO_BLOT_N; i++) {
    s.blotX[i] = (rng() - 0.5) * 2 * W * 0.30;
    s.blotY[i] = (rng() - 0.5) * 2 * H * 0.26;
    s.blotR[i] = 18 + rng() * 46;
    s.blotSeed[i] = rng() * 997;
    s.blotTone[i] = (rng() * INK_WASH.length) | 0;
  }

  /* 墨涟漪槽 */
  s.rippleX = new Float32Array(SHUIMO_RIPPLE_N);
  s.rippleY = new Float32Array(SHUIMO_RIPPLE_N);
  s.rippleBorn = new Float32Array(SHUIMO_RIPPLE_N);
  s.rippleLife = new Float32Array(SHUIMO_RIPPLE_N);
  s.rippleSeed = new Float32Array(SHUIMO_RIPPLE_N);
  s.rippleHead = 0;

  /* 剑气残痕槽 */
  s.streakX1 = new Float32Array(SHUIMO_STREAK_N);
  s.streakY1 = new Float32Array(SHUIMO_STREAK_N);
  s.streakX2 = new Float32Array(SHUIMO_STREAK_N);
  s.streakY2 = new Float32Array(SHUIMO_STREAK_N);
  s.streakZ = new Float32Array(SHUIMO_STREAK_N);
  s.streakBorn = new Float32Array(SHUIMO_STREAK_N);
  s.streakLife = new Float32Array(SHUIMO_STREAK_N);
  s.streakWidth = new Float32Array(SHUIMO_STREAK_N);
  s.streakGold = new Uint8Array(SHUIMO_STREAK_N);
  s.streakHead = 0;
}

/* 平滑墨团路径：16 点 + 二次曲线过中点，天然圆润无折角 */
function wob(seed, layer, p) {
  return 0.905 + 0.17 * hash2(seed + layer * 2.3 + 0.5, p + 1.5);
}

function blobPath(ctx, cx, cy, rx, ry, seed, layer) {
  const N = 20;
  const step = TAU / N;
  const x0 = cx + Math.cos(0) * rx * wob(seed, layer, 0);
  const y0 = cy + Math.sin(0) * ry * wob(seed, layer, 0);
  const x1 = cx + Math.cos(step) * rx * wob(seed, layer, 1);
  const y1 = cy + Math.sin(step) * ry * wob(seed, layer, 1);
  ctx.beginPath();
  ctx.moveTo((x0 + x1) * 0.5, (y0 + y1) * 0.5);
  for (let p = 1; p <= N; p++) {
    const cxp = cx + Math.cos(p * step) * rx * wob(seed, layer, p);
    const cyp = cy + Math.sin(p * step) * ry * wob(seed, layer, p);
    const q = p + 1;
    const nx = cx + Math.cos(q * step) * rx * wob(seed, layer, q);
    const ny = cy + Math.sin(q * step) * ry * wob(seed, layer, q);
    ctx.quadraticCurveTo(cxp, cyp, (cxp + nx) * 0.5, (cyp + ny) * 0.5);
  }
  ctx.closePath();
}

/* 分形墨晕：不规则平滑层叠，无圆形“靶心”环带 */
function inkBlob(ctx, cx, cy, rx, ry, seed, tone, layers, alpha) {
  for (let L = 0; L < layers; L++) {
    const R = 1 - L * 0.17;
    blobPath(ctx, cx, cy, rx * R, ry * R, seed, L);
    ctx.globalAlpha = alpha * (1 - L * 0.15) * (0.78 + 0.42 * hash2(seed + L, 9.1));
    ctx.fillStyle = INK_WASH[(tone + (L >> 1)) % INK_WASH.length];
    ctx.fill();
  }
}

function shuimoDrawBackground(ctx, W, H, time, state, helpers) {
  const s = state.custom && state.custom.shuimo;
  if (!s || !s.fiberX) return;
  s.clock = time;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = PAPER_BASE;
  ctx.fillRect(0, 0, W, H);

  /* 古卷斑驳：大块柔和纸色沉淀 */
  for (let i = 0; i < 5; i++) {
    const bx = (0.10 + 0.80 * hash1(i * 3.3 + 0.4)) * W;
    const by = (0.12 + 0.76 * hash1(i * 4.9 + 1.2)) * H;
    const brx = (0.22 + 0.20 * hash1(i * 5.7 + 2.3)) * W;
    const bry = brx * (0.48 + 0.26 * hash1(i * 6.1 + 3.5));
    for (let L = 0; L < 2; L++) {
      ctx.globalAlpha = 0.060 - L * 0.024;
      ctx.fillStyle = PAPER_MOTTLE[i];
      blobPath(ctx, bx, by, brx * (1 + L * 0.20), bry * (1 + L * 0.20), i * 7.3 + 1.5, L);
      ctx.fill();
    }
  }

  /* 纸纤维 */
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (let i = 0; i < s.fiberX.length; i++) {
    const x = s.fiberX[i] * W;
    const y = s.fiberY[i] * H;
    const len = s.fiberLen[i];
    const ang = s.fiberAng[i];
    ctx.globalAlpha = s.fiberAlpha[i];
    ctx.strokeStyle = FIBER_TONES[s.fiberTone[i]];
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  /* 远山雾气：三层剪影（低透明度叠出层次） */
  for (let L = 0; L < 3; L++) {
    const baseY = H * (0.055 + L * 0.045);
    const amp = H * (0.055 - L * 0.012);
    const drift = Math.sin(time * 0.05 + L * 1.7) * W * 0.010;
    ctx.globalAlpha = 1;
    ctx.fillStyle = MIST_TONES[L];
    ctx.beginPath();
    ctx.moveTo(-W * 0.05 + drift, baseY + amp * 3.0);
    for (let k = 0; k <= 20; k++) {
      const x = (k / 20) * W * 1.1 - W * 0.05 + drift;
      const peak = 0.32 * Math.sin(k * 0.62 + L * 2.1)
        + 0.68 * hash2(L + 1, k) * hash2(L + 5, k * 1.7);
      ctx.lineTo(x, baseY - amp * peak);
    }
    ctx.lineTo(W * 1.05 + drift, baseY + amp * 3.0);
    ctx.closePath();
    ctx.fill();
  }

  /* 山脚雾化：纸色条带逐级覆盖，消除山体硬边 */
  const fogTop = H * 0.012;
  const fogBottom = H * 0.30;
  const fogSteps = 26;
  const fogH = (fogBottom - fogTop) / fogSteps;
  ctx.fillStyle = PAPER_BASE;
  for (let i = 0; i < fogSteps; i++) {
    const t = (i + 1) / fogSteps;
    ctx.globalAlpha = 0.46 * t * t;
    ctx.fillRect(0, fogTop + i * fogH, W, fogH + 1);
  }

  /* 桌面落墨：分形圆润墨晕 */
  for (let i = 0; i < s.blotX.length; i++) {
    const { sx, sy, scale } = helpers.project(s.blotX[i], s.blotY[i], 0);
    const baseR = s.blotR[i] * scale;
    inkBlob(ctx, sx, sy, baseR, baseR * 0.88, s.blotSeed[i], s.blotTone[i], 4, 0.040);
  }

  /* 骰子落点墨影：让白玉 / 黑墨骰从纸面上“立”起来 */
  if (state.dice) {
    for (let i = 0; i < state.dice.length; i++) {
      const d = state.dice[i];
      if (!d || typeof d.x !== 'number') continue;
      const { sx, sy, scale } = helpers.project(d.x, d.y, 0);
      const rr = (d.radius || 9) * scale;
      const height = clampN(1 - (d.z || 0) / 280, 0.34, 1);
      inkBlob(ctx, sx + scale * 2.2, sy + scale * 3.2, rr * 1.02, rr * 0.44,
        d.index * 31.7 + 5.5, 0, 4, 0.062 * height);
    }
  }

  /* 撞击点水墨涟漪（渐次晕开） */
  for (let i = 0; i < s.rippleBorn.length; i++) {
    if (s.rippleLife[i] <= 0) continue;
    const born = s.rippleBorn[i];
    let age = time - born;
    if (age < 0) age = 0;
    const life = s.rippleLife[i];
    if (age > life) continue;
    const t = age / life;
    const { sx, sy, scale } = helpers.project(s.rippleX[i], s.rippleY[i], 0);
    for (let k = 0; k < 3; k++) {
      const rr = (5 + t * 34 + k * 7.5) * scale;
      ctx.globalAlpha = (1 - t) * (0.20 - k * 0.05);
      ctx.strokeStyle = INK_WET;
      ctx.lineWidth = Math.max(1, 3.2 * scale * (1 - t));
      ctx.beginPath();
      ctx.arc(sx, sy, rr, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = (1 - t) * 0.18;
    ctx.fillStyle = INK_WASH[0];
    ctx.beginPath();
    ctx.arc(sx, sy, (3 + t * 8) * scale, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

function shuimoOnBounce(impact, state, helpers) {
  const s = state.custom && state.custom.shuimo;
  if (!s) return;
  const x = (impact && typeof impact.x === 'number') ? impact.x : 0;
  const y = (impact && typeof impact.y === 'number') ? impact.y : 0;
  const z = (impact && typeof impact.z === 'number') ? impact.z : 0;
  const power = (impact && typeof impact.speed === 'number')
    ? clampN(impact.speed / 900, 0.5, 2) : 1;

  /* 飞溅浓淡墨滴 */
  for (let i = 0; i < 10; i++) {
    const ang = helpers.rand(0, TAU);
    const spd = helpers.rand(36, 190) * power;
    const tone = helpers.rand(0, 1) < 0.3 ? 1 : 0;
    emitParticle(
      helpers,
      x, y, z + helpers.rand(0, 3),
      Math.cos(ang) * spd, Math.sin(ang) * spd, helpers.rand(20, 120) * power,
      helpers.rand(1.6, 4.2), 0.6,
      helpers.rand(0.5, 1.1),
      30, 32, 38, tone ? 0.85 : 0.55,
      540, 0.7, 'source-over', 'ink'
    );
  }
  /* 淡墨飞沫 */
  for (let i = 0; i < 4; i++) {
    emitParticle(
      helpers,
      x + helpers.rand(-6, 6), y + helpers.rand(-6, 6), z + 2,
      helpers.rand(-40, 40), helpers.rand(-40, 40), helpers.rand(10, 60),
      helpers.rand(1, 2.4), 0.3,
      helpers.rand(0.4, 0.8),
      70, 72, 78, 0.35,
      300, 0.6, 'source-over', 'ink'
    );
  }

  /* 撞击点生成一朵渐次晕开的水墨涟漪 */
  const i = s.rippleHead | 0;
  s.rippleHead = (i + 1) % s.rippleBorn.length;
  s.rippleX[i] = x;
  s.rippleY[i] = y;
  s.rippleBorn[i] = s.clock;
  s.rippleLife[i] = 1.25 + helpers.rand(0, 0.35);
  s.rippleSeed[i] = helpers.rand(0, 900);
}

function shuimoOnSettle(outcome, state, helpers) {
  const s = state.custom && state.custom.shuimo;
  if (!s) return;
  const tier = (typeof outcome === 'string')
    ? outcome
    : ((outcome && outcome.tier) || state.tier || 'normal');

  s.sealBorn = s.clock + 0.28;
  s.sealTier = SEAL_TEXT[tier] ? tier : 'normal';
  s.goldSlash = (tier === 'critical') ? 1 : 0;
  s.goldBurst = (tier === 'critical') ? 1 : 0;

  /* 凌厉弧形剑气：critical 万剑金墨交辉 */
  const count = (tier === 'critical') ? 4 : (tier === 'fumble' ? 2 : 3);
  for (let i = 0; i < count; i++) {
    const k = s.streakHead | 0;
    s.streakHead = (k + 1) % s.streakBorn.length;
    s.streakX1[k] = -s.W * helpers.rand(0.28, 0.46);
    s.streakY1[k] = helpers.rand(-s.H * 0.26, s.H * 0.26);
    s.streakX2[k] = s.W * helpers.rand(0.28, 0.46);
    s.streakY2[k] = helpers.rand(-s.H * 0.26, s.H * 0.26);
    s.streakZ[k] = helpers.rand(6, 48);
    s.streakBorn[k] = s.clock + i * 0.07;
    s.streakLife[k] = 1.05 + helpers.rand(0, 0.55);
    s.streakWidth[k] = helpers.rand(0.9, 2.1);
    s.streakGold[k] = (s.goldSlash && i === 0) ? 1 : 0;
  }

  /* 墨雾爆开 */
  for (let i = 0; i < 18; i++) {
    const ang = helpers.rand(0, TAU);
    const spd = helpers.rand(40, 200);
    emitParticle(
      helpers, 0, 0, helpers.rand(0, 10),
      Math.cos(ang) * spd, Math.sin(ang) * spd, helpers.rand(-30, 90),
      helpers.rand(2, 6), 9,
      helpers.rand(0.6, 1.2),
      36, 38, 44, 0.55,
      40, 0.9, 'source-over', 'ink'
    );
  }

  if (s.goldBurst) {
    for (let i = 0; i < 14; i++) {
      const ang = helpers.rand(0, TAU);
      const spd = helpers.rand(60, 240);
      emitParticle(
        helpers, 0, 0, helpers.rand(6, 40),
        Math.cos(ang) * spd, Math.sin(ang) * spd, helpers.rand(40, 200),
        helpers.rand(1.4, 3), 0.5,
        helpers.rand(0.7, 1.3),
        246, 214, 132, 0.95,
        220, 0.5, 'lighter', 'spark'
      );
    }
    helpers.spawnShockwave(0, 0, Math.max(s.W, s.H) * 0.42, 0.9, SHUIMO_SHOCK_GOLD, 3);
  }
  helpers.spawnShockwave(0, 0, Math.max(s.W, s.H) * 0.40, 0.8, SHUIMO_SHOCK, 2);
}

function shuimoDrawDieTrail(ctx, die, time, state, helpers) {
  const n = Math.min(die.trailCount | 0, 24);
  if (n < 2) return;
  const radius = (typeof die.radius === 'number' && die.radius > 0) ? die.radius : 9;
  const di = die.index | 0;
  const energy = clampN((die.speed || 0) / 900, 0.28, 1.7);

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let px = 0;
  let py = 0;
  let has = 0;

  for (let i = 0; i < n; i++) {
    const idx = (die.trailHead - i + 24) % 24;
    const { sx, sy, scale } = helpers.project(die.trailX[idx], die.trailY[idx], die.trailZ[idx]);
    if (has) {
      const f = 1 - i / n;
      /* 飞白：干笔断笔（确定性哈希，不抖动） */
      const dry = hash2(idx + 0.5, di * 3 + 1) < (0.16 + 0.22 * (1 - f));
      if (!dry) {
        const w = radius * scale * (0.18 + 0.90 * f) * energy;
        ctx.globalAlpha = 0.12 + 0.62 * f;
        ctx.strokeStyle = f > 0.58 ? INK_STRONG : INK_MID;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(sx, sy);
        ctx.stroke();

        /* 飞白侧锋：淡墨伴线 */
        ctx.globalAlpha = 0.10 + 0.18 * f;
        ctx.strokeStyle = INK_RAMP[14];
        ctx.lineWidth = Math.max(0.6, w * 0.35);
        ctx.beginPath();
        ctx.moveTo(px + 1.5, py + 1.5);
        ctx.lineTo(sx + 1.5, sy + 1.5);
        ctx.stroke();
      }
    }
    px = sx;
    py = sy;
    has = 1;
  }

  ctx.restore();
}

function shuimoStyleFace(info, state, helpers) {
  let out = info.out;
  /* 引擎违约兜底：正常帧内路径 info.out 一定存在，不会走到这里 */
  if (!out) out = info.out = {};

  const tier = state.tier || 'normal';
  const pal = SHUIMO_PAL[tier] || SHUIMO_PAL.normal;

  out.style = 'shuimo';
  out.skin = 'jade';
  out.fill = pal.fill;
  out.faceFill = pal.fill;
  out.faceColor = pal.fill;
  out.edge = pal.edge;
  out.edgeColor = pal.edge;
  out.stroke = pal.edge;
  out.ink = pal.ink;
  out.lineWidth = pal.lineW;
  out.strokeWidth = pal.lineW;
  out.glow = pal.glow;
  out.glowStrength = pal.glow;
  out.glowColor = pal.glowColor;
  out.text = pal.text;
  out.textColor = pal.text;
  out.pip = pal.pip;
  out.pipColor = pal.pip;
  out.accent = pal.accent;
  out.rim = '#ffffff';
  out.rimColor = '#ffffff';
  out.sheen = '#ffffff';
  out.crackAlpha = 0;
  out.innerGlow = 0;
  out.hatch = 0;
  out.overlay = 1;
  out.overlayStyle = 'shuimo';
  out.seal = pal.seal;
  out.sealText = pal.seal ? SEAL_TEXT[tier] : '';
  out.blend = 'source-over';

  return out;
}

function shuimoDrawFaceOverlay(ctx, cx, cy, radius, verts2D, vertCount, info, state) {
  const n = vertCount | 0;
  if (n < 3 || !verts2D) return;
  const flat = typeof verts2D[0] === 'number';
  const tier = state.tier || 'normal';

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  /* 古典内双线墨框 */
  for (let r = 0; r < 2; r++) {
    const k = FACE_RING_SCALES[r];
    ctx.beginPath();
    for (let v = 0; v < n; v++) {
      const x = lerpN(cx, vertX(verts2D, flat, v), k);
      const y = lerpN(cy, vertY(verts2D, flat, v), k);
      if (v === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.globalAlpha = r === 0 ? 0.5 : 0.28;
    ctx.strokeStyle = INK_STRONG;
    ctx.lineWidth = Math.max(0.7, radius * (r === 0 ? 0.042 : 0.028));
    ctx.stroke();
  }

  /* 回纹角标 */
  const tick = radius * 0.10;
  ctx.globalAlpha = 0.42;
  ctx.strokeStyle = INK_MID;
  ctx.lineWidth = Math.max(0.6, radius * 0.022);
  for (let v = 0; v < n; v++) {
    const x = lerpN(cx, vertX(verts2D, flat, v), 0.90);
    const y = lerpN(cy, vertY(verts2D, flat, v), 0.90);
    const inx = lerpN(cx, x, 0.84);
    const iny = lerpN(cy, y, 0.84);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(inx, y);
    ctx.lineTo(inx, iny);
    ctx.stroke();
  }

  /* 朱砂大成功点睛 */
  if (tier === 'critical') {
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = SEAL_RED_DEEP;
    ctx.beginPath();
    ctx.arc(cx, cy - radius * 0.34, radius * 0.085, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = SEAL_RED;
    ctx.lineWidth = Math.max(0.6, radius * 0.02);
    ctx.beginPath();
    ctx.arc(cx, cy - radius * 0.34, radius * 0.13, 0, TAU);
    ctx.stroke();
  }

  ctx.restore();
}

function diSeed(i) { return i * 1.37 + 0.5; }

function shuimoDrawForeground(ctx, W, H, time, state, helpers) {
  const s = state.custom && state.custom.shuimo;

  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  /* 凌空弧形剑气斩痕 */
  if (s && s.streakBorn) {
    for (let i = 0; i < s.streakBorn.length; i++) {
      if (s.streakLife[i] <= 0) continue;
      const born = s.streakBorn[i];
      let age = time - born;
      if (age < 0) age = 0;
      const life = s.streakLife[i];
      if (age > life) continue;
      const t = age / life;
      const reveal = smoothN(0, 0.24, age);
      const fade = 1 - smoothN(0.55, 1, t);
      const z = s.streakZ[i];
      const { sx: x1, sy: y1, scale: sc1 } =
        helpers.project(s.streakX1[i], s.streakY1[i], z);
      const { sx: x2, sy: y2, scale: sc2 } =
        helpers.project(s.streakX2[i], s.streakY2[i], z);
      const ex = lerpN(x1, x2, reveal);
      const ey = lerpN(y1, y2, reveal);
      const dxr = ex - x1;
      const dyr = ey - y1;
      const chord = Math.sqrt(dxr * dxr + dyr * dyr) || 1;
      const bend = chord * (0.12 + 0.05 * hash2(i + 1.7, diSeed(i)));
      const dir = hash2(i + 3.1, 7.7) > 0.5 ? 1 : -1;
      const mx = (x1 + ex) * 0.5 - (dyr / chord) * bend * dir;
      const my = (y1 + ey) * 0.5 + (dxr / chord) * bend * dir;
      const width = s.streakWidth[i] * ((sc1 + sc2) * 0.5);
      const gold = s.streakGold[i];

      ctx.globalAlpha = fade * (gold ? 0.55 : 0.30);
      ctx.strokeStyle = gold ? GOLD_RAMP[8] : INK_MID;
      ctx.lineWidth = width * (gold ? 3.6 : 2.8);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.stroke();

      ctx.globalAlpha = fade * (gold ? 0.98 : 0.88);
      ctx.strokeStyle = gold ? GOLD_RAMP[2] : INK_STRONG;
      ctx.lineWidth = width * (gold ? 1.5 : 1);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.stroke();

      /* 二重笔锋（错位淡墨） */
      ctx.globalAlpha = fade * 0.22;
      ctx.strokeStyle = gold ? GOLD_RAMP[6] : INK_RAMP[12];
      ctx.lineWidth = Math.max(0.6, width * 0.42);
      ctx.beginPath();
      ctx.moveTo(x1 + 2.2, y1 + 3.4);
      ctx.quadraticCurveTo(mx + 2.2, my + 3.4, ex + 2.2, ey + 3.4);
      ctx.stroke();

      /* 斩痕末端飘墨 */
      ctx.globalAlpha = fade * 0.26;
      ctx.fillStyle = gold ? GOLD_RAMP[6] : INK_WASH[2];
      ctx.beginPath();
      ctx.arc(ex, ey, width * 1.4, 0, TAU);
      ctx.fill();
    }
  }

  /* 高速滚动时的细墨气流 */
  if (!state.settled && state.dice) {
    for (let i = 0; i < state.dice.length; i++) {
      const d = state.dice[i];
      if ((d.speed || 0) < 700) continue;
      const { sx, sy, scale } = helpers.project(d.x, d.y, d.z);
      const sp = Math.sin(time * 7 + i * 2) * 0.25;
      ctx.globalAlpha = 0.10;
      ctx.strokeStyle = INK_MID;
      ctx.lineWidth = Math.max(0.8, 1.4 * scale);
      ctx.beginPath();
      ctx.arc(sx, sy, (d.radius || 9) * scale * 1.7, sp, sp + 1.6);
      ctx.stroke();
    }
  }

  /* 朱砂篆刻方印（拍击缩放 + 外框斑驳） */
  if (s && s.sealBorn > 0) {
    let age = time - s.sealBorn;
    if (age < 0) age = 0;
    const appear = smoothN(0.10, 0.40, age);
    if (appear > 0) {
      const pop = 1 + 0.55 * Math.exp(-7 * Math.max(0, age - 0.10)) * Math.sin(19 * age);
      const sc = appear * pop;
      const fadeOut = 1 - smoothN(2.05, 2.85, age);
      const px = W * 0.78 + Math.sin(time * 0.7) * 2.5;
      const py = H * 0.24 + Math.cos(time * 0.9) * 2.5;
      const size = Math.min(W, H) * 0.072;
      if (fadeOut > 0.004) {
        ctx.globalAlpha = 0.95 * fadeOut;
        drawShuimoSeal(ctx, px, py, size, sc, s.sealTier);
      }
    }
  }

  ctx.restore();
}

/* 朱砂印章本体：外框斑驳 + 内框 + 篆体印文（两次双字竖排） */
function drawShuimoSeal(ctx, cx, cy, r, sc, tierKey) {
  const pair = SEAL_CHARS[tierKey] || SEAL_CHARS.normal;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.055);
  ctx.scale(sc, sc);

  /* 印面 */
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = SEAL_RED;
  roundRectPath(ctx, -r, -r, r * 2, r * 2, r * 0.16);
  ctx.fill();

  /* 外框斑驳：纸色侵蚀点 */
  ctx.fillStyle = PAPER_SPECKS;
  for (let i = 0; i < 26; i++) {
    const side = i & 3;
    const u = hash1(i * 3.77 + 0.5);
    const w = r * (0.06 + 0.10 * hash1(i * 5.31));
    const h = r * (0.05 + 0.09 * hash1(i * 7.13));
    let x = -r;
    let y = -r;
    if (side === 0) { x = -r + u * r * 2; y = -r - h * 0.35; }
    else if (side === 1) { x = r - w * 0.35; y = -r + u * r * 2; }
    else if (side === 2) { x = -r + u * r * 2; y = r - h * 0.65; }
    else { x = -r - w * 0.35; y = -r + u * r * 2; }
    ctx.globalAlpha = 0.5 + 0.4 * hash1(i * 2.9);
    ctx.fillRect(x, y, w, h);
  }

  /* 内双线框 */
  ctx.globalAlpha = 0.92;
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = r * 0.055;
  ctx.strokeRect(-r * 0.80, -r * 0.80, r * 1.60, r * 1.60);
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = r * 0.030;
  ctx.strokeRect(-r * 0.70, -r * 0.70, r * 1.40, r * 1.40);

  /* 篆体印文：竖排两字 */
  ctx.globalAlpha = 0.96;
  ctx.fillStyle = PAPER_EDGE;
  ctx.font = SEAL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.save();
  ctx.scale(r / 20, r / 20);
  ctx.fillText(pair[0], 0, -9.5);
  ctx.fillText(pair[1], 0, 9.5);
  ctx.restore();

  ctx.restore();
}

function shuimoHasActiveFX(state) {
  if ((state.settleTime || 0) < 2.2) return true;
  const s = state.custom && state.custom.shuimo;
  if (!s) return false;
  if (s.sealBorn > 0 && (s.clock - s.sealBorn) < 2.9) return true;
  for (let i = 0; i < s.rippleBorn.length; i++) {
    if (s.rippleLife[i] <= 0) continue;
    if ((s.clock - s.rippleBorn[i]) < s.rippleLife[i]) return true;
  }
  for (let i = 0; i < s.streakBorn.length; i++) {
    if (s.streakLife[i] <= 0) continue;
    if ((s.clock - s.streakBorn[i]) < s.streakLife[i]) return true;
  }
  return false;
}

/* ==========================================================================
 * 6. 风格对象导出（StylePlugin 契约）
 * ========================================================================== */

const magmaStyle = {
  id: 'magma',
  name: '炼狱熔岩锻造',
  subtitle: '黑曜熔铁 · 赤金地脉 · 火山熔柱',
  badge: '🔥 孤注一掷',
  desc: '桌面化作炙热铁砧，地脉熔岩随呼吸明灭；每一记落骰都砸出放射状灼痕，由亮黄渐冷至暗红。暴击与孤注一掷触发熔柱冲击与金红流火。',
  accent: '#ff6a1a',
  bgPreview: 'linear-gradient(160deg,#1a0d08 0%,#3a1206 45%,#7a2408 100%)',
  soundPreset: 'magma',

  init: magmaInit,
  drawBackground: magmaDrawBackground,
  onBounce: magmaOnBounce,
  onSettle: magmaOnSettle,
  drawDieTrail: magmaDrawDieTrail,
  styleFace: magmaStyleFace,
  drawFaceOverlay: magmaDrawFaceOverlay,
  drawForeground: magmaDrawForeground,
  hasActiveFX: magmaHasActiveFX
};

const shuimoStyle = {
  id: 'shuimo',
  name: '水墨丹青剑意',
  subtitle: '古卷宣纸 · 分形墨晕 · 剑气朱印',
  badge: '墨 · 剑意',
  desc: '米白古卷为底，远山雾带层叠；落骰溅开浓淡墨滴与渐次晕开的墨涟漪。结算时凌厉弧形剑气扫过，朱砂篆印凌空拍下（天命 / 破局 / 险胜 / 失手 / 劫数）。',
  accent: '#b0301f',
  bgPreview: 'linear-gradient(155deg,#f6f0e0 0%,#e6dcc4 55%,#cfc2a2 100%)',
  soundPreset: 'shuimo',

  init: shuimoInit,
  drawBackground: shuimoDrawBackground,
  onBounce: shuimoOnBounce,
  onSettle: shuimoOnSettle,
  drawDieTrail: shuimoDrawDieTrail,
  styleFace: shuimoStyleFace,
  drawFaceOverlay: shuimoDrawFaceOverlay,
  drawForeground: shuimoDrawForeground,
  hasActiveFX: shuimoHasActiveFX
};

export const STYLES = [magmaStyle, shuimoStyle];
export { magmaStyle, shuimoStyle };
