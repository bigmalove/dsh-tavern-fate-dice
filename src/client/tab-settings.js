/* ------------------------------------------------------------------ *
 * tab-settings.js —— 页签 2「检定设置」：干净清爽的 7 项检定参数
 * 每一项均带 ? 就地展开详细说明；底部单一「保存设置」主按钮。
 * ------------------------------------------------------------------ */

function SettingsTab(props) {
  const { view, actions } = props || {}
  const settings = view.settings || FD_DEFAULT_SETTINGS
  const [draft, setDraft] = useState(settings)

  useEffect(() => {
    setDraft(settings)
  }, [settings.sensitivity, settings.alwaysRoll, settings.toneBias, settings.autoHidden, settings.damperLinkage, settings.allowHeuristicFallback, settings.animation])

  const patchDraft = patch => setDraft({ ...draft, ...patch })

  const saveSettings = () => {
    if (!actions || typeof actions.persistSettings !== 'function') return
    actions.persistSettings(draft)
  }

  return h(Fragment, null,
    h(FdSection, {
      title: '⚙️ 检定设置',
      note: '保存后对全部对话生效',
      help: [
        '这一屏是全局检定设置：改的是草稿，只有点底部「保存设置」才落盘并对所有对话生效。',
        '参数分三类：① 触发与难度（触发灵敏度、叙事基调修正）；② 表现层（掷骰动画、感知自动暗骰）；③ 联动与兜底（叙事阻尼器双向联动、无决策模型时本地关键词兜底）。',
        '每项标题右侧的 ? 可展开详细说明，收起后界面保持清爽单列布局。'
      ].join('\n')
    },
      h(FdField, {
        label: '触发灵敏度',
        help: [
          '决定「什么时候该自动发起一次检定」的门槛，越高越少打扰、越低越积极。',
          '积极：只要尝试本身有不确定性就可能触发，主动尝试、探查、交涉几乎都会进检定，检定密度最高，适合想用骰子驱动细节的硬核跑团。',
          '适中（默认）：有明确动作意图或冲突时才触发，日常寒暄与纯情绪对话不掷骰，节奏最平衡。',
          '谨慎：只有高风险关键节点（生死、暴露、重大抉择）才触发，正文更连贯、骰子更稀有，适合重叙事的沉浸式长文。'
        ].join('\n')
      },
      h(FdSelect, { value: draft.sensitivity, options: FD_SENSITIVITY_OPTIONS, onChange: value => patchDraft({ sensitivity: value }) })),

      h(FdRow, {
        plain: true,
        title: '每轮必检定',
        sub: '默认关闭：AI 判为日常动作时不掷骰',
        help: [
          '开启后，只要你在聊天框发送行动，本轮就一定投一次真骰，不再受「触发概率」门槛限制——适合想看骰子驱动每一段剧情的玩法。',
          '关闭（默认）时按「触发灵敏度」的门槛判定：模型认为这次行动没有真实不确定性（纯寒暄、内省、必定成功的日常动作）就跳过投骰，正文照常生成，只在输入框上方留一行「本轮无需检定」的浅提示。',
          '两种情况即使开启本开关也不会投骰：① 本轮被判定为场景切换过渡；② 叙事阻尼器判定为越权结果宣告且没有动作尝试。'
        ].join('\n')
      },
      h(FdSwitch, { on: Boolean(draft.alwaysRoll), label: '每轮必检定', onChange: next => patchDraft({ alwaysRoll: next }) })),

      h(FdField, {
        label: '叙事基调修正',
        help: [
          '在所有检定目标值上加一个统一偏置，用来整体调故事的宽容度，不改角色能力加值。',
          '平衡（+0，默认）：按骰制原始概率走，成功与失败大致对半。',
          '英雄（+1 宽容）：目标值整体放宽，角色更容易成功、失败更像插曲，适合爽文、冒险与轻喜剧。',
          '严苛（-1 险境）：目标值整体收紧，同样的能力在险境里更容易翻车，适合恐怖、悬疑、末日生存这类需要压迫感的题材。'
        ].join('\n')
      },
      h(FdSelect, { value: draft.toneBias, options: FD_TONE_OPTIONS, onChange: value => patchDraft({ toneBias: value }) })),

      h(FdField, {
        label: '掷骰动画',
        help: [
          '骰子结果的呈现方式，纯表现层，不影响任何判定结果。',
          '多面体弹跳（默认）：掷出后有多面体翻滚的弹跳动画，信息量最足，适合喜欢手感的跑团玩家。',
          '极简闪现：只闪一下数字，几乎不占视觉空间。',
          '关闭动画：直接出结果，适合批量推剧情或录屏。',
          '三种档位都在「首字等待期」非阻塞播放——动画不会拖慢正文出字，也遵循系统的「减弱动态效果」设置；关掉系统动效后会退化成静态呈现。'
        ].join('\n')
      },
      h(FdSelect, { value: draft.animation, options: FD_ANIMATION_OPTIONS, onChange: value => patchDraft({ animation: value }) })),

      h(FdRow, {
        plain: true,
        title: '感知类动作自动暗骰',
        sub: '观察 / 察觉类行动默认盖罩',
        help: [
          '开启后，察觉、侦查、识破谎言、微表情洞察这类感知型检定会自动走「暗骰」：正文只写角色主观能感知到的表象（「你总觉得他的笑有点用力」），不写骰点与成败结论，避免玩家读到「侦查 4 失败」就直接判断屋里没人。',
          '想看真实点数时点楼层里的检定胶囊即可偷看，属于「事后复核」而非「实时剧透」。',
          '关闭后这些检定照常明骰，成功/失败结论与点数都会出现在正文。单条能力的明骰/暗骰由 AI 在生成角色能力画像时自动标注（带「暗骰」标记），无需手动逐个勾选。'
        ].join('\n')
      },
      h(FdSwitch, { on: Boolean(draft.autoHidden), label: '感知类动作自动暗骰', onChange: next => patchDraft({ autoHidden: next }) })),

      h(FdRow, {
        plain: true,
        title: '叙事阻尼器双向联动',
        sub: '检定与阻尼配额互通，双向反馈',
        help: [
          '开启后本面板与酒馆「叙事阻尼器」的判定合并成单趟请求：一次调用同时拿到检定结果与阻尼器档位，省掉第二次往返的等待（关掉则各走各的）。',
          '读取方向（改难度）：阻尼器的铺陈分（leverage）折算成额外边缘加值；心理防线 ≥75 时社交/洞察难度 +1 档，亲密信任 ≥70 时社交/洞察难度 −1 档，张力高压 ≥75 时体能与对抗类 +1 档。这些档位会直接进入本次检定的修正。',
          '回写方向（改后续容量）：真骰出点后把结果回传给阻尼器，成功则放宽推进档位、增加 MVU 变量配额，失败则收紧档位、压低配额——让骰子结果真的改变后续能推进的剧情量。',
          '阻尼器未安装或未配置时，读取与回写都自动跳过，检定本身照常进行。'
        ].join('\n')
      },
      h(FdSwitch, { on: Boolean(draft.damperLinkage), label: '叙事阻尼器双向联动', onChange: next => patchDraft({ damperLinkage: next }) })),

      h(FdRow, {
        plain: true,
        title: '无决策模型时使用本地关键词兜底',
        sub: '默认关闭：未配决策模型时不自动检定',
        help: [
          '默认关闭。关闭时，AI 自动检定必须先在酒馆「设置 › 叙事阻尼器」里配好决策模型与 API Key 才会执行——没有模型就安静地不掷骰，正文干净、也不会出现瞎判。',
          '开启后，在纯离线环境、或暂时不想消耗 API Key 时，改用内置的本地动词规则做粗略检定：从玩家输入里提取动作动词与技能名做关键词匹配，命中即按该技能加值掷骰；匹配不上或语义模糊时直接跳过，绝不硬编结果。',
          '本地兜底的判定明显不如决策模型精细（不懂上下文、不辨语气、容易把「假装要打」当成「打」），只适合试玩、离线演示或临时救急；一旦配好 API Key 建议关回默认。'
        ].join('\n')
      },
      h(FdSwitch, { on: Boolean(draft.allowHeuristicFallback), label: '无决策模型时使用本地关键词兜底', onChange: next => patchDraft({ allowHeuristicFallback: next }) }))),

    h('div', { className: 'fd-btn-row' },
      h(FdBtn, { primary: true, onClick: saveSettings }, '保存设置')),
    h('div', { className: 'fd-hint' }, '保存后立即对全部对话生效；未保存的改动不会写入本地存储。'))
}
