/* ------------------------------------------------------------------ *
 * uikit.js —— 无状态基础组件（按钮/开关/输入/卡片/折叠），全部走 CSS 类
 * 仅依赖 React.createElement，不使用 useCallback 等非必需 hook
 * ------------------------------------------------------------------ */

function FdBtn(props) {
  const { children, onClick, primary, danger, small, disabled, title, ariaLabel } = props || {}
  const cls = 'fd-btn' + (primary ? ' is-primary' : '') + (danger ? ' is-danger' : '') + (small ? ' is-sm' : '')
  return h('button', {
    type: 'button',
    className: cls,
    onClick: typeof onClick === 'function' ? onClick : undefined,
    disabled: Boolean(disabled),
    title: title || undefined,
    'aria-label': ariaLabel || undefined
  }, children)
}

function FdChip(props) {
  const { children, onClick, active, title } = props || {}
  return h('button', {
    type: 'button',
    className: 'fd-chip' + (active ? ' is-active' : ''),
    onClick: typeof onClick === 'function' ? onClick : undefined,
    title: title || undefined,
    'aria-pressed': active ? 'true' : 'false'
  }, children)
}

function FdSwitch(props) {
  const { on, onChange, label } = props || {}
  return h('button', {
    type: 'button',
    className: 'fd-switch' + (on ? ' is-on' : ''),
    role: 'switch',
    'aria-checked': on ? 'true' : 'false',
    'aria-label': label || '开关',
    onClick: () => (typeof onChange === 'function' ? onChange(!on) : undefined)
  })
}

function FdField(props) {
  const { label, hint, children } = props || {}
  return h('label', { className: 'fd-field' },
    label ? h('span', { className: 'fd-field-label' }, label) : null,
    children,
    hint ? h('span', { className: 'fd-hint' }, hint) : null
  )
}

function FdText(props) {
  const { value, onChange, placeholder, inline, mono, maxLength } = props || {}
  return h('input', {
    className: 'fd-input' + (inline ? ' is-inline' : '') + (mono ? ' fd-mono' : ''),
    type: 'text',
    value: value === undefined || value === null ? '' : String(value),
    placeholder: placeholder || '',
    maxLength: maxLength || undefined,
    onChange: e => (typeof onChange === 'function' ? onChange(e.target.value) : undefined)
  })
}

function FdArea(props) {
  const { value, onChange, placeholder, rows } = props || {}
  return h('textarea', {
    className: 'fd-textarea',
    rows: rows || 6,
    value: value === undefined || value === null ? '' : String(value),
    placeholder: placeholder || '',
    onChange: e => (typeof onChange === 'function' ? onChange(e.target.value) : undefined)
  })
}

function FdNum(props) {
  const { value, onChange, min, max, step, ariaLabel } = props || {}
  return h('input', {
    className: 'fd-input is-num',
    type: 'number',
    value: value === undefined || value === null ? 0 : value,
    min: min === undefined ? undefined : min,
    max: max === undefined ? undefined : max,
    step: step === undefined ? 1 : step,
    'aria-label': ariaLabel || undefined,
    onChange: e => {
      if (typeof onChange !== 'function') return
      const next = Number(e.target.value)
      onChange(Number.isFinite(next) ? next : 0)
    }
  })
}

function FdSelect(props) {
  const { value, onChange, options, ariaLabel, placeholder } = props || {}
  const list = Array.isArray(options) ? options : []
  return h('select', {
    className: 'fd-select',
    value: value === undefined || value === null ? '' : String(value),
    'aria-label': ariaLabel || undefined,
    onChange: e => (typeof onChange === 'function' ? onChange(e.target.value) : undefined)
  },
  placeholder ? h('option', { value: '' }, placeholder) : null,
  list.map(opt => h('option', { key: String(opt.value), value: String(opt.value) }, String(opt.label || opt.value))))
}

function FdBadge(props) {
  const { children, tone, title } = props || {}
  return h('span', { className: 'fd-badge' + (tone ? ' is-' + tone : ''), title: title || undefined }, children)
}

function FdSection(props) {
  const { title, note, actions, children } = props || {}
  return h('section', { className: 'fd-section' },
    title || actions
      ? h('div', { className: 'fd-section-head' },
        h('span', { className: 'fd-section-title' }, title),
        note ? h('span', { className: 'fd-section-note' }, note) : null,
        actions ? h('div', { className: 'fd-btn-row' }, actions) : null)
      : null,
    children
  )
}

function FdRow(props) {
  const { title, sub, children, plain } = props || {}
  return h('div', { className: 'fd-row' + (plain ? ' is-plain' : '') },
    h('div', { className: 'fd-row-main' },
      h('span', { className: 'fd-row-title' }, title),
      sub ? h('span', { className: 'fd-row-sub' }, sub) : null),
    children ? h('div', { className: 'fd-row-end' }, children) : null
  )
}

function FdEmpty(props) {
  return h('div', { className: 'fd-empty' }, (props && props.children) || '暂无数据')
}

function FdCollapse(props) {
  const { title, sub, right, defaultOpen, children } = props || {}
  const [open, setOpen] = useState(Boolean(defaultOpen))
  return h('div', { className: 'fd-track' },
    h('div', { className: 'fd-track-head' },
      h('button', {
        type: 'button',
        className: 'fd-chip',
        onClick: () => setOpen(prev => !prev),
        'aria-expanded': open ? 'true' : 'false'
      }, open ? '▾ ' + String(title || '') : '▸ ' + String(title || '')),
      sub ? h('span', { className: 'fd-hint' }, sub) : null,
      right ? h('div', { className: 'fd-btn-row' }, right) : null),
    open ? h('div', { className: 'fd-track-body' }, children) : null
  )
}
