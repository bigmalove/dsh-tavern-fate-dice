import { randomInt, randomBytes } from 'node:crypto'
import { SKILL_BUDGET_SPECS, clampSkillBonus, normalizeRule } from './dice-engine.js'

export const SKILL_CATEGORIES = Object.freeze({
  physical: { label: '体魄', description: '力量、敏捷、耐力与正面冲突' },
  stealth: { label: '潜行', description: '隐匿、开锁、偷窃与悄然行动' },
  social: { label: '社交', description: '说服、威吓、欺瞒与人际交锋' },
  insight: { label: '洞察', description: '察觉、侦查、识破与情报搜集' },
  arcana: { label: '技艺', description: '专业知识、法术、机械与技术操作' },
  will: { label: '意志', description: '精神抵抗、忍耐与定力' }
})

const CATEGORY_KEYS = Object.freeze(Object.keys(SKILL_CATEGORIES))

function skill(id, name, category, hidden = false) {
  return { id, name, category: CATEGORY_KEYS.includes(category) ? category : 'physical', hidden: Boolean(hidden) }
}

/**
 * 12 套世界观技能样板。感知 / 洞察 / 暗中侦查类技能默认 hidden: true（自动暗骰）。
 */
export const SKILL_TEMPLATES = Object.freeze([
  {
    id: 'dnd5e',
    name: '5e 标准（18项）',
    description: '经典 D20 奇幻规则的标准技能表，覆盖冒险全场景。',
    skills: Object.freeze([
      skill('athletics', '运动', 'physical'),
      skill('acrobatics', '体操', 'physical'),
      skill('sleight_of_hand', '巧手', 'stealth'),
      skill('stealth', '隐匿', 'stealth'),
      skill('arcana', '奥秘', 'arcana'),
      skill('history', '历史', 'arcana'),
      skill('investigation', '调查', 'insight', true),
      skill('nature', '自然', 'arcana'),
      skill('religion', '宗教', 'arcana'),
      skill('animal_handling', '驯兽', 'social'),
      skill('insight', '洞悉', 'insight', true),
      skill('medicine', '医药', 'arcana'),
      skill('perception', '察觉', 'insight', true),
      skill('survival', '生存', 'insight', true),
      skill('deception', '欺瞒', 'social'),
      skill('intimidation', '威吓', 'social'),
      skill('performance', '表演', 'social'),
      skill('persuasion', '说服', 'social')
    ])
  },
  {
    id: 'daily',
    name: '日常',
    description: '现代都市日常生活技能，适合轻松向现实题材。',
    skills: Object.freeze([
      skill('fitness', '体能', 'physical'),
      skill('handcraft', '手作', 'arcana'),
      skill('housework', '家政', 'arcana'),
      skill('driving', '驾驶', 'arcana'),
      skill('small_talk', '寒暄', 'social'),
      skill('negotiation', '交涉', 'social'),
      skill('lying', '说谎', 'social'),
      skill('observation', '观察', 'insight', true),
      skill('listening', '倾听', 'insight', true),
      skill('gathering', '打听', 'insight', true),
      skill('common_sense', '常识', 'arcana'),
      skill('focus', '专注', 'will'),
      skill('endurance', '忍耐', 'will'),
      skill('emergency', '应急', 'will'),
      skill('web_search', '检索', 'arcana'),
      skill('finance', '理财', 'arcana'),
      skill('memory', '记忆', 'will'),
      skill('resolve', '意志', 'will')
    ])
  },
  {
    id: 'xianxia',
    name: '修仙',
    description: '仙侠修真世界：剑道、术法与神识探查并重。',
    skills: Object.freeze([
      skill('sword', '剑术', 'physical'),
      skill('body_refine', '炼体', 'physical'),
      skill('flight', '御风轻身', 'physical'),
      skill('conceal', '敛息隐匿', 'stealth'),
      skill('divine_sense', '神识探查', 'insight', true),
      skill('observe_qi', '观气', 'insight', true),
      skill('alchemy', '炼丹', 'arcana'),
      skill('artifact', '炼器', 'arcana'),
      skill('formation', '阵法', 'arcana'),
      skill('talisman', '符箓', 'arcana'),
      skill('medicine', '医术', 'arcana'),
      skill('beast', '御兽', 'social'),
      skill('heart_demon', '心魔抗性', 'will'),
      skill('comprehension', '悟性推演', 'will'),
      skill('debate', '论道辩才', 'social'),
      skill('karma', '仙缘感知', 'insight', true),
      skill('escape', '遁术', 'stealth'),
      skill('herb', '采药', 'arcana')
    ])
  },
  {
    id: 'detective',
    name: '侦探',
    description: '硬派推理与刑侦现场：勘查、侧写与电子取证。',
    skills: Object.freeze([
      skill('scene', '现场勘查', 'insight', true),
      skill('trace', '痕迹检验', 'arcana'),
      skill('forensics', '法医常识', 'arcana'),
      skill('deduction', '逻辑推演', 'insight'),
      skill('interrogation', '讯问技巧', 'social'),
      skill('profiling', '心理侧写', 'insight', true),
      skill('tail', '跟踪监视', 'stealth'),
      skill('infiltration', '潜入搜查', 'stealth'),
      skill('brawl', '搏斗制服', 'physical'),
      skill('firearm', '枪械', 'physical'),
      skill('chase', '驾驶追逐', 'physical'),
      skill('cyber', '电子取证', 'arcana'),
      skill('archive', '档案检索', 'arcana'),
      skill('street', '街头情报', 'social'),
      skill('law', '法条记忆', 'will'),
      skill('pressure', '抗压意志', 'will'),
      skill('disguise', '伪装', 'stealth'),
      skill('micro_expression', '微表情识破', 'insight', true)
    ])
  },
  {
    id: 'wuxia',
    name: '武侠',
    description: '江湖武林：内功轻功、门派招式与江湖规矩。',
    skills: Object.freeze([
      skill('internal', '内功', 'will'),
      skill('qinggong', '轻功', 'physical'),
      skill('sword', '剑法', 'physical'),
      skill('blade', '刀法', 'physical'),
      skill('fist', '拳掌', 'physical'),
      skill('hidden_weapon', '暗器', 'stealth'),
      skill('acupoint', '点穴', 'arcana'),
      skill('healing', '疗伤', 'arcana'),
      skill('poison', '毒理', 'arcana'),
      skill('mechanism', '机关', 'arcana'),
      skill('disguise', '易容', 'stealth'),
      skill('tracking', '追踪', 'insight', true),
      skill('listen', '听风辨位', 'insight', true),
      skill('jianghu', '江湖规矩', 'social'),
      skill('drinking', '酒量', 'will'),
      skill('brotherhood', '义气说服', 'social'),
      skill('breathing', '内息调养', 'will'),
      skill('read_people', '眼力识人', 'insight')
    ])
  },
  {
    id: 'fantasy',
    name: '西幻冒险',
    description: '剑与魔法的旅团冒险：武技、法术与野外生存。',
    skills: Object.freeze([
      skill('sword', '剑术', 'physical'),
      skill('bow', '弓术', 'physical'),
      skill('shield', '盾防', 'physical'),
      skill('stealth', '潜行', 'stealth'),
      skill('lockpick', '开锁', 'stealth'),
      skill('trap', '陷阱解除', 'arcana'),
      skill('survival', '野外生存', 'insight', true),
      skill('riding', '骑术', 'physical'),
      skill('herbalism', '草药', 'arcana'),
      skill('arcane_lore', '奥术知识', 'arcana'),
      skill('spellcasting', '法术施放', 'arcana'),
      skill('ritual', '仪式学', 'arcana'),
      skill('monster_lore', '怪物学识', 'arcana'),
      skill('diplomacy', '交涉', 'social'),
      skill('intimidate', '威吓', 'social'),
      skill('sense_motive', '察言观色', 'insight', true),
      skill('scout', '侦查', 'insight', true),
      skill('willpower', '意志', 'will')
    ])
  },
  {
    id: 'apocalypse',
    name: '末日生存',
    description: '废土求生：物资、医疗、机械与高危环境适应。',
    skills: Object.freeze([
      skill('firearm', '枪械维护', 'arcana'),
      skill('melee', '近战搏杀', 'physical'),
      skill('stealth', '潜行规避', 'stealth'),
      skill('scavenge', '搜刮物资', 'insight', true),
      skill('forage', '野外觅食', 'insight', true),
      skill('water', '净水', 'arcana'),
      skill('first_aid', '医疗急救', 'arcana'),
      skill('repair', '机械维修', 'arcana'),
      skill('radio', '无线电', 'arcana'),
      skill('driving', '驾驶', 'physical'),
      skill('barter', '交易谈判', 'social'),
      skill('calm', '群体安抚', 'social'),
      skill('infection', '感染防护', 'will'),
      skill('danger_sense', '危险感知', 'insight', true),
      skill('tracking', '追踪', 'insight', true),
      skill('endurance', '忍耐意志', 'will'),
      skill('disguise', '伪装', 'stealth'),
      skill('map_reading', '地图判读', 'arcana')
    ])
  },
  {
    id: 'cyberpunk',
    name: '赛博科幻',
    description: '霓虹与义体：骇入、电子战与街头规则。',
    skills: Object.freeze([
      skill('firearm', '枪械', 'physical'),
      skill('melee', '近身格斗', 'physical'),
      skill('stealth', '潜行', 'stealth'),
      skill('hacking', '骇入', 'arcana'),
      skill('ewar', '电子战', 'arcana'),
      skill('cyberware', '义体操作', 'arcana'),
      skill('driving', '驾驶', 'physical'),
      skill('social_eng', '社交工程', 'social'),
      skill('street_knowledge', '街头知识', 'social'),
      skill('negotiation', '谈判', 'social'),
      skill('forgery', '伪造', 'stealth'),
      skill('medicine', '医疗', 'arcana'),
      skill('recon', '侦察', 'insight', true),
      skill('sniff', '数据嗅探', 'insight', true),
      skill('net_trace', '网络追踪', 'insight', true),
      skill('pressure', '抗压', 'will'),
      skill('reflex', '反射神经', 'physical'),
      skill('tactics', '战术规划', 'will')
    ])
  },
  {
    id: 'urban_power',
    name: '都市异能',
    description: '现代都市中的异能者：控制、感知与精神对抗。',
    skills: Object.freeze([
      skill('power_control', '异能控制', 'arcana'),
      skill('martial', '体术', 'physical'),
      skill('conceal', '隐匿', 'stealth'),
      skill('field', '感知领域', 'insight', true),
      skill('spirit', '精神力', 'will'),
      skill('hypnosis', '催眠暗示', 'social'),
      skill('telekinesis', '念力', 'will'),
      skill('element', '元素操控', 'arcana'),
      skill('healing', '治愈', 'arcana'),
      skill('enhance', '强化', 'will'),
      skill('street', '都市生存', 'social'),
      skill('network', '情报网', 'insight', true),
      skill('negotiation', '谈判', 'social'),
      skill('acting', '演技伪装', 'social'),
      skill('crisis_sense', '危机预感', 'insight', true),
      skill('resist', '意志抗性', 'will'),
      skill('burst', '极限爆发', 'physical'),
      skill('organize', '组织协调', 'social')
    ])
  },
  {
    id: 'campus',
    name: '校园成长',
    description: '校园题材：学业、社团与人际关系的青春成长。',
    skills: Object.freeze([
      skill('study', '学业', 'arcana'),
      skill('sports', '体育', 'physical'),
      skill('talent', '才艺', 'social'),
      skill('social', '社交', 'social'),
      skill('council', '学生会长手腕', 'social'),
      skill('part_time', '打工', 'arcana'),
      skill('cooking', '厨艺', 'arcana'),
      skill('gaming', '游戏', 'will'),
      skill('gossip', '情报打听', 'insight', true),
      skill('reading_people', '察言观色', 'insight', true),
      skill('romance', '恋爱直觉', 'insight', true),
      skill('fib', '谎言', 'social'),
      skill('all_nighter', '熬夜耐力', 'will'),
      skill('time_management', '时间管理', 'will'),
      skill('tutoring', '家教', 'arcana'),
      skill('club', '社团活动', 'social'),
      skill('net_surfing', '网络冲浪', 'arcana'),
      skill('resolve', '意志', 'will')
    ])
  },
  {
    id: 'palace',
    name: '宫廷权谋',
    description: '深宫权斗：礼仪才艺、言语机锋与暗中角力。',
    skills: Object.freeze([
      skill('etiquette', '礼仪', 'social'),
      skill('arts', '琴棋书画', 'arcana'),
      skill('poetry', '诗词', 'arcana'),
      skill('reading_faces', '察言观色', 'insight', true),
      skill('informant', '打探消息', 'insight', true),
      skill('scheme_talk', '宫斗话术', 'social'),
      skill('frame', '栽赃', 'stealth'),
      skill('bribe', '收买', 'social'),
      skill('pharmacology', '药理', 'arcana'),
      skill('embroidery', '刺绣', 'arcana'),
      skill('dance', '舞技', 'social'),
      skill('service', '侍奉', 'social'),
      skill('strategy', '权谋推演', 'insight'),
      skill('forbearance', '隐忍', 'will'),
      skill('archery', '骑射', 'physical'),
      skill('medicine', '医理', 'arcana'),
      skill('favor', '人情往来', 'social'),
      skill('probing', '试探', 'social')
    ])
  },
  {
    id: 'cthulhu',
    name: '诡秘惊悚',
    description: '克苏鲁式调查恐怖：神秘学、理智与不可名状之秘。',
    skills: Object.freeze([
      skill('occult', '神秘学', 'arcana'),
      skill('library', '图书馆使用', 'arcana'),
      skill('investigate', '侦查', 'insight', true),
      skill('listen', '聆听', 'insight', true),
      skill('psychology', '心理学', 'insight', true),
      skill('persuade', '说服', 'social'),
      skill('charm', '魅惑', 'social'),
      skill('stealth', '潜行', 'stealth'),
      skill('dodge', '闪避', 'physical'),
      skill('fight', '格斗', 'physical'),
      skill('firearm', '射击', 'physical'),
      skill('first_aid', '急救', 'arcana'),
      skill('medicine', '医疗', 'arcana'),
      skill('repair', '机械维修', 'arcana'),
      skill('drive', '驾驶', 'physical'),
      skill('willpower', '意志', 'will'),
      skill('mythos', '克苏鲁神话', 'arcana'),
      skill('luck', '幸运', 'will')
    ])
  }
])

