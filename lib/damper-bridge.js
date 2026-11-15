import {
  DIFFICULTY_LABELS,
  normalizeDifficulty,
  shiftDifficulty
} from './dice-engine.js'
import { heuristicAssessWithSkills } from './difficulty-judge.js'
import { SKILL_CATEGORIES, findMatchingSkill } from './skill-system.js'

export const DAMPER_QUESTION_PREFIX = 'fd_'

const SENSITIVITY_THRESHOLDS = Object.freeze({
  strict: 0.35,
  normal: 0.55,
  rare: 0.78
})

const DIFFICULTY_CRITERIA = Object.freeze({
  trivial: '极易：几乎没有阻碍，仅微小意外才可能出错',
  easy: '容易：有常规成功把握，稍加注意即可达成',
  moderate: '中等：成败参半，需要真正拼搏或运气',
  hard: '困难：逆境、强防备、高技巧或不利处境下的强行尝试',
  extreme: '极难：以弱胜强、几乎违背常理或严密防线下的冒险一搏'
})

const ACTION_ATTEMPT_CUE = /尝试|试图|伸手|举起|抬|挥|冲|扑|奔|走|跑|摸|掏|拔|推|拉|踢|喊|低声|开口|靠近|转身|拔腿|按下|启动|施法|凝聚|瞄准|架|挡|躲|潜入|跟踪|观察|翻|撬|问|谈|劝|威胁|安抚|亲吻|抱住/
const RESULT_DECLARATION_CUE = /已经|已然|成功|直接|立刻|瞬间|当场|所有人|全都|注定|必然|获得了|得到了|杀死了|击倒|说服了|逃出|通关|拿下/

/** 阻尼器协议识别：低阶提供方只支持 is/is-not 并发题。 */
export function resolveJudgeProtocol(status = {}) {
  const caps = status?.capabilities || {}
  if (caps.choice && caps.score) return status?.provider === 'gemini' ? 'gemini' : 'structured'
  return 'noul'
}

/**
 * 构造与叙事阻尼器单趟合并的检定附加题（阻尼器已算 leverage_score，因此无需再问 situation_edge）。
 */
export function buildDamperJudgeQuestions({ skills = [], protocol = 'gemini', allowHidden = true } = {}) {
  const skillList = (Array.isArray(skills) ? skills : []).filter(item => item && item.name)
  const questions = [
    {
      id: 'fd_needs_check',
      type: 'noul',
      instructions: '本轮玩家行动是否真的存在结果不确定性、阻力对抗或需要侦查才能发现的信息（而非纯日常寒暄、内省或必定成功的轻松动作）？'
    }
  ]

  if (protocol === 'gemini') {
    questions.push({
      id: 'fd_difficulty',
      type: 'choice',
      instructions: '结合当前场景阻力与该角色的能力，评估这次行动客观难度档位：',
      criteria: { ...DIFFICULTY_CRITERIA }
    })
    if (skillList.length >= 2) {
      const criteria = {}
      for (const item of skillList.slice(0, 24)) {
        criteria[item.id] = `${item.name}（${SKILL_CATEGORIES[item.category]?.label || '综合'}${item.hidden && allowHidden ? '·暗骰' : ''}）`
      }
      questions.push({
        id: 'fd_skill',
        type: 'choice',
        instructions: '这项行动最贴合该角色的哪项技能？',
        criteria
      })
    }
    return questions
  }

  questions.push({
    id: 'fd_hard',
    type: 'noul',
    instructions: '以普通角色能力衡量，这项尝试本身是否属于困难或高风险行动？'
  })
  questions.push({
    id: 'fd_hidden',
    type: 'noul',
    instructions: allowHidden
      ? '这项行动的核心是否在于察觉秘密、识破伪装或探测不该立刻知晓的真相（适合暗骰）？'
      : '这项行动是否需要暗中进行、避免被他人察觉？'
  })
  return questions
}

function isViolationTier(ruling) {
  const tier = String(ruling?.rulingTier || ruling?.ruling_tier || ruling?.tier || '')
  return tier === 'strip_delusion' || tier === 'block_delusion' || tier === 'violation'
}

function leverageToEdgeBonus(score) {
  const num = Number(score)
  if (!Number.isFinite(num)) return 0
  if (num >= 2.4) return 2
  if (num >= 1.6) return 1
  if (num < 0.7) return -1
  return 0
}

