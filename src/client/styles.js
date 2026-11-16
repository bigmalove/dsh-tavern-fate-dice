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

/* ---------- 右侧栏工作台：双层弹性滚动架构 ----------
 * 宿主 betterSidebar 的页签容器是固定高度 + overflow:hidden 的弹性盒，
 * 因此面板根节点必须自己填满高度并把滚动交给内层 .fd-wb-scroll，
 * 否则内容超出视口会被直接截断、无法下滑。 */
.fd-root.fd-workbench {
  position: relative;
  width: 100%;
  height: 100%;
  max-height: 100%;
  min-height: 0;
  min-width: 0;
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 10px 12px 0;
  gap: 0;
}
.fd-wb-top {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 8px;
}
.fd-wb-scroll {
  flex: 1 1 0%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 2px 2px 48px;
}
/* 子卡片在 flex 列中不许被压缩，否则永远撑不出滚动条 */
.fd-wb-scroll > * { flex-shrink: 0; }
.fd-wb-scroll::-webkit-scrollbar { width: 8px; }
.fd-wb-scroll::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: var(--fd-line);
}
.fd-wb-scroll::-webkit-scrollbar-track { background: transparent; }
.fd-workbench > .fd-toast {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 10px;
  z-index: 5;
  box-shadow: var(--fd-shadow);
}

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
  font-weight: 650;
  cursor: pointer;
  touch-action: manipulation;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  box-shadow: 0 1px 2px rgba(24, 24, 32, 0.08);
  transition: transform 0.14s ease, filter 0.15s ease, box-shadow 0.15s ease;
}
.fd-btn:hover:not(:disabled) {
  transform: translateY(-0.5px);
  filter: brightness(1.06);
  box-shadow: 0 2px 6px rgba(24, 24, 32, 0.13);
}
.fd-btn:active:not(:disabled) { transform: translateY(0.5px); }
.fd-btn.is-primary {
  background: color-mix(in oklab, var(--fd-accent) 26%, var(--fd-fill-strong));
  border-color: color-mix(in oklab, var(--fd-accent) 68%, transparent);
  color: inherit;
}
.fd-btn.is-danger {
  background: color-mix(in oklab, var(--fd-bad) 14%, var(--fd-fill-strong));
  color: var(--fd-bad);
  border-color: color-mix(in oklab, var(--fd-bad) 52%, transparent);
}
.fd-btn.is-sm { min-height: 29px; padding: 3px 10px; font-size: 11.5px; border-radius: 8px; }
.fd-btn:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; transform: none; }
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
.fd-skip-note {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 10px;
  background: var(--fd-fill);
  border: 1px dashed var(--fd-line);
  color: var(--dsh-ink, inherit);
  font-size: 11.5px;
  opacity: 0.82;
  cursor: pointer;
  user-select: none;
  animation: fd-rise 0.2s ease-out;
}
.fd-skip-icon { flex: 0 0 auto; opacity: 0.75; filter: grayscale(1); }
.fd-skip-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fd-skip-check { flex: 0 0 auto; opacity: 0.6; }
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

/* ---------- 状态卡 ---------- */
.fd-status { display: flex; flex-direction: column; gap: 9px; font-size: 12.5px; color: var(--dsh-ink, inherit); }