function cloneSkill(item) {
  return {
    id: String(item.id ?? item.key ?? '').trim(),
    name: String(item.name ?? item.skillName ?? item.label ?? '').trim(),
    category: CATEGORY_KEYS.includes(item.category) ? item.category : 'physical',
    hidden: Boolean(item.hidden),
    bonus: Number.isFinite(Number(item.bonus)) ? Math.trunc(Number(item.bonus)) : 0
  }
}

/** 规范技能数组：补齐字段、裁剪空项、去重 id。 */
export function normalizeSkills(skills, rule = '2d6') {
  const activeRule = normalizeRule(rule)
  const seen = new Set()
  const list = []
  for (const raw of Array.isArray(skills) ? skills : []) {
    if (typeof raw === 'string') {
      const name = raw.trim()
      if (!name) continue
      if (seen.has(name)) continue
      seen.add(name)
      list.push({ id: name, name, category: 'physical', hidden: false, bonus: 0 })
      continue
    }
    if (!raw || typeof raw !== 'object') continue
    const item = cloneSkill(raw)
    if (!item.name && !item.id) continue
    if (!item.id) item.id = item.name
    if (seen.has(item.id)) continue
    seen.add(item.id)
    item.bonus = clampSkillBonus(item.bonus, activeRule)
    list.push(item)
  }
  return list
}

