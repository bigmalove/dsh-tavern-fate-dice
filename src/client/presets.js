/* ------------------------------------------------------------------ *
 * presets.js —— 常量、12 套世界观技能样板、默认设置与工厂函数
 * 由 build.mjs 拼接进 client.js 的模块工厂作用域内（共享 require / h / React）
 * ------------------------------------------------------------------ */

const FD_PLUGIN_ID = 'dsh-tavern-fate-dice'
const FD_PANEL_ID = 'fate-dice'
const FD_STYLE_ID = 'dsh-fate-dice-styles'
const FD_STORAGE_PREFIX = 'fate-dice:'
const FD_STORAGE_KEYS = {
  settings: 'fate-dice:save-global-settings',
  skillGroups: 'fate-dice:skill-groups',
  eventGroups: 'fate-dice:event-groups'
}

/* 宿主 RPC 名称（宿主未实现时由 bridge 统一降级，绝不抛错） */
const FD_RPC = {
  status: 'fate-dice:status',
  readTurn: 'fate-dice:read-turn',
  workbench: 'fate-dice:workbench',
  freeRoll: 'fate-dice:free-roll',
  saveSettings: 'fate-dice:save-global-settings',
  saveBinding: 'fate-dice:save-binding',
  saveSkillGroups: 'fate-dice:save-skill-groups',
  saveEventGroups: 'fate-dice:save-event-groups',
  plotline: 'fate-dice:plotline',
  pauseNext: 'fate-dice:pause-next-roll',
  blockTheme: 'fate-dice:block-theme',
  unblockTheme: 'fate-dice:unblock-theme',
  clearCooldown: 'fate-dice:clear-cooldown',
  sceneResume: 'fate-dice:scene-resume',
  importPreview: 'fate-dice:import-preview',
  importApply: 'fate-dice:import-apply'
}

const FD_RULES = [
  { id: '2d6', label: '2d6 叙事渐进', sides: 6, dice: 2, budget: '−2 ~ +3', budgetMin: -2, budgetMax: 3, recommendedNet: 1, hint: '默认档：成功率线性爬坡，适合长线文字 RP' },
  { id: 'd10', label: 'd10 轻量阶梯', sides: 10, dice: 1, budget: '−2 ~ +4', budgetMin: -2, budgetMax: 4, recommendedNet: 2, hint: '单骰阶梯更轻，节奏偏明快' },
  { id: 'd20', label: 'd20 经典跑团', sides: 20, dice: 1, budget: '−2 ~ +8', budgetMin: -2, budgetMax: 8, recommendedNet: 4, hint: '经典 DC 思维，适合规则化跑团' },
  { id: 'd100', label: 'd100 百分阈值', sides: 100, dice: 1, budget: '−10 ~ +30', budgetMin: -10, budgetMax: 30, recommendedNet: 10, hint: '百分阈值，适合硬核拟真与技能树' }
]

const FD_SENSITIVITY_OPTIONS = [
  { value: 'strict', label: '积极（多数主动尝试触发）' },
  { value: 'normal', label: '适中（动作/冲突触发）' },
  { value: 'rare', label: '谨慎（仅高风险关键节点）' }
]

const FD_TONE_OPTIONS = [
  { value: 'balanced', label: '平衡（+0）' },
  { value: 'heroic', label: '英雄（+1 宽容）' },
  { value: 'gritty', label: '严苛（-1 险境）' }
]

const FD_ANIMATION_OPTIONS = [
  { value: 'bounce', label: '多面体弹跳' },
  { value: 'compact', label: '极简闪现' },
  { value: 'none', label: '关闭动画' }
]

const FD_ENTRY_TYPES = [
  { value: '推动', label: '剧情推动' },
  { value: '氛围', label: '氛围描写' },
  { value: '常驻', label: '常驻固定' }
]

