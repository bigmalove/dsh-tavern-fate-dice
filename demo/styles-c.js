/* ===================================================================== *
 * styles-c.js —— 高质感 60/120fps 投骰视觉风格插件（纯 Canvas 2D · 零 GC 分配）
 * --------------------------------------------------------------------- *
 *   prism  · 星骸水晶棱镜 : 极光星云镜面暗底 + 菱形焦散光网 + 子弹时间折射慢镜
 *   tavern · 酒馆橡木绒盘 : 八角胡桃木框 + 拉丝黄铜铆钉 + 祖母绿丝绒 + 烛火暖光
 *
 * 零分配纪律（帧内热路径 drawBackground / onBounce / onSettle / drawDieTrail /
 * styleFace / drawFaceOverlay / drawForeground / hasActiveFX）：
 *   1. 颜色一律走 init 期量化的 RAMP 缓存（24 级 alpha 色阶），帧内只做整数索引，
 *      不拼接 'rgba(...)' 字符串、不写模板串；
 *   2. 一切几何数据用 Float32Array 预分配（星野 / 焦散菱形 / 八角框 / 铆钉 / 木纹）；
 *   3. CanvasGradient 在 init 期按 (ctx, W, H) 缓存，帧内绝不 createGradient；
 *   4. helpers.spawnParticle 复用预分配 spec 环（32 槽就地改字段），不产出字面量对象；
 *   5. 无 [...spread] / .map / .filter / 数组切片 / 解构新对象；
 *      helpers.project 的共享返回值一律立即解构为标量。
 *
 * 契约要点：styleFace 必须原地改写并返回 info.out；timeScale 让主引擎把 rollTime
 * 的推进速度乘以返回值（prism 在落定前的临界窗口返回 0.35 做子弹时间）。
 * ===================================================================== */

const TAU = 6.283185307179586;
const RAMP_STEPS = 24;
const RAMP_MAX = RAMP_STEPS - 1;
const TRAIL_LEN = 24;
const SPEC_RING = 32;

