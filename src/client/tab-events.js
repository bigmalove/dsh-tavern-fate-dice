/* ------------------------------------------------------------------ *
 * tab-events.js —— 随机事件标签页：样板组一键生成 / 绑定与场景追加 / 共享组管理 / 多轨骰编辑器
 * ------------------------------------------------------------------ */

function TrackEditor(props) {
  const { track, index, onPatch, onRemove } = props || {}
  const mode = track.mode
  const entryPatch = (entryIdx, patch) => onPatch(track.id, {
    entries: track.entries.map((entry, i) => (i === entryIdx ? { ...entry, ...patch } : entry))
  })

  return h(FdCollapse, {
    key: track.id || index,
    title: `${track.name || '未命名轨'}（${FD_TRACK_MODES.find(m => m.value === mode) ? FD_TRACK_MODES.find(m => m.value === mode).label : mode} · ${track.entries.length} 条${track.enabled ? '' : ' · 已停用'}）`,
    defaultOpen: index === 0,
    right: [
      h(FdSwitch, {
        key: 'sw',
        on: track.enabled,
        label: '启用该轨',
        onChange: next => onPatch(track.id, { enabled: next })
      }),
      h(FdBtn, { key: 'del', small: true, danger: true, onClick: () => onRemove(track.id) }, '删除轨')
    ]
  },
  h('div', { className: 'fd-inline-fields' },
    h(FdField, {
      label: '轨名称',
      help: '只是给你自己看的标签（折叠标题与删除时辨认用），不影响抽取逻辑；建议直接写这条轨的叙事职能，如「进展波折」「雨夜环境音」。'
    },
      h(FdText, { value: track.name, onChange: value => onPatch(track.id, { name: value }), placeholder: '例如：进展波折' })),
    h(FdField, {
      label: '模式',
      help: [
        'd1 常驻：整条轨的所有条目每轮全部生效，不受每轮上限与主题冷却限制，sides 固定为 1；因为「全部」都带上，建议一条轨只放 1 条。',
        'dn 等权骰：掷 1~sides 后把骰面按条目数均分映射到条目，概率近似均等、不会空抽；面数建议 ≥ 条目数，否则靠后的条目分不到骰面。',
        'd100 区间表：掷 1~100 后按条目的 min–max 区间命中，按顺序取第一条命中的；没有区间覆盖则本轮该轨不产出。',
        'weighted 权重池：按相对权重抽取，权重比即概率比，权重和不必等于 100。',
        '切换模式时会自动把 sides 调成该模式的合理默认值（d1→1、d100→100、其余保留原值）。'
      ].join('\n')
    },
      h(FdSelect, {
        value: mode,
        options: FD_TRACK_MODES,
        onChange: value => onPatch(track.id, {
          mode: value,
          sides: value === 'd1' ? 1 : (value === 'd100' ? 100 : track.sides)
        })
      })),
    h(FdField, {
      label: '面数 sides',
      help: '仅在 dn 等权骰模式（以及按面数分档的判定）下有意义：面数越多，单条条目被抽中的概率越低、空抽概率越高；1~100 有效。d1 常驻固定为 1，d100 区间表固定为 100，其余模式建议设成「条目数量」或略大于条目数，让每条都有机会又保留一点空拍。'
    },
      h(FdNum, {
        value: track.sides,
        min: 1,
        max: 100,
        onChange: value => onPatch(track.id, { sides: fdClamp(value, 1, 100) })
      }))),

  h(FdRow, {
    plain: true,
    title: '条目类型与主题标签',
    help: [
      '条目类型决定这条事件算「实质推进」还是「氛围润色」，并分别受设置页的两个上限约束：',
      '· 剧情推动：实质转折、阻碍、线索、关系变化——受「每轮剧情推动上限（0~3 条）」限制，超出上限的推动条目本轮直接丢弃。',
      '· 氛围描写：光影、神态、环境细节、镜头语言——受「每轮氛围描写上限（0~3 条）」限制，与推动各算各的，不互相抢名额。',
      '· 常驻固定：命中即无条件带上，不受两个上限、也不受主题冷却限制（d1 常驻轨里的条目全部按这个规则处理，所以常驻轨不宜放多条）。',
      '主题标签（线索/阻碍/关系/压迫/机会/氛围/代价/转折，也可自填）用于三件事：① 本轮去重——同一主题一轮最多只选 1 条（按轨道顺序先到先得）；② 同主题冷却——推动类条目命中后，接下来 N 个成功结算的新用户轮内不再抽中同主题推动（氛围类不参与冷却）；③ 设置页「临时主题屏蔽器」按主题名临时过滤，屏蔽期间带该主题的条目一律跳过（推动与氛围都算）。'
    ].join('\n')
  }),
  h(FdRow, {
    plain: true,
    title: '区间 / 权重 / AND 触发条件',
    help: [
      '区间（仅 d100 区间表显示）：本条目的 min–max 百分命中范围，例如 1 与 3 表示掷出 1~3 才命中；区间重叠时按条目顺序取第一条命中的，掷到没有任何区间覆盖的点数则本轮该轨不产出事件。',
      '权重（仅 weighted 权重池显示）：1~99，数字越大越容易被抽中，代表相对比例而非绝对百分比。',
      'AND 触发条件：条目下方的折叠区，可加任意多条条件，全部同时满足时该条才会真正生效；任一不满足，本轮该条被丢弃（不会改抽同轨其他条目）。三种写法——',
      '① MVU 变量：路径填 `好感.女主`（或 `/主角/意志`），运算符 `≥`，值填 `60`，即「女主好感 ≥ 60 才可能触发」。值看起来是数字时按数值比较，否则按文本比较；支持 = ≠ > < ≥ ≤ 包含 不包含。',
      '② 玩家输入关键词：把「路径」留空，关键词填在「值」里，多个用逗号/分号分隔（如 `告白，亲上去`），任意一个出现在玩家输入里即满足；运算符选「不包含」则反过来——输入里出现这些词时该条被屏蔽。注意关键词一定填在「值」里，填到路径里会被当成变量路径、永远匹配不上。',
      '③ 持续剧情线状态：路径写 `剧情线:<剧情线ID>`（如 `剧情线:plot-abc123`），运算符 `=`，值填 `active` / `paused` / `closed`，按该剧情线当前状态决定是否放行。',
      '没有条件＝任意输入都可能命中。'
    ].join('\n')
  }),

  track.entries.length
    ? track.entries.map((entry, entryIdx) => h('div', { key: entry.id || entryIdx, className: 'fd-entry' },
      h('div', { className: 'fd-entry-row' },
        h('div', { style: { flex: '1 1 200px' } }, h(FdText, {
          value: entry.text,
          placeholder: '事件内容文本',
          onChange: value => entryPatch(entryIdx, { text: value })
        })),
        h('div', { style: { flex: '0 0 118px' } }, h(FdSelect, {
          value: entry.type,
          options: FD_ENTRY_TYPES,
          onChange: value => entryPatch(entryIdx, { type: value })
        })),
        h('div', { style: { flex: '0 0 96px' } }, h(FdText, {
          value: entry.theme,
          placeholder: '主题',
          onChange: value => entryPatch(entryIdx, { theme: value })
        }))),
      h('div', { className: 'fd-entry-row' },
        mode === 'd100'
          ? h(Fragment, null,
            h('span', { className: 'fd-hint' }, '区间'),
            h(FdNum, { value: entry.min, min: 1, max: 100, ariaLabel: '起始', onChange: value => entryPatch(entryIdx, { min: fdClamp(value, 1, 100) }) }),
            h('span', { className: 'fd-hint' }, '—'),
            h(FdNum, { value: entry.max, min: 1, max: 100, ariaLabel: '结束', onChange: value => entryPatch(entryIdx, { max: fdClamp(value, 1, 100) }) }))
          : mode === 'weighted'
            ? h(Fragment, null,
              h('span', { className: 'fd-hint' }, '权重'),
              h(FdNum, { value: entry.weight, min: 1, max: 99, ariaLabel: '权重', onChange: value => entryPatch(entryIdx, { weight: fdClamp(value, 1, 99) }) }))
            : null,
        h(FdBtn, {
          small: true,
          danger: true,
          onClick: () => onPatch(track.id, { entries: track.entries.filter((_, i) => i !== entryIdx) })
        }, '删除条目')),
      h(FdCollapse, {
        title: `AND 条件（${entry.conditions.length}）`,
        sub: '全部满足才可能抽中',
        right: [h(FdBtn, {
          key: 'add-cond',
          small: true,
          onClick: () => entryPatch(entryIdx, {
            conditions: [...entry.conditions, { path: '', op: '=', value: '' }]
          })
        }, '＋ 条件')]
      },
      entry.conditions.length
        ? entry.conditions.map((cond, condIdx) => h('div', { key: condIdx, className: 'fd-cond' },
          h('div', { style: { flex: '1 1 120px' } }, h(FdText, {
            value: cond.path,
            placeholder: 'MVU 路径 / 输入词 / 剧情线状态',
            onChange: value => entryPatch(entryIdx, {
              conditions: entry.conditions.map((c, i) => (i === condIdx ? { ...c, path: value } : c))
            })
          })),
          h('div', { style: { flex: '0 0 84px' } }, h(FdSelect, {
            value: cond.op,
            options: FD_CONDITION_OPS.map(op => ({ value: op, label: op })),
            onChange: value => entryPatch(entryIdx, {
              conditions: entry.conditions.map((c, i) => (i === condIdx ? { ...c, op: value } : c))
            })
          })),
          h('div', { style: { flex: '1 1 100px' } }, h(FdText, {
            value: cond.value,
            placeholder: '值',
            onChange: value => entryPatch(entryIdx, {
              conditions: entry.conditions.map((c, i) => (i === condIdx ? { ...c, value } : c))
            })
          })),
          h(FdBtn, {
            small: true,
            danger: true,
            onClick: () => entryPatch(entryIdx, { conditions: entry.conditions.filter((_, i) => i !== condIdx) })
          }, '×')))
        : h('div', { className: 'fd-hint' }, '无条件：任意输入都可能命中')))
    )
    : h('div', { className: 'fd-hint' }, '该轨暂无条目'),
  h('div', { className: 'fd-btn-row' },
    h(FdBtn, {
      small: true,
      primary: true,
      onClick: () => onPatch(track.id, {
        entries: [...track.entries, {
          id: fdUid('ent'),
          text: '新事件条目',
          type: '推动',
          theme: '',
          min: 1,
          max: 1,
          weight: 1,
          conditions: []
        }]
      })
    }, '＋ 添加条目')))
}