/* ---------- 说明气泡（? 按钮 + 就地展开卡片） ---------- */
.fd-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}
.fd-help {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  vertical-align: middle;
}
.fd-help.is-open { flex: 1 1 100%; }
.fd-help-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 17px;
  height: 17px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid color-mix(in oklab, var(--fd-accent) 48%, transparent);
  background: color-mix(in oklab, var(--fd-accent) 12%, transparent);
  color: color-mix(in oklab, var(--fd-accent) 86%, currentColor);
  font: inherit;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
  transition: transform 0.16s ease, background 0.16s ease, color 0.16s ease;
}
.fd-help-btn:hover {
  transform: scale(1.1);
  background: color-mix(in oklab, var(--fd-accent) 24%, transparent);
}
.fd-help-btn:focus-visible {
  outline: 2px solid color-mix(in oklab, var(--fd-accent) 62%, transparent);
  outline-offset: 1px;
}
.fd-help-btn.is-open {
  background: color-mix(in oklab, var(--fd-accent) 90%, transparent);
  border-color: color-mix(in oklab, var(--fd-accent) 90%, transparent);
  color: var(--fd-on-accent, #fff);
}
.fd-help-pop {
  flex: 1 1 100%;
  width: 100%;
  margin: 5px 0 2px;
  padding: 8px 10px 9px 12px;
  border-radius: 10px;
  border: 1px solid color-mix(in oklab, var(--fd-accent) 30%, var(--fd-line-soft, transparent));
  border-left: 3px solid color-mix(in oklab, var(--fd-accent) 82%, transparent);
  background: color-mix(in oklab, var(--fd-accent) 7%, var(--fd-fill, transparent));
  color: inherit;
  box-shadow: 0 3px 12px color-mix(in oklab, var(--fd-accent) 12%, transparent);
  animation: fd-rise 0.16s ease-out both;
}
.fd-help-pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 3px;
}
.fd-help-pop-title {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: color-mix(in oklab, var(--fd-accent) 78%, currentColor);
  opacity: 0.96;
}
.fd-help-close {
  flex: 0 0 auto;
  padding: 0 5px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 10.5px;
  line-height: 1.6;
  opacity: 0.66;
  cursor: pointer;
  touch-action: manipulation;
}
.fd-help-close:hover {
  opacity: 1;
  background: color-mix(in oklab, currentColor 10%, transparent);
  border-color: color-mix(in oklab, currentColor 16%, transparent);
}
.fd-help-pop-body { display: flex; flex-direction: column; gap: 4px; }
.fd-help-line {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.72;
  word-break: break-word;
  opacity: 0.92;
}

/* ---------- 琥珀色引导横幅（未配置决策模型） ---------- */
.fd-guide-banner {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid color-mix(in oklab, var(--fd-warn) 44%, transparent);
  background: color-mix(in oklab, var(--fd-warn) 14%, var(--fd-surface, transparent));
  color: inherit;
  box-shadow: 0 3px 14px color-mix(in oklab, var(--fd-warn) 16%, transparent);
  animation: fd-rise 0.2s ease-out both;
}
.fd-guide-banner.is-lite {
  gap: 4px;
  padding: 8px 10px;
  border-radius: 10px;
  box-shadow: none;
  cursor: pointer;
  touch-action: manipulation;
}
.fd-guide-banner-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.fd-guide-banner-icon { flex: 0 0 auto; font-size: 15px; line-height: 1; }
.fd-guide-banner-title {
  font-size: 12.5px;
  font-weight: 700;
  line-height: 1.5;
  color: color-mix(in oklab, var(--fd-warn) 72%, currentColor);
  word-break: break-word;
}
.fd-guide-banner-steps {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 0;
  padding: 0;
}
.fd-guide-banner-step {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.72;
  word-break: break-word;
  opacity: 0.94;
}
.fd-guide-banner-meta {
  font-size: 11px;
  line-height: 1.6;
  opacity: 0.72;
  word-break: break-word;
}

/* ---------- AI 角色能力画像 ---------- */
.fd-profile-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.fd-profile-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.fd-profile-name { font-size: 13.5px; font-weight: 700; }
.fd-profile-arch { font-size: 12px; opacity: 0.78; word-break: break-word; }
.fd-profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 6px;
}
.fd-profile-trait {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 7px 9px;
  border-radius: 10px;
  background: var(--fd-fill);
  border: 1px solid var(--fd-line-soft);
  border-left-width: 3px;
  min-width: 0;
}
.fd-profile-trait.is-good { border-left-color: var(--fd-ok); }
.fd-profile-trait.is-bad { border-left-color: var(--fd-bad); }
.fd-profile-trait.is-neutral { border-left-color: var(--fd-warn); }
.fd-profile-trait-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.fd-profile-trait-label { font-size: 12.5px; font-weight: 650; word-break: break-word; }
.fd-profile-trait-bonus {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.fd-profile-trait-bonus.is-good { color: var(--fd-ok); }
.fd-profile-trait-bonus.is-bad { color: var(--fd-bad); }
.fd-profile-trait-bonus.is-neutral { color: var(--fd-warn); }
.fd-profile-trait-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  font-size: 10.5px;
  opacity: 0.72;
}
.fd-profile-trait-reason {
  font-size: 11px;
  line-height: 1.55;
  opacity: 0.78;
  word-break: break-word;
}
.fd-ctx-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px;
}
.fd-ctx-cell {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 9px;
  border-radius: 10px;
  background: var(--fd-fill);
  border: 1px solid var(--fd-line-soft);
  min-width: 0;
}
.fd-ctx-cell.is-on { border-color: color-mix(in oklab, var(--fd-ok) 38%, transparent); }
.fd-ctx-cell.is-off { opacity: 0.72; }
.fd-ctx-title { font-size: 11.5px; font-weight: 650; }
.fd-ctx-value { font-size: 12px; word-break: break-word; }
.fd-ctx-sub { font-size: 10.5px; opacity: 0.66; word-break: break-word; }
.fd-mvu-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}
.fd-mvu-pill {
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--fd-fill-strong);
  border: 1px solid var(--fd-line-soft);
  word-break: break-all;
}

