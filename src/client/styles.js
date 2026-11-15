/* ------------------------------------------------------------------ *
 * styles.js —— 全部样式（宿主主题变量驱动，深浅色双主题自适应）
 * 说明：不使用写死黑底白字，统一基于 currentColor 的 color-mix 半透明层，
 *      在浅色暖白主题与深色主题下都保持对比度与柔和边框。
 * ------------------------------------------------------------------ */

const CSS_TEXT = `
.fd-root {
  --fd-line: rgba(128, 128, 142, 0.24);
  --fd-line: color-mix(in oklab, currentColor 18%, transparent);
  --fd-line-soft: rgba(128, 128, 142, 0.14);
  --fd-line-soft: color-mix(in oklab, currentColor 11%, transparent);
  --fd-fill: rgba(128, 128, 142, 0.09);
  --fd-fill: color-mix(in oklab, currentColor 7%, transparent);
  --fd-fill-strong: rgba(128, 128, 142, 0.16);
  --fd-fill-strong: color-mix(in oklab, currentColor 13%, transparent);
  --fd-accent: var(--dsh-tavern-accent, #b9824a);
  --fd-accent-soft: rgba(185, 130, 74, 0.16);
  --fd-accent-soft: color-mix(in oklab, var(--fd-accent) 18%, transparent);
  --fd-ok: #2f8f66;
  --fd-warn: #b9772f;
  --fd-bad: #bb5044;
  --fd-shadow: 0 6px 20px rgba(30, 30, 40, 0.12);
  color: var(--dsh-ink, inherit);
  font-size: 13px;
  line-height: 1.55;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.fd-root *, .fd-root *::before, .fd-root *::after { box-sizing: border-box; }

.fd-wb-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.fd-wb-title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
  display: flex;
  align-items: center;
  gap: 6px;
}
.fd-wb-sub {
  font-size: 12px;
  opacity: 0.72;
  margin: 2px 0 0;
}

.fd-tabbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 3px;
  border-radius: 12px;
  background: var(--fd-fill);
  border: 1px solid var(--fd-line-soft);
}
.fd-tab {
  flex: 1 1 auto;
  min-height: 34px;
  padding: 5px 10px;
  border-radius: 9px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  white-space: nowrap;
  opacity: 0.78;
  transition: background 0.15s ease, opacity 0.15s ease;
}
.fd-tab.is-active {
  background: var(--fd-accent-soft);
  border-color: var(--fd-line);
  opacity: 1;
}

.fd-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border-radius: 12px;
  background: var(--fd-fill);
  border: 1px solid var(--fd-line-soft);
}
.fd-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.fd-section-title {
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  opacity: 0.9;
  display: flex;
  align-items: center;
  gap: 6px;
}
.fd-section-note { font-size: 11.5px; opacity: 0.62; }

.fd-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 8px;
}
.fd-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border-radius: 10px;
  background: var(--fd-fill);
  border: 1px solid var(--fd-line-soft);
}
.fd-card-title { font-size: 12.5px; font-weight: 650; }
.fd-card-sub { font-size: 11.5px; opacity: 0.66; }

.fd-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding: 6px 8px;
  border-radius: 9px;
  background: var(--fd-fill);
  border: 1px solid var(--fd-line-soft);
}
.fd-row.is-plain { background: transparent; border-color: transparent; padding: 4px 0; }
.fd-row-main { flex: 1 1 140px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fd-row-title { font-size: 12.5px; font-weight: 600; word-break: break-word; }
.fd-row-sub { font-size: 11.5px; opacity: 0.66; word-break: break-word; }
.fd-row-end { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.fd-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 650;
  border: 1px solid var(--fd-line);
  background: var(--fd-fill-strong);
  white-space: nowrap;
}
.fd-badge.is-ok { color: var(--fd-ok); border-color: color-mix(in oklab, var(--fd-ok) 45%, transparent); }
.fd-badge.is-warn { color: var(--fd-warn); border-color: color-mix(in oklab, var(--fd-warn) 45%, transparent); }
.fd-badge.is-bad { color: var(--fd-bad); border-color: color-mix(in oklab, var(--fd-bad) 45%, transparent); }
.fd-badge.is-off { opacity: 0.6; }
.fd-badge-row { display: flex; flex-wrap: wrap; gap: 6px; }

.fd-btn {
  min-height: 34px;
  padding: 5px 12px;
  border-radius: 9px;
  border: 1px solid var(--fd-line);
  background: var(--fd-fill-strong);
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  touch-action: manipulation;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition: filter 0.15s ease;
}
.fd-btn:hover:not(:disabled) { filter: brightness(1.06); }
.fd-btn.is-primary {
  background: var(--fd-accent-soft);
  border-color: color-mix(in oklab, var(--fd-accent) 55%, transparent);
  color: inherit;
}
.fd-btn.is-danger { color: var(--fd-bad); border-color: color-mix(in oklab, var(--fd-bad) 40%, transparent); }
.fd-btn.is-sm { min-height: 28px; padding: 2px 9px; font-size: 11.5px; border-radius: 8px; }
.fd-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.fd-btn-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

.fd-chip {
  min-height: 30px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--fd-line);
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  touch-action: manipulation;
  white-space: nowrap;
}
.fd-chip.is-active {
  background: var(--fd-accent-soft);
  border-color: color-mix(in oklab, var(--fd-accent) 60%, transparent);
  font-weight: 650;
}
.fd-chip-group { display: flex; flex-wrap: wrap; gap: 5px; }

.fd-input, .fd-select, .fd-textarea {
  width: 100%;
  border-radius: 9px;
  border: 1px solid var(--fd-line);
  background: var(--fd-fill);
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  padding: 7px 10px;
  min-height: 34px;
}
.fd-select { cursor: pointer; }
.fd-textarea { min-height: 96px; line-height: 1.5; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.fd-input.is-num { width: 64px; text-align: center; min-height: 30px; padding: 3px 6px; }
.fd-input.is-inline { min-height: 30px; padding: 3px 8px; }
.fd-field { display: flex; flex-direction: column; gap: 4px; }
.fd-field-label { font-size: 11.5px; font-weight: 650; opacity: 0.82; }
.fd-inline-fields { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-end; }
.fd-inline-fields > * { flex: 1 1 150px; min-width: 0; }

.fd-switch {
  position: relative;
  width: 44px;
  height: 26px;
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid var(--fd-line);
  background: var(--fd-fill-strong);
  cursor: pointer;
  padding: 0;
  touch-action: manipulation;
}
.fd-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.55;
  transition: transform 0.16s ease, opacity 0.16s ease;
}
.fd-switch.is-on {
  background: var(--fd-accent-soft);
  border-color: color-mix(in oklab, var(--fd-accent) 55%, transparent);
}
.fd-switch.is-on::after {
  transform: translateX(18px);
  background: var(--fd-accent);
  opacity: 0.95;
}

.fd-stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}
.fd-stat-cell {
  padding: 8px 6px;
  border-radius: 10px;
  background: var(--fd-fill);
  border: 1px solid var(--fd-line-soft);
  text-align: center;
}
.fd-stat-num { display: block; font-size: 17px; font-weight: 700; }
.fd-stat-lbl { font-size: 11px; opacity: 0.68; }

.fd-list { display: flex; flex-direction: column; gap: 5px; }
.fd-list-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
.fd-empty { font-size: 12px; opacity: 0.6; padding: 6px 2px; }
.fd-hint { font-size: 11.5px; opacity: 0.66; }
.fd-error { font-size: 12px; color: var(--fd-bad); }
.fd-toast {
  position: sticky;
  bottom: 0;
  font-size: 11.5px;
  padding: 6px 10px;
  border-radius: 9px;
  background: var(--fd-fill-strong);
  border: 1px solid var(--fd-line);
}

.fd-track {
  border-radius: 10px;
  border: 1px solid var(--fd-line-soft);
  background: var(--fd-fill);
  overflow: hidden;
}
.fd-track-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 7px 9px;
  border-bottom: 1px solid var(--fd-line-soft);
}
.fd-track-body { display: flex; flex-direction: column; gap: 6px; padding: 8px 9px; }
.fd-entry {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 7px 8px;
  border-radius: 9px;
  border: 1px solid var(--fd-line-soft);
  background: var(--fd-fill);
}
.fd-entry-row { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.fd-cond { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; padding-top: 4px; border-top: 1px dashed var(--fd-line-soft); }
.fd-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }

/* ---------- 输入栏上方非阻塞揭晓动效条 ---------- */
.fd-live-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 11px;
  border-radius: 12px;
  background: var(--fd-fill);
  border: 1px solid var(--fd-line);
  color: var(--dsh-ink, inherit);
  box-shadow: var(--fd-shadow);
  cursor: pointer;
  user-select: none;
  touch-action: manipulation;
  overflow: hidden;
  animation: fd-rise 0.22s ease-out;
}
.fd-live-card[data-tier="critical"] { border-color: color-mix(in oklab, #d99a2b 68%, transparent); }
.fd-live-card[data-tier="success"] { border-color: color-mix(in oklab, var(--fd-ok) 55%, transparent); }
.fd-live-card[data-tier="costly"] { border-color: color-mix(in oklab, var(--fd-warn) 58%, transparent); }
.fd-live-card[data-tier="failure"], .fd-live-card[data-tier="fumble"] { border-color: color-mix(in oklab, var(--fd-bad) 58%, transparent); }
.fd-live-card[data-tier="hidden"] { border-color: var(--fd-line); }
.fd-die-stage { display: flex; align-items: center; gap: 5px; flex: 0 0 auto; }
.fd-die-svg { width: 34px; height: 34px; flex: 0 0 auto; }
.fd-die-svg.is-rolling { animation: fd-tumble 0.72s cubic-bezier(0.22, 1.28, 0.36, 1) forwards; }
.fd-die-svg.is-settled[data-tier="critical"] { animation: fd-pop 0.36s ease-out; }
.fd-live-body { flex: 1 1 140px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fd-live-title {
  display: flex; align-items: center; gap: 6px;
  font-size: 12.5px; font-weight: 650;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.fd-live-sub { font-size: 11.5px; opacity: 0.74; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-tier-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 8px; border-radius: 999px;
  font-size: 11px; font-weight: 700; flex: 0 0 auto;
  background: var(--fd-fill-strong);
  border: 1px solid var(--fd-line);
}
.fd-tier-pill[data-tier="critical"] { color: #b8860b; border-color: color-mix(in oklab, #d99a2b 55%, transparent); }
.fd-tier-pill[data-tier="success"] { color: var(--fd-ok); }
.fd-tier-pill[data-tier="costly"] { color: var(--fd-warn); }
.fd-tier-pill[data-tier="failure"], .fd-tier-pill[data-tier="fumble"] { color: var(--fd-bad); }
.fd-tier-pill[data-tier="hidden"] { opacity: 0.75; }
.fd-event-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 1px 8px; border-radius: 999px;
  font-size: 11px;
  background: var(--fd-fill-strong);
  border: 1px dashed var(--fd-line);
  max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* ---------- 楼层折叠胶囊 ---------- */
.fd-turn-capsule {
  margin-bottom: 8px;
  border-radius: 10px;
  border: 1px solid var(--fd-line-soft);
  background: var(--fd-fill);
  overflow: hidden;
  color: var(--dsh-ink, inherit);
}
.fd-turn-head {
  width: 100%;
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
}
.fd-turn-head-left { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
.fd-turn-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-turn-details {
  padding: 7px 11px 10px;
  border-top: 1px dashed var(--fd-line-soft);
  font-size: 11.5px;
  line-height: 1.6;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 10px;
  margin: 0;
}
.fd-turn-dt { opacity: 0.6; white-space: nowrap; }
.fd-turn-dd { margin: 0; word-break: break-word; }
.fd-turn-events { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 3px; }

/* ---------- 状态卡 ---------- */
.fd-status { display: flex; flex-direction: column; gap: 9px; font-size: 12.5px; color: var(--dsh-ink, inherit); }

@keyframes fd-tumble {
  0% { transform: translateY(-18px) rotateX(0deg) rotateZ(-200deg) scale(0.72); opacity: 0.25; }
  55% { transform: translateY(3px) rotateX(330deg) rotateZ(18deg) scale(1.1); opacity: 1; }
  78% { transform: translateY(-3px) rotateX(360deg) rotateZ(-6deg) scale(0.97); }
  100% { transform: translateY(0) rotateX(360deg) rotateZ(0deg) scale(1); opacity: 1; }
}
@keyframes fd-pop {
  0% { transform: scale(1); }
  45% { transform: scale(1.2); }
  100% { transform: scale(1); }
}
@keyframes fd-rise {
  from { transform: translateY(4px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* ---------- 手机竖屏 / 窄栏单列 ---------- */
@media (max-width: 720px) {
  .fd-card-grid { grid-template-columns: 1fr; }
  .fd-tabbar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .fd-tab { flex: 1 1 auto; }
  .fd-inline-fields > * { flex: 1 1 100%; }
  .fd-live-sub { white-space: normal; }
  .fd-row { align-items: flex-start; }
}
@media (max-width: 420px) {
  .fd-tabbar { grid-template-columns: 1fr; }
  .fd-stat-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (prefers-reduced-motion: reduce) {
  .fd-die-svg.is-rolling, .fd-die-svg.is-settled, .fd-live-card { animation: none !important; }
}
`
