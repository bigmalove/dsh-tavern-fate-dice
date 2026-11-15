/**
 * 清理正文中的 HTML 块与长面板标签，保留精简叙事摘要喂给决策模型。
 */
export function extractContextSnippet(turnSnapshot, maxLength = 700) {
  if (!turnSnapshot) return ''
  const raw = String(turnSnapshot.text || turnSnapshot.rawText || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return ''
  return raw.length > maxLength ? raw.slice(-maxLength) : raw
}

const OUTCOME_GUIDANCE = Object.freeze({
  critical: '大成功：超额达成企图，收获意料之外的有利局面或关键优势。',
  success: '成功：稳妥达成预期行动目标，剧情顺畅推进。',
  costly: '代价成功（部分成功）：行动勉强达成，但必须伴随真实代价（耗时、声响、暴露、资源损耗、关系擦伤或留下隐患）。',
  failure: '失败：行动未能如愿；切勿让剧情僵死原地，请用失败推动出新的危机、阻碍或反转局面。',
  fumble: '大失败：弄巧成拙或暴露严重破绽，引发局势恶化或即时反制。'
})

function normalizePayload(payload) {
  if (!payload || typeof payload !== 'object') return { roll: null }
  if (payload.roll || payload.pickedEvents || payload.activeArcs || Array.isArray(payload.events)) return payload
  if (payload.rule || payload.tier || payload.check) return { roll: payload }
  return payload
}

function buildCheckBlock(roll) {
  const diceText = Array.isArray(roll.dice) ? roll.dice.join(' + ') : String(roll.total)
  const modText = roll.modifier
    ? (roll.modifier > 0 ? `+${roll.modifier}` : String(roll.modifier))
    : ''
  const skillBonus = Number(roll.skillBonus) || 0
  const skillText = skillBonus === 0 ? '' : (skillBonus > 0 ? `+${skillBonus}` : String(skillBonus))
  const ruleLine = roll.rule === 'd100'
    ? `1d100 骰出 ${roll.total}（难度「${roll.difficultyLabel || '中等'}」目标 ≤ ${roll.target}）`
    : `${roll.rule} 骰出 [${diceText}]${modText ? ` ${modText}` : ''}${skillText ? ` 技能${skillText}` : ''} = ${roll.total}（难度「${roll.difficultyLabel || '中等'}」目标 ≥ ${roll.target}）`

  const checkName = String(roll.skillName || roll.check || '行动').replace(/检定$/, '')
  const lines = [
    '【本轮客观检定已由系统掷骰裁定（严禁模型重投或篡改结果）】',
    `- 检定项目：${checkName}检定${roll.skillName && roll.skillId && roll.skillId !== 'general' ? `（${roll.skillName}）` : ''}`,
    `- 掷骰结果：${ruleLine} → 【${roll.tierLabel || '成功'}】`,
    `- 演绎要求：${OUTCOME_GUIDANCE[roll.tier] || OUTCOME_GUIDANCE.success}`,
    '- 沉浸要求：严禁在故事正文中出现任何骰点数字、难度 DC/目标值、技能加值算式，或“检定成功 / 检定失败 / 大成功 / 大失败”等规则字眼；必须完全通过动作细节、对白反应与局势后果自然体现裁定结果。'
  ]
  if (roll.tier === 'failure' || roll.tier === 'costly' || roll.tier === 'fumble') {
    lines.push('- 渐进失败（Fail Forward）：即使裁定未完全如愿，也必须让剧情向前推进：发生新变化、暴露新线索、迫使角色做出新的选择，禁止让场面停滞或重复原地尝试。')
  }
  if (roll.hidden) {
    lines.push('- 暗骰约束：本次为暗骰。受控角色自身并不知晓具体骰点与成败裁定，正文只能描写角色主观能感知到的表象或误判，不得提前揭露尚未被发现的真相，也不要泄露骰数。')
  }
  if (roll.attempt) lines.push(`- 判定动作：${roll.attempt}`)
  return lines
}

/**
 * 构建注入主模型本轮上下文（turnSection）的判定块 + 随机事件与剧情线锚点。
 */
export function buildTurnInjection(payload) {
  const { roll, pickedEvents = [], activeArcs = [], storyEnhance = false } = normalizePayload(payload)
  const blocks = []
  if (roll && typeof roll === 'object') linesPush(blocks, buildCheckBlock(roll))

  const events = (Array.isArray(pickedEvents) ? pickedEvents : []).filter(item => String(item?.text || '').trim())
  if (pickedEvents === undefined && Array.isArray(payload?.events)) events.push(...payload.events)
  if (events.length) {
    const constants = events.filter(item => item.category === 'constant')
    const pushes = events.filter(item => item.category === 'push')
    const vibes = events.filter(item => item.category === 'vibe')
    const lines = ['【本轮随机事件线索（必须自然融入本轮叙事，严禁逐字照抄或生硬罗列）】']
    const addGroup = (title, list) => {
      if (!list.length) return
      lines.push(`- ${title}：`)
      for (const item of list) lines.push(`  · ${String(item.text).trim()}`)
    }
    addGroup('常驻要求（全程遵守）', constants)
    addGroup('剧情推动事件（本轮至少让其中一条产生实质后果）', pushes)
    addGroup('氛围描写细节（穿插进场景与反应描写）', vibes)
    blocks.push(lines)
  }

  if (storyEnhance && Array.isArray(activeArcs) && activeArcs.length) {
    const lines = ['【持续剧情线锚点（正文需自然呼应，不必逐条点明）】']
    for (const arc of activeArcs.slice(0, 3)) {
      const anchors = Array.isArray(arc.anchors) && arc.anchors.length ? `；锚点：${arc.anchors.join('、')}` : ''
      const summary = arc.summary ? `：${arc.summary}` : ''
      lines.push(`- ${arc.title || '剧情线'}${summary}${anchors}`)
    }
    blocks.push(lines)
  }

  return blocks.map(lines => lines.join('\n')).join('\n\n')
}

function linesPush(target, lines) {
  target.push(lines)
}
