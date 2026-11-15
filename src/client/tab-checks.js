/* ------------------------------------------------------------------ *
 * tab-checks.js —— 页签 1「检定与能力」（默认页）
 * 设计原则：玩家零手填。骰制只选风格，能力加减值全部由决策模型
 * 依据【角色卡/人设 + 世界书 + MVU 变量 + 近期正文】实时评定。
 * ------------------------------------------------------------------ */

const FD_PROFILE_SOURCE_TONE = {
  '角色卡': 'ok',
  '世界书': 'ok',
  'MVU': 'warn',
  '正文': 'off'
}

function fdProfileBonusText(bonus) {
  const value = fdNumber(bonus, 0)
  if (value > 0) return '+' + value
  if (value < 0) return String(value)
  return '±0'
}

function fdProfileToneOf(trait) {
  const tone = trait && trait.tone
  if (tone === 'good' || tone === 'bad' || tone === 'neutral') return tone
  const bonus = fdNumber(trait && trait.bonus, 0)
  if (bonus > 0) return 'good'
  if (bonus < 0) return 'bad'
  return 'neutral'
}

function ProfileTraitCard(props) {
  const { trait } = props || {}
  if (!trait) return null
  const tone = fdProfileToneOf(trait)
  const sourceTone = FD_PROFILE_SOURCE_TONE[trait.source] || 'off'
  return h('div', { className: 'fd-profile-trait is-' + tone },
    h('div', { className: 'fd-profile-trait-head' },
      h('span', { className: 'fd-profile-trait-label' }, trait.label),
      h('span', { className: 'fd-profile-trait-bonus is-' + tone }, fdProfileBonusText(trait.bonus))),
    h('div', { className: 'fd-profile-trait-meta' },
      h(FdBadge, { tone: sourceTone, title: '该条能力的判定来源' }, trait.source || '正文'),
      trait.hidden ? h(FdBadge, { tone: 'off', title: '暗骰：不向玩家展示具体骰面' }, '暗骰') : null),
    trait.reason ? h('span', { className: 'fd-profile-trait-reason' }, trait.reason) : null
  )
}

function ContextSourceCell(props) {
  const { title, on, value, sub, children } = props || {}
  return h('div', { className: 'fd-ctx-cell ' + (on ? 'is-on' : 'is-off') },
    h('span', { className: 'fd-ctx-title' }, title),
    h('span', { className: 'fd-ctx-value' }, value),
    sub ? h('span', { className: 'fd-ctx-sub' }, sub) : null,
    children || null
  )
}

