/* ============================================================================
 * styles-a.js — Fate Dice · Style Pack A
 * ----------------------------------------------------------------------------
 *   arcane : 黄金秘法星盘  (obsidian velvet + rotating golden sacred geometry)
 *   cyber  : 赛博霓虹故障  (night violet base + perspective neon grid + glitch)
 *
 * Main-engine contract (`StylePlugin`):
 *   init(ctx, W, H, state)
 *   drawBackground(ctx, W, H, time, state, helpers)
 *   onBounce(impact, state, helpers)
 *   onSettle(outcome, state, helpers)
 *   drawDieTrail(ctx, die, time, state, helpers)
 *   styleFace(info, state, helpers) -> info.out
 *   drawFaceOverlay(ctx, cx, cy, radius, verts2D, vertCount, info, state)
 *   drawForeground(ctx, W, H, time, state, helpers)
 *   hasActiveFX(state) -> boolean
 *
 * ZERO-GC DISCIPLINE (frame hot paths: drawBackground / drawDieTrail /
 * styleFace / drawFaceOverlay / drawForeground):
 *   · no array literal, no object literal, no template literal, no string
 *     concatenation inside a frame — every color string comes from a table
 *     built once at module load;
 *   · all animation state lives in fixed-length Float32Array / Int8Array
 *     allocated in init();
 *   · helpers.project() scratch is read into locals immediately and never
 *     held across a second call;
 *   · particles are emitted from a pre-built descriptor pool (rings through
 *     fixed objects), so emit sites allocate nothing and stay aliasing-safe.
 * ========================================================================== */

const TAU = Math.PI * 2;

/* ---------------------------------------------------------------------------
 * 1. Color tables — built once at module load, only read inside frames
 * ------------------------------------------------------------------------- */

function rampRGBA(n, r0, g0, b0, a0, r1, g1, b1, a1) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0;
    const r = Math.round(r0 + (r1 - r0) * t);
    const g = Math.round(g0 + (g1 - g0) * t);
    const b = Math.round(b0 + (b1 - b0) * t);
    const a = a0 + (a1 - a0) * t;
    out[i] = 'rgba(' + r + ',' + g + ',' + b + ',' + (a < 0.0005 ? 0 : +a.toFixed(3)) + ')';
  }
  return out;
}

