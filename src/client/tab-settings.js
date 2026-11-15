/* ------------------------------------------------------------------ *
 * tab-settings.js —— 设置与导入导出：全局参数 / 临时主题屏蔽 / 配置导入导出中心
 * ------------------------------------------------------------------ */

function fdToggleIn(list, id) {
  return list.includes(id) ? list.filter(item => item !== id) : [...list, id]
}

function SettingsTab(props) {
  const { ui, gameId, hasGame, view, actions, notify } = props || {}
  const settings = view.settings || FD_DEFAULT_SETTINGS
  const [draft, setDraft] = useState(settings)
  const [themeInput, setThemeInput] = useState('')
  const [exportSkills, setExportSkills] = useState([])
  const [exportEvents, setExportEvents] = useState([])
  const [importText, setImportText] = useState('')
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const skillGroups = view.skillGroups || []
  const eventGroups = view.eventGroups || []

  useEffect(() => {
    setDraft(settings)
  }, [settings.sensitivity, settings.toneBias, settings.autoHidden, settings.damperLinkage, settings.allowHeuristicFallback, settings.animation, settings.maxPlotPush, settings.maxAmbience, settings.themeCooldown, settings.scenePath])

  /* 导入永远新建组：重名时自动追加序号，绝不覆盖已有数据 */
  const fdImportName = (base, used) => {
    const root = String(base || '未命名组') + ' · 导入'
    let name = root
    let seq = 2
    while (used.has(name)) {
      name = `${root} (${seq})`
      seq += 1
    }
    used.add(name)
    return name
  }

  useEffect(() => {
    setExportSkills(skillGroups.map(item => item.id))
  }, [skillGroups.length])

  useEffect(() => {
    setExportEvents(eventGroups.map(item => item.id))
  }, [eventGroups.length])

  const patchDraft = patch => setDraft({ ...draft, ...patch })

  const saveSettings = () => {
    actions.persistSettings(draft)
  }

  const buildExport = () => ({
    version: 2,
    kind: 'dsh-tavern-fate-dice/config',
    exportedAt: new Date().toISOString(),
    settings: { ...draft },
    skillGroups: skillGroups.filter(item => exportSkills.includes(item.id)),
    eventGroups: eventGroups.filter(item => exportEvents.includes(item.id))
  })

  const doExport = () => {
    const payload = buildExport()
    const ok = fdDownloadJson(`fate-dice-config-${Date.now()}.json`, payload)
    if (notify) notify(ok ? `已导出 ${payload.skillGroups.length} 个技能组 / ${payload.eventGroups.length} 个事件组` : '浏览器不允许自动下载，请改用复制 JSON')
  }

  const downloadSample = () => {
    const ok = fdDownloadJson('fate-dice-sample.json', fdSampleConfig())
    if (notify) notify(ok ? '已下载示例模板' : '浏览器不允许自动下载')
  }

  const pickFile = file => {
    if (!file) return
    fdReadFileText(file).then(text => {
      setImportText(text)
      setPreview(null)
      if (notify) notify(`已读取 ${file.name || '文件'}（${text.length} 字符），请点击「预览识别结果」`)
    }).catch(error => {
      if (notify) notify(String((error && error.message) || '文件读取失败'))
    })
  }

  const doPreview = () => {
    if (!importText.trim()) {
      if (notify) notify('请先选择文件或粘贴 JSON 文本')
      return
    }
    setBusy(true)
    fdImportPreview(ui, importText, gameId).then(res => {
      setPreview(res)
      if (!res.ok) {
        if (notify) notify(res.error || '无法识别该配置')
        return
      }
      if (notify) notify(`识别为${res.format}：技能组 ${res.skillCount} / 事件组 ${res.eventCount}（来源：${res.source === 'host' ? '宿主' : '本地解析'}）`)
    }).finally(() => setBusy(false))
  }

  const doApply = () => {
    if (!preview || !preview.ok) {
      if (notify) notify('请先预览并确认识别结果')
      return
    }
    const usedSkillNames = new Set(skillGroups.map(item => item.name))
    const usedEventNames = new Set(eventGroups.map(item => item.name))
    const newSkills = (preview.skillGroups || []).map(group => fdNormalizeSkillGroup({ ...group, id: fdUid('skg'), name: fdImportName(group.name, usedSkillNames) }))
    const newEvents = (preview.eventGroups || []).map(group => fdNormalizeEventGroup({ ...group, id: fdUid('evg'), name: fdImportName(group.name, usedEventNames) }))
    if (newSkills.length) actions.persistGroups('skillGroups', [...skillGroups, ...newSkills])
    if (newEvents) actions.persistGroups('eventGroups', [...eventGroups, ...newEvents])
    fdImportApply(ui, gameId, { skillGroups: newSkills, eventGroups: newEvents }).then(res => {
      if (notify) notify(res.ok
        ? `已导入 ${newSkills.length} 个技能组 / ${newEvents.length} 个事件组`
        : `已导入到本地面板：${newSkills.length} 个技能组 / ${newEvents.length} 个事件组（宿主接口不可用）`)
    })
    setPreview(null)
    setImportText('')
  }

  return h(Fragment, null,
    h(FdSection, {
      title: '⚙️ 全局参数',
      note: '保存后对全部对话生效',
      help: [
        '这一屏是全局设置：改的是草稿，只有点「保存全局设置」才落盘并对所有对话生效；点「还原」丢弃未保存的改动（回到上次保存值）。',
        '参数分四类：① 检定触发与难度（触发灵敏度、叙事基调修正）；② 表现层（掷骰动画档位、感知自动暗骰）；③ 事件配额（每轮剧情推动上限、氛围描写上限、同主题冷却轮数）；④ 场景与联动（场景位置 MVU 路径、叙事阻尼器双向联动、无决策模型时本地兜底）。',
        '各项之间没有硬性依赖，但改动骰制/技能组后建议顺手回检这里的两项配额，避免单轮被塞进过多事件。'
      ].join('\n')
    },
      h('div', { className: 'fd-inline-fields' },
        h(FdField, {
          label: '触发灵敏度',
          help: [
            '决定「什么时候该自动发起一次技能检定」的门槛，越高越少打扰、越低越积极。',
            '积极 35%：只要动作里有 35% 以上把握值得一掷就触发，主动尝试、探查、交涉几乎都会进检定，检定密度最高，适合想用骰子驱动细节的硬核跑团。',
            '适中 55%（默认）：有明确动作意图或冲突时才触发，日常寒暄与纯情绪对话不掷骰，节奏最平衡。',
            '谨慎 78%：只有高风险关键节点（生死、暴露、重大抉择）才触发，正文更连贯、骰子更稀有，适合重叙事的沉浸式长文。'
          ].join('\n')
        },
          h(FdSelect, { value: draft.sensitivity, options: FD_SENSITIVITY_OPTIONS, onChange: value => patchDraft({ sensitivity: value }) })),
        h(FdField, {
          label: '叙事基调修正',
          help: [
            '在所有检定目标值上加一个统一偏置，用来整体调故事的宽容度，不改技能加值。',
            '平衡 +0：按骰制原始概率走，成功与失败大致对半。',
            '英雄 +1：目标值整体放宽，角色更容易成功、失败更像插曲，适合爽文、冒险与轻喜剧。',
            '严苛 -1：目标值整体收紧，同样的技能在险境里更容易翻车，适合恐怖、悬疑、末日生存这类需要压迫感的题材。'
          ].join('\n')
        },
          h(FdSelect, { value: draft.toneBias, options: FD_TONE_OPTIONS, onChange: value => patchDraft({ toneBias: value }) })),
        h(FdField, {
          label: '掷骰动画档位',
          help: [
            '骰子结果的呈现方式，纯表现层，不影响任何判定结果。',
            '多面体弹跳：掷出后有多面体翻滚的弹跳动画，信息量最足，适合喜欢手感的跑团玩家。',
            '极简闪现：只闪一下数字，几乎不占视觉空间。',
            '关闭动画：直接出结果，适合批量推剧情或录屏。',
            '三种档位都在「首字等待期」非阻塞播放——动画不会拖慢正文出字，也遵循系统的「减弱动态效果」设置；关掉系统动效后即使这里选了弹跳也会退化成静态呈现。'
          ].join('\n')
        },
          h(FdSelect, { value: draft.animation, options: FD_ANIMATION_OPTIONS, onChange: value => patchDraft({ animation: value }) }))),
      h('div', { className: 'fd-card-grid' },
        h('div', { className: 'fd-card' },
          h(FdRow, {
            plain: true,
            title: '感知自动暗骰',
            sub: '观察/察觉类行动默认盖罩',
            help: [
              '开启后，察觉、侦查、识破谎言、微表情洞察这类感知型技能检定会自动走「暗骰」：正文只写角色主观能感知到的表象（「你总觉得他的笑有点用力」），不写骰点与成败结论，避免玩家读到「侦查 4 失败」就直接判断屋里没人。',
              '想看真实点数时点楼层里的结算胶囊即可偷看，属于「事后复核」而非「实时剧透」。',
              '关闭后这些检定照常明骰，成功/失败结论与点数都会出现在正文。单个技能是否暗骰还可以在「技能检定 › 技能清单」里用 🎴/👁 逐个覆盖——那里的设置为准。'
            ].join('\n')
          },
          h(FdSwitch, { on: draft.autoHidden, label: '感知自动暗骰', onChange: next => patchDraft({ autoHidden: next }) }))),
        h('div', { className: 'fd-card' },
          h(FdRow, {
            plain: true,
            title: '叙事阻尼器双向联动',
            sub: '检定与事件配额互通，双向反馈',
            help: [
              '开启后本面板与酒馆「叙事阻尼器」的判定合并成单趟请求：一次调用同时拿到检定结果与阻尼器档位，省掉第二次往返的等待（关掉则各走各的）。',
              '读取方向（改难度）：阻尼器的铺陈分（leverage）折算成额外 edge 加值；心理防线 ≥75 时社交/洞察难度 +1 档，亲密信任 ≥70 时社交/洞察难度 −1 档，张力/情欲高压 ≥75 时体能与对抗类 +1 档。这些档位会直接进入本次检定的修正。',
              '回写方向（改后续容量）：真骰出点后把结果回传给阻尼器（交由酒馆侧的 applyDamperDiceShift 处理），成功则放宽推进档位、增加 MVU 变量配额，失败则收紧档位、压低配额——让骰子结果真的改变后续能推进的剧情量，而不是只改一句台词。',
              '阻尼器未安装或未配置时，读取与回写都自动跳过，检定本身照常进行。'
            ].join('\n')
          },
          h(FdSwitch, { on: draft.damperLinkage, label: '阻尼双向联动', onChange: next => patchDraft({ damperLinkage: next }) }))),
        h('div', { className: 'fd-card' },
          h(FdRow, {
            plain: true,
            title: '无决策模型时使用本地关键词兜底',
            sub: '默认关闭：未配决策模型时不自动检定',
            help: [
              '默认关闭。关闭时，AI 自动检定必须先在酒馆「设置 › 叙事阻尼器」里配好决策模型与 API Key 才会执行——没有模型就安静地不掷骰，正文干净、也不会出现瞎判。',
              '开启后，在纯离线环境、或暂时不想消耗 API Key 时，改用内置的本地动词规则做粗略检定：从玩家输入里提取动作动词与技能名做关键词匹配，命中即按该技能加值掷骰；匹配不上或语义模糊时直接跳过，绝不硬编结果。',
              '本地兜底的判定明显不如决策模型精细（不懂上下文、不辨语气、容易把「假装要打」当成「打」），只适合试玩、离线演示或临时救急；一旦配好 API Key 建议关回默认。',
              '该开关只影响「会不会自动生成检定」，不影响手动掷骰与事件抽取。'
            ].join('\n')
          },
          h(FdSwitch, { on: Boolean(draft.allowHeuristicFallback), label: '无决策模型时本地兜底', onChange: next => patchDraft({ allowHeuristicFallback: next }) })))),
      h('div', { className: 'fd-inline-fields' },
        h(FdField, {
          label: '每轮「剧情推动」上限',
          help: [
            '单轮最多注入几条「实质推进」类事件（转折、阻碍、线索、关系变化、第三方插手）。取值 0~3。',
            '0：完全关闭推动类事件，故事只由玩家与角色互动推进，适合纯日常/纯感情线。1：默认，每轮最多一个变数，节奏稳。2~3：事件密度高，适合冒险、群像或快节奏悬疑，但连抽容易显得强行，建议配合同主题冷却。',
            '这里只是天花板而不是保底：轨道没抽到、条件没满足、主题正在冷却，都可能一轮零推动。'
          ].join('\n')
        },
          h(FdSelect, {
            value: String(draft.maxPlotPush),
            options: [0, 1, 2, 3].map(n => ({ value: String(n), label: `${n} 条` })),
            onChange: value => patchDraft({ maxPlotPush: Number(value) })
          })),
        h(FdField, {
          label: '每轮「氛围描写」上限',
          help: [
            '单轮最多注入几条「氛围描写」类事件（光影、神态、环境细节、镜头语言）。取值 0~3。',
            '氛围条目与推动条目分开计数，不互相抢名额。0：只要干练的叙事、不要环境描写；1：默认，点缀一处细节；2~3：画面感更浓，适合抒情、恐怖氛围营造或慢节奏长文。',
            '氛围不承担剧情功能，纯粹增强画面；拉满 3 条容易出现「形容词堆砌」，建议与推动上限的总和控制在 3 以内。'
          ].join('\n')
        },
          h(FdSelect, {
            value: String(draft.maxAmbience),
            options: [0, 1, 2, 3].map(n => ({ value: String(n), label: `${n} 条` })),
            onChange: value => patchDraft({ maxAmbience: Number(value) })
          })),
        h(FdField, {
          label: '同主题冷却轮数',
          help: [
            '某个主题（线索/阻碍/关系/压迫/机会/氛围/代价/转折等）的「剧情推动」被成功抽中后，接下来 N 个成功结算的新用户轮内不再抽中同主题推动，防止连续几轮反复「线索、线索、线索」。取值 0~5。',
            '0：不冷却，同一主题可以连轮出现；2：默认，两轮内避开；3~5：题材需要轮换感（悬疑揭底、群像调度）时调高。',
            '只约束「剧情推动」类，氛围描写不受此限制；屏蔽中的主题在设置页「临时主题屏蔽器」里可直接撤销，冷却可在那里一键清空。'
          ].join('\n')
        },
          h(FdSelect, {
            value: String(draft.themeCooldown),
            options: [0, 1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n} 轮` })),
            onChange: value => patchDraft({ themeCooldown: Number(value) })
          }))),
      h(FdField, {
        label: '本局场景位置 MVU 变量路径',
        hint: '例如 场景.位置；用于场景切换时自动停用旧场景追加事件组',
        help: [
          '填角色卡变量（MVU / stat_data）里表示「当前场景」的字段路径，如 `场景.位置`、`/地点/当前`。',
          '作用：每轮读一次该变量，一旦值发生变化（从「雨夜小巷」变成「拍卖会大厅」），就自动停用旧的「当前场景追加事件组」并标记为待恢复，避免新场景里还在抽上场景的专属事件；点事件页的「恢复场景追加」按新场景重新启用。',
          '留空＝不做场景联动，场景追加组只能手动切换。没有 MVU 变量系统的人物卡保持留空即可，功能完全不受影响。'
        ].join('\n')
      }, h(FdText, {
        value: draft.scenePath || '',
        placeholder: '场景.位置',
        onChange: value => patchDraft({ scenePath: value })
      })),
      h('div', { className: 'fd-btn-row' },
        h(FdBtn, { primary: true, onClick: saveSettings }, '保存全局设置'),
        h(FdBtn, { onClick: () => setDraft({ ...settings }) }, '还原'))),

    h(FdSection, {
      title: '🚫 临时主题屏蔽器',
      note: hasGame ? '屏蔽期间该主题不会被抽中' : '进入对话后可用',
      help: [
        '在输入框里填一个主题名（与事件条目「主题」字段同名，如 阻碍、氛围、关系），点「屏蔽 5 轮」后，接下来 5 个成功结算的新用户轮内，该主题的条目会被直接过滤掉——不参与抽取、不会占配额。',
        '屏蔽是临时的、按本局生效：计数随轮次自动递减，窗口结束自动失效；也可以在任何时候点「撤销」立刻解除，不必等倒计时（不想再看到「压迫」连发时最好用）。',
        '下面的「冷却中的主题」是自动产生的、不能手动加的记录：某个主题的推动刚被抽中，就会按设置里的「同主题冷却轮数」进入冷却，这里能看到还剩几轮，也可以「一键清空冷却」全部放开。',
        '屏蔽与冷却的区别：屏蔽是你主动禁止（可撤销、固定 5 轮），冷却是系统防重复（时长跟随设置）。两者同时命中时以屏蔽为准。',
        '未进入对话时不显示这一块：屏蔽与冷却都挂在具体对话的运行时状态上。'
      ].join('\n')
    },
    hasGame
      ? h(Fragment, null,
        h('div', { className: 'fd-inline-fields' },
          h(FdText, { value: themeInput, placeholder: '主题名（如 阻碍）', onChange: setThemeInput }),
          h('div', { style: { flex: '0 0 auto' } },
            h(FdBtn, {
              small: true,
              primary: true,
              onClick: () => {
                const theme = themeInput.trim()
                if (!theme) {
                  if (notify) notify('请输入要屏蔽的主题名')
                  return
                }
                fdBlockTheme(ui, gameId, theme, 5).then(res => {
                  if (notify) notify(res.ok ? `已屏蔽主题「${theme}」5 轮` : '宿主接口不可用，未能写入屏蔽表')
                })
                setThemeInput('')
              }
            }, '屏蔽 5 轮'))),
        (view.blockedThemes || []).length
          ? h('div', { className: 'fd-list' },
            view.blockedThemes.map(item => h('div', { key: item.theme, className: 'fd-list-item' },
              h('span', null, `🚫 ${item.theme}`),
              h('span', { className: 'fd-btn-row' },
                h('span', { className: 'fd-hint' }, `剩余 ${item.rounds} 轮`),
                h(FdBtn, {
                  small: true,
                  onClick: () => {
                    fdUnblockTheme(ui, gameId, item.theme).then(res => {
                      if (notify) notify(res.ok ? `已撤销屏蔽「${item.theme}」` : '宿主接口不可用')
                    })
                  }
                }, '撤销')))))
          : h('div', { className: 'fd-hint' }, '当前无生效中的屏蔽主题'),
        (view.cooldowns || []).length
          ? h('div', { className: 'fd-list' },
            h('span', { className: 'fd-hint' }, '冷却中的主题'),
            view.cooldowns.map(item => h('div', { key: item.theme, className: 'fd-list-item' },
              h('span', null, `⏳ ${item.theme}`),
              h('span', { className: 'fd-hint' }, `剩余 ${item.rounds} 轮`))),
            h('div', { className: 'fd-btn-row' },
              h(FdBtn, {
                small: true,
                onClick: () => {
                  fdClearCooldown(ui, gameId).then(res => {
                    if (notify) notify(res.ok ? '已清空全部主题冷却' : '宿主接口不可用')
                  })
                }
              }, '一键清空冷却')))
          : h('div', { className: 'fd-hint' }, '当前无冷却中的主题'))
      : h('div', { className: 'fd-hint' }, '未进入对话：无法使用临时屏蔽')),

    h(FdSection, {
      title: '📤 导出配置',
      note: '勾选要打包的共享库',
      help: [
        '导出的是一份自包含 JSON（version 2 / kind 为 dsh-tavern-fate-dice/config）：包含当前草稿里的全部全局参数、勾选的技能组、勾选的事件组，附导出时间戳，方便备份、跨设备迁移或分享给朋友。',
        '默认两组都全选；点胶囊取消勾选即可只打包其中一个题材。组里的一切（骰制、加值、暗骰标记、MVU 路径、轨道模式、条目条件）都会原样带出，不截断。',
        '「导出 JSON 文件」走浏览器下载，文件名带时间戳，不会覆盖旧备份；若浏览器拦截自动下载，可用「下载示例模板」拿到结构说明，或从导入框的 JSON 文本反向复制。',
        '「下载示例模板」给的是最小可用样例（一堆空组结构），用来对照字段含义，不是你的真实数据。',
        '导出的是快照：导出后再改本地组，旧文件不会跟着变。'
      ].join('\n')
    },
      h('div', { className: 'fd-card-grid' },
        h('div', { className: 'fd-card' },
          h('span', { className: 'fd-card-title' }, `技能组（${exportSkills.length}/${skillGroups.length}）`),
          skillGroups.length
            ? h('div', { className: 'fd-chip-group' },
              skillGroups.map(group => h(FdChip, {
                key: group.id,
                active: exportSkills.includes(group.id),
                onClick: () => setExportSkills(prev => fdToggleIn(prev, group.id))
              }, group.name)))
            : h('div', { className: 'fd-hint' }, '暂无技能组'),
          h('div', { className: 'fd-btn-row' },
            h(FdBtn, { small: true, onClick: () => setExportSkills(skillGroups.map(item => item.id)) }, '全选'),
            h(FdBtn, { small: true, onClick: () => setExportSkills([]) }, '清空'))),
        h('div', { className: 'fd-card' },
          h('span', { className: 'fd-card-title' }, `事件组（${exportEvents.length}/${eventGroups.length}）`),
          eventGroups.length
            ? h('div', { className: 'fd-chip-group' },
              eventGroups.map(group => h(FdChip, {
                key: group.id,
                active: exportEvents.includes(group.id),
                onClick: () => setExportEvents(prev => fdToggleIn(prev, group.id))
              }, group.name)))
            : h('div', { className: 'fd-hint' }, '暂无事件组'),
          h('div', { className: 'fd-btn-row' },
            h(FdBtn, { small: true, onClick: () => setExportEvents(eventGroups.map(item => item.id)) }, '全选'),
            h(FdBtn, { small: true, onClick: () => setExportEvents([]) }, '清空')))),
      h('div', { className: 'fd-btn-row' },
        h(FdBtn, { primary: true, onClick: doExport }, '导出 JSON 文件'),
        h(FdBtn, { onClick: downloadSample }, '下载示例模板'))),

    h(FdSection, {
      title: '📥 导入配置',
      note: '支持原生 v2 与 AutoRandomInput 配置包',
      help: [
        '两种输入方式等价：选本地 .json 文件，或把 JSON 文本直接粘进下面的多行框。',
        '自动识别两种格式：① 本插件原生 v2 配置（kind 为 dsh-tavern-fate-dice/config）；② 原版 AutoRandomInput 的 v1 / v2 配置文件——字段名、轨道结构、技能表、区间/权重写法都会自动转换成本插件的技能组与事件组，缺失的字段填默认值，无法映射的字段会在预览里以 warning 列出（不会静默丢弃）。',
        '必须先「预览识别结果」再导入：预览会显示识别到的格式、将导入的技能组/事件组数量、数据来源（宿主识别或本地解析）以及每个组的名字与规模，确认无误再点「确认为新组导入」。',
        '导入一律新建组：即使与已有组同名，也绝不会覆盖、不会合并原数据——名字会自动补「 · 导入」后缀（重名时再加序号区分），旧数据零风险。想拿导入数据替换某组，请手动改选或删掉旧组。',
        '识别失败时这块会显示具体错误（JSON 语法错、找不到可识别的组、版本不支持等），改好文本或换文件再预览即可。'
      ].join('\n')
    },
      h('div', { className: 'fd-btn-row' },
        h('label', { className: 'fd-btn', style: { position: 'relative', overflow: 'hidden' } },
          '选择本地 .json 文件',
          h('input', {
            type: 'file',
            accept: '.json,application/json',
            style: { position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' },
            onChange: e => {
              const file = e && e.target && e.target.files ? e.target.files[0] : null
              pickFile(file)
            }
          }))),
      h(FdArea, {
        value: importText,
        rows: 6,
        placeholder: '或直接粘贴 JSON 文本…',
        onChange: value => { setImportText(value); setPreview(null) }
      }),
      h('div', { className: 'fd-btn-row' },
        h(FdBtn, { disabled: busy, onClick: doPreview }, busy ? '识别中…' : '预览识别结果'),
        h(FdBtn, { primary: true, disabled: !preview || !preview.ok, onClick: doApply }, '确认为新组导入')),
      preview && preview.ok
        ? h('div', { className: 'fd-card' },
          h('span', { className: 'fd-card-title' }, `识别格式：${preview.format}`),
          h('span', { className: 'fd-card-sub' }, `将导入 技能组 ${preview.skillCount} 个 / 事件组 ${preview.eventCount} 个 · 来源 ${preview.source === 'host' ? '宿主识别' : '本地解析'}`),
          (preview.warnings || []).length
            ? h('span', { className: 'fd-hint' }, preview.warnings.join(' · '))
            : null,
          (preview.skillGroups || []).length
            ? h('div', { className: 'fd-chip-group' }, preview.skillGroups.map(group => h('span', { key: group.id, className: 'fd-event-pill' }, `${group.name}（${group.skills.length} 技能）`)))
            : null,
          (preview.eventGroups || []).length
            ? h('div', { className: 'fd-chip-group' }, preview.eventGroups.map(group => h('span', { key: group.id, className: 'fd-event-pill' }, `${group.name}（${group.tracks.length} 轨）`)))
            : null)
        : null,
      preview && !preview.ok
        ? h('div', { className: 'fd-error' }, preview.error || '无法识别')
        : null))
}
