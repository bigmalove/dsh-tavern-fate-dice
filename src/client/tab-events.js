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
    h(FdField, { label: '轨名称' },
      h(FdText, { value: track.name, onChange: value => onPatch(track.id, { name: value }), placeholder: '例如：进展波折' })),
    h(FdField, { label: '模式' },
      h(FdSelect, {
        value: mode,
        options: FD_TRACK_MODES,
        onChange: value => onPatch(track.id, {
          mode: value,
          sides: value === 'd1' ? 1 : (value === 'd100' ? 100 : track.sides)
        })
      })),
    h(FdField, { label: '面数 sides' },
      h(FdNum, {
        value: track.sides,
        min: 1,
        max: 100,
        onChange: value => onPatch(track.id, { sides: fdClamp(value, 1, 100) })
      }))),

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
    note: '常驻肘击 + 进展波折 + 情绪氛围 + 叙事节奏'
  }, h('div', { className: 'fd-btn-row' },
    h(FdBtn, { primary: true, onClick: addGenericGroup }, '＋ 添加通用剧情样板组'))))

  if (hasGame) {
    const bindingChildren = [
      h('div', { key: 'long', className: 'fd-inline-fields' },
        h(FdField, { label: '长期事件组' },
          h(FdSelect, {
            value: binding.eventGroupId || '',
            options: groups.map(item => ({ value: item.id, label: item.name + '（' + item.tracks.length + ' 轨）' })),
            placeholder: '未绑定',
            onChange: value => actions.setBinding({ eventGroupId: value })
          })))
    ]
    if (view.enhanced) {
      bindingChildren.push(h('div', { key: 'scene', className: 'fd-inline-fields' },
        h(FdField, { label: '当前场景追加事件组' },
          h(FdSelect, {
            value: binding.sceneEventGroupId || '',
            options: groups.map(item => ({ value: item.id, label: item.name })),
            placeholder: '未配置场景追加',
            onChange: value => actions.setBinding({ sceneEventGroupId: value })
          }))))
      bindingChildren.push(binding.sceneSuspended
        ? h('div', { key: 'suspend', className: 'fd-row' },
          h('div', { className: 'fd-row-main' },
            h('span', { className: 'fd-row-title' }, '场景追加已因场景切换停用'),
            h('span', { className: 'fd-row-sub' }, '恢复后将按新场景重新匹配事件组')),
          h('div', { className: 'fd-row-end' },
            h(FdBtn, {
              small: true,
              primary: true,
              onClick: () => {
                fdSceneResume(ui, gameId).then(res => {
                  actions.setBinding({ sceneSuspended: false })
                  if (notify) notify(res.ok ? '场景追加已恢复' : '已在面板内恢复（宿主接口不可用）')
                })
              }
            }, '恢复场景追加')))
        : h('div', { key: 'scene-hint', className: 'fd-hint' }, '场景追加事件组在场景切换时会自动停用，可在上方恢复'))
    } else {
      bindingChildren.push(h('div', { key: 'off', className: 'fd-hint' }, '开启「剧情增强 3.2 双轨模式」（总览页）后可配置场景追加事件组'))
    }
    sections.push(h(FdSection, {
      title: '🔗 本局绑定',
      note: view.enhanced ? '剧情增强 3.2 双轨已开启' : '双轨未开启'
    }, bindingChildren))
  } else {
    sections.push(h(FdSection, { title: '🔗 本局绑定', note: '进入任意对话后可配置' },
      h('div', { className: 'fd-hint' }, '未进入对话：共享事件组仍可自由编辑与导出')))
  }

  sections.push(h(FdSection, {
    title: '🗂 共享事件组',
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
    h(FdField, { label: '组名 / 重命名' },
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