function EventsTab(props) {
  const { ui, gameId, hasGame, view, actions, notify } = props || {}
  const groups = view.eventGroups || []
  const binding = view.binding || {}
  const [workingId, setWorkingId] = useState('')
  const [draft, setDraft] = useState(null)
  const [nameDraft, setNameDraft] = useState('')

  useEffect(() => {
    if (workingId) return
    const preset = binding.eventGroupId || (groups[0] && groups[0].id) || ''
    if (preset) setWorkingId(preset)
  }, [binding.eventGroupId, groups.length])

  useEffect(() => {
    const found = groups.find(group => group.id === workingId)
    if (found) {
      setDraft(fdClone(found))
      setNameDraft(found.name)
    } else if (!workingId) {
      setDraft(fdCreateEventGroup('未命名事件组'))
      setNameDraft('')
    }
  }, [workingId, groups.length])

  const current = draft || fdCreateEventGroup('未命名事件组')

  const patchTrack = (trackId, patch) => setDraft({
    ...current,
    tracks: current.tracks.map(track => (track.id === trackId ? { ...track, ...patch } : track))
  })

  const saveGroup = () => {
    const target = workingId || current.id || fdUid('evg')
    const group = fdNormalizeEventGroup({ ...current, id: target, name: (current.name || '事件组').trim() })
    const list = groups.some(item => item.id === target)
      ? groups.map(item => (item.id === target ? group : item))
      : [...groups, group]
    setWorkingId(target)
    actions.persistGroups('eventGroups', list)
    if (notify) notify('事件组已保存')
  }

  const addGenericGroup = () => {
    const group = fdNormalizeEventGroup(fdCreateGenericEventGroup('通用剧情样板组'))
    setWorkingId(group.id)
    actions.persistGroups('eventGroups', [...groups, group])
    if (hasGame) actions.setBinding({ eventGroupId: group.id })
    if (notify) notify('已创建通用剧情样板组（d1 常驻 + d6 波折 + d4 氛围 + d3 节奏）')
  }

  const addTrack = () => setDraft({
    ...current,
    tracks: [...current.tracks, fdNormalizeTrack({ name: '新轨道', mode: 'dn', sides: 6, entries: [] })]
  })

  const sections = []

  sections.push(h(FdSection, {
    title: '✨ 快速生成',
    note: '常驻肘击 + 进展波折 + 情绪氛围 + 叙事节奏',
    help: [
      '「通用剧情样板组」是一套开箱即用的四轨剧情引擎，点一次就为你新建一个独立事件组（不会改动、也不会覆盖你已有的任何组），若已进入对话还会顺手绑定为本局长期事件组。',
      '它内置四条轨道：① 常驻肘击（d1 常驻）——只有一条「局势持续施压：任何行动都带着额外代价」，每轮必定附带、且不占用随机名额，用来保证故事永远有阻力；② 进展波折（d6 等权骰）——6 条剧情推动：线索浮现、计划受阻、第三方插手、时间压力、关系升温或结冰、环境骤变，每轮按六面骰抽 1 条；③ 情绪氛围（d4 等权骰）——4 条氛围：暖意、紧张、远处杂音、沉默，负责光影与神态层面的细腻感；④ 叙事节奏（d3 等权骰）——3 条镜头语言：拉远概括、细节定格、节奏骤快被打断，用来控制单轮的叙述步调。',
      '四条轨道各抽各的、互不排斥，但最终仍受「每轮推动上限 / 氛围上限」和「同主题本轮只选 1 条」约束：典型单轮产出是「1 条常驻 + 1 条推动 + 1 条氛围」，而叙事节奏轨的三条也属于「氛围」主题，通常只有先出现的氛围条目生效——想让节奏轨抢到名额，把它的主题改成「节奏」之类的独立标签即可。',
      '常驻肘击轨是 d1 常驻，轨内所有条目每轮全部生效，不受上限与冷却限制（所以默认只放 1 条）。',
      '生成后就是一个普通共享事件组，可以自由改轨、改条目、删轨、改模式，也可以「复制组」派生出不同题材的变体。'
    ].join('\n')
  }, h('div', { className: 'fd-btn-row' },
    h(FdBtn, { primary: true, onClick: addGenericGroup }, '＋ 添加通用剧情样板组'))))

  if (hasGame) {
    const bindingChildren = [
      h('div', { key: 'long', className: 'fd-inline-fields' },
        h(FdField, {
          label: '长期事件组',
          help: '本局的常驻事件组，整场对话都在抽取范围内；下拉里列出全部共享事件组（括号内是轨道数）。改选立即生效、不需要保存。选「未绑定」＝本局不再产出长期事件，但场景追加组（若有）仍会照常工作。'
        },
          h(FdSelect, {
            value: binding.eventGroupId || '',
            options: groups.map(item => ({ value: item.id, label: item.name + '（' + item.tracks.length + ' 轨）' })),
            placeholder: '未绑定',
            onChange: value => actions.setBinding({ eventGroupId: value })
          })))
    ]
    if (view.enhanced) {
      bindingChildren.push(h('div', { key: 'scene', className: 'fd-inline-fields' },
        h(FdField, {
          label: '当前场景追加事件组',
          help: '只在这一场戏里额外叠加的事件组：它的轨道与长期事件组同时抽取、互不顶替，适合放「雨夜追踪」「拍卖会现场」这类场景专属事件。场景一旦切换会自动停用（防串味），可用下方「恢复场景追加」按新场景重新启用，或直接改选更匹配的组。留空＝本场景不追加任何事件。'
        },
          h(FdSelect, {
            value: binding.sceneEventGroupId || '',
            options: groups.map(item => ({ value: item.id, label: item.name })),
            placeholder: '未配置场景追加',
            onChange: value => actions.setBinding({ sceneEventGroupId: value })
          }))))
      bindingChildren.push(binding.sceneSuspended
        ? h(FdRow, {
          key: 'suspend',
          title: '场景追加已因场景切换停用',
          sub: '恢复后将按新场景重新匹配事件组',
          help: [
            '为什么会出现这一行：你在设置页填了「本局场景位置 MVU 变量路径」后，面板每轮都会读一次那个变量；一旦它的值变了（换场景了），旧的场景追加组会被自动挂起，避免新场景里还在抽上一个场景的专属事件。',
            '「恢复场景追加」＝把挂起状态清掉，让场景追加组重新参与抽取；建议先把「当前场景追加事件组」改成匹配新场景的组，再点恢复，否则会把上一场的组重新启用。',
            '宿主接口不可用时会直接在面板内清除挂起标记，面板侧同样生效。不填场景变量路径时这块永远不会出现，场景追加只能手动切换。'
          ].join('\n')
        },
          h(FdBtn, {
            small: true,
            primary: true,
            onClick: () => {
              fdSceneResume(ui, gameId).then(res => {
                actions.setBinding({ sceneSuspended: false })
                if (notify) notify(res.ok ? '场景追加已恢复' : '已在面板内恢复（宿主接口不可用）')
              })
            }
          }, '恢复场景追加'))
        : h('div', { key: 'scene-hint', className: 'fd-hint' }, '场景追加事件组在场景切换时会自动停用，可在上方恢复'))
    } else {
      bindingChildren.push(h('div', { key: 'off', className: 'fd-hint' }, '开启「剧情增强 3.2 双轨模式」（总览页）后可配置场景追加事件组'))
    }
    sections.push(h(FdSection, {
      title: '🔗 本局绑定',
      note: view.enhanced ? '剧情增强 3.2 双轨已开启' : '双轨未开启',
      help: [
        '绑定分两层，两层的结果是「叠加」而不是「二选一」：',
        '① 长期事件组：本局的常驻底座，整场对话一直都在，每轮都参与抽取；换个组长线题材就换它。',
        '② 当前场景追加事件组：只在这一场戏里额外叠上去的临时组（例如「雨夜追踪」「拍卖会现场」），与长期组的轨道各抽各的，两组的条目一起进入当轮的候选池；若两者选的是同一个组则不会重复叠加。',
        '场景切换时这些临时组会自动停用（面板里显示「场景追加已因场景切换停用」），避免离开场景后还在抽「拍卖会台上的木槌声」；点「恢复场景追加」可手动按新场景重新启用，也可以直接把追加组换成匹配新场景的组。',
        '两层都可留空：留空即该层不产出任何事件，不影响另一层。需要「换场景自动换组」的，请在设置页填「本局场景位置 MVU 变量路径」。',
        '「剧情增强 3.2 双轨」未开启时只能绑定长期组，场景追加整层隐藏。'
      ].join('\n')
    }, bindingChildren))
  } else {
    sections.push(h(FdSection, { title: '🔗 本局绑定', note: '进入任意对话后可配置' },
      h('div', { className: 'fd-hint' }, '未进入对话：共享事件组仍可自由编辑与导出')))
  }

  sections.push(h(FdSection, {
    title: '🗂 共享事件组',
    help: [
      '「共享事件组库」是跨对话共用的本地组库：这里每个组都能被任意对话绑定，改一次全局生效。下拉框只负责「选中哪个组来编辑」，选中本身不会绑定本局——绑定请在「本局绑定」里做，或在快速生成时自动绑。',
      '「新建组」给你一个只含 1 条推动条目的空壳；「复制组」把当前编辑中的组连轨道带条目一起复制成「 · 副本」，适合在原组上做出题材变体；「保存事件组」把当前草稿就地写回选中的那个组（会覆盖共享库里的旧值，所有引用它的对话都会变）；「删除组」从库中移除，正在绑定的对话会变成空指向。',
      '样板组（快速生成出来的四轨组）与手搓组在库里地位完全平等——样板只是省事，不是特殊类型，照样可以删轨、改模式、另存为新组。',
      '未进入对话时也能自由编辑、导入、导出这些组，绑定栏会隐藏。'
    ].join('\n'),
    actions: [
      h(FdBtn, {
        key: 'new',
        small: true,
        onClick: () => {
          const group = fdNormalizeEventGroup(fdCreateEventGroup('新建事件组'))
          setWorkingId(group.id)
          actions.persistGroups('eventGroups', [...groups, group])
        }
      }, '新建组'),
      h(FdBtn, {
        key: 'copy',
        small: true,
        onClick: () => {
          const group = fdNormalizeEventGroup({ ...current, id: fdUid('evg'), name: (current.name || '事件组') + ' · 副本' })
          setWorkingId(group.id)
          actions.persistGroups('eventGroups', [...groups, group])
        }
      }, '复制组'),
      h(FdBtn, { key: 'save', small: true, primary: true, onClick: saveGroup }, '保存事件组'),
      h(FdBtn, {
        key: 'del',
        small: true,
        danger: true,
        disabled: !workingId,
        onClick: () => {
          setWorkingId('')
          actions.persistGroups('eventGroups', groups.filter(item => item.id !== workingId))
          if (notify) notify('事件组已删除')
        }
      }, '删除组')
    ]
  },
  h('div', { className: 'fd-inline-fields' },
    h(FdSelect, {
      value: workingId,
      onChange: setWorkingId,
      options: groups.map(item => ({ value: item.id, label: item.name + '（' + item.tracks.length + ' 轨）' })),
      placeholder: groups.length ? '选择事件组…' : '暂无事件组'
    })),
  h('div', { className: 'fd-inline-fields' },
    h(FdField, {
      label: '组名 / 重命名',
      help: '只改当前编辑中草稿的名字，点「保存事件组」才写回共享库。重名不会报错也不会合并，库里允许同名，建议用「题材 · 用途」的写法区分（如「废土 · 夜巡追加」），避免绑定下拉里认不出来。'
    },
      h(FdText, {
        value: nameDraft,
        placeholder: '事件组名称',
        onChange: value => {
          setNameDraft(value)
          setDraft({ ...current, name: value })
        }
      })))))

  sections.push(h(FdSection, {
    title: '🎰 多轨骰子编辑器',
    note: current.tracks.length + ' 轨 · ' + current.tracks.reduce((sum, track) => sum + track.entries.length, 0) + ' 条事件',
    help: [
      '每条轨道就是一颗独立的小骰子，单轮各摇一次，互不影响；轨道里的每条条目都可能被抽中。总数上限由设置页的两个上限控制，轨道多不等于单轮一定塞满。',
      '轨道模式决定「怎么从条目里挑」，与面数 sides 配合使用：',
      '· d1 常驻：整条轨的所有条目每轮全部带上，且不受每轮上限与主题冷却限制，用于「世界永远在施压」这类恒定底色。因为全部条目都会生效，建议一条轨只放 1 条；sides 固定为 1。',
      '· dn 等权骰：掷 1~sides，把骰面按条目数量均分映射到条目（第 floor((点数−1)×条目数/面数) 条），概率近似均等、不会空抽。条目数少于面数时每条被覆盖的面更多；条目多于面数时部分条目永远分不到骰面——所以面数建议 ≥ 条目数。',
      '· d100 区间表：掷 1~100，按每条条目自己填的 min–max 百分区间命中，按条目顺序取「第一条」命中的（区间重叠时排在前面的优先）；没有任何区间覆盖掷出的点数，则本轮该轨不产出事件。适合用数字精确安排「稀有 1~3、常见 40~80」。',
      '· weighted 权重池：按每条条目的相对权重抽取，权重 1 与 5 的出现比是 1:5，权重和不必凑 100；想突出某条主线事件又不想手算区间时用它。',
      '轨道右侧开关可临时停用整轨（保留内容不删、本轮不参与抽取）；「删除轨」则是彻底移除。'
    ].join('\n'),
    actions: [h(FdBtn, { key: 'track', small: true, onClick: addTrack }, '＋ 添加轨道')]
  },
  current.tracks.length
    ? current.tracks.map((track, idx) => h(TrackEditor, {
      key: track.id || idx,
      track,
      index: idx,
      onPatch: patchTrack,
      onRemove: trackId => setDraft({
        ...current,
        tracks: current.tracks.filter(item => item.id !== trackId)
      })
    }))
    : h(FdEmpty, null, '暂无轨道：点击「添加通用剧情样板组」快速起步')))

  sections.push(h('div', { key: 'tail', className: 'fd-btn-row' },
    h(FdBtn, { primary: true, onClick: saveGroup }, '保存事件组'),
    h(FdBtn, { onClick: addTrack }, '＋ 添加轨道')))

  return h(Fragment, null, sections)
}
