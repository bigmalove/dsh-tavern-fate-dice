// ============================================================================
// demo/gl-shaders.js — 原生 WebGL2 (#version 300 es) HDR 着色器套件
// 包含：
// 1. Ray-Plane 3D 程序化舞台着色器（6大主题：星穹星盘 / 时停极光焦散 / 焚天熔岩铁砧 /
//    赛博全息视界 / 宣纸远山水墨晕染 / 黑洞引力透镜奇点 + 实时软接触阴影 + 落地能量涟漪）
// 2. 圆润倒角 + 4通道凹凸雕文 + PBR / 次表面玉石散射 / 内部星云岩浆视差 / 光谱色散 多面体着色器
// 3. 3D 能量丝带与书法飞白/弧形剑气着色器 + 速度拉伸动态模糊火星与冲天光柱着色器
// 4. Dual-Kawase 多级 HDR 辉光 (Bloom) + 屏幕空间冲击波透镜折射 + ACES 电影级色调映射
// ============================================================================

export const FULLSCREEN_VERT = `#version 300 es
precision highp float;
out vec2 v_uv;
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`

export const ARENA_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform mat4 u_invViewProj;
uniform vec3 u_camPos;
uniform float u_time;
uniform int u_theme;       // 0:astral 1:prism 2:inferno 3:cyber 4:jianxin 5:singularity
uniform int u_tier;        // 0:normal 1:critical 2:success 3:costly 4:failure 5:fumble
uniform float u_climax;    // 0..1 落定高潮强度
uniform float u_charge;    // 0..1 按住蓄力旋涡强度
uniform int u_diceCount;
uniform vec4 u_diceSpheres[24]; // xyz, radius
uniform vec4 u_impacts[8];      // x, y, age, strength (strength<=0 inactive)

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * noise2(p);
    p = rot * p * 2.03;
    a *= 0.5;
  }
  return v;
}

// 返回 vec2(d1: 最近点距离, d2 - d1: 精确多边形裂隙边界距离！0 即在晶界裂纹正中心)
vec2 voronoiEdge(vec2 x, float animSpeed) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float d1 = 8.0;
  float d2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(hash21(n + g), hash21(n + g + 17.3));
      o = 0.5 + 0.42 * sin(u_time * animSpeed + TAU * o);
      vec2 r = g + o - f;
      float d = length(r);
      if (d < d1) {
        d2 = d1;
        d1 = d;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  return vec2(d1, d2 - d1);
}

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

// 黄金秘法星盘精细蚀刻几何环函数
float astrolabePattern(vec2 p, float rotSpeed, float scale) {
  vec2 q = rot2(u_time * rotSpeed) * (p * scale);
  float r = length(q);
  float a = atan(q.y, q.x);
  float aa = max(0.0045, fwidth(r) * 1.35);
  float rings = smoothstep(aa, 0.0, abs(r - 1.0))
              + smoothstep(aa * 0.85, 0.0, abs(r - 0.91))
              + smoothstep(aa * 0.9, 0.0, abs(r - 0.66))
              + smoothstep(aa * 0.75, 0.0, abs(r - 0.38));
  // 十二星宫精密刻度齿
  float ticks = 0.0;
  if (r > 0.91 && r < 1.0) {
    ticks = smoothstep(0.14, 0.0, abs(sin(a * 36.0))) * 0.75;
  }
  // 神圣六芒星阵（两组正反交错正三角形极坐标方程）
  float triA = 0.48 / max(0.35, cos(mod(a + PI / 3.0, TAU / 3.0) - PI / 3.0));
  float triB = 0.48 / max(0.35, cos(mod(a + PI + PI / 3.0, TAU / 3.0) - PI / 3.0));
  float hexagram = smoothstep(aa * 1.2, 0.0, abs(r - triA)) * step(r, 0.92)
                 + smoothstep(aa * 1.2, 0.0, abs(r - triB)) * step(r, 0.92);
  // 星轨符文虚线环
  float glyphs = 0.0;
  if (r > 0.70 && r < 0.87) {
    float seg = abs(fract(a * 12.0 / TAU) - 0.5);
    glyphs = smoothstep(0.18, 0.08, seg) * smoothstep(aa * 1.1, 0.0, abs(r - 0.785)) * 0.85;
  }
  return rings + ticks + hexagram * 0.9 + glyphs;
}