/* ---------- 楼层顶栏并列检定胶囊（对齐叙事阻尼器 StoryFloorDamperPill / Panel） ---------- */
.fd-floor-head-slot {
  display: inline-flex;
  align-items: center;
}
.fd-floor-pill {
  --fd-pill-color: #3f9d68;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--fd-pill-color) 34%, var(--dsw-alias-border-l2, rgba(128,128,142,0.28)));
  border-radius: 999px;
  background: color-mix(in srgb, var(--fd-pill-color) 10%, transparent);
  color: var(--dsw-alias-label-secondary, inherit);
  font: inherit;
  font-size: 11px;
  line-height: 18px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background .15s ease, border-color .15s ease, color .15s ease;
}
.fd-floor-pill:hover {
  background: color-mix(in srgb, var(--fd-pill-color) 18%, transparent);
  border-color: color-mix(in srgb, var(--fd-pill-color) 52%, var(--dsw-alias-border-l2, rgba(128,128,142,0.36)));
  color: var(--dsw-alias-label-primary, inherit);
}
.fd-floor-pill[data-expanded="true"] {
  background: color-mix(in srgb, var(--fd-pill-color) 20%, transparent);
  border-color: color-mix(in srgb, var(--fd-pill-color) 60%, var(--dsw-alias-border-l2, rgba(128,128,142,0.42)));
  color: var(--dsw-alias-label-primary, inherit);
}
.fd-floor-pill[data-tone="critical"] { --fd-pill-color: #26a269; }
.fd-floor-pill[data-tone="success"] { --fd-pill-color: #3f9d68; }
.fd-floor-pill[data-tone="costly"] { --fd-pill-color: #d4712a; }
.fd-floor-pill[data-tone="failure"] { --fd-pill-color: #d05842; }
.fd-floor-pill[data-tone="fumble"] { --fd-pill-color: #cf4343; }
.fd-floor-pill[data-tone="hidden"] { --fd-pill-color: #6e7787; }
.fd-floor-pill[data-tone="skipped"] {
  --fd-pill-color: #8a8f98;
  border-style: dashed;
  color: var(--dsw-alias-label-tertiary, inherit);
}
.fd-floor-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--fd-pill-color);
  flex: none;
}
.fd-floor-pill[data-tone="skipped"] .fd-floor-dot {
  background: transparent;
  box-sizing: border-box;
  border: 1.5px solid var(--fd-pill-color);
}
/* 骰子图标：桌面端不显示（显示圆点 + 全文），窄屏/触屏只留这一枚图标。
 * 用 mask 而不是内联 SVG，三处胶囊（楼层顶栏 / 轮次胶囊 / 输入栏）共用同一套样式。 */
.fd-floor-pill-icon {
  display: none;
  flex: none;
  width: 13px;
  height: 13px;
  background: var(--fd-pill-color);
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cg fill='none' stroke='%23000' stroke-width='2' stroke-linejoin='round'%3E%3Crect x='3.4' y='3.4' width='17.2' height='17.2' rx='4.8'/%3E%3C/g%3E%3Cg fill='%23000'%3E%3Ccircle cx='8.4' cy='8.4' r='1.55'/%3E%3Ccircle cx='15.6' cy='8.4' r='1.55'/%3E%3Ccircle cx='12' cy='12' r='1.55'/%3E%3Ccircle cx='8.4' cy='15.6' r='1.55'/%3E%3Ccircle cx='15.6' cy='15.6' r='1.55'/%3E%3C/g%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cg fill='none' stroke='%23000' stroke-width='2' stroke-linejoin='round'%3E%3Crect x='3.4' y='3.4' width='17.2' height='17.2' rx='4.8'/%3E%3C/g%3E%3Cg fill='%23000'%3E%3Ccircle cx='8.4' cy='8.4' r='1.55'/%3E%3Ccircle cx='15.6' cy='8.4' r='1.55'/%3E%3Ccircle cx='12' cy='12' r='1.55'/%3E%3Ccircle cx='8.4' cy='15.6' r='1.55'/%3E%3Ccircle cx='15.6' cy='15.6' r='1.55'/%3E%3C/g%3E%3C/svg%3E") center / contain no-repeat;
}
.fd-floor-panel-slot {
  flex: 0 0 100%;
  min-width: 0;
}
.fd-floor-panel-slot:empty {
  display: none;
}
.fd-floor-panel {
  --fd-pill-color: #3f9d68;
  display: grid;
  gap: 8px;
  max-width: min(100%, 760px);
  box-sizing: border-box;
  margin: 4px 0 6px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--fd-pill-color) 30%, var(--dsw-alias-border-l2, rgba(128,128,142,0.28)));
  border-left: 3px solid var(--fd-pill-color);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1, rgba(128,128,142,0.06));
  color: var(--dsw-alias-label-secondary, inherit);
  font-size: 12px;
  line-height: 1.55;
}
.fd-floor-panel[data-tone="critical"] { --fd-pill-color: #26a269; }
.fd-floor-panel[data-tone="success"] { --fd-pill-color: #3f9d68; }
.fd-floor-panel[data-tone="costly"] { --fd-pill-color: #d4712a; }
.fd-floor-panel[data-tone="failure"] { --fd-pill-color: #d05842; }
.fd-floor-panel[data-tone="fumble"] { --fd-pill-color: #cf4343; }
.fd-floor-panel[data-tone="hidden"] { --fd-pill-color: #6e7787; }
.fd-floor-panel[data-tone="skipped"] { --fd-pill-color: #8a8f98; }
.fd-floor-panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 10px;
}
.fd-floor-panel-title {
  font-weight: 650;
  color: var(--dsw-alias-label-primary, inherit);
}
.fd-floor-panel-tags {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}
.fd-floor-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  background: rgba(128,128,142,0.12);
  border: 1px solid rgba(128,128,142,0.22);
}
.fd-floor-panel-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 8px;
  padding-top: 2px;
}

/* ---------- 输入栏左下角悬浮骰子胶囊与弹出裁定小窗 ---------- */
.fd-composer-dock-wrap {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.fd-floor-pill.fd-composer-pill {
  height: auto;
  min-height: 24px;
  padding: 3px 9px;
  font-size: 12px;
  line-height: 1.4;
  max-width: min(100%, 340px);
  overflow: hidden;
  text-overflow: ellipsis;
  backdrop-filter: blur(6px);
}
.fd-floor-pill.fd-composer-pill[data-tone="idle"] {
  --fd-pill-color: var(--dsh-tavern-accent, #b9824a);
  border-color: transparent;
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
}
.fd-floor-pill.fd-composer-pill[data-tone="idle"]:hover,
.fd-floor-pill.fd-composer-pill[data-tone="idle"][data-expanded="true"] {
  background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.1));
  border-color: var(--dsw-alias-border-l2, rgba(128, 128, 142, 0.22));
}
.fd-floor-pill.fd-composer-pill:not([data-tone="idle"]) {
  background: linear-gradient(color-mix(in srgb, var(--fd-pill-color) 11%, transparent) 0 0) color-mix(in srgb, var(--dsw-alias-bg-base, Canvas) 88%, transparent);
}
.fd-floor-pill.fd-composer-pill:not([data-tone="idle"]):hover,
.fd-floor-pill.fd-composer-pill:not([data-tone="idle"])[data-expanded="true"] {
  background: linear-gradient(color-mix(in srgb, var(--fd-pill-color) 20%, transparent) 0 0) color-mix(in srgb, var(--dsw-alias-bg-base, Canvas) 92%, transparent);
}
.fd-floor-panel.fd-composer-popover {
  position: fixed;
  z-index: 9500;
  margin: 0;
  border-radius: 10px;
  overflow-y: auto;
  overscroll-behavior: contain;
  background: linear-gradient(color-mix(in srgb, var(--fd-pill-color) 6%, var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-base, #fff))) 0 0) Canvas;
  box-shadow: 0 12px 32px rgba(20, 20, 32, 0.18), 0 2px 8px rgba(20, 20, 32, 0.08);
  animation: fd-rise 0.16s ease-out;
}
.fd-popover-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 999px;
  border: 1px solid transparent;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  opacity: 0.62;
  cursor: pointer;
  touch-action: manipulation;
}
.fd-popover-close:hover {
  opacity: 1;
  background: rgba(128, 128, 142, 0.14);
}

/* ---------- 命运点醒目英雄卡与规则三宫格 ---------- */
.fd-fate-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 14px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1.5px solid color-mix(in srgb, #c88a22 42%, var(--fd-line));
  background: linear-gradient(135deg, rgba(208, 146, 40, 0.11), rgba(63, 157, 104, 0.06));
}
.fd-fate-hero.is-empty {
  border-color: color-mix(in srgb, #cf4343 45%, var(--fd-line));
  background: linear-gradient(135deg, rgba(207, 67, 67, 0.10), rgba(128, 128, 142, 0.05));
}
.fd-fate-main {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 180px;
}
.fd-fate-eyebrow {
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  opacity: 0.78;
}
.fd-fate-meter-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.fd-fate-orbs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.fd-fate-orb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  font-size: 16px;
  font-weight: 800;
  border: 1.5px dashed var(--fd-line);
  background: rgba(128, 128, 142, 0.06);
  opacity: 0.42;
  transition: transform .16s ease, opacity .16s ease, background .16s ease;
}
.fd-fate-orb.is-lit {
  opacity: 1;
  border-style: solid;
  border-color: rgba(202, 138, 28, 0.68);
  background: rgba(226, 162, 46, 0.20);
  color: #b87314;
  box-shadow: 0 1px 6px rgba(202, 138, 28, 0.18);
}
.fd-fate-num {
  font-size: 21px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.02em;
}
.fd-fate-status {
  font-size: 12px;
  font-weight: 600;
  opacity: 0.88;
}
.fd-fate-charge {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 11px;
  border-radius: 10px;
  background: var(--fd-fill);
  border: 1px solid var(--fd-line-soft);
  min-width: 190px;
  flex: 1 1 200px;
  max-width: 320px;
}
.fd-fate-charge-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
  font-weight: 650;
}
.fd-fate-pips {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px;
}
.fd-fate-pip {
  height: 7px;
  border-radius: 999px;
  background: rgba(128, 128, 142, 0.18);
  border: 1px solid var(--fd-line-soft);
}
.fd-fate-pip.is-lit {
  background: #d4712a;
  border-color: rgba(212, 113, 42, 0.65);
}
.fd-fate-latest-box {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 11px 9px;
  border-radius: 11px;
  background: color-mix(in srgb, currentColor 3.5%, transparent);
  border: 1px solid var(--fd-line);
}
.fd-fate-latest-box .fd-turn-capsule {
  margin-bottom: 0;
}
.fd-fate-latest-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.fd-fate-latest-title {
  font-size: 12px;
  font-weight: 750;
  opacity: 0.92;
}

/* ---------- 醒目重投操作台与高对比实心双按钮 ---------- */
.fd-reroll-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 2px 10px 10px;
  padding: 10px 11px;
  border-radius: 10px;
  background: color-mix(in srgb, #c88a22 9%, rgba(128, 128, 142, 0.06));
  border: 1px solid color-mix(in srgb, #c88a22 36%, var(--fd-line));
}
.fd-reroll-bar.is-compact {
  margin: 2px 0 0;
  padding: 9px 10px;
}
.fd-reroll-prompt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11.5px;
  font-weight: 700;
  opacity: 0.9;
}
.fd-reroll-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(215px, 1fr));
  gap: 8px;
}
.fd-reroll-btn {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 3px;
  min-height: 52px;
  padding: 9px 13px;
  border-radius: 10px;
  font: inherit;
  text-align: left;
  color: #ffffff;
  cursor: pointer;
  user-select: none;
  touch-action: manipulation;
  transition: transform 0.14s ease, box-shadow 0.14s ease, filter 0.14s ease;
}
.fd-reroll-bar.is-compact .fd-reroll-btn {
  min-height: 46px;
  padding: 7px 11px;
}
.fd-reroll-btn.is-fate {
  background: linear-gradient(180deg, #cc851f 0%, #aa6610 100%);
  border: 1px solid #8c5108;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.30), 0 3px 10px rgba(170, 102, 16, 0.30);
}
.fd-reroll-btn.is-push {
  background: linear-gradient(180deg, #c94c3d 0%, #a53426 100%);
  border: 1px solid #88261a;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.26), 0 3px 10px rgba(165, 52, 38, 0.28);
}
.fd-reroll-btn:hover:not(:disabled) {
  transform: translateY(-1.5px);
  filter: brightness(1.07);
}
.fd-reroll-btn.is-fate:hover:not(:disabled) {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.36), 0 6px 15px rgba(170, 102, 16, 0.40);
}
.fd-reroll-btn.is-push:hover:not(:disabled) {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32), 0 6px 15px rgba(165, 52, 38, 0.38);
}
.fd-reroll-btn:active:not(:disabled) {
  transform: translateY(0.5px);
  filter: brightness(0.96);
}
.fd-reroll-btn:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.fd-reroll-btn:disabled {
  opacity: 0.58;
  cursor: wait;
  transform: none;
  box-shadow: none;
}
.fd-reroll-btn-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.fd-reroll-btn-title {
  font-size: 13.5px;
  font-weight: 800;
  letter-spacing: 0.01em;
  line-height: 1.25;
  color: #ffffff;
}
.fd-reroll-btn-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.45;
  white-space: nowrap;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid rgba(255, 255, 255, 0.26);
  color: #ffffff;
}
.fd-reroll-btn-sub {
  font-size: 11px;
  line-height: 1.35;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.90);
}
.fd-reroll-foot {
  font-size: 11px;
  line-height: 1.45;
  opacity: 0.76;
}
.fd-reroll-done {
  margin: 2px 10px 10px;
  padding: 8px 11px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 650;
  line-height: 1.5;
  background: color-mix(in srgb, var(--fd-ok) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--fd-ok) 45%, var(--fd-line));
}
.fd-reroll-done.is-compact {
  margin: 2px 0 0;
}
.fd-reroll-status {
  padding: 4px 11px 9px;
  font-size: 11.5px;
  opacity: 0.72;
}
.fd-reroll-status.is-compact {
  padding: 2px 0 0;
}