export function skillCategoryLabel(category) {
  return SKILL_CATEGORIES[category]?.label || '综合'
}

export function getSkillTemplate(templateId) {
  const found = SKILL_TEMPLATES.find(t => t.id === templateId)
  if (!found) return null
  return {
    id: found.id,
    name: found.name,
    description: found.description,
    skills: found.skills.map(item => ({ ...item }))
  }
}

export function listSkillTemplates() {
  return SKILL_TEMPLATES.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    skillCount: t.skills.length,
    skills: t.skills.map(item => ({ ...item }))
  }))
}

function newGroupId(prefix) {
  return `${prefix}_${randomBytes(5).toString('hex')}`
}

/** 推荐技能预算：单技能建议预算 × 技能数，总预算按非负整数且不超过 技能数 × 骰面最大值。 */
export function recommendedSkillBudget(rule, skillCount, customBudget = null) {
  const activeRule = normalizeRule(rule)
  const spec = SKILL_BUDGET_SPECS[activeRule]
  const count = Math.max(0, Math.trunc(Number(skillCount) || 0))
  const ceiling = Math.max(spec.max, count * spec.max)
  const custom = Number(customBudget)
  if (customBudget !== null && customBudget !== undefined && Number.isFinite(custom)) {
    return Math.max(0, Math.min(ceiling, Math.trunc(custom)))
  }
  if (!count) return 0
  return Math.max(0, Math.trunc(count * spec.perSkillBudget))
}