function ChecksTab(props) {
  const { ui, gameId, hasGame, view, actions, notify, checking, onRecheck } = props || {}
  const judge = view.judgeStatus || { available: false }
  const damper = view.damper || { available: false, linkage: false }
  const settings = view.settings || FD_DEFAULT_SETTINGS
  const rule = view.rule || '2d6'
  const meta = fdRuleMeta(rule)
  const profile = view.characterProfile || fdEmptyCharacterProfile()
  const context = view.contextSources || fdEmptyContextSources()
  const traits = Array.isArray(profile.traits) ? profile.traits : []
  const highlights = Array.isArray(profile.mvuHighlights) ? profile.mvuHighlights : []
  const stats = view.stats || { total: 0, good: 0, bad: 0 }
  const recent = (view.recent || []).slice(0, 8)
  const [refreshing, setRefreshing] = useState(false)
  const [noteDraft, setNoteDraft] = useState(profile.customNote || '')
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    setNoteDraft(profile.customNote || '')
  }, [profile.customNote])

  const switchRule = nextRule => {
    if (actions && typeof actions.setRule === 'function') actions.setRule(nextRule)
    fdSaveProfileNote(ui, gameId, { rule: nextRule, customNote: noteDraft }).then(res => {
      if (res && res.ok && res.data && res.data.characterProfile && actions && typeof actions.setProfile === 'function') {
        actions.setProfile(fdNormalizeCharacterProfile(res.data.characterProfile), null)
      }
    })
  }

  const refresh = () => {
    if (refreshing) return
    setRefreshing(true)
    fdRefreshProfile(ui, gameId)
      .then(res => {
        if (res && res.ok && res.characterProfile) {
          if (actions && typeof actions.setProfile === 'function') {
            actions.setProfile(res.characterProfile, res.contextSources)
          }
          if (notify) notify('✨ 已根据角色卡 / 世界书 / MVU / 正文更新角色能力画像')
        } else if (notify) {
          notify((res && res.error) || '宿主暂未返回画像：进入对话完成一轮回复后会自动建立')
        }
      })
      .catch(() => { if (notify) notify('提取失败：请确认决策模型已配置') })
      .finally(() => setRefreshing(false))
  }

  const saveNote = () => {
    if (savingNote) return
    setSavingNote(true)
    fdSaveProfileNote(ui, gameId, { customNote: noteDraft })
      .then(res => {
        if (actions && typeof actions.setProfile === 'function') {
          actions.setProfile({ ...profile, customNote: noteDraft }, null)
        }
        if (notify) notify(fdToastResult(res, '备注已保存，下次检定会一并参考'))
      })
      .catch(() => { if (notify) notify('备注已保存在本地') })
      .finally(() => setSavingNote(false))
  }

  const hasProfile = Boolean(traits.length)
  const nameText = profile.characterName || context.cardName || context.playerName || '主角'

  return h(Fragment, null,
    /* ---------------- 0. 状态徽章行 + 未配模型引导 ---------------- */
    h('div', { className: 'fd-badge-row' },
      h(FdBadge, { tone: judge.available ? 'ok' : (settings.allowHeuristicFallback ? 'off' : 'warn') },
        judge.available
          ? `⚡ 决策模型：${judge.provider || '已就绪'}`
          : (settings.allowHeuristicFallback ? '🧭 本地关键词兜底' : '⚠️ 待配置阻尼决策模型')),
      h(FdBadge, { tone: damper.available ? (damper.linkage ? 'ok' : 'warn') : 'off' },
        damper.available
          ? (damper.linkage ? '⛓ 叙事阻尼器双向联动' : '⛓ 阻尼器可用 · 未联动')
          : '⛓ 未检测到叙事阻尼器'),
      view.source === 'local' ? h(FdBadge, { tone: 'off' }, '🖥 本地配置模式') : null),
    h(DecisionModelGuideBanner, { view, onRecheck, checking }),

    /* ---------------- 1. 自动行动检定 ---------------- */
    h(FdSection, {
      title: '⚡ 自动行动检定',
      note: '发送前定难并投掷真骰',
      help: [
        '你在主聊天框照常发送一行行动描述后，插件会在生成正文前把它交给叙事阻尼器的决策模型评估本次行动的不确定性。',
        '模型会结合【角色卡/玩家人设 + 启用世界书 + 当前 MVU 变量 + 近期正文】实时评定主角在该行动上的能力加减值（−2 ~ +3），并按处境裁定 5 档难度（极难 / 困难 / 普通 / 容易 / 极易）——无需任何手填技能表。',
        '随后由密码学真随机数投骰，把骰面、总计、档位结论注入本轮上下文，再交还给宿主继续生成正文——整个过程不额外消耗一次主模型对话轮次。',
        '角色能力画像在下方「AI 动态角色能力画像」中可查看，随受伤、突破或装备变化自动演进。',
        '关闭本开关后不再自动检定：正文照常生成，只是没有骰子与难度裁定。'
      ].join('\n')
    },
      h(FdRow, {
        plain: true,
        title: '自动行动检定',
        sub: '发送行动前毫秒定难并投掷密码学真骰，不额外占用对话轮次'
      },
      h(FdSwitch, {
        on: Boolean(view.autoCheck),
        label: '自动行动检定',
        onChange: next => (actions && actions.setAutoCheck ? actions.setAutoCheck(next) : undefined)
      }))),

    /* ---------------- 2. 检定骰制 ---------------- */
    h(FdSection, {
      title: '🎲 检定骰制',
      note: meta.hint,
      help: [
        '这里只决定「骰点如何换算成结果档位」，不涉及任何能力数值——所有加减值都由 AI 自动评定，你不需要手填任何表格。',
        '2d6 叙事渐进（默认）：两枚六面相加再加 AI 评定的加减值。合计 ≥10 成功、7~9 代价成功、≤6 失败；双 6 或合计 ≥12 大成功，双 1 大失败。曲线居中、失败温和，适合长线文字 RP。',
        'd10 轻量阶梯：单骰 1~10，档位少、节奏快，适合轻量日常与快节奏互动。',
        'd20 经典跑团：单骰 1~20，天然 20 必大成功、天然 1 必大失败，与桌面 DC 判定思维一致，适合规则化跑团与战斗。',
        'd100 百分阈值：百分制阈值判定，出点 ≤ 目标即成功，适合硬核拟真与技能树。',
        '切换骰制时，AI 评定的能力档位（−2 ~ +3）会自动按比例折算成对应骰制的检定加减值（例如 d20 的 +4 量级、d100 的 +10 量级），完全无需手改任何数值。'
      ].join('\n')
    },
      h('div', { className: 'fd-chip-group' },
        FD_RULES.map(item => h(FdChip, {
          key: item.id,
          active: rule === item.id,
          onClick: () => switchRule(item.id)
        }, item.label))),
      h('div', { className: 'fd-hint' }, '切换即同步宿主与后台画像，下方能力加值由 AI 自动重算')),

    /* ---------------- 3. AI 动态角色能力画像 ---------------- */
    h(FdSection, {
      title: '🤖 AI 动态角色能力画像',
      note: hasProfile ? `已识别 ${traits.length} 条能力` : '尚未建档',
      help: [
        '本页没有任何需要你填写的数字表格：主角在每项行动上的能力加减值，全部由决策模型在「发送前检定」时实时评定。',
        '评定依据是四类上下文：① 角色卡 / 玩家人设；② 当前启用的世界书条目；③ MVU 实时变量（属性、状态、装备等）；④ 近期正文记忆。模型据此判断这次行动属于主角的强项、普通还是短板，并给出 −2 ~ +3 的能力档位。',
        '下方画像由后台在每轮结算时自动演进：受伤、突破、装备更替、关系变化都会让特长与短板随之增减，无需手动维护。',
        '「✨ 从本局设定与正文重新提取」会立刻让 AI 重新通读一遍上下文并重建画像，适合刚导入角色卡、刚改过世界书、或剧情发生重大转折后手动刷新一次。',
        '画像只是给 AI 的参考快照，即使尚未建档，每轮发前检定依然会实时读取人设与 MVU 自动定加值——所以这里空着也完全不影响游玩。'
      ].join('\n')
    },
      h('div', { className: 'fd-profile-bar' },
        h(FdBtn, {
          small: true,
          primary: true,
          disabled: !hasGame || refreshing,
          onClick: refresh
        }, refreshing ? '提取中…' : '✨ 从本局设定与正文重新提取'),
        hasProfile && profile.updatedTurn
          ? h(FdBadge, { tone: 'off' }, `更新于第 ${profile.updatedTurn} 轮`)
          : null,
        !hasGame ? h('span', { className: 'fd-hint' }, '进入对话后可用') : null),

      /* 四源上下文接入小卡片 */
      h('div', { className: 'fd-ctx-grid' },
        h(ContextSourceCell, {
          title: '角色卡 / 人设',
          on: Boolean(context.hasCard),
          value: context.hasCard ? (context.cardName || '已接入角色卡') : '待进局',
          sub: context.playerName ? `玩家：${context.playerName}` : '未检测到玩家名'
        }),
        h(ContextSourceCell, {
          title: '激活世界书',
          on: fdNumber(context.loreCount, 0) > 0,
          value: fdNumber(context.loreCount, 0) > 0 ? `${context.loreCount} 条规则` : '暂无启用条目',
          sub: '关键词命中后注入判定'
        }),
        h(ContextSourceCell, {
          title: 'MVU 实时变量',
          on: fdNumber(context.mvuKeyCount, 0) > 0,
          value: fdNumber(context.mvuKeyCount, 0) > 0 ? `自动识别 ${context.mvuKeyCount} 项指标` : '暂无变量',
          sub: '受伤/突破/装备变化会实时反映'
        },
          highlights.length
            ? h('div', { className: 'fd-mvu-preview' },
              highlights.slice(0, 4).map((item, idx) => h('span', {
                key: (item && item.key) || idx,
                className: 'fd-mvu-pill'
              }, `${(item && item.key) || ''}${item && item.value !== '' ? '：' + item.value : ''}`)))
            : null),
        h(ContextSourceCell, {
          title: '近期正文',
          on: fdNumber(context.historyTurns, 0) > 0,
          value: fdNumber(context.historyTurns, 0) > 0 ? `最近 ${context.historyTurns} 轮` : '暂无正文',
          sub: context.backgroundModelReady ? '后台结算模型已就绪' : '后台结算模型待配置'
        })),

      /* 特长 / 短板卡片网格 */
      hasProfile
        ? h(Fragment, null,
          h('div', { className: 'fd-profile-head' },
            h('span', { className: 'fd-profile-name' }, nameText),
            profile.archetype ? h('span', { className: 'fd-profile-arch' }, profile.archetype) : null),
          h('div', { className: 'fd-profile-grid' },
            traits.map(item => h(ProfileTraitCard, { key: item.id || item.label, trait: item }))))
        : h('div', { className: 'fd-hint' },
          '进入对话完成首轮回复后后台将自动建立角色能力画像；即使尚未建档，每轮发前检定仍会实时读取人设与 MVU 自动定加值。'),

      /* 可选单行补充备注：默认折叠 */
      h(FdCollapse, {
        title: '补充角色背景备注（可选，默认无需填写）',
        sub: '仅补卡面未写明的设定',
        right: h(FdHelp, {
          title: '补充角色背景备注',
          text: [
            '这一栏完全可选：只有当角色卡与世界书里没写、但你又希望 AI 在判定时参考的设定，才需要填一句。',
            '例如「主角左眼失明但听觉极敏锐」「右手旧伤，长时间挥剑会脱力」——这类细节写进备注后，AI 在评定相关行动的能力加减值时会一并参考。',
            '备注只保存一句话，不涉及任何数字表格；留空即表示完全依赖角色卡 / 世界书 / MVU / 正文自动推演。',
            '点「保存备注」后会同步宿主（宿主未实现该接口时保存在本地浏览器），下次检定立即生效。'
          ].join('\n')
        })
      },
      h('div', { className: 'fd-field' },
        h(FdText, {
          value: noteDraft,
          placeholder: '例如：主角左眼失明但听觉极敏锐',
          maxLength: 120,
          onChange: setNoteDraft
        })),
      h('div', { className: 'fd-btn-row' },
        h(FdBtn, { small: true, primary: true, disabled: savingNote, onClick: saveNote }, savingNote ? '保存中…' : '保存备注'),
        h(FdBtn, { small: true, onClick: () => setNoteDraft('') }, '清空')))),

    /* ---------------- 4. 本局检定统计与最近记录 ---------------- */
    h(FdSection, {
      title: '📊 本局检定统计与最近记录',
      note: hasGame ? '最近 8 轮' : '需要进入对话',
      help: [
        '统计口径：累计检定 = 本局自动检定与自由骰投掷的总次数；大成功+成功 = 档位 critical 与 success 之和；代价+失手 = costly、failure 与 fumble 之和。',
        '最近记录保留最近 8 轮，每行显示轮次、所用技能、是否经过叙事阻尼器联动，以及总计骰值与档位标签；暗骰只显示「暗骰」标签不暴露骰面。',
        '数据按本局 gameId 分别统计，切换对话不会串局。'
      ].join('\n')
    },
      h('div', { className: 'fd-stat-grid' },
        h('div', { className: 'fd-stat-cell' },
          h('span', { className: 'fd-stat-num' }, String(stats.total || 0)),
          h('span', { className: 'fd-stat-lbl' }, '累计检定')),
        h('div', { className: 'fd-stat-cell' },
          h('span', { className: 'fd-stat-num' }, String(stats.good || 0)),
          h('span', { className: 'fd-stat-lbl' }, '大成功/成功')),
        h('div', { className: 'fd-stat-cell' },
          h('span', { className: 'fd-stat-num' }, String(stats.bad || 0)),
          h('span', { className: 'fd-stat-lbl' }, '代价/失手'))),
      recent.length
        ? h('div', { className: 'fd-list' },
          recent.map(item => h('div', { key: `${item.turn}-${item.rolledAt}`, className: 'fd-list-item' },
            h('span', null, `第 ${item.turn} 轮 · ${item.check}`),
            h('span', { className: 'fd-btn-row' },
              item.damper ? h('span', { className: 'fd-event-pill' }, '⛓ 阻尼') : null,
              h('span', { className: 'fd-hint' }, item.hidden ? '暗骰' : `${item.total} ${item.tierLabel}`)))))
        : h('div', { className: 'fd-hint' }, '本局尚无检定记录，发送一轮行动后开始记录')),

    /* ---------------- 5. 自由骰小工具（默认折叠） ---------------- */
    h(FreeRollCard, { ui, gameId, notify }))
}