void main() {
  vec2 ndc = v_uv * 2.0 - 1.0;
  vec4 nearH = u_invViewProj * vec4(ndc, -1.0, 1.0);
  vec4 farH  = u_invViewProj * vec4(ndc,  1.0, 1.0);
  vec3 pNear = nearH.xyz / nearH.w;
  vec3 pFar  = farH.xyz / farH.w;
  vec3 rayDir = normalize(pFar - pNear);

  vec3 col = vec3(0.015, 0.018, 0.03);

  // 求与桌面 z = 0 的精确三维交点
  if (rayDir.z < -0.001) {
    float tHit = -u_camPos.z / rayDir.z;
    vec3 hit = u_camPos + rayDir * tHit;
    vec2 p = hit.xy * 0.0038; // 归一化舞台坐标（半径 ~1.0 对应 ~260 世界单位）
    float rad = length(p);
    float distFade = exp(-rad * rad * 0.42);

    // 1. 六大主题程序化 3D 台面材质（带真实深度视差层！）
    if (u_theme == 0) {
      // [0] 星穹秘法·天命司南：三层深度视差黄金星盘 + 曜石星云深渊
      vec2 pDeep1 = (u_camPos + rayDir * ((-46.0 - u_camPos.z) / rayDir.z)).xy * 0.0034;
      vec2 pDeep2 = (u_camPos + rayDir * ((-105.0 - u_camPos.z) / rayDir.z)).xy * 0.0029;
      float neb = fbm(pDeep2 * 2.8 + vec2(u_time * 0.04, -u_time * 0.03));
      col = mix(vec3(0.008, 0.007, 0.022), vec3(0.055, 0.025, 0.12), neb * distFade);

      // 细密圆润深空星辰点（基于格内局部圆心距离，杜绝方块像素感）
      vec2 starGrid = pDeep2 * 78.0;
      float starSeed = hash21(floor(starGrid));
      if (starSeed > 0.965) {
        float sd = length(fract(starGrid) - 0.5);
        float twinkle = 0.45 + 0.55 * sin(u_time * 3.2 + starSeed * 90.0);
        col += vec3(1.5, 1.3, 1.9) * smoothstep(0.18, 0.0, sd) * twinkle * distFade;
      }

      float boost = 1.0 + u_climax * (u_tier == 1 ? 1.35 : 0.45) + u_charge * 1.2;
      float layer0 = astrolabePattern(p, 0.13 * boost, 1.02);
      float layer1 = astrolabePattern(pDeep1, -0.21 * boost, 1.18) * 0.48;
      float layer2 = astrolabePattern(pDeep2, 0.09 * boost, 1.36) * 0.26;

      vec3 goldCol = u_tier == 5
        ? vec3(1.25, 0.20, 1.95)
        : vec3(1.38, 0.92, 0.28); // 克制丝滑金线，凸显前景黑曜鎏金骰子主体！
      col += goldCol * (layer0 + layer1 + layer2) * distFade * (0.48 + 0.36 * boost);

      if (u_charge > 0.01) {
        float vortex = smoothstep(0.55, 0.0, rad) * (sin(rad * 28.0 - u_time * 14.0) * 0.5 + 0.5);
        col += vec3(2.2, 1.45, 0.5) * vortex * smoothstep(0.65, 0.0, rad) * u_charge;
      }
    } else if (u_theme == 1) {
      // [1] 时停棱镜·碎星圣晶：深海极光镜湖 + 锐利双层 Voronoi 晶界焦散光网！
      float n1 = fbm(p * 2.2 + vec2(0.0, u_time * 0.12));
      vec3 aurora = mix(vec3(0.02, 0.14, 0.32), vec3(0.10, 0.38, 0.42), sin(p.x * 3.0 + n1 * 4.0 + u_time * 0.4) * 0.5 + 0.5);
      col = vec3(0.006, 0.012, 0.028) + aurora * 0.42 * distFade;

      vec2 ve1 = voronoiEdge(p * 3.8 + vec2(u_time * 0.06, -u_time * 0.04), 0.85);
      vec2 ve2 = voronoiEdge(p * 6.4 - vec2(u_time * 0.05, u_time * 0.07), 1.15);
      float caus1 = smoothstep(0.085, 0.0, ve1.y);
      float caus2 = smoothstep(0.065, 0.0, ve2.y) * 0.45;
      col += vec3(0.45, 1.55, 2.35) * (caus1 + caus2) * 0.88 * distFade;

      float ring = smoothstep(0.009, 0.0, abs(rad - 0.95));
      col += vec3(0.7, 1.7, 2.5) * ring * distFade;
    } else if (u_theme == 2) {
      // [2] 焚天熔炉·孤注一掷：玄武岩多边形龟裂板块 + 地底涌动炽金岩浆裂脉！
      vec2 pLava = (u_camPos + rayDir * ((-26.0 - u_camPos.z) / rayDir.z)).xy * 0.004;
      vec2 warp = vec2(fbm(p * 4.5), fbm(p * 4.5 + 9.2)) * 0.18;
      vec2 ve = voronoiEdge(p * 3.2 + warp, 0.22);

      float rock = fbm(p * 6.5);
      col = mix(vec3(0.018, 0.012, 0.011), vec3(0.052, 0.036, 0.030), rock);
      // 岩石边缘受热暗红过渡 + 缝隙中心炽白金黄岩浆！
      float crackGlow = smoothstep(0.13, 0.015, ve.y);
      float crackCore = smoothstep(0.032, 0.003, ve.y);
      float magmaFlow = fbm(pLava * 4.2 + vec2(u_time * 0.28, -u_time * 0.20));
      vec3 lavaHDR = mix(vec3(1.85, 0.24, 0.02), vec3(4.2, 1.95, 0.28), magmaFlow * 0.6 + crackCore * 0.5);
      col += lavaHDR * (crackGlow * 0.55 + crackCore * 0.95) * distFade * (0.65 + 0.65 * u_climax + u_charge);

      float anvilRim = smoothstep(0.011, 0.0, abs(max(abs(p.x) * 0.82, abs(p.y)) - 0.90));
      col += vec3(2.1, 0.65, 0.10) * anvilRim * distFade;
    } else if (u_theme == 3) {
      // [3] 赛博超频·霓虹矩阵：全息透视网格 + 脉冲扫描波
      col = vec3(0.010, 0.007, 0.028);
      vec2 gp = hit.xy / 38.0;
      vec2 grid = abs(fract(gp - 0.5) - 0.5) / fwidth(gp);
      float line = 1.0 - min(min(grid.x, grid.y), 1.0);
      float scan = exp(-abs(rad - fract(u_time * 0.38) * 1.6) * 14.0);
      vec3 neon = mix(vec3(0.0, 1.75, 2.25), vec3(2.25, 0.15, 1.45), smoothstep(-0.8, 0.8, p.y));
      col += neon * line * (0.30 + scan * 1.35) * distFade;
      float oct = max(max(abs(p.x), abs(p.y)), (abs(p.x) + abs(p.y)) * 0.7071);
      col += vec3(2.3, 0.2, 1.5) * smoothstep(0.011, 0.0, abs(oct - 0.96)) * distFade;
    } else if (u_theme == 4) {
      // [4] 水墨剑心·太虚玉简：古宣远山云海 + 中央温润苍青端砚圆盘衬托羊脂白玉骰！
      float paperFiber = fbm(p * 14.0) * 0.055 + fbm(p * 3.2) * 0.085;
      vec3 xuan = vec3(0.74, 0.70, 0.62) - paperFiber;
      float m1 = smoothstep(0.12, -0.22, p.y + 0.50 + 0.16 * fbm(vec2(p.x * 2.5, 1.2)));
      float m2 = smoothstep(0.08, -0.18, p.y + 0.30 + 0.12 * fbm(vec2(p.x * 3.8 + 4.0, 2.5)));
      xuan = mix(xuan, vec3(0.40, 0.42, 0.42), m1 * 0.52);
      xuan = mix(xuan, vec3(0.22, 0.25, 0.27), m2 * 0.42);

      // 中央淡墨砚台圆韵与书法枯笔圆环，让白玉鎏金骰子对比鲜明！
      float inkWash = smoothstep(0.86, 0.15, rad + 0.06 * fbm(p * 4.5));
      xuan = mix(xuan, vec3(0.50, 0.49, 0.45), inkWash * 0.35);
      float brushRing = smoothstep(0.024, 0.002, abs(rad - 0.84 + 0.022 * fbm(p * 6.5 + u_time * 0.15)));
      xuan = mix(xuan, vec3(0.08, 0.09, 0.11), brushRing * 0.75);
      xuan *= mix(0.38, 1.0, distFade);
      col = xuan;
    } else {
      // [5] 虚空星噬·克苏鲁奇点：黑洞吸积盘引力透镜旋涡！
      float rSafe = max(rad, 0.04);
      float twist = 2.6 / (rSafe + 0.18) - u_time * 0.85;
      vec2 swirled = rot2(twist) * p;
      float disk = fbm(swirled * 3.6);
      float horizon = smoothstep(0.16, 0.24, rad);
      float photonRing = exp(-abs(rad - 0.19) * 32.0);
      vec3 plasma = mix(vec3(0.12, 1.85, 1.45), vec3(1.45, 0.25, 2.35), disk);
      col = plasma * disk * smoothstep(1.35, 0.18, rad) * horizon * 0.85;
      col += vec3(1.8, 2.8, 2.5) * photonRing * 1.6;
      // 异界七芒几何虚线
      float a7 = atan(p.y, p.x);
      float sigil = smoothstep(0.012, 0.0, abs(rad - (0.72 + 0.12 * cos(a7 * 7.0 - u_time * 0.5))));
      col += vec3(0.3, 1.9, 1.5) * sigil * 0.45 * distFade;
    }

    // 2. 落地能量涟漪 / 熔岩灼痕 / 水墨晕染贴花（支持最多 8 处并发撞击！）
    for (int i = 0; i < 8; i++) {
      vec4 imp = u_impacts[i];
      if (imp.w <= 0.001) continue;
      float age = imp.z;
      float life = u_theme == 4 ? 2.4 : 1.15;
      if (age > life) continue;
      float prog = age / life;
      vec2 dVec = hit.xy - imp.xy;
      float dist = length(dVec);

      if (u_theme == 4) {
        // 水墨剑心：宣纸有机分形墨晕扩散！
        float maxR = (28.0 + imp.w * 56.0) * (0.35 + 0.65 * (1.0 - pow(1.0 - prog, 3.0)));
        float nEdge = fbm(dVec * 0.055 + float(i) * 3.1) * 18.0;
        float blot = smoothstep(maxR, maxR * 0.45, dist + nEdge - 8.0);
        float fade = (1.0 - smoothstep(0.55, 1.0, prog)) * 0.62 * imp.w;
        col = mix(col, vec3(0.06, 0.07, 0.09), blot * fade);
      } else if (u_theme == 2) {
        // 焚天熔炉：炽热放射状熔岩裂痕！
        float ang = atan(dVec.y, dVec.x);
        float rays = pow(abs(cos(ang * 5.0 + float(i) * 2.1)), 14.0);
        float reach = (35.0 + imp.w * 85.0) * smoothstep(0.0, 0.15, prog);
        float scorch = rays * smoothstep(reach, 0.0, dist) * (1.0 - prog);
        col += vec3(4.5, 1.4, 0.15) * scorch * imp.w * 1.8;
      } else {
        // 秘法/棱镜/赛博/虚空：高精度双环能量冲击波
        float ringR = (18.0 + prog * (95.0 + imp.w * 75.0));
        float w = 3.5 + prog * 6.0;
        float wave = exp(-abs(dist - ringR) / w) * (1.0 - prog) * imp.w;
        vec3 rCol = u_theme == 0 ? vec3(2.8, 1.85, 0.55)
                  : u_theme == 1 ? vec3(0.8, 2.2, 3.0)
                  : u_theme == 3 ? vec3(0.2, 2.6, 2.8)
                                 : vec3(0.4, 2.4, 1.9);
        col += rCol * wave * 1.35;
      }
    }

    // 3. 真实三维多面体软接触阴影 (Ambient Occlusion) + 底部彩色漫反射发光 (Bounce GI)！
    float shadow = 1.0;
    vec3 bounceGI = vec3(0.0);
    vec3 lightDir = normalize(vec3(-0.35, -0.42, 0.84));
    for (int i = 0; i < 24; i++) {
      if (i >= u_diceCount) break;
      vec4 sp = u_diceSpheres[i];
      // 沿逆光方向投射偏移阴影中心
      float h = max(0.0, sp.z - sp.w * 0.65);
      vec2 shCenter = sp.xy - lightDir.xy * (h * 0.55);
      float shRadius = sp.w * (0.95 + h * 0.008);
      float d = length(hit.xy - shCenter);
      float occ = smoothstep(shRadius * 1.28, shRadius * 0.25, d) * exp(-h * 0.011);
      shadow *= (1.0 - occ * (u_theme == 4 ? 0.48 : 0.76));

      // 骰子自身能量向桌面投射的近场点光源漫反射！
      float dDirect = length(vec3(hit.xy - sp.xy, sp.z));
      float giAtten = (sp.w * sp.w) / (dDirect * dDirect + sp.w * sp.w * 0.8);
      vec3 giTint = u_theme == 0 ? vec3(1.4, 0.9, 0.25)
                  : u_theme == 1 ? vec3(0.4, 1.3, 1.9)
                  : u_theme == 2 ? vec3(2.2, 0.55, 0.08)
                  : u_theme == 3 ? vec3(0.1, 1.5, 1.8)
                  : u_theme == 4 ? vec3(0.8, 0.15, 0.12)
                                 : vec3(0.3, 1.5, 1.2);
      bounceGI += giTint * giAtten * (0.28 + 0.65 * u_climax);
    }

    col = col * shadow + bounceGI * (u_theme == 4 ? 0.18 : 0.45);
  } else {
    // 远景天穹微光渐变
    float skyH = clamp(rayDir.z * 3.0, 0.0, 1.0);
    col = u_theme == 4
      ? mix(vec3(0.58, 0.56, 0.52), vec3(0.32, 0.34, 0.36), skyH)
      : mix(vec3(0.04, 0.03, 0.08), vec3(0.005, 0.006, 0.015), skyH);
  }

  fragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`

export const DICE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec3 a_faceNormal;
layout(location = 2) in vec3 a_smoothNormal;
layout(location = 3) in vec3 a_tangent;
layout(location = 4) in vec3 a_bitangent;
layout(location = 5) in vec2 a_uv;
layout(location = 6) in float a_edgeDist;
layout(location = 7) in float a_faceIdx;

uniform mat4 u_viewProj;
uniform mat3 u_rotMat;
uniform vec3 u_diePos;
uniform float u_dieRadius;

out vec3 v_worldPos;
out vec3 v_localPos;
out vec3 v_faceN;
out vec3 v_smoothN;
out vec3 v_tan;
out vec3 v_bitan;
out vec2 v_uv;
out float v_edgeDist;
flat out int v_faceIdx;

void main() {
  v_localPos = a_pos;
  vec3 wp = u_diePos + (u_rotMat * a_pos) * u_dieRadius;
  v_worldPos = wp;
  v_faceN = normalize(u_rotMat * a_faceNormal);
  v_smoothN = normalize(u_rotMat * a_smoothNormal);
  v_tan = normalize(u_rotMat * a_tangent);
  v_bitan = normalize(u_rotMat * a_bitangent);
  v_uv = a_uv;
  v_edgeDist = a_edgeDist;
  v_faceIdx = int(a_faceIdx + 0.5);
  gl_Position = u_viewProj * vec4(wp, 1.0);
}
`

export const DICE_FRAG = `#version 300 es
precision highp float;
in vec3 v_worldPos;
in vec3 v_localPos;
in vec3 v_faceN;
in vec3 v_smoothN;
in vec3 v_tan;
in vec3 v_bitan;
in vec2 v_uv;
in float v_edgeDist;
flat in int v_faceIdx;

out vec4 fragColor;

uniform sampler2D u_atlas;
uniform vec3 u_camPos;
uniform float u_time;
uniform int u_theme;
uniform int u_tier;
uniform int u_winningFace;
uniform float u_settled;
uniform float u_climax;
uniform int u_faceTiles[20];

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

// 伪环境反射采样，营造奢华宝石/黑曜石/鎏金镜面高光流转感
vec3 sampleEnvMap(vec3 R, int theme) {
  float horizon = pow(1.0 - abs(R.z), 4.0);
  float studioStrip1 = smoothstep(0.86, 0.98, dot(R, normalize(vec3(-0.45, -0.35, 0.82))));
  float studioStrip2 = smoothstep(0.80, 0.96, dot(R, normalize(vec3(0.62, 0.25, 0.74))));
  vec3 baseEnv = theme == 4
    ? mix(vec3(0.35, 0.34, 0.31), vec3(0.88, 0.85, 0.78), clamp(R.z * 0.5 + 0.5, 0.0, 1.0))
    : mix(vec3(0.03, 0.04, 0.09), vec3(0.14, 0.18, 0.32), clamp(R.z * 0.5 + 0.5, 0.0, 1.0));
  vec3 rimTint = theme == 0 ? vec3(1.6, 1.05, 0.35)
               : theme == 1 ? vec3(0.55, 1.65, 2.3)
               : theme == 2 ? vec3(2.2, 0.55, 0.1)
               : theme == 3 ? vec3(0.15, 1.9, 2.2)
               : theme == 4 ? vec3(0.95, 0.90, 0.82)
                            : vec3(0.45, 1.85, 1.45);
  return baseEnv + rimTint * horizon * 0.65 + vec3(3.2, 3.0, 2.7) * studioStrip1 + rimTint * studioStrip2 * 1.4;
}

// 薄膜干涉彩虹光谱函数（供时停水晶棱镜使用）
vec3 spectralIridescence(float cosTheta, float phase) {
  return 0.5 + 0.5 * cos(6.28318 * (cosTheta * 1.65 + phase + vec3(0.0, 0.33, 0.67)));
}

void main() {
  vec3 V = normalize(u_camPos - v_worldPos);

  // 1. 窄倒角：圆角只吃掉最外 5% 边沿，面内 95% 严格保持平面法线（切面必须平，否则会像球）
  float bevelMask = 1.0 - smoothstep(0.008, 0.052, v_edgeDist);
  float ridgeLine = smoothstep(0.032, 0.004, v_edgeDist);
  vec3 N = normalize(mix(v_faceN, v_smoothN, bevelMask * 0.55));

  // 2. 采样 2048x2048 高对比四通道雕文图集（R:锐利字芯, G:暗槽描边保护环, B:刻槽斜率, A:外晕）
  float glyphMask = 0.0;
  float moatMask  = 0.0;
  float glyphHalo = 0.0;
  float bumpSlope = 0.0;

  if (v_uv.x > 0.03 && v_uv.x < 0.97 && v_uv.y > 0.03 && v_uv.y < 0.97) {
    int tileId = u_faceTiles[clamp(v_faceIdx, 0, 19)];
    vec2 tileOrigin = vec2(float(tileId & 7), float(tileId >> 3)) * 0.125;
    vec2 atlasUV = tileOrigin + clamp(v_uv, 0.02, 0.98) * 0.125;
    vec4 tex = texture(u_atlas, atlasUV);
    // 收紧字芯阈值：缩小到 30~50px 时，宽软边会把笔画糊成一团灰白
    float aa = max(0.035, fwidth(tex.r) * 0.8);
    glyphMask = smoothstep(0.56 - aa, 0.56 + aa, tex.r);
    moatMask  = clamp(smoothstep(0.34, 0.60, tex.g) - glyphMask, 0.0, 1.0);
    bumpSlope = (tex.b * 2.0 - 1.0);
    glyphHalo = clamp(tex.a - glyphMask * 0.85, 0.0, 1.0);
  }

  // 刻槽边缘立体法线扰动（仅作用于字芯边缘，保持字芯内部平坦锐利不眩光）
  N = normalize(N - (v_tan + v_bitan) * (bumpSlope * 0.52));

  float NdotV = max(dot(N, V), 0.001);
  vec3 R = reflect(-V, N);
  float fresnel = pow(1.0 - NdotV, 4.0);

  vec3 L1 = normalize(vec3(-0.38, -0.45, 0.81));
  vec3 L2 = normalize(vec3(0.65, 0.52, 0.55));
  float diff1 = max(dot(N, L1), 0.0);
  float diff2 = max(dot(N, L2), 0.0);
  vec3 H1 = normalize(L1 + V);
  vec3 H2 = normalize(L2 + V);

  bool isWinFace = (v_faceIdx == u_winningFace) && (u_settled > 0.5);
  float winPulse = isWinFace ? (1.25 + 0.22 * sin(u_time * 6.5)) : 1.0;

  vec3 localView = v_localPos - V * 0.36;
  float interiorNoise = noise3(localView * 3.8 + vec3(u_time * 0.25, -u_time * 0.18, u_time * 0.15));
  float interiorFine  = noise3(localView * 8.2 - vec3(0.0, u_time * 0.4, 0.0));

  vec3 baseColor = vec3(0.04);
  vec3 emissive  = vec3(0.0);
  float roughness = 0.15;
  float metallic  = 0.1;
  float clearZone = clamp(glyphMask + moatMask * 0.95, 0.0, 1.0);

  if (u_theme == 0) {
    // [0] 星穹秘法：深邃黑曜石底 + 纯黑描边护城槽 + 零过曝高锐度鎏金亮白数字（对比度 > 18:1）
    vec3 deepNebula = mix(vec3(0.008, 0.006, 0.024), vec3(0.08, 0.03, 0.18), interiorNoise) * (1.0 - clearZone);
    deepNebula += vec3(0.45, 0.28, 0.08) * pow(interiorFine, 4.0) * 0.35 * (1.0 - clearZone);
    deepNebula = mix(deepNebula, vec3(0.004, 0.003, 0.010), moatMask);

    vec3 rimGold  = vec3(0.95, 0.70, 0.22);
    vec3 numColor = isWinFace ? vec3(1.0, 0.94, 0.68) : vec3(0.98, 0.84, 0.42);
    baseColor = mix(deepNebula, rimGold, ridgeLine * 0.85 * (1.0 - clearZone));
    baseColor = mix(baseColor, numColor, glyphMask);
    metallic  = mix(0.08, 0.88, ridgeLine * (1.0 - clearZone));
    roughness = mix(0.10, 0.45, glyphMask);

    vec3 auraCol = u_tier == 5 ? vec3(2.1, 0.28, 3.0) : vec3(2.4, 1.52, 0.38);
    // 仅棱脊高光触发 HDR Bloom，字芯保持在 0.95 以内，100% 锐利零糊边！
    emissive = auraCol * (ridgeLine * 0.52 * winPulse) * (1.0 - clearZone)
             + numColor * (glyphMask * 0.42);
  } else if (u_theme == 1) {
    // [1] 时停棱镜：深海蓝宝石棱镜 + 深靛黑护城槽 + 纯白高锐度刻字
    // 每个切面一个色相：相位由面法线决定（面内恒定），彩虹只沿棱脊流动，面内不再出现油膜斑块
    float faceNdotV = max(dot(v_faceN, V), 0.001);
    vec3 irid = spectralIridescence(faceNdotV, float(v_faceIdx) * 0.13 + u_time * 0.05);
    vec3 refractedCore = mix(vec3(0.016, 0.082, 0.215), irid * 0.30, (0.34 + 0.10 * interiorFine) * (1.0 - clearZone));
    refractedCore = mix(refractedCore, vec3(0.005, 0.015, 0.045), moatMask);

    vec3 numCol = vec3(0.99, 1.0, 1.0);
    baseColor = mix(refractedCore, numCol, glyphMask);
    roughness = mix(0.06, 0.42, glyphMask);
    metallic  = 0.12 * (1.0 - glyphMask);
    emissive  = irid * (fresnel * 0.42 + ridgeLine * 0.9) * (1.0 - clearZone)
              + numCol * (glyphMask * 0.62);
  } else if (u_theme == 2) {
    // [2] 焚天熔炉：锻打黑铁壳 + 纯黑隔热槽 + 亮金白清晰数字
    float coreHeat = pow(clamp(interiorNoise * 0.65 + interiorFine * 0.55, 0.0, 1.0), 2.2);
    vec3 magmaCore = mix(vec3(1.6, 0.18, 0.01), vec3(3.8, 1.85, 0.32), coreHeat);
    float fissure = smoothstep(0.66, 0.88, interiorFine) * (1.0 - bevelMask * 0.5) * (1.0 - clearZone);

    vec3 ironBody = mix(vec3(0.022, 0.018, 0.017), vec3(0.004, 0.003, 0.003), moatMask);
    vec3 hotNum   = isWinFace ? vec3(1.0, 0.95, 0.72) : vec3(1.0, 0.86, 0.48);
    baseColor = mix(ironBody, hotNum, glyphMask);
    metallic  = mix(0.62, 0.10, clearZone);
    roughness = 0.34;
    emissive  = magmaCore * (fissure * 0.85 + ridgeLine * 0.88) * (1.0 - clearZone)
              + hotNum * (glyphMask * 0.44);
  } else if (u_theme == 3) {
    // [3] 赛博超频：深黑装甲玻璃 + 纯黑护城槽 + 高对比荧光冰青白数码字
    float scanPlane = exp(-abs(fract(v_worldPos.z * 0.035 - u_time * 0.85) - 0.5) * 18.0) * (1.0 - clearZone);
    vec3 holoTint = (v_faceIdx & 1) == 0 ? vec3(0.05, 2.2, 2.5) : vec3(2.4, 0.18, 1.75);
    vec3 body = mix(vec3(0.010, 0.016, 0.038), vec3(0.002, 0.004, 0.010), moatMask);
    vec3 cyberNum = isWinFace ? vec3(0.95, 1.0, 1.0) : vec3(0.55, 0.98, 1.0);

    baseColor = mix(body, cyberNum, glyphMask);
    roughness = mix(0.09, 0.40, glyphMask);
    metallic  = 0.20 * (1.0 - clearZone);
    emissive  = holoTint * (ridgeLine * 1.25 + scanPlane * 0.48) * (1.0 - clearZone)
              + cyberNum * (glyphMask * 0.44);
  } else if (u_theme == 4) {
    // [4] 水墨剑心：温润羊脂白玉 + 素白净空衬底 + 浓黑徽墨 / 深沉朱砂阴文（印刷级清晰度！）
    float jadeCloud = interiorNoise * 0.09 * (1.0 - clearZone);
    vec3 jadeBody = vec3(0.91, 0.92, 0.88) - vec3(0.05, 0.03, 0.04) * jadeCloud;
    float wrapDiff = max(0.0, (dot(N, L1) + 0.55) / 1.55);
    float backTrans = pow(clamp(dot(V, -L1), 0.0, 1.0), 2.5) * 0.34;
    jadeBody *= (0.52 + 0.64 * wrapDiff + backTrans * vec3(0.88, 1.02, 0.92));
    jadeBody = mix(jadeBody, vec3(0.97, 0.97, 0.94), moatMask * 0.72);

    bool useCinnabar = isWinFace || (u_tier == 1 && v_faceIdx == u_winningFace) || (v_faceIdx == 0);
    vec3 inkCol = useCinnabar ? vec3(0.68, 0.04, 0.04) : vec3(0.02, 0.025, 0.032);
    vec3 trimGold = vec3(0.74, 0.56, 0.24);

    baseColor = mix(jadeBody, trimGold, ridgeLine * 0.78 * (1.0 - clearZone));
    baseColor = mix(baseColor, inkCol, glyphMask);
    roughness = mix(0.16, 0.82, glyphMask);
    metallic  = ridgeLine * 0.65 * (1.0 - clearZone);
  } else {
    // [5] 虚空星噬：深渊黑骨 + 纯黑护城槽 + 锐利薄荷白秘文
    float vein = pow(1.0 - abs(interiorFine * 2.0 - 1.0), 6.0) * (1.0 - clearZone);
    vec3 bone = mix(vec3(0.015, 0.026, 0.032), vec3(0.06, 0.10, 0.09), interiorNoise * (1.0 - clearZone));
    bone = mix(bone, vec3(0.003, 0.006, 0.008), moatMask);
    vec3 voidNum = u_tier == 5 ? vec3(0.96, 0.78, 1.0) : vec3(0.78, 1.0, 0.92);

    baseColor = mix(bone, voidNum, glyphMask);
    roughness = mix(0.18, 0.42, glyphMask);
    metallic  = 0.16 * (1.0 - clearZone);
    vec3 voidGlow = u_tier == 5 ? vec3(1.9, 0.28, 2.8) : vec3(0.22, 2.2, 1.72);
    emissive = voidGlow * (vein * 0.48 + ridgeLine * 0.68 * winPulse) * (1.0 - clearZone)
             + voidNum * (glyphMask * 0.42);
  }

  // 3. 落定后"赢面聚焦"：判定面全亮，其余四个面压暗到 42%，多面数字不再互相干扰读数
  if (u_settled > 0.5) {
    float faceFocus = isWinFace ? 1.0 : 0.42;
    baseColor *= faceFocus;
    emissive *= faceFocus;
  }

  // 4. PBR 高光与环境反射合成（字芯与暗槽 98% 消光抗眩，任何视角绝不反光糊字！）
  float specPow = mix(128.0, 14.0, roughness);
  float spec1 = pow(max(dot(N, H1), 0.0), specPow) * (1.8 - roughness);
  float spec2 = pow(max(dot(N, H2), 0.0), specPow * 0.6) * 0.65;

  vec3 F0 = mix(vec3(0.045), baseColor, metallic);
  vec3 F  = F0 + (1.0 - F0) * fresnel;
  vec3 env = sampleEnvMap(R, u_theme);

  vec3 diffuse = baseColor * (1.0 - metallic * 0.85) * (0.34 + 0.74 * diff1 + 0.24 * diff2);
  if (u_theme == 4 || glyphMask > 0.35) {
    diffuse = baseColor * (1.0 - metallic * 0.5);
  }
  float antiGlare = 1.0 - clamp(glyphMask * 0.98 + moatMask * 0.85, 0.0, 0.98);
  vec3 specular = (F * env * (1.0 - roughness * 0.55) + (F + 0.18) * (spec1 * vec3(1.35, 1.25, 1.1) + spec2 * vec3(0.8, 0.95, 1.2))) * antiGlare;

  specular += F * bevelMask * pow(max(dot(v_smoothN, H1), 0.0), 42.0) * 1.75 * antiGlare;

  vec3 finalHDR = diffuse + specular + emissive;
  fragColor = vec4(max(finalHDR, vec3(0.0)), 1.0);
}
`

// 3D 能量拖尾丝带 & 书法飞白/剑气着色器
export const RIBBON_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec2 a_uv;    // x: 0(头部)..1(尾部), y: -1..+1 宽度横截面
layout(location = 2) in vec4 a_color; // rgb(HDR), a

uniform mat4 u_viewProj;
out vec2 v_uv;
out vec4 v_color;

void main() {
  v_uv = a_uv;
  v_color = a_color;
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}
`

export const RIBBON_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec4 v_color;
out vec4 fragColor;

uniform float u_time;
uniform int u_isInk; // 1: 水墨飞白浓墨混合, 0: 能量发光丝带

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1,0)), f.x),
             mix(hash21(i + vec2(0,1)), hash21(i + vec2(1,1)), f.x), f.y);
}

void main() {
  float across = abs(v_uv.y);
  float tailFade = pow(max(0.0, 1.0 - v_uv.x), 1.45);
  float n = noise2(vec2(v_uv.x * 10.0 - u_time * 6.5, v_uv.y * 3.5));

  if (u_isInk == 1) {
    // 书法飞白：边缘与尾部呈现干笔纤维断续纹理！
    float bristle = noise2(vec2(v_uv.x * 18.0, v_uv.y * 14.0));
    float dryMask = smoothstep(0.22 + v_uv.x * 0.45, 0.78, bristle * (1.0 - across * 0.55));
    float alpha = dryMask * tailFade * v_color.a;
    if (alpha < 0.01) discard;
    fragColor = vec4(v_color.rgb, alpha);
  } else {
    float core = exp(-across * across * 5.5);
    float erode = smoothstep(v_uv.x * 0.65, 1.0, n * 0.55 + core * 0.75);
    float alpha = core * erode * tailFade * v_color.a;
    if (alpha < 0.005) discard;
    fragColor = vec4(v_color.rgb * (0.8 + core * 1.4) * alpha, alpha);
  }
}
`

// 速度拉伸 3D 火星粒子 & 冲天光柱着色器
export const PARTICLE_VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_center;
layout(location = 1) in vec3 a_vel;
layout(location = 2) in vec2 a_corner; // [-1..1, -1..1]
layout(location = 3) in vec4 a_color;  // HDR rgb + alpha
layout(location = 4) in vec2 a_sizeMode; // x: size, y: mode (0:spark, 1:pillar)

uniform mat4 u_viewProj;
uniform vec3 u_camPos;

out vec2 v_corner;
out vec4 v_color;
flat out float v_mode;

void main() {
  v_corner = a_corner;
  v_color = a_color;
  v_mode = a_sizeMode.y;
  float sz = a_sizeMode.x;

  vec3 toCam = normalize(u_camPos - a_center);
  vec3 worldPos;
  if (a_sizeMode.y > 0.5) {
    // 冲天暴击光柱：沿 Z 轴垂直拔地而起！
    vec3 up = vec3(0.0, 0.0, 1.0);
    vec3 side = normalize(cross(toCam, up));
    worldPos = a_center + side * (a_corner.x * sz) + up * ((a_corner.y * 0.5 + 0.5) * a_vel.z);
  } else {
    // 速度方向动态拉伸火星：真实高快门流光残影！
    float spd = length(a_vel);
    vec3 dir = spd > 1.0 ? (a_vel / spd) : vec3(0.0, 0.0, 1.0);
    vec3 side = cross(toCam, dir);
    float sideLen = length(side);
    side = sideLen > 1e-3 ? (side / sideLen) : normalize(cross(toCam, vec3(1.0, 0.0, 0.0)));
    float stretch = sz * (1.0 + min(5.5, spd * 0.012));
    worldPos = a_center + dir * (a_corner.x * stretch) + side * (a_corner.y * sz);
  }

  gl_Position = u_viewProj * vec4(worldPos, 1.0);
}
`

export const PARTICLE_FRAG = `#version 300 es
precision highp float;
in vec2 v_corner;
in vec4 v_color;
flat in float v_mode;
out vec4 fragColor;

void main() {
  if (v_mode > 0.5) {
    // 冲天圣光柱 / 深渊裂柱：中心极亮、向上与向两侧丝滑衰减
    float radial = exp(-v_corner.x * v_corner.x * 5.2);
    float h = v_corner.y * 0.5 + 0.5;
    float vert = smoothstep(0.0, 0.08, h) * pow(max(0.0, 1.0 - h), 1.6);
    float a = radial * vert * v_color.a;
    fragColor = vec4(v_color.rgb * a, a);
  } else {
    float d2 = dot(v_corner, v_corner);
    if (d2 > 1.0) discard;
    float glow = exp(-d2 * 4.2) * (1.0 - d2);
    float a = glow * v_color.a;
    fragColor = vec4(v_color.rgb * glow * v_color.a, a);
  }
}
`

// Dual-Kawase 13-tap / 5-tap 降采样与阈值提取
export const BLOOM_DOWN_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform vec2 u_texelSize;
uniform float u_threshold;

void main() {
  vec2 d = u_texelSize;
  vec3 c0 = texture(u_tex, v_uv).rgb * 0.25;
  vec3 c1 = texture(u_tex, v_uv + vec2(-d.x, -d.y)).rgb * 0.1875;
  vec3 c2 = texture(u_tex, v_uv + vec2( d.x, -d.y)).rgb * 0.1875;
  vec3 c3 = texture(u_tex, v_uv + vec2(-d.x,  d.y)).rgb * 0.1875;
  vec3 c4 = texture(u_tex, v_uv + vec2( d.x,  d.y)).rgb * 0.1875;
  vec3 sum = c0 + c1 + c2 + c3 + c4;

  if (u_threshold > 0.0) {
    float lum = max(max(sum.r, sum.g), sum.b);
    float soft = clamp((lum - u_threshold + 0.35) / 0.7, 0.0, 1.0);
    float contrib = max(soft * soft * 0.35, lum - u_threshold) / max(lum, 1e-4);
    sum *= max(0.0, contrib);
  }
  fragColor = vec4(sum, 1.0);
}
`

// Tent 9-tap 升采样叠加
export const BLOOM_UP_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform vec2 u_texelSize;
uniform float u_intensity;

void main() {
  vec2 d = u_texelSize * 1.25;
  vec3 s = vec3(0.0);
  s += texture(u_tex, v_uv + vec2(-d.x, -d.y)).rgb * 1.0;
  s += texture(u_tex, v_uv + vec2( 0.0, -d.y)).rgb * 2.0;
  s += texture(u_tex, v_uv + vec2( d.x, -d.y)).rgb * 1.0;
  s += texture(u_tex, v_uv + vec2(-d.x,  0.0)).rgb * 2.0;
  s += texture(u_tex, v_uv).rgb                    * 4.0;
  s += texture(u_tex, v_uv + vec2( d.x,  0.0)).rgb * 2.0;
  s += texture(u_tex, v_uv + vec2(-d.x,  d.y)).rgb * 1.0;
  s += texture(u_tex, v_uv + vec2( 0.0,  d.y)).rgb * 2.0;
  s += texture(u_tex, v_uv + vec2( d.x,  d.y)).rgb * 1.0;
  fragColor = vec4((s / 16.0) * u_intensity, 1.0);
}
`

// 最终屏幕合成：光学冲击波透镜扭曲 + 动态色差 + 子弹时间边缘冷焦 + ACES Filmic 色调映射
export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_sceneTex;
uniform sampler2D u_bloomTex;
uniform vec2 u_resolution;
uniform vec4 u_shockwave;  // xy: 屏幕 UV (0..1), z: 半径, w: 扭曲强度
uniform float u_chroma;    // 边缘色差强度 (撞击/赛博故障时飙升)
uniform float u_bulletTime;// 0..1 子弹时间滤镜强度
uniform float u_bloomStrength;
uniform float u_time;

vec3 acesFilm(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / max(1.0, u_resolution.y);

  // 1. 屏幕空间径向冲击波光学折射透镜！
  if (u_shockwave.w > 0.001) {
    vec2 delta = uv - u_shockwave.xy;
    delta.x *= aspect;
    float dist = length(delta);
    float band = exp(-abs(dist - u_shockwave.z) * 26.0);
    vec2 dir = dist > 1e-4 ? normalize(delta) : vec2(0.0);
    dir.x /= aspect;
    uv -= dir * band * u_shockwave.w * 0.042;
  }

  // 2. 径向色差分离 (Chromatic Aberration)
  vec2 fromCenter = uv - 0.5;
  float ca = u_chroma * dot(fromCenter, fromCenter) * 0.032;
  vec3 hdr;
  if (ca > 0.0002) {
    hdr.r = texture(u_sceneTex, clamp(uv + fromCenter * ca, 0.001, 0.999)).r;
    hdr.g = texture(u_sceneTex, clamp(uv, 0.001, 0.999)).g;
    hdr.b = texture(u_sceneTex, clamp(uv - fromCenter * ca, 0.001, 0.999)).b;
  } else {
    hdr = texture(u_sceneTex, clamp(uv, 0.001, 0.999)).rgb;
  }

  vec3 bloom = texture(u_bloomTex, clamp(uv, 0.001, 0.999)).rgb;
  hdr += bloom * u_bloomStrength;

  // 3. 子弹时间边缘冰蓝凝滞滤镜
  if (u_bulletTime > 0.01) {
    float edgeMask = smoothstep(0.18, 0.78, length(fromCenter));
    float luma = dot(hdr, vec3(0.2126, 0.7152, 0.0722));
    vec3 coldTint = mix(vec3(luma), vec3(luma) * vec3(0.65, 1.05, 1.45), 0.75);
    hdr = mix(hdr, coldTint, edgeMask * u_bulletTime * 0.65);
  }

  // 4. 电影级暗角 + ACES 色调映射 + sRGB Gamma 校正
  float vig = 1.0 - dot(fromCenter, fromCenter) * 0.42;
  vec3 mapped = acesFilm(hdr * vig);
  mapped = pow(mapped, vec3(1.0 / 2.2));

  fragColor = vec4(mapped, 1.0);
}
`