export function createSkillsFromTemplate(templateId, rule = '2d6') {
  const template = getSkillTemplate(templateId)
  if (!template) throw new Error(`未知技能样板：${templateId}`)
  const activeRule = normalizeRule(rule)
  return resetRecommendedBonuses(template.skills.map(item => ({ ...item, bonus: 0 })), activeRule)
}

export function createSkillGroup({ name, rule = '2d6', skills = [], customBudget = null, templateId = null } = {}) {
  const activeRule = normalizeRule(rule)
  const normalized = normalizeSkills(skills, activeRule)
  const now = Date.now()
  return {
    id: newGroupId('sg'),
    name: String(name || '未命名技能组').slice(0, 60),
    rule: activeRule,
    customBudget: customBudget === null || customBudget === undefined ? null : recommendedSkillBudget(activeRule, normalized.length, customBudget),
    templateId: templateId || null,
    skills: normalized,
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 技能预算统计：净加值和、推荐预算、剩余可分配、单项越界警告。
 */
export function computeSkillBudget(skills, rule, customBudget = null) {
  const activeRule = normalizeRule(rule)
  const spec = SKILL_BUDGET_SPECS[activeRule]
  const list = Array.isArray(skills) ? skills : []
  const net = list.reduce((sum, item) => sum + (Number(item?.bonus) || 0), 0)
  const recommended = recommendedSkillBudget(activeRule, list.length, customBudget)
  const warnings = []
  for (const item of list) {
    const bonus = Number(item?.bonus) || 0
    if (bonus < spec.min || bonus > spec.max) {
      warnings.push({
        skillId: item?.id || '',
        skillName: item?.name || '',
        bonus,
        min: spec.min,
        max: spec.max,
        message: `「${item?.name || item?.id || '技能'}」加值 ${bonus} 超出 ${activeRule} 允许范围 ${spec.min} ~ ${spec.max}`
      })
    }
  }
  if (net > recommended) {
    warnings.push({
      skillId: '',
      skillName: '',
      bonus: net,
      min: spec.min,
      max: spec.max,
      message: `净加值合计 ${net} 超过推荐预算 ${recommended}，成功判定会明显偏易`
    })
  }
  return {
    rule: activeRule,
    spec: { ...spec },
    count: list.length,
    net,
    recommended,
    remaining: recommended - net,
    overBudget: net > recommended,
    underBudget: net < recommended,
    customBudget: customBudget === null || customBudget === undefined ? null : Number(customBudget),
    minTotal: spec.min * list.length,
    maxTotal: spec.max * list.length,
    warnings
  }
}

/**
 * 从单项最低加值起随机分配正负加值，使净和逼近目标预算；不改动名称与 id。
 */
export function randomizeSkillBonuses(skills, rule, customBudget = null, draw = randomInt) {
  const activeRule = normalizeRule(rule)
  const spec = SKILL_BUDGET_SPECS[activeRule]
  const list = normalizeSkills(skills, activeRule).map(item => ({ ...item, bonus: spec.min }))
  if (!list.length) return []
  const target = recommendedSkillBudget(activeRule, list.length, customBudget)
  let remaining = target - spec.min * list.length
  let guard = 0
  while (remaining > 0 && guard < 600) {
    const candidates = list.filter(item => item.bonus < spec.max)
    if (!candidates.length) break
    const pick = candidates[draw(0, candidates.length)]
    const room = spec.max - pick.bonus
    const step = Math.max(1, Math.min(room, remaining, 1 + draw(0, 3)))
    pick.bonus += step
    remaining -= step
    guard += 1
  }
  return list
}

/** 按推荐值重置：优先给前若干项分配 defaultBonus，总额不超过推荐预算。 */
export function resetRecommendedBonuses(skills, rule) {
  const activeRule = normalizeRule(rule)
  const spec = SKILL_BUDGET_SPECS[activeRule]
  const list = normalizeSkills(skills, activeRule)
  const target = recommendedSkillBudget(activeRule, list.length)
  let remaining = target
  return list.map(item => {
    const give = Math.max(0, Math.min(spec.defaultBonus, remaining, spec.max))
    remaining -= give
    return { ...item, bonus: give }
  })
}

/**
 * 按 id 优先、其次同名/包含匹配查找技能；找不到时返回通用兜底技能。
 */
export function findMatchingSkill(skills, keyOrName) {
  const key = String(keyOrName || '').trim()
  const list = Array.isArray(skills) ? skills : []
  const fallback = {
    id: 'general',
    name: key || '行动',
    bonus: 0,
    category: 'physical',
    hidden: false
  }
  if (!key || !list.length) return fallback
  const normalized = key.toLowerCase()
  const byId = list.find(item => String(item?.id || '').toLowerCase() === normalized)
  if (byId) return cloneSkill(byId)
  const byName = list.find(item => String(item?.name || '') === key)
  if (byName) return cloneSkill(byName)
  const byNameLoose = list.find(item => {
    const name = String(item?.name || '').toLowerCase()
    const id = String(item?.id || '').toLowerCase()
    return (name && (name.includes(normalized) || normalized.includes(name))) ||
      (id && (id.includes(normalized) || normalized.includes(id)))
  })
  if (byNameLoose) return cloneSkill(byNameLoose)
  return fallback
}