/* ------------------------------------------------------------------ *
 * 0. 纯标量数学（无分配，不依赖 helpers，便于自检与降级）
 * ------------------------------------------------------------------ */
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function clampN(v, a, b) { return v < a ? a : v > b ? b : v; }
function lerpN(a, b, t) { return a + (b - a) * t; }
function smoothstepN(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

/* 确定性 LCG：init 期铺星野/木纹用，避免每次初始化画面跳动 */
let _seed = 1;
function prngReset(s) { _seed = (s | 0) || 1; }
function prng() { _seed = (_seed * 1664525 + 1013904223) | 0; return ((_seed >>> 8) & 0xffff) / 65536; }

/* ------------------------------------------------------------------ *
 * 1. 颜色 RAMP 量化缓存：帧内只取索引，不生成字符串
 * ------------------------------------------------------------------ */
function buildRamp(r, g, b) {
  const rr = r | 0, gg = g | 0, bb = b | 0;
  const out = new Array(RAMP_STEPS);
  for (let i = 0; i < RAMP_STEPS; i++) {
    out[i] = 'rgba(' + rr + ',' + gg + ',' + bb + ',' + (i / RAMP_MAX).toFixed(3) + ')';
  }
  return out;
}
function rampAt(ramp, a) {
  let i = (a * RAMP_MAX + 0.5) | 0;
  if (i < 0) i = 0; else if (i > RAMP_MAX) i = RAMP_MAX;
  return ramp[i];
}
function hslToRgbInto(h, s, l, out) {
  h = h - Math.floor(h);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  out[0] = hueChan(p, q, h + 1 / 3) * 255;
  out[1] = hueChan(p, q, h) * 255;
  out[2] = hueChan(p, q, h - 1 / 3) * 255;
  return out;
}
function hueChan(p, q, t) {
  t = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/* 模块级共享基础色阶 */
const RAMP_WHITE = buildRamp(255, 255, 255);
const RAMP_INK = buildRamp(4, 7, 16);

/* 光谱 12 阶（prism 色散）：同时缓存 rgb 分量供 styleFace 输出数值字段 */
function buildSpectral(n) {
  const ramps = new Array(n);
  const rgb = new Float32Array(n * 3);
  const tmp = new Float32Array(3);
  for (let i = 0; i < n; i++) {
    hslToRgbInto(i / n, 0.78, 0.58, tmp);
    ramps[i] = buildRamp(tmp[0], tmp[1], tmp[2]);
    rgb[i * 3] = tmp[0] | 0;
    rgb[i * 3 + 1] = tmp[1] | 0;
    rgb[i * 3 + 2] = tmp[2] | 0;
  }
  return { ramps: ramps, rgb: rgb };
}

/* ------------------------------------------------------------------ *
 * 2. spawnParticle spec 环（复用对象，零字面量）
 * ------------------------------------------------------------------ */
function makeSpecRing() {
  const ring = new Array(SPEC_RING);
  for (let i = 0; i < SPEC_RING; i++) {
    ring[i] = {
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      size: 2, endSize: 0, life: 0.6,
      r: 255, g: 255, b: 255, a: 1,
      gravity: 0, drag: 0, blend: 'lighter', shape: 'dot'
    };
  }
  return { ring: ring, idx: 0 };
}
function takeSpec(pool) {
  const i = pool.idx;
  pool.idx = (i + 1) % SPEC_RING;
  return pool.ring[i];
}

/* ------------------------------------------------------------------ *
 * 3. 通用绘制辅助（纯函数，无分配）
 * ------------------------------------------------------------------ */
function drawPolyPath(ctx, pts, count) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 1; i < count; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  ctx.closePath();
}
/* 骰面叠层的小粒度绘制函数：刻意保持函数体短小，避免 V8 因体量越过内联预算
 * 退回解释执行而在 Float32Array 顶点读取处产生装箱（实测会让每帧多出 HeapNumber）。 */
function strokeInsetPoly(ctx, cx, cy, verts2D, vertCount, flat, scale, lineW, color) {
  ctx.beginPath();
  for (let i = 0; i < vertCount; i++) {
    const vx = flat === 1 ? verts2D[i * 2] : verts2D[i].x;
    const vy = flat === 1 ? verts2D[i * 2 + 1] : verts2D[i].y;
    const px = cx + (vx - cx) * scale;
    const py = cy + (vy - cy) * scale;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.lineWidth = lineW;
  ctx.strokeStyle = color;
  ctx.stroke();
}
function strokeCenterRays(ctx, cx, cy, verts2D, vertCount, flat, scale, lineW, color) {
  ctx.beginPath();
  for (let i = 0; i < vertCount; i++) {
    const vx = flat === 1 ? verts2D[i * 2] : verts2D[i].x;
    const vy = flat === 1 ? verts2D[i * 2 + 1] : verts2D[i].y;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (vx - cx) * scale, cy + (vy - cy) * scale);
  }
  ctx.lineWidth = lineW;
  ctx.strokeStyle = color;
  ctx.stroke();
}
function fillGlintDot(ctx, gx, gy, r, color) {
  ctx.beginPath();
  ctx.arc(gx, gy, r, 0, TAU);
  ctx.fillStyle = color;
  ctx.fill();
}
function strokeBevelArc(ctx, ax, ay, r, a0, a1, lineW, color) {
  ctx.beginPath();
  ctx.arc(ax, ay, r, a0, a1);
  ctx.lineWidth = lineW;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
function octagonInto(arr, cx, cy, rx, ry, rot) {
  for (let k = 0; k < 8; k++) {
    const a = rot + k * TAU / 8;
    arr[k * 2] = cx + Math.cos(a) * rx;
    arr[k * 2 + 1] = cy + Math.sin(a) * ry;
  }
  return arr;
}

/* 章首标签缓存（避免帧内字符串） */
const TIERS = ['critical', 'success', 'costly', 'failure', 'fumble'];
const TIER_LABELS = ['大成功', '成功', '代价成功', '失败', '大失败'];
const TIER_TAG = ['✦ 命途交汇', '✦ 顺流而行', '✦ 代价已偿', '✦ 命数未至', '✦ 星骸崩解'];
function tierIndex(t) {
  if (t === 'critical') return 0;
  if (t === 'success') return 1;
  if (t === 'costly') return 2;
  if (t === 'failure') return 3;
  if (t === 'fumble') return 4;
  return -1;
}

/* ================================================================== *
 *                         P R I S M
 * ================================================================== */

function createPrismCore() {
  const spectral = buildSpectral(12);
  return {
    tag: 'prism',
    ready: false,
    W: 0, H: 0,
    gradCtx: null,
    /* 色阶 */
    spectral: spectral.ramps,
    spectralRgb: spectral.rgb,
    whiteRamp: RAMP_WHITE,
    inkRamp: RAMP_INK,
    nebRamp: [buildRamp(84, 255, 236), buildRamp(126, 122, 255), buildRamp(255, 118, 208)],
    starRamp: buildRamp(214, 246, 255),
    causticRamp: buildRamp(140, 236, 255),
    rimRamp: buildRamp(156, 244, 255),
    glowRamp: buildRamp(80, 214, 255),
    crackRamp: buildRamp(96, 124, 168),
    goldRamp: buildRamp(255, 232, 168),
    /* 几何预分配 */
    stars: new Float32Array(110 * 4),
    caustics: new Float32Array(42 * 4),
    nebPhase: new Float32Array([0.11, 0.47, 0.79]),
    nebSpeed: new Float32Array([0.037, -0.028, 0.021]),
    nebRadius: new Float32Array([0, 0, 0]),
    /* 子弹时间 */
    bt: 1,
    btHit: 0,
    /* 落定天幕 */
    beamT: 9,
    beamKind: 0,
    crack: 0,
    /* 渐变缓存 */
    bgGrad: null, vigGrad: null, spotGrad: null, flareGrad: null,
    /* 粒子 spec 环 */
    spec: makeSpecRing(),
    huePhase: 0,
    dash: [7, 9]
  };
}

function ensureCustom(state) {
  let custom = state.custom;
  if (!custom || typeof custom !== 'object') {
    custom = {};
    state.custom = custom;
  }
  return custom;
}

function buildPrismGeometry(ctx, c, W, H) {
  const cx = W * 0.5, cy = H * 0.5;
  prngReset(0x9e3779b9);
  const stars = c.stars;
  for (let i = 0, o = 0; i < stars.length; i += 4, o++) {
    stars[i] = prng() * W;
    stars[i + 1] = prng() * H;
    stars[i + 2] = 0.7 + prng() * 2.1;
    stars[i + 3] = prng() * TAU;
  }
  const ca = c.caustics;
  const spanX = W * 0.42, spanY = H * 0.38;
  for (let i = 0, o = 0; i < ca.length; i += 4, o++) {
    const ang = prng() * TAU;
    const rad = 0.18 + prng() * 0.92;
    ca[i] = cx + Math.cos(ang) * spanX * rad;
    ca[i + 1] = cy + Math.sin(ang) * spanY * rad * 0.86;
    ca[i + 2] = (10 + prng() * 34) * (W / 1280);
    ca[i + 3] = prng();
  }
  c.nebRadius[0] = Math.max(W, H) * 0.42;
  c.nebRadius[1] = Math.max(W, H) * 0.30;
  c.nebRadius[2] = Math.max(W, H) * 0.26;
  c.W = W; c.H = H;
  buildPrismGradients(ctx, c, W, H);
}

function buildPrismGradients(ctx, c, W, H) {
  if (!ctx || typeof ctx.createLinearGradient !== 'function') { c.gradCtx = null; return; }
  const cx = W * 0.5, cy = H * 0.46;
  const bg = ctx.createLinearGradient(0, 0, W * 0.35, H);
  bg.addColorStop(0, rampAt(c.inkRamp, 1));
  bg.addColorStop(0.34, rampAt(buildRamp(9, 18, 42), 1));
  bg.addColorStop(0.68, rampAt(buildRamp(15, 26, 58), 1));
  bg.addColorStop(1, rampAt(buildRamp(26, 12, 44), 1));
  c.bgGrad = bg;

  const vig = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.16, cx, cy, Math.max(W, H) * 0.72);
  vig.addColorStop(0, rampAt(RAMP_INK, 0));
  vig.addColorStop(0.62, rampAt(RAMP_INK, 0.18));
  vig.addColorStop(1, rampAt(RAMP_INK, 0.82));
  c.vigGrad = vig;

  const spot = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.04, cx, cy, Math.min(W, H) * 0.62);
  spot.addColorStop(0, rampAt(buildRamp(120, 238, 255), 0.34));
  spot.addColorStop(0.55, rampAt(buildRamp(96, 160, 255), 0.10));
  spot.addColorStop(1, rampAt(buildRamp(24, 34, 88), 0));
  c.spotGrad = spot;

  const fl = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.30);
  fl.addColorStop(0, rampAt(RAMP_WHITE, 0.55));
  fl.addColorStop(0.28, rampAt(buildRamp(150, 240, 255), 0.18));
  fl.addColorStop(1, rampAt(buildRamp(90, 140, 255), 0));
  c.flareGrad = fl;
  c.gradCtx = ctx;
}

function initPrism(ctx, W, H, state) {
  const custom = ensureCustom(state);
  let c = custom.prism;
  if (!c || c.tag !== 'prism') c = custom.prism = createPrismCore();
  if (!c.ready || c.W !== W || c.H !== H) {
    buildPrismGeometry(ctx, c, W, H);
    c.ready = true;
  } else if (ctx && c.gradCtx !== ctx) {
    buildPrismGradients(ctx, c, W, H);
  }
  return c;
}
function prismSlot(state) {
  const custom = state.custom;
  if (!custom || typeof custom !== 'object') return null;
  const c = custom.prism;
  return c && c.ready ? c : null;
}