function solidRGBA(r, g, b, a) {
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

/* ---- arcane (gold / amber / rift-violet) --------------------------------- */
const ARC_FACE = rampRGBA(16, 44, 30, 12, 0.62, 255, 222, 132, 0.97);
const ARC_FACE_DIM = rampRGBA(16, 30, 22, 14, 0.55, 186, 148, 78, 0.86);
const ARC_EDGE = rampRGBA(12, 112, 78, 20, 0.52, 255, 240, 190, 1.0);
const ARC_EDGE_DIM = rampRGBA(12, 74, 54, 18, 0.46, 206, 164, 88, 0.9);
const ARC_TEXT = rampRGBA(8, 228, 198, 128, 0.9, 255, 253, 238, 1.0);
const ARC_TEXT_DIM = rampRGBA(8, 150, 126, 78, 0.8, 214, 190, 140, 0.95);
const ARC_GLOW = rampRGBA(8, 255, 184, 52, 0.16, 255, 238, 172, 0.86);
const ARC_TRAIL = rampRGBA(24, 255, 236, 178, 0.95, 240, 120, 28, 0.0);
const ARC_TRAIL_CORE = rampRGBA(24, 255, 255, 255, 0.9, 255, 205, 118, 0.0);
const ARC_RING = rampRGBA(12, 255, 214, 118, 0.06, 255, 240, 186, 0.72);
const ARC_RUNE = rampRGBA(10, 255, 200, 76, 0.08, 255, 236, 168, 0.66);
const ARC_RIFT = rampRGBA(12, 196, 96, 255, 0.06, 152, 44, 212, 0.8);
const ARC_RAY = rampRGBA(12, 255, 226, 160, 0.0, 255, 246, 206, 0.62);
const ARC_BURST = rampRGBA(12, 255, 190, 70, 0.0, 255, 244, 200, 0.5);

const ARC_SHADOW = [
  '0 0 4px rgba(255,196,72,0.55)',
  '0 0 7px rgba(255,206,96,0.62)',
  '0 0 10px rgba(255,216,120,0.70)',
  '0 0 14px rgba(255,226,150,0.80)',
  '0 0 18px rgba(255,236,180,0.90)',
];
const ARC_SHADOW_DIM = [
  '0 0 3px rgba(190,150,70,0.40)',
  '0 0 5px rgba(170,134,62,0.36)',
  '0 0 6px rgba(150,118,54,0.32)',
  '0 0 8px rgba(140,110,50,0.30)',
  '0 0 10px rgba(130,102,46,0.28)',
];

/* ---- cyber (cyan / magenta / violet) ------------------------------------- */
const CYB_FACE_A = rampRGBA(16, 16, 12, 38, 0.74, 108, 238, 255, 0.95);
const CYB_FACE_B = rampRGBA(16, 22, 10, 40, 0.74, 255, 108, 214, 0.95);
const CYB_FACE_DIM = rampRGBA(16, 12, 12, 26, 0.66, 108, 138, 158, 0.82);
const CYB_EDGE_A = rampRGBA(12, 32, 108, 148, 0.6, 154, 250, 255, 1.0);
const CYB_EDGE_B = rampRGBA(12, 140, 26, 112, 0.6, 255, 146, 232, 1.0);
const CYB_TEXT = rampRGBA(8, 158, 244, 255, 0.88, 240, 255, 255, 1.0);
const CYB_TEXT_DIM = rampRGBA(8, 120, 170, 196, 0.8, 196, 232, 244, 0.95);
const CYB_GLOW_A = rampRGBA(8, 32, 200, 255, 0.14, 176, 250, 255, 0.8);
const CYB_GLOW_B = rampRGBA(8, 255, 40, 176, 0.14, 255, 170, 240, 0.8);
const CYB_TRAIL_A = rampRGBA(24, 158, 250, 255, 0.92, 20, 96, 160, 0.0);
const CYB_TRAIL_B = rampRGBA(24, 255, 118, 226, 0.9, 130, 20, 110, 0.0);
const CYB_GRID = rampRGBA(14, 84, 190, 255, 0.06, 66, 232, 255, 0.44);
const CYB_GRID_MAG = rampRGBA(14, 190, 60, 190, 0.04, 255, 120, 226, 0.32);
const CYB_SCAN = rampRGBA(8, 70, 220, 255, 0.0, 190, 252, 255, 0.4);
const CYB_GLITCH_A = rampRGBA(10, 90, 246, 255, 0.55, 40, 120, 200, 0.0);
const CYB_GLITCH_B = rampRGBA(10, 255, 90, 214, 0.5, 140, 24, 120, 0.0);
const CYB_GLITCH_R = rampRGBA(8, 255, 58, 92, 0.42, 160, 20, 40, 0.0);
const CYB_HUD = rampRGBA(10, 70, 236, 255, 0.9, 190, 254, 255, 0.98);
const CYB_HUD_MAG = rampRGBA(10, 255, 76, 196, 0.9, 255, 190, 246, 0.98);

const CYB_SHADOW = [
  '0 0 4px rgba(72,226,255,0.65)',
  '0 0 7px rgba(96,238,255,0.72)',
  '0 0 10px rgba(120,246,255,0.80)',
  '0 0 14px rgba(150,250,255,0.86)',
  '0 0 18px rgba(190,253,255,0.92)',
];
const CYB_SHADOW_MAG = [
  '0 0 4px rgba(255,86,206,0.6)',
  '0 0 7px rgba(255,110,214,0.7)',
  '0 0 10px rgba(255,140,222,0.78)',
  '0 0 14px rgba(255,170,232,0.86)',
  '0 0 18px rgba(255,200,242,0.92)',
];
const CYB_SHADOW_DIM = [
  '0 0 3px rgba(90,160,190,0.35)',
  '0 0 5px rgba(96,168,198,0.4)',
  '0 0 7px rgba(102,176,206,0.44)',
  '0 0 9px rgba(108,184,214,0.48)',
  '0 0 11px rgba(114,192,222,0.52)',
];

/* ---- tier / mode weight tables (read by literal key, no allocation) ------ */
const ARC_TIER_W = { critical: 3, success: 2, costly: 1, failure: 0, fumble: 1 };
const ARC_TIER_INT = { critical: 1.0, success: 0.62, costly: 0.34, failure: 0.16, fumble: 0.94 };
const CYB_TIER_W = { critical: 3, success: 2, costly: 1, failure: 0, fumble: 1 };
const CYB_TIER_INT = { critical: 1.0, success: 0.6, costly: 0.32, failure: 0.18, fumble: 0.95 };
const CYB_TELE = {
  critical: 'SYNC // CRIT',
  success: 'SYNC // LOCK',
  costly: 'WARN // COST',
  failure: 'FAIL // MISS',
  fumble: 'ERR // FUMBLE',
};
const ARC_TELE = {
  critical: 'FATUM // AUREUM',
  success: 'ORDO // FIRM',
  costly: 'PRETIUM // SOLVE',
  failure: 'FRUSTRA // NIL',
  fumble: 'RUPTUM // NOX',
};

/* ---- fixed pool sizing (allocated once, in init) ------------------------- */
const POOL_N = 192;
const RIPE_N = 24;
const GLITCH_N = 28;
const ARC_TICK_N = 96;
const ARC_RUNE_N = 16;
const ARC_CRACK_N = 6;
const ARC_CRACK_SEG = 7;
const CYB_GRID_X = 13;
const CYB_GRID_Y = 9;

/* ---------------------------------------------------------------------------
 * 2. Shared primitives
 * ------------------------------------------------------------------------- */

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Pre-built descriptor pool: emit sites cycle through fixed objects. */
function makePool() {
  const items = new Array(POOL_N);
  for (let i = 0; i < POOL_N; i++) {
    items[i] = {
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      size: 1, endSize: 0, life: 1,
      r: 255, g: 255, b: 255, a: 1,
      gravity: 0, drag: 0,
      blend: 'lighter', shape: 'circle',
    };
  }
  return items;
}

function take(s) {
  const pool = s.pool;
  const i = s.pi;
  const p = pool[i];
  s.pi = i + 1 >= POOL_N ? 0 : i + 1;
  return p;
}

function frameDelta(s, time) {
  let dt = 1 / 60;
  const lt = s.lastT;
  if (lt > 0) {
    dt = time - lt;
    if (dt < 0) dt = 0;
    else if (dt > 0.05) dt = 0.05;
  }
  s.lastT = time;
  return dt;
}

function hasCtx(thing, fn) {
  return !!thing && typeof thing[fn] === 'function';
}

/* ===========================================================================
 * 3. ARCANE — 黄金秘法星盘
 * ======================================================================== */

function buildArcane(s, ctx, W, H) {
  s.w = W;
  s.h = H;
  s.cx = W * 0.5;
  s.cy = H * 0.515;
  const R = (s.R = Math.min(W, H) * 0.415);

  /* ---- twelve-zodiac tick ring: local coords, ring is rotated as a whole */
  s.tickX0 = new Float32Array(ARC_TICK_N);
  s.tickY0 = new Float32Array(ARC_TICK_N);
  s.tickX1 = new Float32Array(ARC_TICK_N);
  s.tickY1 = new Float32Array(ARC_TICK_N);
  for (let i = 0; i < ARC_TICK_N; i++) {
    const a = (i / ARC_TICK_N) * TAU;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const long = i % 8 === 0;
    const mid = i % 2 === 0;
    const len = long ? R * 0.115 : mid ? R * 0.062 : R * 0.032;
    const inner = R * (long ? 0.845 : 0.885);
    s.tickX0[i] = ca * inner;
    s.tickY0[i] = sa * inner;
    s.tickX1[i] = ca * (inner + len);
    s.tickY1[i] = sa * (inner + len);
  }

  /* ---- zodiac glyph diamonds (12) + hexagram + inner heptagram ---------- */
  s.zoX = new Float32Array(12);
  s.zoY = new Float32Array(12);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU - Math.PI / 2;
    s.zoX[i] = Math.cos(a) * R * 0.7;
    s.zoY[i] = Math.sin(a) * R * 0.7;
  }
  s.hexX = new Float32Array(6);
  s.hexY = new Float32Array(6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU - Math.PI / 2;
    s.hexX[i] = Math.cos(a) * R * 0.5;
    s.hexY[i] = Math.sin(a) * R * 0.5;
  }

  /* ---- 16 rune marks on the inner rune ring ---------------------------- */
  s.runeX = new Float32Array(ARC_RUNE_N);
  s.runeY = new Float32Array(ARC_RUNE_N);
  s.runeA = new Float32Array(ARC_RUNE_N);
  for (let i = 0; i < ARC_RUNE_N; i++) {
    const a = (i / ARC_RUNE_N) * TAU;
    s.runeX[i] = Math.cos(a) * R * 0.325;
    s.runeY[i] = Math.sin(a) * R * 0.325;
    s.runeA[i] = a;
  }

  /* ---- fumble rift cracks: pre-seeded polylines ------------------------ */
  s.crackX = new Float32Array(ARC_CRACK_N * ARC_CRACK_SEG);
  s.crackY = new Float32Array(ARC_CRACK_N * ARC_CRACK_SEG);
  s.crackLen = new Float32Array(ARC_CRACK_N);
  for (let c = 0; c < ARC_CRACK_N; c++) {
    const base = (c / ARC_CRACK_N) * TAU + 0.37;
    const total = R * (0.55 + 0.35 * ((c * 37) % 13) / 13);
    s.crackLen[c] = total;
    let px = 0;
    let py = 0;
    for (let k = 0; k < ARC_CRACK_SEG; k++) {
      const t = k / (ARC_CRACK_SEG - 1);
      const wobble = Math.sin(c * 2.1 + k * 1.7) * R * 0.075 * (0.3 + t);
      s.crackX[c * ARC_CRACK_SEG + k] = px;
      s.crackY[c * ARC_CRACK_SEG + k] = py;
      const step = total * 0.16;
      px += Math.cos(base + wobble * 0.02) * step;
      py += Math.sin(base + wobble * 0.02) * step;
    }
  }

  /* ---- landing rune-ripple slots (screen space, camera is static) ------ */
  s.rpx = new Float32Array(RIPE_N);
  s.rpy = new Float32Array(RIPE_N);
  s.rpr = new Float32Array(RIPE_N);
  s.rpMax = new Float32Array(RIPE_N);
  s.rpLife = new Float32Array(RIPE_N);
  s.rpMaxLife = new Float32Array(RIPE_N);
  s.rpScale = new Float32Array(RIPE_N);
  s.rpHead = 0;

  /* ---- motion / heat state --------------------------------------------- */
  s.rot1 = 0;
  s.rot2 = 0;
  s.rot3 = 0;
  s.heat = 0;
  s.rift = 0;
  s.burst = 0;
  s.lastT = 0;
  s.pi = 0;
  s.pool = makePool();

  /* ---- cached canvas gradients (built once per resize) ----------------- */
  s.gradBg = null;
  s.gradVig = null;
  if (hasCtx(ctx, 'createLinearGradient')) {
    const g = ctx.createLinearGradient(0, 0, W * 0.22, H);
    if (g && g.addColorStop) {
      g.addColorStop(0, '#0b0713');
      g.addColorStop(0.42, '#140c1a');
      g.addColorStop(0.72, '#0a0610');
      g.addColorStop(1, '#040209');
      s.gradBg = g;
    }
  }
  if (hasCtx(ctx, 'createRadialGradient')) {
    const v = ctx.createRadialGradient(s.cx, s.cy, R * 0.05, s.cx, s.cy, R * 1.65);
    if (v && v.addColorStop) {
      v.addColorStop(0, 'rgba(120,86,26,0.20)');
      v.addColorStop(0.45, 'rgba(58,34,12,0.10)');
      v.addColorStop(1, 'rgba(0,0,0,0.62)');
      s.gradVig = v;
    }
  }
  return s;
}

function arcaneInit(ctx, W, H, state) {
  if (!state) return null;
  const custom = state.custom || (state.custom = {});
  let s = custom.arcane;
  if (s && s.w === W && s.h === H) return s;
  if (!s) s = custom.arcane = {};
  return buildArcane(s, ctx, W, H);
}

function getArc(state) {
  return state && state.custom ? state.custom.arcane : null;
}

function pushRipple(s, sx, sy, scale, maxR, life) {
  const i = s.rpHead;
  s.rpHead = i + 1 >= RIPE_N ? 0 : i + 1;
  s.rpx[i] = sx;
  s.rpy[i] = sy;
  s.rpr[i] = 0;
  s.rpMax[i] = maxR;
  s.rpLife[i] = life;
  s.rpMaxLife[i] = life;
  s.rpScale[i] = scale > 0 ? scale : 1;
}