function readStateValue(data, key, depth = 0) {
  if (!data || typeof data !== 'object' || depth > 3) return undefined
  const root = depth === 0 ? (data.stat_data || data) : data
  if (root?.[key] !== undefined) {
    const num = Number(root[key])
    return Number.isFinite(num) ? num : undefined
  }
  for (const value of Object.values(root)) {
    if (value && typeof value === 'object') {
      const found = readStateValue(value, key, depth + 1)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function normalizeAnswers(raw) {
  if (!raw) return null
  if (Array.isArray(raw)) {
    const map = {}
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const id = String(item.id || item.questionId || item.name || '')
      if (!id) continue
      map[id] = item
    }
    return map
  }
  if (typeof raw === 'object') return raw
  return null
}

function answerProbability(answers, key) {
  const entry = answers?.[key]
  if (entry === undefined || entry === null) return NaN
  if (typeof entry === 'number') return entry
  const prob = Number(entry.probability ?? entry.score ?? entry.value)
  return Number.isFinite(prob) ? prob : NaN
}

function firstFinite(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value
  }
  return NaN
}

function answerChoice(answers, key) {
  const entry = answers?.[key]
  if (entry === undefined || entry === null) return ''
  if (typeof entry === 'string') return entry
  return String(entry.choice ?? entry.value ?? entry.label ?? '')
}

function extractSkillFromAnswers(answers, skillList) {
  const key = answerChoice(answers, 'fd_skill') || answerChoice(answers, 'check_skill') || answerChoice(answers, 'skill')
  if (key) {
    const matched = findMatchingSkill(skillList, key)
    if (matched.id !== 'general') return matched
  }
  return null
}

/**
 * 合并裁定：从叙事阻尼器本轮上下文解析是否需要掷骰、技能、难度与双向联动修正。
 */
export function resolveCheckFromDamperContext({
  damperContext = null,
  input = '',
  skills = [],
  rule = '2d6',
  sensitivity = 'normal',
  allowHidden = true,
  damperLinkage = true
} = {}) {
  const context = damperContext && typeof damperContext === 'object' ? damperContext : {}
  const skillList = (Array.isArray(skills) ? skills : []).filter(item => item && item.name)
  const threshold = SENSITIVITY_THRESHOLDS[sensitivity] ?? SENSITIVITY_THRESHOLDS.normal
  const text = String(input || '')

  if (context.explicitSceneShift) {
    return {
      shouldRoll: false,
      reason: '场景切换过渡免检定',
      source: 'damper',
      damperSync: { skipped: 'scene-shift' }
    }
  }

  const ruling = context.ruling || {}
  if (isViolationTier(context.ruling) || isViolationTier(context)) {
    const hasAttempt = ACTION_ATTEMPT_CUE.test(text)
    if (!hasAttempt) {
      return {
        shouldRoll: false,
        reason: '叙事阻尼器已拦截越权设定宣告',
        source: 'damper',
        damperSync: { blockedByViolation: true, rulingTier: ruling.rulingTier || ruling.tier || 'strip_delusion' }
      }
    }
  }

  const answers = normalizeAnswers(context.answers)
  const needProb = firstFinite(
    answerProbability(answers, 'fd_needs_check'),
    answerProbability(answers, 'needs_check'),
    answerProbability(answers, 'fd_check')
  )
  const hasAnswers = Number.isFinite(needProb)
  const fallback = heuristicAssessWithSkills(text, skillList, sensitivity, allowHidden)

  let shouldRoll
  let needProbability
  let difficulty
  let matchedSkill
  let hidden
  let baseCheck
  let category
  let reason

  if (!hasAnswers) {
    shouldRoll = fallback.shouldRoll
    needProbability = fallback.needProbability
    difficulty = normalizeDifficulty(fallback.difficulty)
    matchedSkill = fallback.skillId && fallback.skillId !== 'general'
      ? findMatchingSkill(skillList, fallback.skillId)
      : null
    hidden = Boolean(allowHidden && fallback.hidden)
    baseCheck = fallback.check
    category = fallback.category
    reason = `无阻尼器附加题答案，回退本地启发式：${fallback.reason}`
  } else {
    shouldRoll = needProb >= threshold
    needProbability = Math.round(needProb * 100) / 100
    const choice = answerChoice(answers, 'fd_difficulty') || answerChoice(answers, 'difficulty_tier')
    if (choice) {
      difficulty = normalizeDifficulty(choice)
    } else {
      const hardProb = firstFinite(answerProbability(answers, 'fd_hard'), 0.5)
      if (hardProb >= 0.82) difficulty = 'extreme'
      else if (hardProb >= 0.62) difficulty = 'hard'
      else if (hardProb <= 0.2) difficulty = 'trivial'
      else if (hardProb <= 0.36) difficulty = 'easy'
      else difficulty = 'moderate'
    }
    matchedSkill = extractSkillFromAnswers(answers, skillList)
    const hiddenProb = firstFinite(answerProbability(answers, 'fd_hidden'), 0)
    hidden = Boolean(allowHidden && (matchedSkill?.hidden || hiddenProb >= 0.65))
    baseCheck = matchedSkill?.name || fallback.check
    category = matchedSkill?.category || fallback.category || 'physical'
    reason = `叙事阻尼器合并裁定：触发概率 ${Math.round(needProb * 100)}%`
  }

  if (!matchedSkill) {
    const guessed = findMatchingSkill(skillList, baseCheck)
    if (guessed.id !== 'general') matchedSkill = guessed
  }
  const check = matchedSkill?.name || baseCheck || '行动'
  const skillId = matchedSkill?.id || 'general'
  const skillBonus = Number(matchedSkill?.bonus) || 0

  const damperSync = {}
  let edgeBonus = 0

  if (damperLinkage !== false) {
    const leverageScore = Number(ruling.leverageScore ?? ruling.leverage_score ?? context.leverageScore ?? 0)
    edgeBonus = leverageToEdgeBonus(leverageScore)
    const snapshot = context.stateSnapshot?.data || context.stateSnapshot?.stat_data || context.stateSnapshot || null
    const guard = readStateValue(snapshot, 'psychological_guard')
    const trust = readStateValue(snapshot, 'intimacy_trust')
    const tension = readStateValue(snapshot, 'arousal_or_tension')
    const shifts = []
    const socialOrInsight = category === 'social' || category === 'insight'
    let next = normalizeDifficulty(difficulty)
    if (socialOrInsight && guard !== undefined && guard >= 75) {
      next = shiftDifficulty(next, 1)
      shifts.push({ source: 'psychological_guard', value: guard, delta: 1, message: '心理防线高企：社交/洞察难度 +1 档' })
    }
    if (socialOrInsight && trust !== undefined && trust >= 70) {
      next = shiftDifficulty(next, -1)
      shifts.push({ source: 'intimacy_trust', value: trust, delta: -1, message: '亲密信任充足：社交/洞察难度 -1 档' })
    }
    if ((category === 'physical' || category === 'social') && tension !== undefined && tension >= 75) {
      next = shiftDifficulty(next, 1)
      shifts.push({ source: 'arousal_or_tension', value: tension, delta: 1, message: '张力/情欲高压：对抗类难度 +1 档' })
    }
    difficulty = next
    damperSync.leverageScore = Number.isFinite(leverageScore) ? leverageScore : 0
    damperSync.edgeBonus = edgeBonus
    damperSync.difficultyShifts = shifts
    damperSync.state = {
      psychological_guard: guard ?? null,
      intimacy_trust: trust ?? null,
      arousal_or_tension: tension ?? null
    }
  } else {
    damperSync.skipped = 'damper-linkage-disabled'
  }

  if (isViolationTier(context.ruling) || isViolationTier(context)) {
    const escalated = Math.max(
      ['trivial', 'easy', 'moderate', 'hard', 'extreme'].indexOf(difficulty),
      ['trivial', 'easy', 'moderate', 'hard', 'extreme'].indexOf('hard')
    )
    difficulty = ['trivial', 'easy', 'moderate', 'hard', 'extreme'][escalated]
    damperSync.blockedByViolation = false
    damperSync.violationEscalation = true
    shouldRoll = true
    reason = '叙事阻尼器判定为越权结果宣告且存在动作尝试，难度已上调'
  }

  return {
    shouldRoll,
    needProbability,
    check,
    skillId,
    skillName: check,
    skillBonus,
    category,
    rule,
    difficulty,
    difficultyLabel: DIFFICULTY_LABELS[difficulty],
    edgeBonus,
    hidden,
    reason,
    source: 'damper',
    damperSync
  }
}