/* ---------- 静态规则附注（纯文本竖线引注，彻底去除类按钮卡片外观） ---------- */
.fd-fate-footnote {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 2px 2px 2px 10px;
  border-left: 2px solid var(--fd-line);
  font-size: 11.5px;
  line-height: 1.55;
  opacity: 0.75;
  cursor: default;
}
.fd-fate-footnote-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.02em;
  opacity: 0.86;
}
.fd-fate-footnote-item {
  margin: 0;
  word-break: break-word;
}

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
  .fd-tabbar { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .fd-tab { flex: 1 1 auto; }
  .fd-live-sub { white-space: normal; }
  .fd-row { align-items: flex-start; }
}
/* 移动端裁定胶囊：正文太挤就只留一枚骰子图标（语义交给 title / aria-label） */
@media (max-width: 720px), (hover: none) and (pointer: coarse) {
  .fd-floor-pill,
  .fd-floor-pill.fd-composer-pill {
    gap: 0;
    width: 22px;
    min-width: 22px;
    height: 22px;
    min-height: 22px;
    padding: 0;
    max-width: none;
    justify-content: center;
  }
  .fd-floor-pill .fd-floor-dot,
  .fd-floor-pill .fd-floor-pill-text { display: none; }
  .fd-floor-pill .fd-floor-pill-icon { display: block; }
}
@media (max-width: 420px) {
  .fd-tabbar { grid-template-columns: 1fr; }
  .fd-stat-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (prefers-reduced-motion: reduce) {
  .fd-die-svg.is-rolling, .fd-die-svg.is-settled, .fd-live-card, .fd-composer-popover { animation: none !important; }
}
`