/* ---------------------------- prism style --------------------------- */
const prismStyle = {
  id: 'prism',
  name: '星骸水晶棱镜',
  subtitle: 'Starwreck Crystal Prism',
  badge: '✦ 逆命重投',
  desc: '深空极光镜面上的晶体折射。骰子临落定前触发子弹时间折射慢镜，七彩色散丝带与菱形焦散光网同步凝固。',
  accent: '#7fe7ff',
  bgPreview: 'radial-gradient(120% 120% at 50% 20%, #16305c 0%, #0a1730 48%, #05080f 100%)',
  soundPreset: 'prism',

  /* 专属亮点：子弹时间。返回 0.35 = 时间流速降到 35% */
  timeScale(rollTime, state) {
    const c = prismSlot(state);
    let active = 0, speedSum = 0;
    const dice = state && state.dice;
    if (dice && dice.length) {
      for (let i = 0; i < dice.length; i++) {
        const d = dice[i];
        if (d && !d.settled) {
          active++;
          speedSum += d.speed > 0 ? d.speed : 0;
        }
      }
    }
    const avg = active > 0 ? speedSum / active : 0;
    const t = rollTime > 0 ? rollTime : 0;
    /* 主窗口 0.62..0.95，两端用 smoothstep 平滑进出 */
    let w = smoothstepN(0.62, 0.70, t) * (1 - smoothstepN(0.86, 0.95, t));
    if (state && state.mode === 'fate') {
      /* 逆命重投：临界窗口提前拉开，戏剧张力更足 */
      const wf = smoothstepN(0.56, 0.66, t) * (1 - smoothstepN(0.86, 0.96, t));
      if (wf > w) w = wf;
    }
    if (active === 0) {
      w = 0;                       /* 全部落定 → 立刻恢复 1.0 */
    } else if (avg >= 260) {
      w *= 0.70;                   /* 高速飞行阶段收敛，避免拖慢整段手感 */
    } else if (avg < 90 && w > 0 && w < 0.55) {
      w = 0.55;                    /* 低速临近落定：保留完整慢镜强度 */
    }
    const target = 1 + (0.35 - 1) * w;
    if (!c) return target;
    c.bt += (target - c.bt) * 0.28;   /* 一阶平滑，避免时间轴跳变 */
    c.btHit = w;
    if (c.bt < 0.35) c.bt = 0.35; else if (c.bt > 1) c.bt = 1;
    return c.bt;
  },

  init(ctx, W, H, state) { initPrism(ctx, W, H, state); },

  /* -------------------- 背景：极光星云镜面 + 菱形焦散 -------------------- */
  drawBackground(ctx, W, H, time, state, helpers) {
    const c = initPrism(ctx, W, H, state);
    const cx = W * 0.5, cy = H * 0.46;

    /* 暗底 */
    if (c.bgGrad) {
      ctx.fillStyle = c.bgGrad;
    } else {
      ctx.fillStyle = rampAt(c.inkRamp, 1);
    }
    ctx.fillRect(0, 0, W, H);

    /* 极光星云团（3 层漂移） */
    ctx.globalCompositeOperation = 'lighter';
    const neb = c.nebRamp;
    for (let k = 0; k < 3; k++) {
      const ph = c.nebPhase[k] + time * c.nebSpeed[k];
      const ang = ph * TAU;
      const nx0 = cx + Math.cos(ang) * W * 0.20;
      const ny0 = cy + Math.sin(ang * 0.73 + k) * H * 0.16;
      const rad = c.nebRadius[k] * (1 + 0.07 * Math.sin(ph * TAU * 1.7 + k));
      ctx.fillStyle = rampAt(neb[k], 0.10 + 0.075 * (0.5 + 0.5 * Math.sin(ph * TAU + k * 2.1)));
      ctx.beginPath();
      ctx.arc(nx0, ny0, rad, 0, TAU);
      ctx.fill();
    }

    /* 星野（两层：实心晶点 + 闪烁微尘） */
    const stars = c.stars;
    ctx.fillStyle = rampAt(c.starRamp, 0.5);
    for (let i = 0; i < stars.length; i += 4) {
      const tw = 0.36 + 0.64 * (0.5 + 0.5 * Math.sin(time * 1.7 + stars[i + 3]));
      const r = stars[i + 2] * (0.7 + 0.5 * tw);
      ctx.fillRect(stars[i] - r, stars[i + 1] - r * 0.35, r * 2, r * 0.7);
    }

    /* 菱形焦散光网（Caustics） */
    const ca = c.caustics;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(0.7, W / 1600);
    for (let i = 0; i < ca.length; i += 4) {
      const ph = ca[i + 3] * TAU + time * 0.55;
      const grow = 1 + 0.28 * Math.sin(ph);
      const s = ca[i + 2] * grow;
      const x = ca[i], y = ca[i + 1];
      ctx.strokeStyle = rampAt(c.causticRamp, 0.05 + 0.11 * (0.5 + 0.5 * Math.sin(ph * 1.6)));
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.42);
      ctx.lineTo(x + s, y);
      ctx.lineTo(x, y + s * 0.42);
      ctx.lineTo(x - s, y);
      ctx.closePath();
      ctx.stroke();
    }

    /* 暗角 */
    ctx.globalCompositeOperation = 'source-over';
    if (c.vigGrad) {
      ctx.fillStyle = c.vigGrad;
      ctx.fillRect(0, 0, W, H);
    }

    /* 子弹时间：暗角聚光呼吸圈 */
    const slow = 1 - clamp01((c.bt - 0.35) / 0.65);
    if (slow > 0.02) {
      if (c.spotGrad) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = slow * 0.85;
        ctx.fillStyle = c.spotGrad;
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
      const base = Math.min(W, H) * 0.34;
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineWidth = Math.max(1, W / 900);
      for (let k = 0; k < 2; k++) {
        const pulse = 1 + 0.045 * Math.sin(time * 2.4 + k * 2.2);
        ctx.strokeStyle = rampAt(c.rimRamp, slow * (0.30 - k * 0.13));
        ctx.beginPath();
        ctx.arc(cx, cy, base * pulse * (1 + k * 0.14), 0, TAU);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  },

  /* -------------------- 撞击：七彩棱晶碎片 + 星芒 -------------------- */
  onBounce(impact, state, helpers) {
    const c = prismSlot(state);
    if (!c || !helpers || typeof helpers.spawnParticle !== 'function') return;
    const ix = impact && impact.x ? impact.x : 0;
    const iy = impact && impact.y ? impact.y : 0;
    const iz = impact && impact.z ? impact.z : 6;
    const s = clampN(impact && impact.strength ? impact.strength : 0.6, 0.12, 2.4);

    const shards = 3 + ((s * 6) | 0);
    const n = shards > 13 ? 13 : shards;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + prng() * 0.5;
      const spd = (60 + prng() * 150) * (0.5 + s * 0.6);
      const p = takeSpec(c.spec);
      p.x = ix; p.y = iy; p.z = iz;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd * 0.8;
      p.vz = 55 + prng() * 120;
      p.size = 2.4 + prng() * 3.4 * (0.6 + s * 0.4);
      p.endSize = 0.4;
      p.life = 0.34 + prng() * 0.30;
      let hue = i * 0.0833 + c.huePhase;
      hue -= Math.floor(hue);
      const hi = (hue * 12) | 0;
      const rgb = c.spectralRgb;
      const k = (hi > 11 ? 11 : hi) * 3;
      p.r = rgb[k]; p.g = rgb[k + 1]; p.b = rgb[k + 2];
      p.a = 0.85;
      p.gravity = -240;
      p.drag = 2.2;
      p.blend = 'lighter';
      p.shape = 'shard';
      helpers.spawnParticle(p);
    }

    /* 十字星芒 */
    const sparks = 2 + ((s * 3) | 0);
    for (let i = 0; i < sparks; i++) {
      const ang = prng() * TAU;
      const spd = 40 + prng() * 90;
      const p = takeSpec(c.spec);
      p.x = ix; p.y = iy; p.z = iz + 2;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd;
      p.vz = 20 + prng() * 40;
      p.size = 5 + prng() * 5;
      p.endSize = 0.2;
      p.life = 0.22 + prng() * 0.18;
      p.r = 214; p.g = 248; p.b = 255;
      p.a = 0.9;
      p.gravity = 0;
      p.drag = 3.4;
      p.blend = 'lighter';
      p.shape = 'star';
      helpers.spawnParticle(p);
    }
    c.huePhase += 0.037;
    if (c.huePhase > 1) c.huePhase -= 1;

    /* 冰晶波纹 */
    if (typeof helpers.spawnShockwave === 'function') {
      helpers.spawnShockwave(ix, iy, 42 + 62 * s, 0.30 + 0.22 * s, rampAt(c.rimRamp, 0.5), 1.6);
    }
    c.btHit = clamp01(s);
  },

  /* -------------------- 落定：极光虹彩天幕 / 冰晶裂痕 -------------------- */
  onSettle(outcome, state, helpers) {
    const c = prismSlot(state);
    if (!c) return;
    const tier = outcome && outcome.tier ? outcome.tier : 'success';
    const fate = state && state.mode === 'fate';
    if (tier === 'critical' || fate) {
      c.beamT = 0;
      c.beamKind = tier === 'critical' ? 1 : 2;
      if (helpers && typeof helpers.spawnParticle === 'function') {
        const cx0 = 0, cy0 = 0;
        for (let i = 0; i < 12; i++) {
          const ray = (i / 12) * TAU;
          const p = takeSpec(c.spec);
          p.x = cx0; p.y = cy0; p.z = 14;
          p.vx = Math.cos(ray) * 46;
          p.vy = Math.sin(ray) * 46;
          p.vz = 130 + prng() * 90;
          p.size = 6 + prng() * 4;
          p.endSize = 0.3;
          p.life = 0.85 + prng() * 0.45;
          const k = i * 3;
          p.r = c.spectralRgb[k % 36];
          p.g = c.spectralRgb[(k + 1) % 36];
          p.b = c.spectralRgb[(k + 2) % 36];
          p.a = 0.8;
          p.gravity = -60;
          p.drag = 1.1;
          p.blend = 'lighter';
          p.shape = 'star';
          helpers.spawnParticle(p);
        }
        if (typeof helpers.spawnShockwave === 'function') {
          helpers.spawnShockwave(0, 0, 150, 0.9, rampAt(c.goldRamp, 0.55), 2.2);
        }
      }
    } else if (tier === 'fumble') {
      c.crack = 1;
      c.beamT = 0;
      c.beamKind = 3;
    } else {
      c.beamT = 0;
      c.beamKind = 0;
    }
  },

  /* -------------------- 骰子拖尾：七彩光谱色散丝带 -------------------- */
  drawDieTrail(ctx, die, time, state, helpers) {
    const c = prismSlot(state);
    if (!c || !die || !helpers || typeof helpers.project !== 'function') return;
    const tx = die.trailX, ty = die.trailY, tz = die.trailZ;
    if (!tx || !ty || !tz || typeof tx !== 'object' || typeof ty !== 'object' || typeof tz !== 'object') return;
    const count = die.trailCount | 0;
    if (count < 2) return;
    const n = count > TRAIL_LEN ? TRAIL_LEN : count;
    const head = die.trailHead | 0;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    let px = 0, py = 0, has = false;
    for (let i = n - 1; i >= 0; i--) {
      let idx = (head - i) % TRAIL_LEN;
      if (idx < 0) idx += TRAIL_LEN;
      const { sx, sy, scale } = helpers.project(tx[idx], ty[idx], tz[idx]);
      const t = 1 - i / n;                       /* 0 最旧 → 1 最新 */
      if (!has) { px = sx; py = sy; has = true; continue; }
      const col = c.spectral[(i + head) % 12];
      ctx.strokeStyle = rampAt(col, 0.06 + 0.62 * t * t);
      ctx.lineWidth = (0.8 + 4.6 * t) * (0.6 + scale * 0.4);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      /* 第二重薄弱色散（轻微视差） */
      ctx.strokeStyle = rampAt(c.whiteRamp, 0.05 + 0.22 * t);
      ctx.lineWidth = 0.7 + 1.6 * t;
      ctx.beginPath();
      ctx.moveTo(px + 1.2, py - 1.2);
      ctx.lineTo(sx + 1.2, sy - 1.2);
      ctx.stroke();
      px = sx; py = sy;
    }
    ctx.restore();
  },

  /* -------------------- 骰面：钻石色散虹彩半透明切面 -------------------- */
  styleFace(info, state, helpers) {
    let out = info.out;
    if (!out) out = info.out = {};
    const c = prismSlot(state);
    const nx = info.nx || 0;
    const ny = info.ny || 0;
    let nd = info.lightDot;
    if (nd !== 0 && !nd) nd = 0.66;
    nd = nd < 0 ? -nd : nd;            /* 背面也保持通透感 */
    nd = nd > 1 ? 1 : nd;

    if (!c) {
      out.fill = rampAt(RAMP_WHITE, 0.22);
      out.stroke = rampAt(RAMP_WHITE, 0.6);
      out.highlight = rampAt(RAMP_WHITE, 0.9);
      out.alpha = 0.85;
      return out;
    }

    /* 法线半球 → 色相环：晶体各切面天然分光 */
    const ang = Math.atan2(ny, nx);              /* -PI..PI */
    let hueT = ang * 0.15915494 + 0.5;           /* /TAU + 0.5 */
    hueT += c.beamT < 2.2 ? 0.05 : 0;            /* 落定闪光期色相微移 */
    hueT -= Math.floor(hueT);
    let si = (hueT * 12) | 0;
    if (si < 0) si = 0; else if (si > 11) si = 11;
    const spec = c.spectral[si];
    const rgb = c.spectralRgb;

    out.fill = rampAt(spec, 0.30 + 0.44 * nd);          /* 色散主切面 */
    out.fillTop = rampAt(c.whiteRamp, 0.08 + 0.34 * nd); /* 顶部高光面 */
    out.fillBottom = rampAt(c.inkRamp, 0.26 + 0.34 * (1 - nd));
    out.stroke = rampAt(c.rimRamp, 0.48 + 0.40 * nd);
    out.highlight = rampAt(c.whiteRamp, 0.52 + 0.42 * nd * nd);
    out.shade = rampAt(c.inkRamp, 0.52 + 0.20 * (1 - nd));
    out.spec = rampAt(c.whiteRamp, 0.92);
    out.glow = rampAt(c.glowRamp, 0.28 + 0.44 * nd);
    out.rim = rampAt(c.rimRamp, 0.74);
    out.text = '#eafcff';
    out.alpha = 0.80 + 0.18 * nd;
    out.emissive = 0.16 + 0.30 * nd;
    out.r = rgb[si * 3];
    out.g = rgb[si * 3 + 1];
    out.b = rgb[si * 3 + 2];
    return out;
  },

  /* -------------------- 骰面叠层：内切刻面折线 + 焦散高光 -------------------- */
  drawFaceOverlay(ctx, cx, cy, radius, verts2D, vertCount, info, state) {
    const c = prismSlot(state);
    if (!c || !verts2D || vertCount < 3) return;
    const flat = typeof verts2D[0] === 'number' ? 1 : 0;
    let nd = info && info.lightDot ? info.lightDot : 0.6;
    if (nd > 1) nd = 1;

    /* 内切刻面折线（0.66R）+ 中心放射刻线 */
    strokeInsetPoly(ctx, cx, cy, verts2D, vertCount, flat, 0.66,
      radius > 12 ? radius * 0.055 : 0.7, rampAt(c.whiteRamp, 0.16 + 0.24 * nd));
    strokeCenterRays(ctx, cx, cy, verts2D, vertCount, flat, 0.66,
      radius > 12 ? radius * 0.032 : 0.5, rampAt(c.whiteRamp, 0.08 + 0.11 * nd));

    /* 焦散高光斑（跟随光照方向偏移） */
    const gx = cx + (info && info.nx ? info.nx : 0.35) * radius * 0.30;
    const gy = cy + (info && info.ny ? info.ny : -0.35) * radius * 0.30;
    fillGlintDot(ctx, gx, gy, radius * 0.16 > 1.1 ? radius * 0.16 : 1.1, rampAt(c.whiteRamp, 0.10 + 0.20 * nd));
  },

  /* -------------------- 前景：十字星芒镜头耀斑 + 极光光束 -------------------- */
  drawForeground(ctx, W, H, time, state, helpers) {
    const c = prismSlot(state);
    if (!c) return;
    const cx = W * 0.5, cy = H * 0.46;

    /* 极光天幕（落定特效） */
    if (c.beamT < 2.2) c.beamT += 1 / 60;
    if (c.beamT < 2.2) {
      const p = clamp01(c.beamT / 2.2);
      const fade = 1 - smoothstepN(0.55, 1, p);
      if (fade > 0.01) {
        ctx.globalCompositeOperation = 'lighter';
        if (c.beamKind === 3) {
          /* 冰晶黯淡裂纹 */
          ctx.strokeStyle = rampAt(c.crackRamp, 0.42 * fade);
          ctx.lineWidth = Math.max(1, W / 900);
          for (let k = 0; k < 7; k++) {
            const a0 = k * 0.897 + 0.3;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            let x = cx, y = cy;
            for (let s = 1; s <= 4; s++) {
              const len = (18 + s * 26) * (W / 1280);
              x += Math.cos(a0 + s * 0.22) * len;
              y += Math.sin(a0 + s * 0.22) * len * 0.8;
              ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        } else {
          /* 虹彩光束幕 */
          const beams = c.beamKind === 1 ? 9 : 6;
          for (let k = 0; k < beams; k++) {
            const a0 = (k / beams) * TAU + time * 0.16;
            const len = Math.min(W, H) * (0.34 + 0.20 * p);
            ctx.strokeStyle = rampAt(c.spectral[k % 12], 0.10 + 0.20 * fade);
            ctx.lineWidth = Math.max(2, W / 210) * (0.5 + 0.9 * fade);
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a0) * len * 1.5, cy + Math.sin(a0) * len);
            ctx.stroke();
          }
          /* 八芒星冕 */
          ctx.strokeStyle = rampAt(c.goldRamp, 0.30 * fade);
          ctx.lineWidth = Math.max(1.2, W / 800);
          for (let k = 0; k < 8; k++) {
            const a0 = (k / 8) * TAU - time * 0.05;
            const r0 = Math.min(W, H) * (0.20 + 0.10 * p);
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0 * 0.86);
            ctx.lineTo(cx + Math.cos(a0) * r0 * 1.22, cy + Math.sin(a0) * r0 * 1.05);
            ctx.stroke();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    /* 十字星芒镜头耀斑 */
    const flare = 0.34 + 0.30 * c.btHit + 0.20 * (1 - c.bt);
    if (c.flareGrad) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = clamp01(flare * 0.5);
      ctx.fillStyle = c.flareGrad;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    const fl = Math.min(W, H) * 0.10 * (0.6 + flare);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = rampAt(c.whiteRamp, 0.18 + 0.22 * flare);
    ctx.lineWidth = Math.max(0.8, W / 1400);
    ctx.beginPath();
    ctx.moveTo(cx - fl * 1.9, cy); ctx.lineTo(cx + fl * 1.9, cy);
    ctx.moveTo(cx, cy - fl * 1.35); ctx.lineTo(cx, cy + fl * 1.35);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  },

  hasActiveFX(state) {
    return !(state.settleTime >= 2.2);
  }
};

/* 小工具：给 onBounce 提供稳定的相位种子（无分配） */
/* ================================================================== *
 *                         T A V E R N
 * ================================================================== */

function createTavernCore() {
  return {
    tag: 'tavern',
    ready: false,
    W: 0, H: 0,
    gradCtx: null,
    octOuter: new Float32Array(16),
    octBand: new Float32Array(16),
    octVelvet: new Float32Array(16),
    rivets: new Float32Array(16 * 3),
    rivetCount: 16,
    grain: new Float32Array(14 * 2),
    damask: new Float32Array(48 * 3),
    shakeX: 0, shakeY: 0, shakeVX: 0, shakeVY: 0, energy: 0,
    plaqueT: 9, plaqueTier: -1, plaqueW: new Float32Array(5),
    crack: 0,
    spec: makeSpecRing(),
    /* 色阶 */
    woodRamp: buildRamp(120, 74, 40),
    woodDarkRamp: buildRamp(58, 33, 18),
    brassRamp: buildRamp(198, 158, 88),
    goldRamp: buildRamp(246, 208, 132),
    velvetRamp: buildRamp(19, 84, 60),
    velvetHiRamp: buildRamp(46, 132, 96),
    ivoryRamp: buildRamp(246, 238, 218),
    ivory2Ramp: buildRamp(232, 218, 190),
    amberRamp: buildRamp(214, 156, 74),
    amber2Ramp: buildRamp(178, 118, 52),
    creamRamp: buildRamp(255, 246, 226),
    shadowRamp: buildRamp(24, 14, 8),
    candleRamp: buildRamp(255, 186, 104),
    coinRamp: buildRamp(255, 214, 120),
    /* 缓存字符串 */
    fontPlaque: '700 20px "Georgia", "Songti SC", serif',
    fontPlaqueSm: '600 13px "Georgia", "Songti SC", serif',
    dash: [5, 7],
    bgGrad: null, velvetGrad: null, candleGrad: null, vigGrad: null
  };
}

function buildTavernGeometry(ctx, c, W, H) {
  const cx = W * 0.5, cy = H * 0.5;
  const rx = W * 0.5 - Math.max(6, W * 0.012);
  const ry = H * 0.5 - Math.max(6, H * 0.014);
  octagonInto(c.octOuter, cx, cy, rx, ry, TAU / 16);
  octagonInto(c.octBand, cx, cy, rx * 0.955, ry * 0.945, TAU / 16);
  octagonInto(c.octVelvet, cx, cy, rx * 0.865, ry * 0.845, TAU / 16);

  /* 铆钉：八角顶点 + 每边中点 */
  const riv = c.rivets;
  for (let k = 0; k < 8; k++) {
    const a = TAU / 16 + k * TAU / 8;
    const ax = cx + Math.cos(a) * rx * 0.905;
    const ay = cy + Math.sin(a) * ry * 0.895;
    riv[k * 6] = ax; riv[k * 6 + 1] = ay;
    riv[k * 6 + 2] = Math.max(2.2, Math.min(W, H) * 0.0055);
    const am = a + TAU / 16;
    riv[k * 6 + 3] = cx + Math.cos(am) * rx * 0.905;
    riv[k * 6 + 4] = cy + Math.sin(am) * ry * 0.895;
    riv[k * 6 + 5] = riv[k * 6 + 2] * 0.72;
  }
  c.rivetCount = 16;

  /* 木纹线 y 坐标 */
  const g = c.grain;
  prngReset(0x51f3a7);
  for (let i = 0; i < 14; i++) {
    g[i * 2] = prng() * 40 - 20;
    g[i * 2 + 1] = TAU / 16 + prng() * TAU / 8;
  }

  /* 丝绒暗纹（菱形网格点） */
  const d = c.damask;
  const cols = 8, rows = 6;
  let o = 0;
  for (let r = 0; r < rows; r++) {
    for (let cc = 0; cc < cols; cc++) {
      const fx = (cc + 0.5) / cols;
      const fy = (r + 0.5) / rows;
      d[o] = cx + (fx - 0.5) * rx * 1.55;
      d[o + 1] = cy + (fy - 0.5) * ry * 1.45;
      d[o + 2] = (Math.max(W, H) * 0.012) * (0.8 + prng() * 0.8);
      o += 3;
    }
  }
  c.W = W; c.H = H;
  buildTavernGradients(ctx, c, W, H);
}

function buildTavernGradients(ctx, c, W, H) {
  if (!ctx || typeof ctx.createLinearGradient !== 'function') { c.gradCtx = null; return; }
  const cx = W * 0.5, cy = H * 0.5;

  const wood = ctx.createLinearGradient(0, 0, W, H);
  wood.addColorStop(0, rampAt(buildRamp(146, 94, 52), 1));
  wood.addColorStop(0.35, rampAt(c.woodRamp, 1));
  wood.addColorStop(0.72, rampAt(buildRamp(104, 62, 34), 1));
  wood.addColorStop(1, rampAt(c.woodDarkRamp, 1));
  c.bgGrad = wood;

  const vel = ctx.createRadialGradient(cx, cy * 0.92, Math.min(W, H) * 0.05, cx, cy, Math.max(W, H) * 0.62);
  vel.addColorStop(0, rampAt(buildRamp(30, 118, 88), 1));
  vel.addColorStop(0.45, rampAt(c.velvetRamp, 1));
  vel.addColorStop(1, rampAt(buildRamp(9, 46, 34), 1));
  c.velvetGrad = vel;

  const cand = ctx.createRadialGradient(cx, -H * 0.10, Math.min(W, H) * 0.06, cx, -H * 0.10, Math.max(W, H) * 0.92);
  cand.addColorStop(0, rampAt(c.candleRamp, 0.34));
  cand.addColorStop(0.42, rampAt(buildRamp(255, 148, 70), 0.13));
  cand.addColorStop(1, rampAt(buildRamp(60, 24, 8), 0));
  c.candleGrad = cand;

  const vig = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.24, cx, cy, Math.max(W, H) * 0.74);
  vig.addColorStop(0, rampAt(c.shadowRamp, 0));
  vig.addColorStop(0.7, rampAt(c.shadowRamp, 0.16));
  vig.addColorStop(1, rampAt(c.shadowRamp, 0.72));
  c.vigGrad = vig;
  c.gradCtx = ctx;
}

function initTavern(ctx, W, H, state) {
  const custom = ensureCustom(state);
  let c = custom.tavern;
  if (!c || c.tag !== 'tavern') c = custom.tavern = createTavernCore();
  if (!c.ready || c.W !== W || c.H !== H) {
    buildTavernGeometry(ctx, c, W, H);
    c.ready = true;
  } else if (ctx && c.gradCtx !== ctx) {
    buildTavernGradients(ctx, c, W, H);
  }
  return c;
}
function tavernSlot(state) {
  const custom = state.custom;
  if (!custom || typeof custom !== 'object') return null;
  const c = custom.tavern;
  return c && c.ready ? c : null;
}

/* ---------------------------- tavern style -------------------------- */
const tavernStyle = {
  id: 'tavern',
  name: '酒馆橡木绒盘',
  subtitle: 'Oak & Velvet Tavern Tray',
  badge: '🕯 烛影余温',
  desc: '八角胡桃木托盘、拉丝黄铜包角铆钉与祖母绿丝绒内衬。骰子撞击带动托盘微震，落定后黄铜铭牌缓缓滑出。',
  accent: '#d0a35a',
  bgPreview: 'radial-gradient(120% 120% at 50% 30%, #2f7a5c 0%, #1a4a38 42%, #4a2f18 78%, #2a1a0e 100%)',
  soundPreset: 'tavern',

  timeScale() { return 1; },

  init(ctx, W, H, state) { initTavern(ctx, W, H, state); },

  /* -------------------- 背景：木框 + 铆钉 + 丝绒 + 烛光 -------------------- */
  drawBackground(ctx, W, H, time, state, helpers) {
    const c = initTavern(ctx, W, H, state);
    /* 托盘震动阻尼（每帧一次，两个方向独立） */
    c.shakeVX += -c.shakeX * 0.30;
    c.shakeVY += -c.shakeY * 0.30;
    c.shakeVX *= 0.84; c.shakeVY *= 0.84;
    c.shakeX += c.shakeVX; c.shakeY += c.shakeVY;
    if (c.shakeX < 0.02 && c.shakeX > -0.02) c.shakeX = 0;
    if (c.shakeY < 0.02 && c.shakeY > -0.02) c.shakeY = 0;

    ctx.save();
    ctx.translate(c.shakeX, c.shakeY);

    /* 桌面木框底 */
    ctx.fillStyle = rampAt(c.woodDarkRamp, 1);
    ctx.fillRect(-8, -8, W + 16, H + 16);

    /* 八角胡桃木外框 */
    if (c.bgGrad) ctx.fillStyle = c.bgGrad;
    drawPolyPath(ctx, c.octOuter, 8);
    ctx.fill();

    /* 木纹（细弧线，克制） */
    const g = c.grain;
    ctx.lineWidth = Math.max(0.6, W / 1800);
    for (let i = 0; i < 14; i++) {
      const off = g[i * 2] * (W / 1280);
      ctx.strokeStyle = rampAt(c.woodDarkRamp, 0.10 + 0.10 * (0.5 + 0.5 * Math.sin(i * 2.1)));
      ctx.beginPath();
      ctx.moveTo(-W * 0.02, H * 0.12 + i * H * 0.056 + off);
      ctx.quadraticCurveTo(W * 0.5, H * 0.10 + i * H * 0.058 + off * 1.7, W * 1.02, H * 0.13 + i * H * 0.055 + off);
      ctx.stroke();
    }

    /* 祖母绿丝绒内衬 */
    if (c.velvetGrad) ctx.fillStyle = c.velvetGrad;
    drawPolyPath(ctx, c.octVelvet, 8);
    ctx.fill();

    /* 丝绒暗纹菱形 */
    const d = c.damask;
    ctx.lineWidth = Math.max(0.5, W / 2000);
    for (let i = 0; i < d.length; i += 3) {
      const s = d[i + 2];
      ctx.strokeStyle = rampAt(c.velvetHiRamp, 0.05 + 0.045 * (0.5 + 0.5 * Math.sin(time * 0.7 + i)));
      ctx.beginPath();
      ctx.moveTo(d[i], d[i + 1] - s * 0.5);
      ctx.lineTo(d[i] + s, d[i + 1]);
      ctx.lineTo(d[i], d[i + 1] + s * 0.5);
      ctx.lineTo(d[i] - s, d[i + 1]);
      ctx.closePath();
      ctx.stroke();
    }

    /* 黄铜包边（双层：亮面 + 暗面倒角） */
    drawPolyPath(ctx, c.octBand, 8);
    ctx.lineWidth = Math.max(3, Math.min(W, H) * 0.012);
    ctx.strokeStyle = rampAt(c.brassRamp, 0.92);
    ctx.stroke();
    drawPolyPath(ctx, c.octBand, 8);
    ctx.lineWidth = Math.max(1, Math.min(W, H) * 0.0035);
    ctx.strokeStyle = rampAt(c.goldRamp, 0.55);
    ctx.stroke();

    /* 包角铆钉 */
    const riv = c.rivets;
    for (let k = 0; k < 8; k++) {
      const b = k * 6;
      for (let j = 0; j < 2; j++) {
        const x = riv[b + j * 3];
        const y = riv[b + j * 3 + 1];
        const r = riv[b + j * 3 + 2];
        ctx.fillStyle = rampAt(c.brassRamp, 1);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = rampAt(c.creamRamp, 0.42 + 0.16 * (0.5 + 0.5 * Math.sin(time * 1.3 + k)));
        ctx.beginPath();
        ctx.arc(x - r * 0.28, y - r * 0.32, r * 0.44, 0, TAU);
        ctx.fill();
      }
    }

    ctx.restore();

    /* 烛火暖光漫反射渐晕（不随震动位移，守住真实光照感） */
    if (c.candleGrad) {
      const flick = 0.82 + 0.18 * Math.sin(time * 5.3) * Math.sin(time * 1.7 + 1.1);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55 * flick;
      ctx.fillStyle = c.candleGrad;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (c.vigGrad) {
      ctx.fillStyle = c.vigGrad;
      ctx.fillRect(0, 0, W, H);
    }
  },

  /* -------------------- 撞击：暖金微尘 + 托盘微震 -------------------- */
  onBounce(impact, state, helpers) {
    const c = tavernSlot(state);
    if (!c) return;
    const s = clampN(impact && impact.strength ? impact.strength : 0.5, 0.05, 2.4);
    c.energy += s * 0.55;
    if (c.energy > 3) c.energy = 3;
    const dir = (c.energy % 2 < 1) ? 1 : -1;
    c.shakeVX += dir * s * 2.6;
    c.shakeVY += (prng() - 0.5) * s * 3.2;

    if (!helpers || typeof helpers.spawnParticle !== 'function') return;
    const ix = impact && impact.x ? impact.x : 0;
    const iy = impact && impact.y ? impact.y : 0;
    const iz = impact && impact.z ? impact.z : 4;
    const n = 2 + ((s * 5) | 0);
    const cap = n > 12 ? 12 : n;
    for (let i = 0; i < cap; i++) {
      const ang = prng() * TAU;
      const spd = 12 + prng() * 46 * (0.4 + s * 0.5);
      const p = takeSpec(c.spec);
      p.x = ix + (prng() - 0.5) * 10;
      p.y = iy + (prng() - 0.5) * 10;
      p.z = iz;
      p.vx = Math.cos(ang) * spd;
      p.vy = Math.sin(ang) * spd * 0.7;
      p.vz = 26 + prng() * 58;
      p.size = 1.6 + prng() * 2.4;
      p.endSize = 0.3;
      p.life = 0.42 + prng() * 0.34;
      p.r = 255; p.g = 208 + ((prng() * 30) | 0); p.b = 148;
      p.a = 0.62;
      p.gravity = -120;
      p.drag = 1.9;
      p.blend = 'lighter';
      p.shape = 'dot';
      helpers.spawnParticle(p);
    }
  },

  /* -------------------- 落定：黄铜铭牌滑出 -------------------- */
  onSettle(outcome, state, helpers) {
    const c = tavernSlot(state);
    if (!c) return;
    const tier = outcome && outcome.tier ? outcome.tier : 'success';
    const ti = tierIndex(tier);
    c.plaqueT = 0;
    c.plaqueTier = ti < 0 ? 1 : ti;
    if (tier === 'critical' && helpers && typeof helpers.spawnParticle === 'function') {
      /* 金币星火 */
      for (let i = 0; i < 16; i++) {
        const ang = -Math.PI * 0.5 + (prng() - 0.5) * 1.9;
        const spd = 70 + prng() * 130;
        const p = takeSpec(c.spec);
        p.x = (prng() - 0.5) * 60;
        p.y = (prng() - 0.5) * 30;
        p.z = 24;
        p.vx = Math.cos(ang) * spd;
        p.vy = Math.sin(ang) * spd;
        p.vz = 120 + prng() * 110;
        p.size = 3.4 + prng() * 3.2;
        p.endSize = 0.4;
        p.life = 0.9 + prng() * 0.5;
        p.r = 255; p.g = 214; p.b = 120;
        p.a = 0.9;
        p.gravity = -300;
        p.drag = 0.9;
        p.blend = 'lighter';
        p.shape = 'coin';
        helpers.spawnParticle(p);
      }
      if (typeof helpers.spawnShockwave === 'function') {
        helpers.spawnShockwave(0, 0, 96, 0.6, rampAt(c.goldRamp, 0.5), 2);
      }
    } else if (tier === 'fumble') {
      c.crack = 1;
    }
  },

  /* -------------------- 拖尾：克制柔和的丝绒空气残影 -------------------- */
  drawDieTrail(ctx, die, time, state, helpers) {
    const c = tavernSlot(state);
    if (!c || !die || !helpers || typeof helpers.project !== 'function') return;
    const tx = die.trailX, ty = die.trailY, tz = die.trailZ;
    if (!tx || !ty || !tz || typeof tx !== 'object' || typeof ty !== 'object' || typeof tz !== 'object') return;
    const count = die.trailCount | 0;
    if (count < 2) return;
    const n = count > 16 ? 16 : count;
    const head = die.trailHead | 0;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = 'source-over';
    let px = 0, py = 0, has = false;
    for (let i = n - 1; i >= 0; i--) {
      let idx = (head - i) % TRAIL_LEN;
      if (idx < 0) idx += TRAIL_LEN;
      const { sx, sy, scale } = helpers.project(tx[idx], ty[idx], tz[idx]);
      const t = 1 - i / n;
      if (!has) { px = sx; py = sy; has = true; continue; }
      ctx.strokeStyle = rampAt(c.ivoryRamp, 0.03 + 0.13 * t * t);
      ctx.lineWidth = (1.2 + 4.2 * t) * (0.55 + scale * 0.45);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      px = sx; py = sy;
    }
    ctx.restore();
  },

  /* -------------------- 骰面：温润象牙骨瓷 / 琥珀鎏金 -------------------- */
  styleFace(info, state, helpers) {
    let out = info.out;
    if (!out) out = info.out = {};
    const c = tavernSlot(state);
    let nd = info.lightDot;
    if (!nd && nd !== 0) nd = 0.55;
    nd = nd < 0 ? 0 : nd > 1 ? 1 : nd;
    const v = info.faceValue | 0;
    const idx = info.index | 0;

    if (!c) {
      out.fill = rampAt(RAMP_WHITE, 0.72);
      out.stroke = rampAt(RAMP_WHITE, 0.9);
      out.alpha = 0.95;
      return out;
    }

    /* 高面值走琥珀鎏金，低面值走温润象牙骨瓷 */
    const maxSides = info.sides | 0 || 6;
    const gold = v > maxSides * 0.75 || (v === maxSides);
    const alt = ((v ^ idx) & 1) === 0;
    if (gold) {
      out.fill = rampAt(alt ? c.amberRamp : c.amber2Ramp, 0.72 + 0.22 * nd);
      out.fillTop = rampAt(c.goldRamp, 0.34 + 0.32 * nd);
      out.fillBottom = rampAt(c.woodDarkRamp, 0.28 + 0.24 * (1 - nd));
      out.stroke = rampAt(c.brassRamp, 0.85);
      out.highlight = rampAt(c.creamRamp, 0.46 + 0.34 * nd);
      out.text = '#2b1a08';
      out.glow = rampAt(c.candleRamp, 0.20 + 0.28 * nd);
    } else {
      out.fill = rampAt(alt ? c.ivoryRamp : c.ivory2Ramp, 0.86 + 0.12 * nd);
      out.fillTop = rampAt(c.creamRamp, 0.62 + 0.30 * nd);
      out.fillBottom = rampAt(c.shadowRamp, 0.12 + 0.16 * (1 - nd));
      out.stroke = rampAt(c.brassRamp, 0.55 + 0.25 * nd);
      out.highlight = rampAt(c.creamRamp, 0.55 + 0.30 * nd);
      out.text = '#3a2412';
      out.glow = rampAt(c.candleRamp, 0.08 + 0.16 * nd);
    }
    out.spec = rampAt(c.creamRamp, 0.86);
    out.shade = rampAt(c.shadowRamp, 0.20 + 0.18 * (1 - nd));
    out.rim = rampAt(c.brassRamp, 0.78);
    out.alpha = 0.94 + 0.06 * nd;
    out.emissive = 0.05 + 0.14 * nd;
    return out;
  },

  /* -------------------- 骰面叠层：复古黄铜镶边倒角高光 -------------------- */
  drawFaceOverlay(ctx, cx, cy, radius, verts2D, vertCount, info, state) {
    const c = tavernSlot(state);
    if (!c || !verts2D || vertCount < 3) return;
    const flat = typeof verts2D[0] === 'number' ? 1 : 0;
    let nd = info && info.lightDot ? info.lightDot : 0.55;
    if (nd > 1) nd = 1;
    const big = radius > 12;

    /* 黄铜镶边（外圈暗、内圈亮 → 倒角感） */
    strokeInsetPoly(ctx, cx, cy, verts2D, vertCount, flat, 0.86,
      big ? radius * 0.10 : 1, rampAt(c.brassRamp, 0.42 + 0.28 * nd));
    strokeInsetPoly(ctx, cx, cy, verts2D, vertCount, flat, 0.72,
      big ? radius * 0.045 : 0.7, rampAt(c.goldRamp, 0.30 + 0.26 * nd));

    /* 左上倒角高光弧 / 右下暗倒角 */
    strokeBevelArc(ctx, cx - radius * 0.30, cy - radius * 0.30, radius * 0.86, 3.330, 5.403,
      big ? radius * 0.055 : 0.9, rampAt(c.creamRamp, 0.26 + 0.34 * nd));
    strokeBevelArc(ctx, cx + radius * 0.24, cy + radius * 0.26, radius * 0.86, 0.188, 1.948,
      big ? radius * 0.05 : 0.9, rampAt(c.shadowRamp, 0.22 + 0.14 * (1 - nd)));
  },

  /* -------------------- 前景：黄铜铭牌滑出 + 烛光暗角 -------------------- */
  drawForeground(ctx, W, H, time, state, helpers) {
    const c = tavernSlot(state);
    if (!c) return;
    const cx = W * 0.5;

    /* 暖色暗角 + 上方烛光呼吸 */
    if (c.vigGrad) {
      ctx.fillStyle = c.vigGrad;
      ctx.fillRect(0, 0, W, H);
    }
    if (c.candleGrad) {
      const flick = 0.5 + 0.5 * Math.sin(time * 4.1 + 0.4);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.10 + 0.10 * flick;
      ctx.fillStyle = c.candleGrad;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    /* 黄铜角标光泽 */
    const rvx = (W * 0.5 - Math.max(6, W * 0.012)) * 0.905;
    const rvy = (H * 0.5 - Math.max(6, H * 0.014)) * 0.895;
    const glint = 0.30 + 0.22 * Math.sin(time * 1.6);
    ctx.lineWidth = Math.max(1, W / 1100);
    ctx.strokeStyle = rampAt(c.goldRamp, 0.14 + 0.16 * glint);
    for (let k = 0; k < 8; k++) {
      const a = TAU / 16 + k * TAU / 8;
      const x = W * 0.5 + Math.cos(a) * rvx;
      const y = H * 0.5 + Math.sin(a) * rvy;
      ctx.beginPath();
      ctx.moveTo(x - 9, y);
      ctx.lineTo(x + 9, y);
      ctx.moveTo(x, y - 9);
      ctx.lineTo(x, y + 9);
      ctx.stroke();
    }

    /* 铭牌滑出 */
    if (c.plaqueT < 2.4) {
      c.plaqueT += 1 / 60;
      const ti = c.plaqueTier;
      if (ti >= 0 && ti < 5) {
        const p = clamp01(c.plaqueT / 0.55);          /* 滑入 0→1 */
        const fade = 1 - smoothstepN(1.5, 2.4, c.plaqueT);
        const ease = 1 - (1 - p) * (1 - p) * (1 - p);
        if (fade > 0.01) {
          const label = TIER_LABELS[ti];
          const tag = TIER_TAG[ti];
          const pw = 210 + (ti === 0 ? 34 : 0);
          const ph = 58;
          const bottom = (state && state.plaqueAtBottom) ? H - 78 : 78;
          const x = cx - pw * 0.5;
          const y = bottom - ph * 0.5 + (1 - ease) * -16 * (bottom < H * 0.5 ? -1 : 1);
          ctx.globalAlpha = clamp01(p * 1.2) * fade;
          /* 铭牌底：深木 + 黄铜双框 */
          ctx.fillStyle = rampAt(c.woodDarkRamp, 0.92);
          roundRectPath(ctx, x, y, pw, ph, 7);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = rampAt(c.brassRamp, 0.9);
          ctx.stroke();
          roundRectPath(ctx, x + 4, y + 4, pw - 8, ph - 8, 5);
          ctx.lineWidth = 0.9;
          ctx.strokeStyle = rampAt(c.goldRamp, 0.45);
          ctx.stroke();
          /* 文字（字符串与字号均在 init 期缓存） */
          ctx.font = c.fontPlaque;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = rampAt(c.goldRamp, 1);
          ctx.fillText(label, cx, y + ph * 0.42);
          ctx.font = c.fontPlaqueSm;
          ctx.fillStyle = rampAt(c.candleRamp, 0.72);
          ctx.fillText(tag, cx, y + ph * 0.74);
          ctx.globalAlpha = 1;
        }
      }
    }
  },

  hasActiveFX(state) {
    return !(state.settleTime >= 2.2);
  }
};

/* ===================================================================== *
 * 导出
 * ===================================================================== */
export { prismStyle, tavernStyle };
export const STYLES = [prismStyle, tavernStyle];
export default STYLES;