const FD_TRACK_MODES = [
  { value: 'd1', label: 'd1 常驻' },
  { value: 'dn', label: 'dn 等权骰' },
  { value: 'd100', label: 'd100 区间表' },
  { value: 'weighted', label: 'weighted 权重池' }
]

const FD_PLOT_STATUS = [
  { value: 'active', label: '活跃' },
  { value: 'paused', label: '暂停' },
  { value: 'closed', label: '已完结' }
]

const FD_CONDITION_OPS = ['=', '≠', '>', '<', '≥', '≤', '包含', '不包含']

const FD_THEME_SUGGESTIONS = ['线索', '阻碍', '关系', '压迫', '机会', '氛围', '代价', '转折']

const FD_DEFAULT_SETTINGS = {
  sensitivity: 'normal',
  toneBias: 'balanced',
  autoHidden: true,
  damperLinkage: true,
  allowHeuristicFallback: false,
  animation: 'bounce',
  maxPlotPush: 1,
  maxAmbience: 1,
  themeCooldown: 2,
  scenePath: ''
}

/* 12 套世界观技能样板：rule 决定默认骰制，net 为设计意图净加值 */
const FD_SKILL_TEMPLATES = [
  {
    id: 'tpl-5e', name: '5e 标准跑团', rule: 'd20', note: '经典六维派生的通用冒险技能组',
    skills: [
      { name: '运动', bonus: 3, hidden: false },
      { name: '察觉', bonus: 2, hidden: true },
      { name: '说服', bonus: 2, hidden: false },
      { name: '潜行', bonus: 1, hidden: false },
      { name: '奥秘', bonus: 1, hidden: false },
      { name: '威吓', bonus: 0, hidden: false }
    ]
  },
  {
    id: 'tpl-xianxia', name: '修仙问道', rule: '2d6', note: '灵气、境界与心性定力驱动的修真世界',
    skills: [
      { name: '灵气感知', bonus: 2, hidden: true },
      { name: '御剑身法', bonus: 2, hidden: false },
      { name: '丹道辨识', bonus: 1, hidden: false },
      { name: '心性定力', bonus: 1, hidden: false },
      { name: '阵法推演', bonus: 0, hidden: true },
      { name: '杀伐果断', bonus: 0, hidden: false }
    ]
  },
  {
    id: 'tpl-detective', name: '侦探推理', rule: 'd100', note: '线索拼图与心理博弈，暗骰密集',
    skills: [
      { name: '现场勘查', bonus: 12, hidden: false },
      { name: '证词盘问', bonus: 10, hidden: false },
      { name: '逻辑推演', bonus: 10, hidden: true },
      { name: '档案检索', bonus: 8, hidden: false },
      { name: '微表情洞察', bonus: 6, hidden: true },
      { name: '隐匿跟踪', bonus: 4, hidden: false }
    ]
  },
  {
    id: 'tpl-wuxia', name: '武侠江湖', rule: '2d6', note: '内力、招式与江湖人情并重',
    skills: [
      { name: '内力运转', bonus: 2, hidden: false },
      { name: '轻功', bonus: 2, hidden: false },
      { name: '剑法', bonus: 2, hidden: false },
      { name: '江湖见识', bonus: 1, hidden: false },
      { name: '听风辨位', bonus: 1, hidden: true },
      { name: '侠义声望', bonus: 0, hidden: false }
    ]
  },
  {
    id: 'tpl-fantasy', name: '西幻冒险', rule: 'd20', note: '剑与魔法的远行队配置',
    skills: [
      { name: '剑术', bonus: 4, hidden: false },
      { name: '秘法', bonus: 3, hidden: false },
      { name: '野外生存', bonus: 2, hidden: false },
      { name: '博物学识', bonus: 2, hidden: false },
      { name: '谈判', bonus: 1, hidden: false },
      { name: '危险直觉', bonus: 1, hidden: true }
    ]
  },
  {
    id: 'tpl-cyberpunk', name: '赛博朋克', rule: 'd10', note: '义体改造、网络潜入与街头交涉',
    skills: [
      { name: '黑客入侵', bonus: 3, hidden: false },
      { name: '街头周旋', bonus: 2, hidden: false },
      { name: '枪械压枪', bonus: 2, hidden: false },
      { name: '义体过载', bonus: 1, hidden: false },
      { name: '摄像头意识', bonus: 1, hidden: true },
      { name: '企业话术', bonus: 1, hidden: false }
    ]
  },
  {
    id: 'tpl-cthulhu', name: '克苏鲁调查', rule: 'd100', note: '理智损耗与不可名状的知识',
    skills: [
      { name: '图书馆使用', bonus: 10, hidden: false },
      { name: '侦查', bonus: 10, hidden: false },
      { name: '神秘学', bonus: 8, hidden: true },
      { name: '精神抵抗', bonus: 8, hidden: true },
      { name: '说服', bonus: 6, hidden: false },
      { name: '闪避', bonus: 4, hidden: false }
    ]
  },
  {
    id: 'tpl-wasteland', name: '末日废土', rule: '2d6', note: '资源稀缺下的生存与交易',
    skills: [
      { name: '废土生存', bonus: 2, hidden: false },
      { name: '拾荒鉴定', bonus: 2, hidden: false },
      { name: '改装枪械', bonus: 1, hidden: false },
      { name: '辐射耐受', bonus: 1, hidden: false },
      { name: '黑市议价', bonus: 0, hidden: false },
      { name: '异响警觉', bonus: 0, hidden: true }
    ]
  },
  {
    id: 'tpl-campus', name: '校园日常', rule: '2d6', note: '青春日常的关系推进与小心思',
    skills: [
      { name: '共情安抚', bonus: 3, hidden: true },
      { name: '学业表现', bonus: 1, hidden: false },
      { name: '运动社团', bonus: 1, hidden: false },
      { name: '社交破冰', bonus: 1, hidden: false },
      { name: '察言观色', bonus: 1, hidden: true },
      { name: '临场应变', bonus: 0, hidden: false }
    ]
  },
  {
    id: 'tpl-court', name: '宫廷权谋', rule: 'd20', note: '礼法、结党与暗流',
    skills: [
      { name: '宫廷礼仪', bonus: 4, hidden: false },
      { name: '朝堂辩论', bonus: 3, hidden: false },
      { name: '人心揣度', bonus: 3, hidden: true },
      { name: '政务调度', bonus: 2, hidden: false },
      { name: '密信谋略', bonus: 1, hidden: true },
      { name: '仪态压制', bonus: 1, hidden: false }
    ]
  },
  {
    id: 'tpl-steampunk', name: '蒸汽朋克', rule: 'd10', note: '机械造物与工坊发明',
    skills: [
      { name: '机械拆解', bonus: 3, hidden: false },
      { name: '蒸汽操控', bonus: 2, hidden: false },
      { name: '化学配比', bonus: 2, hidden: false },
      { name: '图纸推演', bonus: 1, hidden: false },
      { name: '工坊交易', bonus: 1, hidden: false },
      { name: '齿轮听觉', bonus: 0, hidden: true }
    ]
  },
  {
    id: 'tpl-myth', name: '希腊神话', rule: 'd20', note: '神力恩宠与英雄气概',
    skills: [
      { name: '神谕解读', bonus: 4, hidden: true },
      { name: '英雄气魄', bonus: 3, hidden: false },
      { name: '武技决斗', bonus: 3, hidden: false },
      { name: '航海辨识', bonus: 2, hidden: false },
      { name: '献祭礼仪', bonus: 1, hidden: false },
      { name: '命运直觉', bonus: 0, hidden: true }
    ]
  }
]