function arcaneDrawBackground(ctx, W, H, time, state, helpers) {
  let s = getArc(state);
  if (!s) s = arcaneInit(ctx, W, H, state);
  if (!s) return;

  const dt = frameDelta(s, time);
  const tier = state.tier;
  const settled = !!state.settled;
  const tSec = time;

  const targetHeat = settled ? (tier === 'critical' ? 1 : tier === 'fumble' ? 0.32 : 0.42) : 0.22;
  const targetRift = tier === 'fumble' ? 1 : 0;
  s.heat += (targetHeat - s.heat) * clamp01(dt * 6);
  s.rift += (targetRift - s.rift) * clamp01(dt * 4.2);
  if (s.burst > 0) {
    s.burst -= dt * 0.6;
    if (s.burst < 0) s.burst = 0;
  }

  const heat = s.heat;
  const rotBoost = 1 + heat * 2.1;
  s.rot1 += dt * 0.22 * rotBoost;
  s.rot2 -= dt * 0.36 * rotBoost;
  s.rot3 += dt * 0.13 * (1 + heat);
  if (s.rot1 > TAU) s.rot1 -= TAU;
  if (s.rot2 < -TAU) s.rot2 += TAU;
  if (s.rot3 > TAU) s.rot3 -= TAU;

  const cx = s.cx;
  const cy = s.cy;
  const R = s.R;

  /* ---- 1. obsidian velvet base ---------------------------------------- */
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = s.gradBg || '#0b0713';
  ctx.fillRect(0, 0, W, H);

  /* ---- 2. gold bloom behind the chart (critical surge) ---------------- */
  const bloomIdx = (heat * 11) | 0;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = ARC_RING[bloomIdx < 0 ? 0 : bloomIdx > 11 ? 11 : bloomIdx];
  const bloomR = R * (0.2 + 0.12 * heat);
  const bloomA = 0.05 + 0.16 * heat;
  ctx.globalAlpha = bloomA;
  ctx.beginPath();
  ctx.arc(cx, cy, bloomR, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  /* ---- 3. differential sacred-geometry layers ------------------------- */
  // layer A: twelve-zodiac tick ring
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(s.rot1);
  const tickNB = Math.round(ARC_TICK_N * 0.35);
  ctx.strokeStyle = ARC_RING[(heat * 11) | 0];
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  for (let i = 0; i < tickNB; i++) {
    ctx.moveTo(s.tickX0[i], s.tickY0[i]);
    ctx.lineTo(s.tickX1[i], s.tickY1[i]);
  }
  ctx.stroke();
  ctx.strokeStyle = ARC_RING[Math.min(11, ((heat * 11) | 0) + 3)];
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  for (let i = 0; i < ARC_TICK_N; i += 8) {
    ctx.moveTo(s.tickX0[i], s.tickY0[i]);
    ctx.lineTo(s.tickX1[i] * 1.02, s.tickY1[i] * 1.02);
  }
  ctx.stroke();
  ctx.restore();

  // layer B: zodiac diamond ring (counter-rotating, slow)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(s.rot2);
  const diamond = 3.4 + 1.6 * Math.sin(tSec * 1.4);
  ctx.strokeStyle = ARC_RUNE[Math.min(9, ((heat * 9) | 0) + 2)];
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const x = s.zoX[i];
    const y = s.zoY[i];
    ctx.moveTo(x, y - diamond);
    ctx.lineTo(x + diamond, y);
    ctx.lineTo(x, y + diamond);
    ctx.lineTo(x - diamond, y);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.restore();

  // layer C: hexagram (two counter-rotating triangles) — 六芒符文阵
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(s.rot3);
  ctx.strokeStyle = ARC_RING[Math.min(11, ((heat * 8) | 0) + 4)];
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(s.hexX[0], s.hexY[0]);
  for (let i = 1; i < 6; i++) ctx.lineTo(s.hexX[i], s.hexY[i]);
  ctx.closePath();
  ctx.stroke();
  ctx.rotate(-s.rot3 * 2 + TAU / 6);
  ctx.beginPath();
  ctx.moveTo(s.hexX[0], s.hexY[0]);
  for (let i = 1; i < 6; i++) ctx.lineTo(s.hexX[i], s.hexY[i]);
  ctx.closePath();
  ctx.stroke();

  /* ---- 4. inner rune ring --------------------------------------------- */
  const runeR = 3.6;
  ctx.strokeStyle = ARC_RUNE[Math.min(9, ((heat * 9) | 0) + 1)];
  ctx.lineWidth = 1.05;
  ctx.beginPath();
  for (let i = 0; i < ARC_RUNE_N; i++) {
    const x = s.runeX[i];
    const y = s.runeY[i];
    const a = s.runeA[i];
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    ctx.moveTo(x - sa * runeR, y + ca * runeR);
    ctx.lineTo(x + ca * runeR * 0.8, y + sa * runeR * 0.8);
    ctx.moveTo(x + ca * runeR * 0.8, y + sa * runeR * 0.8);
    ctx.lineTo(x + sa * runeR, y - ca * runeR);
  }
  ctx.stroke();
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';

  /* ---- 5. fumble: violet-black rift wave ------------------------------ */
  if (s.rift > 0.015) {
    const ra = s.rift;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.4 + 1.8 * ra;
    for (let c = 0; c < ARC_CRACK_N; c++) {
      const jitter = Math.sin(tSec * 11 + c * 2.3) * 3.2 * ra;
      ctx.strokeStyle = ARC_RIFT[Math.min(11, (ra * 11) | 0)];
      ctx.beginPath();
      const off = c * ARC_CRACK_SEG;
      ctx.moveTo(cx + s.crackX[off], cy + s.crackY[off] + jitter);
      for (let k = 1; k < ARC_CRACK_SEG; k++) {
        ctx.lineTo(cx + s.crackX[off + k], cy + s.crackY[off + k] + jitter);
      }
      ctx.stroke();
    }
    // rift core: dark violet disc swallowing the chart centre
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.42 * ra;
    ctx.fillStyle = '#150823';
    ctx.beginPath();
    ctx.arc(cx, cy, R * (0.16 + 0.05 * Math.sin(tSec * 3.7)), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = ARC_RIFT[10];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.17, 0, TAU);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---- 6. landing rune-ripples (table plane) -------------------------- */
  if (s.rpLife) {
    for (let i = 0; i < RIPE_N; i++) {
      const life = s.rpLife[i];
      if (life <= 0) continue;
      s.rpLife[i] = life - dt;
      const t = 1 - (life - dt) / s.rpMaxLife[i];
      const p = t < 0 ? 0 : t > 1 ? 1 : t;
      const rad = s.rpMax[i] * (0.15 + p * 0.85);
      const li = p < 0 ? 0 : p > 1 ? 1 : p;
      const alpha = 1 - li;
      ctx.save();
      ctx.translate(s.rpx[i], s.rpy[i]);
      ctx.scale(1, 0.34);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = ARC_RING[Math.min(11, 11 - ((li * 11) | 0))];
      ctx.lineWidth = 1.1 + 2.4 * alpha;
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = alpha * 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, rad * 0.62, 0, TAU);
      ctx.stroke();
      ctx.restore();
      if (s.rpLife[i] <= 0) s.rpLife[i] = 0;
    }
  }

  /* ---- 7. vignette + settle burst wash -------------------------------- */
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (s.gradVig) {
    ctx.fillStyle = s.gradVig;
    ctx.fillRect(0, 0, W, H);
  }
  if (s.burst > 0.01) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = s.burst * 0.5;
    ctx.fillStyle = ARC_BURST[10];
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function arcaneOnBounce(impact, state, helpers) {
  const s = getArc(state);
  if (!s) return;
  const x = impact.x;
  const y = impact.y;
  const z = impact.z;
  const str = impact.strength > 0 ? impact.strength : 1;
  const e = str > 1.8 ? 1.8 : str;

  // gold dust burst
  const n = 6 + ((e * 5) | 0);
  for (let k = 0; k < n; k++) {
    const p = take(s);
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = helpers.rand(-1.5, 1.5) * e;
    p.vy = helpers.rand(-1.5, 1.5) * e;
    p.vz = helpers.rand(0.7, 4.2) * e;
    p.size = helpers.rand(1.4, 3.4);
    p.endSize = 0.2;
    p.life = helpers.rand(0.45, 0.95);
    p.r = 255;
    p.g = 200 + ((k * 11) % 46);
    p.b = 96 + ((k * 7) % 60);
    p.a = 0.9;
    p.gravity = 6.5;
    p.drag = 1.6;
    p.blend = 'lighter';
    p.shape = 'spark';
    helpers.spawnParticle(p);
  }
  // double-color highlight core sparks
  for (let k = 0; k < 3; k++) {
    const p = take(s);
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = helpers.rand(-0.6, 0.6);
    p.vy = helpers.rand(-0.6, 0.6);
    p.vz = helpers.rand(1.2, 3.0);
    p.size = 2.6;
    p.endSize = 0.1;
    p.life = 0.34;
    p.r = 255;
    p.g = 250;
    p.b = 226;
    p.a = 1;
    p.gravity = 1.2;
    p.drag = 2.4;
    p.blend = 'lighter';
    p.shape = 'circle';
    helpers.spawnParticle(p);
  }

  helpers.spawnShockwave(x, y, 1.5 + 0.9 * e, 0.55, '255,206,110', 2.2);

  // landing rune ripple on the table plane
  const pr = helpers.project(x, y, 0);
  pushRipple(s, pr.sx, pr.sy, pr.scale, 70 + 46 * e, 0.9 + 0.18 * e);
  if (s.burst < 0.35) s.burst = 0.35;
}

function arcaneOnSettle(outcome, state, helpers) {
  const s = getArc(state);
  if (!s) return;
  const tier = outcome.tier;
  s.burst = tier === 'critical' ? 1 : tier === 'fumble' ? 0.8 : 0.55;
  if (tier === 'fumble') s.rift = 1;
  if (tier === 'critical') s.heat = 1;

  const dice = state && state.dice ? state.dice : null;
  const count = dice && dice.length ? dice.length : 1;
  const crit = tier === 'critical';
  const fumble = tier === 'fumble';

  for (let d = 0; d < count; d++) {
    const die = dice ? dice[d] : null;
    const x = die ? die.x : 0;
    const y = die ? die.y : 0;
    const z = die ? die.z : 0;
    const pr = helpers.project(x, y, z);
    const px = pr.sx;
    const py = pr.sy;
    const psc = pr.scale > 0 ? pr.scale : 1;

    const waves = crit ? 3 : fumble ? 2 : 1;
    for (let w = 0; w < waves; w++) {
      const rr = (crit ? 3.4 : 1.9) + w * 1.15;
      helpers.spawnShockwave(x, y, rr, 0.62 + w * 0.22, fumble ? '166,74,232' : '255,212,120', crit ? 3 : 1.8);
      pushRipple(s, px, py, psc, (crit ? 150 : 88) + w * 40, 1.15 + w * 0.2);
    }

    const n = crit ? 46 : fumble ? 30 : 20;
    for (let k = 0; k < n; k++) {
      const p = take(s);
      const ang = helpers.rand(0, TAU);
      const spd = helpers.rand(0.9, crit ? 5.4 : 3.2);
      p.x = x;
      p.y = y;
      p.z = z + 0.12;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.vz = helpers.rand(0.6, crit ? 5.6 : 3.4);
      p.size = crit ? helpers.rand(2.0, 4.6) : helpers.rand(1.4, 3.0);
      p.endSize = 0.12;
      p.life = helpers.rand(0.7, crit ? 1.7 : 1.15);
      if (fumble) {
        p.r = 168 + ((k * 13) % 60);
        p.g = 60 + ((k * 7) % 40);
        p.b = 220;
        p.shape = 'shard';
      } else {
        p.r = 255;
        p.g = 196 + ((k * 17) % 56);
        p.b = 80 + ((k * 11) % 70);
        p.shape = k % 3 === 0 ? 'ring' : 'spark';
      }
      p.a = 0.95;
      p.gravity = 5.2;
      p.drag = 1.1;
      p.blend = 'lighter';
      helpers.spawnParticle(p);
    }
    // vertical fate column sparks
    if (crit) {
      for (let k = 0; k < 12; k++) {
        const p = take(s);
        p.x = x + helpers.rand(-0.16, 0.16);
        p.y = y + helpers.rand(-0.16, 0.16);
        p.z = 0.05;
        p.vx = helpers.rand(-0.24, 0.24);
        p.vy = helpers.rand(-0.24, 0.24);
        p.vz = helpers.rand(4.2, 7.6);
        p.size = helpers.rand(1.2, 2.6);
        p.endSize = 0.1;
        p.life = helpers.rand(0.8, 1.4);
        p.r = 255;
        p.g = 244;
        p.b = 198;
        p.a = 1;
        p.gravity = -1.4;
        p.drag = 0.5;
        p.blend = 'lighter';
        p.shape = 'spark';
        helpers.spawnParticle(p);
      }
    }
  }
}

function arcaneDrawTrail(ctx, die, time, state, helpers) {
  const TX = die.trailX;
  const TY = die.trailY;
  const TZ = die.trailZ;
  if (!TX || typeof TX === 'number' || !TY || typeof TY === 'number') return;
  let n = die.trailCount | 0;
  if (n < 2) return;
  if (n > 24) n = 24;

  const head = die.trailHead | 0;
  const speed = die.speed || 0;

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  /* three-pass comet ribbon: wide amber haze -> gold body -> white core */
  for (let pass = 0; pass < 3; pass++) {
    ctx.lineWidth = pass === 0 ? 9.5 : pass === 1 ? 4.2 : 1.35;
    if (pass === 0) ctx.strokeStyle = ARC_TRAIL[6];
    else if (pass === 1) ctx.strokeStyle = ARC_TRAIL[14];
    else ctx.strokeStyle = ARC_TRAIL_CORE[17];

    ctx.beginPath();
    let first = true;
    for (let i = n - 1; i >= 0; i--) {
      const idx = ((head - i + 24) % 24) | 0;
      const wx = TX[idx];
      const wy = TY[idx];
      const wz = TZ ? TZ[idx] : 0;
      if (wx === undefined || wy === undefined) continue;
      const pr = helpers.project(wx, wy, wz || 0);
      const sx = pr.sx;
      const sy = pr.sy;
      const sc = pr.scale > 0 ? pr.scale : 1;
      ctx.lineWidth = (pass === 0 ? 9.5 : pass === 1 ? 4.2 : 1.35) * (0.35 + sc * 0.65);
      if (first) {
        ctx.moveTo(sx, sy);
        first = false;
      } else {
        ctx.lineTo(sx, sy);
      }
    }
    if (!first) ctx.stroke();
  }

  /* gold dust shedding off the tail */
  const s = getArc(state);
  if (s && speed > 480 && (head & 1) === 0) {
    const idx = head % 24;
    const wx = TX[idx];
    const wy = TY[idx];
    if (wx !== undefined && wy !== undefined) {
      const p = take(s);
      const wz = TZ ? TZ[idx] : 0;
      p.x = wx;
      p.y = wy;
      p.z = (wz || 0) + 0.04;
      p.vx = helpers.rand(-0.9, 0.9);
      p.vy = helpers.rand(-0.9, 0.9);
      p.vz = helpers.rand(0.2, 1.6);
      p.size = helpers.rand(1.1, 2.4);
      p.endSize = 0.1;
      p.life = helpers.rand(0.3, 0.6);
      p.r = 255;
      p.g = 214;
      p.b = 122;
      p.a = 0.85;
      p.gravity = 2.2;
      p.drag = 1.4;
      p.blend = 'lighter';
      p.shape = 'spark';
      helpers.spawnParticle(p);
    }
  }

  ctx.globalCompositeOperation = 'source-over';
}

function arcaneStyleFace(info, state, helpers) {
  const out = info.out;
  let d = info.lightDot;
  if (!(d >= 0)) d = 0;
  else if (d > 1) d = 1;

  const settled = !!info.settled;
  const tier = info.tier;
  const w = settled ? ARC_TIER_W[tier] | 0 : 0;

  /* plate shade: quantized LUT index, no string building */
  let q = (d * 15.999) | 0;
  if (w >= 3) q = q > 12 ? 15 : q + 3;
  else if (w === 2) q = q > 13 ? 15 : q + 1;

  const hidden = !!info.hidden;
  if (hidden) q = q > 5 ? q - 5 : 0;

  const edgeI = d > 1 ? 11 : (d * 11.999) | 0;
  const edgeIw = w >= 3 ? (edgeI > 9 ? 11 : edgeI + 2) : edgeI;
  const tI = d > 1 ? 7 : (d * 7.999) | 0;
  const shadowI = w >= 3 ? 4 : d > 0.72 ? 3 : d > 0.45 ? 2 : d > 0.2 ? 1 : 0;
  const gI = d > 1 ? 7 : (d * 7.999) | 0;

  out.fill = hidden ? ARC_FACE_DIM[q] : ARC_FACE[q];
  out.stroke = hidden ? ARC_EDGE_DIM[edgeIw] : ARC_EDGE[edgeIw];
  out.lineWidth = 1.05 + d * 1.65 + (w >= 3 ? 0.7 : 0);
  out.textFill = hidden ? ARC_TEXT_DIM[tI] : ARC_TEXT[tI];
  out.textShadow = hidden ? ARC_SHADOW_DIM[shadowI] : ARC_SHADOW[shadowI];
  out.glowColor = ARC_GLOW[gI];
  out.glowBlur = 5 + d * 11 + w * 4.5;
  out.sheenAlpha = 0.05 + d * 0.33 + (info.isTopFace ? 0.1 : 0) + (w >= 3 ? 0.08 : 0);
  return out;
}

function arcaneDrawFaceOverlay(ctx, cx, cy, radius, verts2D, vertCount, info, state) {
  if (!verts2D || vertCount < 3) return;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < vertCount; i++) {
    sx += verts2D[i * 2];
    sy += verts2D[i * 2 + 1];
  }
  sx /= vertCount;
  sy /= vertCount;

  const d = info && info.lightDot > 0 ? (info.lightDot > 1 ? 1 : info.lightDot) : 0;
  const inset = 0.72;
  const li = (d * 9.999) | 0;
  const hidden = info && info.hidden;

  ctx.globalCompositeOperation = 'source-over';
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = hidden ? ARC_RUNE[2] : ARC_RUNE[Math.min(9, li + 2)];
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let i = 0; i < vertCount; i++) {
    const vx = sx + (verts2D[i * 2] - sx) * inset;
    const vy = sy + (verts2D[i * 2 + 1] - sy) * inset;
    if (i === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
  ctx.stroke();

  /* etched corner ticks toward face centre */
  ctx.strokeStyle = hidden ? ARC_RUNE[3] : ARC_RUNE[Math.min(9, li + 4)];
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  for (let i = 0; i < vertCount; i++) {
    const vx = sx + (verts2D[i * 2] - sx) * 0.96;
    const vy = sy + (verts2D[i * 2 + 1] - sy) * 0.96;
    ctx.moveTo(vx, vy);
    ctx.lineTo(vx + (sx - vx) * 0.28, vy + (sy - vy) * 0.28);
  }
  ctx.stroke();

  /* tiny gold sigil diamond at the face centre */
  const rr = radius * 0.16;
  ctx.fillStyle = hidden ? ARC_RUNE[2] : ARC_RUNE[Math.min(9, li + 3)];
  ctx.beginPath();
  ctx.moveTo(sx, sy - rr);
  ctx.lineTo(sx + rr * 0.62, sy);
  ctx.lineTo(sx, sy + rr);
  ctx.lineTo(sx - rr * 0.62, sy);
  ctx.closePath();
  ctx.fill();
}

function arcaneDrawForeground(ctx, W, H, time, state, helpers) {
  const s = getArc(state);
  if (!s) return;
  const st = state && typeof state.settleTime === 'number' ? state.settleTime : 99;
  if (st >= 2.2) return;
  const tier = state.tier;
  const inten = ARC_TIER_INT[tier] !== undefined ? ARC_TIER_INT[tier] : 0.3;
  /* fade in over 0.3s, hold, fade out until 2.2s */
  let a;
  if (st < 0.3) a = st / 0.3;
  else if (st < 1.5) a = 1;
  else a = 1 - (st - 1.5) / 0.7;
  if (a <= 0) return;
  if (a > 1) a = 1;

  const dice = state.dice;
  if (!dice) return;
  const n = dice.length;
  const tSec = time;
  const flicker = 0.86 + 0.14 * Math.sin(tSec * 17.3);
  const alpha = a * inten * flicker;
  const li = Math.min(11, (alpha * 11.999) | 0);
  const gold = tier === 'fumble' ? ARC_RIFT : ARC_RAY;

  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1;

  for (let i = 0; i < n; i++) {
    const die = dice[i];
    if (!die) continue;
    if (!die.settled && !state.settled) continue;
    const pr = helpers.project(die.x, die.y, die.z);
    const px = pr.sx;
    const py = pr.sy;
    const sc = pr.scale > 0 ? pr.scale : 1;
    const rad = (die.radius || 18) * sc;

    /* light pillar from top of frame down onto the die */
    const beamW = rad * (1.5 + 0.25 * Math.sin(tSec * 3.1) );
    ctx.fillStyle = gold[li];
    for (let k = 0; k < 4; k++) {
      const t = k / 4;
      const w = beamW * (1 - t * 0.55);
      ctx.globalAlpha = alpha * (0.1 + 0.12 * (1 - t));
      ctx.fillRect(px - w * 0.5, py - rad - (1 - t) * (py - rad), w, (py - rad) * (1 - t) + rad);
    }
    ctx.globalAlpha = 1;

    /* fate crown: 8 rotating rays */
    const rot = tSec * 0.9 + i * 0.7;
    ctx.strokeStyle = gold[Math.min(11, li + 2)];
    ctx.lineWidth = 1.1 + 1.5 * alpha;
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const ang = rot + (k / 8) * TAU;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const r0 = rad * 1.28;
      const r1 = rad * (1.9 + 0.35 * Math.sin(tSec * 5 + k));
      ctx.moveTo(px + ca * r0, py + sa * r0);
      ctx.lineTo(px + ca * r1, py + sa * r1);
    }
    ctx.stroke();

    /* halo rings */
    ctx.strokeStyle = gold[Math.min(11, li + 1)];
    ctx.globalAlpha = alpha * 0.7;
    ctx.beginPath();
    ctx.arc(px, py, rad * 1.32, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;

    /* star flare at the crown apex */
    const fx = px;
    const fy = py - rad * 2.15;
    ctx.fillStyle = gold[11];
    ctx.globalAlpha = alpha * 0.8;
    ctx.beginPath();
    ctx.moveTo(fx, fy - rad * 0.35);
    ctx.lineTo(fx + rad * 0.12, fy);
    ctx.lineTo(fx, fy + rad * 0.35);
    ctx.lineTo(fx - rad * 0.12, fy);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    /* tier telemetry glyph line under the die */
    if (tier === 'critical') {
      for (let k = 0; k < 6; k++) {
        const ang = -Math.PI / 2 + (k / 6) * TAU + rot * 0.4;
        const p = take(s);
        p.x = die.x + Math.cos(ang) * 0.5;
        p.y = die.y + Math.sin(ang) * 0.5;
        p.z = 0.08;
        p.vx = 0;
        p.vy = 0;
        p.vz = helpers.rand(0.6, 1.8);
        p.size = 2.2;
        p.endSize = 0.1;
        p.life = 0.5;
        p.r = 255;
        p.g = 240;
        p.b = 190;
        p.a = 0.8;
        p.gravity = -0.4;
        p.drag = 0.2;
        p.blend = 'lighter';
        p.shape = 'spark';
        helpers.spawnParticle(p);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function arcaneHasActiveFX(state) {
  if (!state) return false;
  if (state.settleTime < 2.2) return true;
  const s = getArc(state);
  if (!s) return false;
  if (s.burst > 0.02 || s.rift > 0.03) return true;
  if (s.rpLife) {
    for (let i = 0; i < RIPE_N; i++) if (s.rpLife[i] > 0) return true;
  }
  return false;
}

/* ===========================================================================
 * 4. CYBER — 赛博霓虹故障
 * ======================================================================== */

function buildCyber(s, ctx, W, H) {
  s.w = W;
  s.h = H;
  s.cx = W * 0.5;
  s.cy = H * 0.5;
  s.xMin = -W * 0.42;
  s.xMax = W * 0.42;
  s.yMin = -H * 0.38;
  s.yMax = H * 0.38;
  s.step = (s.yMax - s.yMin) / CYB_GRID_Y;

  s.gx = new Float32Array(CYB_GRID_X);
  for (let i = 0; i < CYB_GRID_X; i++) {
    s.gx[i] = s.xMin + ((s.xMax - s.xMin) * i) / (CYB_GRID_X - 1);
  }

  /* glitch slice slots */
  s.glY = new Float32Array(GLITCH_N);
  s.glH = new Float32Array(GLITCH_N);
  s.glOff = new Float32Array(GLITCH_N);
  s.glLife = new Float32Array(GLITCH_N);
  s.glMax = new Float32Array(GLITCH_N);
  s.glMag = new Int8Array(GLITCH_N);
  s.glHead = 0;

  s.heat = 0;
  s.err = 0;
  s.burst = 0;
  s.scanPhase = 0;
  s.lastT = 0;
  s.pi = 0;
  s.pool = makePool();

  s.gradBg = null;
  if (hasCtx(ctx, 'createLinearGradient')) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (g && g.addColorStop) {
      g.addColorStop(0, '#07030f');
      g.addColorStop(0.48, '#150a33');
      g.addColorStop(0.76, '#0a0a26');
      g.addColorStop(1, '#04101c');
      s.gradBg = g;
    }
  }
  s.gradBloom = null;
  if (hasCtx(ctx, 'createRadialGradient')) {
    const b = ctx.createRadialGradient(s.cx, s.cy * 0.98, 4, s.cx, s.cy, Math.max(W, H) * 0.62);
    if (b && b.addColorStop) {
      b.addColorStop(0, 'rgba(58,206,255,0.16)');
      b.addColorStop(0.5, 'rgba(96,40,160,0.10)');
      b.addColorStop(1, 'rgba(0,0,0,0)');
      s.gradBloom = b;
    }
  }
  return s;
}

function cyberInit(ctx, W, H, state) {
  if (!state) return null;
  const custom = state.custom || (state.custom = {});
  let s = custom.cyber;
  if (s && s.w === W && s.h === H) return s;
  if (!s) s = custom.cyber = {};
  return buildCyber(s, ctx, W, H);
}

function getCyb(state) {
  return state && state.custom ? state.custom.cyber : null;
}

function pushGlitch(s, y, h, off, life, mag) {
  const i = s.glHead;
  s.glHead = i + 1 >= GLITCH_N ? 0 : i + 1;
  s.glY[i] = y;
  s.glH[i] = h;
  s.glOff[i] = off;
  s.glLife[i] = life;
  s.glMax[i] = life;
  s.glMag[i] = mag ? 1 : 0;
}

function cyberDrawBackground(ctx, W, H, time, state, helpers) {
  let s = getCyb(state);
  if (!s) s = cyberInit(ctx, W, H, state);
  if (!s) return;

  const dt = frameDelta(s, time);
  const tier = state.tier;
  const settled = !!state.settled;
  const tSec = time;

  const targetHeat = settled ? (tier === 'critical' ? 1 : tier === 'fumble' ? 0.2 : 0.45) : 0.3;
  const targetErr = tier === 'fumble' ? 1 : 0;
  s.heat += (targetHeat - s.heat) * clamp01(dt * 5.5);
  s.err += (targetErr - s.err) * clamp01(dt * 4);
  if (s.burst > 0) {
    s.burst -= dt * 0.55;
    if (s.burst < 0) s.burst = 0;
  }
  s.scanPhase += dt * 0.22;
  if (s.scanPhase > 1) s.scanPhase -= 1;

  const heat = s.heat;
  const cx = s.cx;
  const cy = s.cy;

  /* ---- 1. night violet base ------------------------------------------- */
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = s.gradBg || '#07030f';
  ctx.fillRect(0, 0, W, H);

  if (s.gradBloom) {
    ctx.fillStyle = s.gradBloom;
    ctx.fillRect(0, 0, W, H);
  }

  /* ---- 2. perspective neon laser grid on the table plane -------------- */
  const xMin = s.xMin;
  const xMax = s.xMax;
  const yMin = s.yMin;
  const yMax = s.yMax;
  const step = s.step;
  const scroll = (tSec * 0.55) % 1;

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 1.1;

  /* depth rails (constant x) */
  for (let i = 0; i < CYB_GRID_X; i++) {
    const wx = s.gx[i];
    let pr = helpers.project(wx, yMin, 0);
    const ax = pr.sx;
    const ay = pr.sy;
    pr = helpers.project(wx, yMax, 0);
    const bx = pr.sx;
    const by = pr.sy;
    const gi = (i * 13) % 14;
    ctx.strokeStyle = CYB_GRID[gi];
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  /* cross rails (constant y, scrolling toward the camera) */
  for (let j = 0; j <= CYB_GRID_Y; j++) {
    let wy = yMin + j * step + scroll * step;
    if (wy > yMax) wy -= step * CYB_GRID_Y;
    let pr = helpers.project(xMin, wy, 0);
    const ax = pr.sx;
    const ay = pr.sy;
    const depth = pr.scale;
    pr = helpers.project(xMax, wy, 0);
    const bx = pr.sx;
    const by = pr.sy;
    let gi = (depth * 22) | 0;
    if (gi < 0) gi = 0;
    if (gi > 13) gi = 13;
    ctx.strokeStyle = (j & 1) === 0 ? CYB_GRID[gi] : CYB_GRID_MAG[gi];
    ctx.lineWidth = 0.8 + depth * 1.5;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  /* ---- 3. horizon glow band ------------------------------------------- */
  ctx.globalCompositeOperation = 'lighter';
  const hz = cy;
  ctx.fillStyle = CYB_SCAN[7];
  ctx.globalAlpha = 0.12 + 0.2 * heat;
  ctx.fillRect(0, hz - 26, W, 52);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  /* ---- 4. dynamic scanline -------------------------------------------- */
  const scanY = ((tSec * 0.16) % 1) * H;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = CYB_SCAN[6];
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, scanY, W, 1.5);
  ctx.fillStyle = CYB_SCAN[3];
  ctx.globalAlpha = 0.35;
  ctx.fillRect(0, scanY - 3, W, 1);
  ctx.fillRect(0, scanY + 2.5, W, 1);
  /* slow rolling CRT band */
  const crtY = ((tSec * 0.045) % 1) * H;
  ctx.fillStyle = CYB_SCAN[2];
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, crtY, W, H * 0.06);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  /* ---- 5. bounce-triggered glitch slices ------------------------------ */
  if (s.glLife) {
    for (let i = 0; i < GLITCH_N; i++) {
      const life = s.glLife[i];
      if (life <= 0) continue;
      const nl = life - dt;
      s.glLife[i] = nl < 0 ? 0 : nl;
      const t = 1 - (nl < 0 ? 0 : nl) / s.glMax[i];
      const q = (t * 9.999) | 0;
      const qi = q < 0 ? 0 : q > 9 ? 9 : q;
      const w = s.glH[i] * (1 - t * 0.4);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = s.glMag[i] ? CYB_GLITCH_B[qi] : CYB_GLITCH_A[qi];
      const off = s.glOff[i];
      ctx.fillRect(off, s.glY[i], W - off, w);
      if (off > 0) ctx.fillRect(0, s.glY[i], off, w);
      ctx.fillStyle = CYB_GLITCH_R[qi];
      ctx.fillRect(0, s.glY[i] - 1, W, 1);
      ctx.fillRect(0, s.glY[i] + w, W, 1);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /* ---- 6. fumble error wash ------------------------------------------- */
  if (s.err > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = s.err * 0.16;
    ctx.fillStyle = '#ff2e6a';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  if (s.burst > 0.01) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = s.burst * 0.4;
    ctx.fillStyle = CYB_SCAN[7];
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

function cyberOnBounce(impact, state, helpers) {
  const s = getCyb(state);
  if (!s) return;
  const x = impact.x;
  const y = impact.y;
  const z = impact.z;
  const str = impact.strength > 0 ? impact.strength : 1;
  const e = str > 1.8 ? 1.8 : str;
  const mag = (impact.bounceIndex + impact.dieIndex) & 1;

  for (let k = 0; k < 8 + ((e * 4) | 0); k++) {
    const p = take(s);
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = helpers.rand(-2.2, 2.2) * e;
    p.vy = helpers.rand(-2.2, 2.2) * e;
    p.vz = helpers.rand(0.4, 3.4) * e;
    p.size = helpers.rand(1.2, 3.0);
    p.endSize = 0.2;
    p.life = helpers.rand(0.28, 0.62);
    if (k % 2 === 0) {
      p.r = 92;
      p.g = 240;
      p.b = 255;
    } else {
      p.r = 255;
      p.g = 92;
      p.b = 208;
    }
    p.a = 0.95;
    p.gravity = 4.4;
    p.drag = 2.0;
    p.blend = 'lighter';
    p.shape = k % 4 === 0 ? 'square' : 'shard';
    helpers.spawnParticle(p);
  }

  helpers.spawnShockwave(x, y, 1.2 + 0.8 * e, 0.42, mag ? '255,86,214' : '96,238,255', 1.6);

  /* glitch slices around the impact row */
  const pr = helpers.project(x, y, z);
  const sy = pr.sy;
  const bands = 2 + ((e * 2) | 0);
  for (let k = 0; k < bands; k++) {
    pushGlitch(
      s,
      sy + helpers.rand(-26, 26),
      helpers.rand(2, 13),
      helpers.rand(-34, 34),
      0.16 + helpers.rand(0, 0.28),
      (k + mag) & 1
    );
  }
}

function cyberOnSettle(outcome, state, helpers) {
  const s = getCyb(state);
  if (!s) return;
  const tier = outcome.tier;
  s.burst = tier === 'critical' ? 0.95 : tier === 'fumble' ? 1 : 0.5;
  if (tier === 'fumble') s.err = 1;
  if (tier === 'critical') s.heat = 1;

  const dice = state && state.dice ? state.dice : null;
  const count = dice && dice.length ? dice.length : 1;
  const crit = tier === 'critical';
  const fumble = tier === 'fumble';

  for (let d = 0; d < count; d++) {
    const die = dice ? dice[d] : null;
    const x = die ? die.x : 0;
    const y = die ? die.y : 0;
    const z = die ? die.z : 0;

    for (let w = 0; w < (crit ? 3 : 1); w++) {
      helpers.spawnShockwave(
        x, y,
        (crit ? 3.0 : 1.8) + w * 1.2,
        0.5 + w * 0.2,
        fumble ? '255,46,106' : w % 2 === 0 ? '96,238,255' : '255,86,214',
        crit ? 2.4 : 1.5
      );
    }

    const n = crit ? 44 : fumble ? 32 : 18;
    for (let k = 0; k < n; k++) {
      const p = take(s);
      const ang = helpers.rand(0, TAU);
      const spd = helpers.rand(1.0, crit ? 5.2 : 3.0);
      p.x = x;
      p.y = y;
      p.z = z + 0.1;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.vz = helpers.rand(0.6, crit ? 5.4 : 3.0);
      p.size = crit ? helpers.rand(1.8, 4.2) : helpers.rand(1.2, 2.8);
      p.endSize = 0.1;
      p.life = helpers.rand(0.5, crit ? 1.35 : 0.95);
      if (fumble) {
        p.r = 255;
        p.g = 46 + ((k * 9) % 40);
        p.b = 106;
        p.shape = 'square';
      } else {
        if (k % 3 === 0) {
          p.r = 255;
          p.g = 88;
          p.b = 212;
        } else {
          p.r = 96;
          p.g = 238;
          p.b = 255;
        }
        p.shape = k % 5 === 0 ? 'ring' : 'spark';
      }
      p.a = 0.95;
      p.gravity = 4.0;
      p.drag = 1.3;
      p.blend = 'lighter';
      helpers.spawnParticle(p);
    }

    const pr = helpers.project(x, y, z);
    if (crit) {
      for (let k = 0; k < 8; k++) {
        pushGlitch(s, pr.sy + helpers.rand(-70, 70), helpers.rand(3, 18), helpers.rand(-46, 46), 0.4 + helpers.rand(0, 0.5), k & 1);
      }
    } else if (fumble) {
      for (let k = 0; k < 6; k++) {
        pushGlitch(s, pr.sy + helpers.rand(-60, 60), helpers.rand(4, 20), helpers.rand(-56, 56), 0.5 + helpers.rand(0, 0.6), 0);
      }
    }
  }
}

function cyberDrawTrail(ctx, die, time, state, helpers) {
  const TX = die.trailX;
  const TY = die.trailY;
  const TZ = die.trailZ;
  if (!TX || typeof TX === 'number' || !TY || typeof TY === 'number') return;
  let n = die.trailCount | 0;
  if (n < 2) return;
  if (n > 24) n = 24;
  const head = die.trailHead | 0;
  const speed = die.speed || 0;

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  /* two parallel rails: cyan (offset +w) and magenta (offset -w) */
  const w0 = 1.4 + Math.min(3.2, speed / 620);

  let first = true;
  for (let rail = 0; rail < 2; rail++) {
    const sign = rail === 0 ? 1 : -1;
    ctx.strokeStyle = rail === 0 ? CYB_TRAIL_A[9] : CYB_TRAIL_B[9];
    ctx.lineWidth = rail === 0 ? 2.1 : 1.6;
    ctx.beginPath();
    first = true;
    for (let i = n - 1; i >= 0; i--) {
      const idx = ((head - i + 24) % 24) | 0;
      const wx = TX[idx];
      const wy = TY[idx];
      const wz = TZ ? TZ[idx] : 0;
      if (wx === undefined || wy === undefined) continue;
      const pr = helpers.project(wx, wy, wz || 0);
      const sx = pr.sx;
      const sy = pr.sy;
      const sc = pr.scale > 0 ? pr.scale : 1;
      const off = w0 * sign * (0.4 + sc * 0.6);
      if (first) {
        ctx.moveTo(sx + off, sy);
        first = false;
      } else {
        ctx.lineTo(sx + off, sy);
      }
    }
    if (!first) ctx.stroke();
  }

  /* bright core line */
  ctx.strokeStyle = CYB_TRAIL_A[18];
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  first = true;
  for (let i = n - 1; i >= 0; i--) {
    const idx = ((head - i + 24) % 24) | 0;
    const wx = TX[idx];
    const wy = TY[idx];
    const wz = TZ ? TZ[idx] : 0;
    if (wx === undefined || wy === undefined) continue;
    const pr = helpers.project(wx, wy, wz || 0);
    const sx = pr.sx;
    const sy = pr.sy;
    if (first) {
      ctx.moveTo(sx, sy);
      first = false;
    } else {
      ctx.lineTo(sx, sy);
    }
  }
  if (!first) ctx.stroke();

  /* RGB chromatic ghosts at high speed */
  if (speed > 420) {
    const g = Math.min(4.5, speed / 380);
    for (let pass = 0; pass < 2; pass++) {
      const dx = pass === 0 ? -g : g;
      ctx.strokeStyle = pass === 0 ? CYB_GLITCH_R[5] : CYB_GLITCH_A[5];
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      let f2 = true;
      for (let i = n - 1; i >= 0; i--) {
        const idx = ((head - i + 24) % 24) | 0;
        const wx = TX[idx];
        const wy = TY[idx];
        const wz = TZ ? TZ[idx] : 0;
        if (wx === undefined || wy === undefined) continue;
        const pr = helpers.project(wx, wy, wz || 0);
        if (f2) {
          ctx.moveTo(pr.sx + dx, pr.sy);
          f2 = false;
        } else {
          ctx.lineTo(pr.sx + dx, pr.sy);
        }
      }
      if (!f2) ctx.stroke();
    }
  }

  ctx.globalCompositeOperation = 'source-over';
}

function cyberStyleFace(info, state, helpers) {
  const out = info.out;
  let d = info.lightDot;
  if (!(d >= 0)) d = 0;
  else if (d > 1) d = 1;

  const settled = !!info.settled;
  const tier = info.tier;
  const w = settled ? CYB_TIER_W[tier] | 0 : 0;
  const hidden = !!info.hidden;
  const par = (info.faceIndex | 0) & 1;

  let q = (d * 15.999) | 0;
  if (w >= 3) q = q > 12 ? 15 : q + 3;
  else if (w === 2) q = q > 13 ? 15 : q + 1;
  if (hidden) q = q > 5 ? q - 5 : 0;

  const edgeI = d > 1 ? 11 : (d * 11.999) | 0;
  const edgeIw = w >= 3 ? (edgeI > 9 ? 11 : edgeI + 2) : edgeI;
  const tI = d > 1 ? 7 : (d * 7.999) | 0;
  const shadowI = w >= 3 ? 4 : d > 0.72 ? 3 : d > 0.45 ? 2 : d > 0.2 ? 1 : 0;
  const gI = d > 1 ? 7 : (d * 7.999) | 0;

  out.fill = hidden ? CYB_FACE_DIM[q] : par ? CYB_FACE_B[q] : CYB_FACE_A[q];
  out.stroke = hidden ? CYB_EDGE_A[edgeIw] : par ? CYB_EDGE_B[edgeIw] : CYB_EDGE_A[edgeIw];
  out.lineWidth = 0.95 + d * 1.55 + (w >= 3 ? 0.8 : 0);
  out.textFill = hidden ? CYB_TEXT_DIM[tI] : CYB_TEXT[tI];
  out.textShadow = hidden ? CYB_SHADOW_DIM[shadowI] : par ? CYB_SHADOW_MAG[shadowI] : CYB_SHADOW[shadowI];
  out.glowColor = par ? CYB_GLOW_B[gI] : CYB_GLOW_A[gI];
  out.glowBlur = 4 + d * 12 + w * 5;
  out.sheenAlpha = 0.04 + d * 0.3 + (info.isTopFace ? 0.12 : 0) + (w >= 3 ? 0.06 : 0);
  return out;
}

function cyberDrawFaceOverlay(ctx, cx, cy, radius, verts2D, vertCount, info, state) {
  if (!verts2D || vertCount < 3) return;
  const d = info && info.lightDot > 0 ? (info.lightDot > 1 ? 1 : info.lightDot) : 0;
  const time = info && info.time ? info.time : 0;
  const li = (d * 9.999) | 0;
  const par = info ? (info.faceIndex | 0) & 1 : 0;
  const hidden = info && info.hidden;

  let minX = verts2D[0];
  let maxX = verts2D[0];
  let minY = verts2D[1];
  let maxY = verts2D[1];
  for (let i = 1; i < vertCount; i++) {
    const vx = verts2D[i * 2];
    const vy = verts2D[i * 2 + 1];
    if (vx < minX) minX = vx;
    if (vx > maxX) maxX = vx;
    if (vy < minY) minY = vy;
    if (vy > maxY) maxY = vy;
  }

  /* holographic circuit trace: inset polyline with chamfered corners */
  const inset = 0.7;
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = hidden ? CYB_HUD[2] : par ? CYB_HUD_MAG[Math.min(9, li + 3)] : CYB_HUD[Math.min(9, li + 3)];
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  for (let i = 0; i < vertCount; i++) {
    const vx = cx + (verts2D[i * 2] - cx) * inset;
    const vy = cy + (verts2D[i * 2 + 1] - cy) * inset;
    if (i === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
  ctx.stroke();

  /* corner brackets + circuit stubs */
  const bx = 0.55;
  ctx.beginPath();
  for (let i = 0; i < vertCount; i++) {
    const vx = cx + (verts2D[i * 2] - cx) * 0.94;
    const vy = cy + (verts2D[i * 2 + 1] - cy) * 0.94;
    const ax = cx + (verts2D[i * 2] - cx) * 0.78;
    const ay = cy + (verts2D[i * 2 + 1] - cy) * 0.78;
    ctx.moveTo(vx, vy);
    ctx.lineTo(vx + (ax - vx) * bx, vy);
    ctx.moveTo(vx, vy);
    ctx.lineTo(vx, vy + (ay - vy) * bx);
  }
  ctx.stroke();

  /* scanning highlight band, clipped to the face polygon */
  const h = maxY - minY;
  const ph = ((time * 1.6) % 1);
  const bandY = minY + h * ph;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < vertCount; i++) {
    const vx = cx + (verts2D[i * 2] - cx) * 0.93;
    const vy = cy + (verts2D[i * 2 + 1] - cy) * 0.93;
    if (i === 0) ctx.moveTo(vx, vy);
    else ctx.lineTo(vx, vy);
  }
  ctx.closePath();
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = par ? CYB_GLITCH_B[8] : CYB_GLITCH_A[8];
  ctx.fillRect(minX, bandY, maxX - minX, Math.max(1.2, h * 0.09));
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();

  /* centre reticle ticks */
  ctx.strokeStyle = hidden ? CYB_HUD[3] : par ? CYB_HUD_MAG[6] : CYB_HUD[6];
  ctx.lineWidth = 0.8;
  const r2 = radius * 0.2;
  ctx.beginPath();
  ctx.moveTo(cx - r2, cy);
  ctx.lineTo(cx - r2 * 0.35, cy);
  ctx.moveTo(cx + r2 * 0.35, cy);
  ctx.lineTo(cx + r2, cy);
  ctx.moveTo(cx, cy - r2);
  ctx.lineTo(cx, cy - r2 * 0.35);
  ctx.moveTo(cx, cy + r2 * 0.35);
  ctx.lineTo(cx, cy + r2);
  ctx.stroke();
}

function cyberDrawForeground(ctx, W, H, time, state, helpers) {
  const s = getCyb(state);
  if (!s) return;
  const st = state && typeof state.settleTime === 'number' ? state.settleTime : 99;
  if (st >= 2.2) return;
  const tier = state.tier;
  const inten = CYB_TIER_INT[tier] !== undefined ? CYB_TIER_INT[tier] : 0.3;
  let a;
  if (st < 0.24) a = st / 0.24;
  else if (st < 1.55) a = 1;
  else a = 1 - (st - 1.55) / 0.65;
  if (a <= 0) return;
  if (a > 1) a = 1;

  const dice = state.dice;
  if (!dice) return;
  const n = dice.length;
  const tSec = time;
  const alpha = a * inten;
  const li = Math.min(9, (alpha * 9.999) | 0);
  const mag = tier === 'fumble';
  const tele = mag ? CYB_TELE.fumble : CYB_TELE[tier] || CYB_TELE.success;

  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;

  for (let i = 0; i < n; i++) {
    const die = dice[i];
    if (!die) continue;
    if (!die.settled && !state.settled) continue;
    const pr = helpers.project(die.x, die.y, die.z);
    const px = pr.sx;
    const py = pr.sy;
    const sc = pr.scale > 0 ? pr.scale : 1;
    const rad = (die.radius || 18) * sc * 1.9;

    const col = mag ? CYB_HUD_MAG : CYB_HUD;
    ctx.strokeStyle = col[Math.min(9, li + 4)];
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    /* four corner brackets */
    const k = rad * 0.36;
    const x0 = px - rad;
    const x1 = px + rad;
    const y0 = py - rad;
    const y1 = py + rad;
    ctx.moveTo(x0, y0 + k); ctx.lineTo(x0, y0); ctx.lineTo(x0 + k, y0);
    ctx.moveTo(x1 - k, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + k);
    ctx.moveTo(x1, y1 - k); ctx.lineTo(x1, y1); ctx.lineTo(x1 - k, y1);
    ctx.moveTo(x0 + k, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - k);
    ctx.stroke();

    /* crosshair ticks outside the box */
    const ct = rad * 0.18;
    ctx.beginPath();
    ctx.moveTo(px, y0 - ct); ctx.lineTo(px, y0);
    ctx.moveTo(px, y1); ctx.lineTo(px, y1 + ct);
    ctx.moveTo(x0 - ct, py); ctx.lineTo(x0, py);
    ctx.moveTo(x1, py); ctx.lineTo(x1 + ct, py);
    ctx.stroke();

    /* rotating sweep arc */
    ctx.strokeStyle = mag ? CYB_HUD_MAG[8] : CYB_HUD[8];
    ctx.lineWidth = 1.6;
    const sw = tSec * 2.2 + i * 1.1;
    ctx.beginPath();
    ctx.arc(px, py, rad * 1.12, sw, sw + 0.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, py, rad * 1.12, sw + 2.1, sw + 2.5);
    ctx.stroke();

    /* telemetry readout above the box */
    ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = mag ? CYB_HUD_MAG[9] : CYB_HUD[9];
    ctx.fillText(tele, x0, y0 - 3);

    /* value / sides readout — table lookups only, no string building */
    ctx.textAlign = 'right';
    ctx.fillStyle = col[Math.min(9, li + 3)];
    const sd = die.sides | 0;
    const sdSafe = sd >= 0 && sd < 128 ? sd : 0;
    const vl = die.faceValue;
    const vlSafe = vl >= 0 && vl < 128 ? vl | 0 : 0;
    ctx.fillText(SIDES_TAG[sdSafe], x1, y0 - 3);
    ctx.fillStyle = col[Math.min(9, li + 5)];
    ctx.fillText(STR_NUM[vlSafe], x1 - SIDES_TAG_W[sdSafe] - 5, y0 - 3);

    /* bottom status bar */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = col[Math.min(9, li + 2)];
    ctx.fillText(mag ? 'LINK // LOST' : 'LOCK // SYNC', x0, y1 + 4);
    ctx.textAlign = 'right';
    ctx.fillText(tier === 'critical' ? 'OVR // 100%' : tier === 'costly' ? 'TAX // APPLIED' : 'SIG // STABLE', x1, y1 + 4);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/* HUD readout strings — built once at module load so the frame only indexes.
 * STR_NUM[v] : face value        SIDES_TAG[sd] : "d6"
 * SIDES_TAG_W: precomputed pixel width for the fixed 10px monospace font. */
const STR_NUM = new Array(128);
const SIDES_TAG = new Array(128);
const SIDES_TAG_W = new Float32Array(128);
for (let i = 0; i < 128; i++) {
  STR_NUM[i] = String(i);
  SIDES_TAG[i] = 'd' + i;
  SIDES_TAG_W[i] = SIDES_TAG[i].length * 6.02;
}

function cyberHasActiveFX(state) {
  if (!state) return false;
  if (state.settleTime < 2.2) return true;
  const s = getCyb(state);
  if (!s) return false;
  if (s.burst > 0.02 || s.err > 0.03) return true;
  if (s.glLife) {
    for (let i = 0; i < GLITCH_N; i++) if (s.glLife[i] > 0) return true;
  }
  return false;
}

/* ===========================================================================
 * 5. Plugin objects
 * ======================================================================== */

export const arcaneStyle = {
  id: 'arcane',
  name: '黄金秘法星盘',
  subtitle: 'Obsidian Velvet · Golden Zodiac',
  badge: 'ARCANE',
  desc: '深曜石天鹅绒底上，十二宫刻度环与六芒符文阵差速旋转；大成功时星盘金光暴涨，大失败时紫黑裂隙自中心撕开。',
  accent: '#ffd46e',
  bgPreview: 'radial-gradient(120% 90% at 50% 46%, #3b2a10 0%, #140c1a 46%, #05030a 100%)',
  soundPreset: 'arcane',

  init: arcaneInit,
  drawBackground: arcaneDrawBackground,
  onBounce: arcaneOnBounce,
  onSettle: arcaneOnSettle,
  drawDieTrail: arcaneDrawTrail,
  styleFace: arcaneStyleFace,
  drawFaceOverlay: arcaneDrawFaceOverlay,
  drawForeground: arcaneDrawForeground,
  hasActiveFX: arcaneHasActiveFX,
};

export const cyberStyle = {
  id: 'cyber',
  name: '赛博霓虹故障',
  subtitle: 'Night Violet · Neon Glitch',
  badge: 'CYBER',
  desc: '暗夜紫青底上 3D 透视霓虹激光网格滚动扫描；落地触发水平故障错位光带，结算后锁定战术 HUD 准星与遥测读数。',
  accent: '#5ce6ff',
  bgPreview: 'linear-gradient(180deg, #07030f 0%, #150a33 48%, #04101c 100%)',
  soundPreset: 'cyber',

  init: cyberInit,
  drawBackground: cyberDrawBackground,
  onBounce: cyberOnBounce,
  onSettle: cyberOnSettle,
  drawDieTrail: cyberDrawTrail,
  styleFace: cyberStyleFace,
  drawFaceOverlay: cyberDrawFaceOverlay,
  drawForeground: cyberDrawForeground,
  hasActiveFX: cyberHasActiveFX,
};

export const STYLES = [arcaneStyle, cyberStyle];
export default STYLES;