function fdUid(prefix) {
  return `${prefix || 'id'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function fdClamp(value, min, max) {
  const num = Number(value)
  if (!Number.isFinite(num)) return min
  return Math.min(max, Math.max(min, Math.round(num)))
}

function fdRuleMeta(ruleId) {
  return FD_RULES.find(item => item.id === ruleId) || FD_RULES[0]
}

function fdClone(value) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return value
  }
}

function fdDefaultTracks() {
  return [
    {
      id: fdUid('trk'),
      name: '常驻肘击',
      enabled: true,
      mode: 'd1',
      sides: 1,
      entries: [
        { id: fdUid('ent'), text: '局势持续施压：任何行动都带着额外代价', type: '常驻', theme: '压迫', min: 1, max: 1, weight: 1, conditions: [] }
      ]
    },
    {
      id: fdUid('trk'),
      name: '进展波折',
      enabled: true,
      mode: 'dn',
      sides: 6,
      entries: [
        { id: fdUid('ent'), text: '一条被忽略的线索自己浮现出来', type: '推动', theme: '线索', min: 1, max: 1, weight: 1, conditions: [] },
        { id: fdUid('ent'), text: '计划中途被意外阻碍拖慢半步', type: '推动', theme: '阻碍', min: 1, max: 1, weight: 1, conditions: [] },
        { id: fdUid('ent'), text: '第三方势力忽然插手打乱局面', type: '推动', theme: '转折', min: 1, max: 1, weight: 1, conditions: [] },
        { id: fdUid('ent'), text: '时间压力收紧，选择窗口变窄', type: '推动', theme: '压迫', min: 1, max: 1, weight: 1, conditions: [] },
        { id: fdUid('ent'), text: '一段关系因这轮交锋明显升温或结冰', type: '推动', theme: '关系', min: 1, max: 1, weight: 1, conditions: [] },
        { id: fdUid('ent'), text: '环境骤变，足以改变后续行动方式', type: '推动', theme: '转折', min: 1, max: 1, weight: 1, conditions: [] }
      ]
    },
    {
      id: fdUid('trk'),
      name: '情绪氛围',
      enabled: true,
      mode: 'dn',
      sides: 4,
      entries: [
        { id: fdUid('ent'), text: '空气里浮着潮湿的暖意，气氛松了一线', type: '氛围', theme: '氛围', min: 1, max: 1, weight: 1, conditions: [] },
        { id: fdUid('ent'), text: '某种说不清的紧张贴着皮肤', type: '氛围', theme: '氛围', min: 1, max: 1, weight: 1, conditions: [] },
        { id: fdUid('ent'), text: '远处传来与此刻无关的琐碎声响', type: '氛围', theme: '氛围', min: 1, max: 1, weight: 1, conditions: [] },
        { id: fdUid('ent'), text: '沉默本身成为对话的一部分', type: '氛围', theme: '氛围', min: 1, max: 1, weight: 1, conditions: [] }
      ]
    },
    {
      id: fdUid('trk'),
      name: '叙事节奏',
      enabled: true,
      mode: 'dn',
      sides: 3,
      entries: [
        { id: fdUid('ent'), text: '镜头拉远，把这段时间压缩成一句概括', type: '氛围', theme: '氛围', min: 1, max: 1, weight: 1, conditions: [] },
        { id: fdUid('ent'), text: '定格在某个动作的细节上，慢一拍', type: '氛围', theme: '氛围', min: 1, max: 1, weight: 1, conditions: [] },
        { id: fdUid('ent'), text: '节奏骤然加快，连话都说了一半就被打断', type: '氛围', theme: '压迫', min: 1, max: 1, weight: 1, conditions: [] }
      ]
    }
  ]
}

function fdCreateGenericEventGroup(name) {
  return {
    id: fdUid('evg'),
    name: String(name || '通用剧情样板组'),
    tracks: fdDefaultTracks(),
    updatedAt: Date.now()
  }
}

function fdCreateEventGroup(name) {
  return {
    id: fdUid('evg'),
    name: String(name || '新建事件组'),
    tracks: [
      {
        id: fdUid('trk'),
        name: '主轨',
        enabled: true,
        mode: 'dn',
        sides: 4,
        entries: [
          { id: fdUid('ent'), text: '一件小事让局面偏移了一点', type: '推动', theme: '转折', min: 1, max: 1, weight: 1, conditions: [] }
        ]
      }
    ],
    updatedAt: Date.now()
  }
}

function fdCreateSkillGroup(name, rule, skills) {
  return {
    id: fdUid('skg'),
    name: String(name || '新建技能组'),
    rule: rule || '2d6',
    mvuPath: '',
    skills: fdClone(skills || []),
    updatedAt: Date.now()
  }
}

function fdSkillGroupFromTemplate(template) {
  return fdCreateSkillGroup(template.name, template.rule, template.skills)
}

function fdCreatePlotline() {
  return { id: fdUid('plot'), title: '新的剧情线', origin: '', progress: '', status: 'active', createdAt: Date.now() }
}

function fdNormalizeSkill(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      id: item.id || fdUid('sk'),
      name: String(item.name || '未命名技能'),
      bonus: fdClamp(item.bonus, -20, 60),
      hidden: Boolean(item.hidden)
    }))
}

function fdNormalizeTrack(track) {
  const src = track && typeof track === 'object' ? track : {}
  const mode = FD_TRACK_MODES.some(m => m.value === src.mode) ? src.mode : 'dn'
  return {
    id: src.id || fdUid('trk'),
    name: String(src.name || '未命名轨'),
    enabled: src.enabled !== false,
    mode,
    sides: fdClamp(src.sides || (mode === 'd1' ? 1 : 6), 1, 100),
    entries: Array.isArray(src.entries)
      ? src.entries.filter(e => e && typeof e === 'object').map(entry => ({
        id: entry.id || fdUid('ent'),
        text: String(entry.text || ''),
        type: FD_ENTRY_TYPES.some(t => t.value === entry.type) ? entry.type : '推动',
        theme: String(entry.theme || ''),
        min: fdClamp(entry.min, 1, 100),
        max: fdClamp(entry.max, 1, 100),
        weight: fdClamp(entry.weight || 1, 1, 99),
        conditions: Array.isArray(entry.conditions)
          ? entry.conditions.filter(c => c && typeof c === 'object').map(c => ({
            path: String(c.path || ''),
            op: FD_CONDITION_OPS.includes(c.op) ? c.op : '=',
            value: String(c.value ?? '')
          }))
          : []
      }))
      : []
  }
}

function fdNormalizeEventGroup(group) {
  const src = group && typeof group === 'object' ? group : {}
  return {
    id: src.id || fdUid('evg'),
    name: String(src.name || '未命名事件组'),
    tracks: Array.isArray(src.tracks) ? src.tracks.map(fdNormalizeTrack) : [],
    updatedAt: Number(src.updatedAt) || Date.now()
  }
}

function fdNormalizeSkillGroup(group) {
  const src = group && typeof group === 'object' ? group : {}
  return {
    id: src.id || fdUid('skg'),
    name: String(src.name || '未命名技能组'),
    rule: FD_RULES.some(r => r.id === src.rule) ? src.rule : '2d6',
    mvuPath: String(src.mvuPath || ''),
    skills: fdNormalizeSkill(src.skills),
    updatedAt: Number(src.updatedAt) || Date.now()
  }
}

function fdNormalizePlotline(line) {
  const src = line && typeof line === 'object' ? line : {}
  const status = FD_PLOT_STATUS.some(s => s.value === src.status) ? src.status : 'active'
  return {
    id: src.id || fdUid('plot'),
    title: String(src.title || '未命名剧情线'),
    origin: String(src.origin || ''),
    progress: String(src.progress || ''),
    status,
    createdAt: Number(src.createdAt) || Date.now()
  }
}
