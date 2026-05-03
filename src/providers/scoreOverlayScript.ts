import type { AnswerScore } from "../types/provider";

/**
 * 评分浮层注入脚本。
 *
 * 很多模型网站在根容器上设了 transform / will-change / contain，
 * 会创建新的 containing block，导致 position:fixed 失效。
 *
 * 解法：
 * - 不依赖 position:fixed，改用 position:absolute + JS 追踪视口位置
 * - 宿主元素挂在 <html> 上，用 Shadow DOM 隔离样式
 * - 不修改宿主页面的任何 CSS（避免破坏页面布局）
 * - 通过 requestAnimationFrame 持续定位到视口右上角
 */

/** 定位脚本：用 absolute + JS 持续追踪视口右上角 */
const POSITION_LOGIC = `
  function __nayPos(el) {
    function up() {
      if (!document.getElementById('__nayai_score_overlay')) return;
      var st = window.scrollY || document.documentElement.scrollTop || 0;
      var sl = window.scrollX || document.documentElement.scrollLeft || 0;
      var vw = document.documentElement.clientWidth || window.innerWidth;
      var ew = el.offsetWidth || 200;
      el.style.top = (st + 12) + 'px';
      el.style.left = (sl + vw - ew - 12) + 'px';
      requestAnimationFrame(up);
    }
    up();
  }
`;

/** Shadow DOM 内部的卡片样式 */
function cardStyles(scoreHex: string): string {
  return `:host { all: initial; display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.card { background: rgba(255,255,255,0.95); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: 12px; padding: 16px 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08); border: 1px solid rgba(0,0,0,0.06); min-width: 180px; max-width: 240px; text-align: center; cursor: pointer; animation: fadeIn 0.3s ease-out; }
.card.collapsed { padding: 6px 14px; min-width: auto; max-width: none; border-radius: 20px; display: inline-flex; align-items: center; gap: 6px; }
.num { font-size: 32px; font-weight: 700; line-height: 1.1; letter-spacing: -1px; color: ${scoreHex}; }
.stars { font-size: 16px; letter-spacing: 2px; margin: 4px 0; color: #F59E0B; }
.comment { font-size: 12px; color: #666; line-height: 1.4; margin-top: 6px; }
.badge-star { font-size: 14px; }
.badge-num { font-size: 14px; font-weight: 700; color: ${scoreHex}; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-8px) scale(0.95); } to { opacity: 1; transform: translateY(0) scale(1); } }
@media (prefers-color-scheme: dark) { .card { background: rgba(30,30,30,0.95); border-color: rgba(255,255,255,0.1); box-shadow: 0 8px 32px rgba(0,0,0,0.3); } .comment { color: #aaa; } }`;
}

const LOADING_STYLES = `:host { all: initial; display: block; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
.ld { background:rgba(255,255,255,0.95); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); border-radius:20px; padding:8px 16px; box-shadow:0 4px 16px rgba(0,0,0,0.1); border:1px solid rgba(0,0,0,0.06); display:inline-flex; align-items:center; gap:8px; font-size:13px; color:#666; animation:fi 0.3s ease-out; }
.sp { width:14px;height:14px;border:2px solid #e5e5e5;border-top-color:#F59E0B;border-radius:50%;animation:s 0.8s linear infinite; }
@keyframes s { to { transform:rotate(360deg) } }
@keyframes fi { from { opacity:0;transform:translateY(-8px) } to { opacity:1;transform:translateY(0) } }
@media (prefers-color-scheme:dark) { .ld { background:rgba(30,30,30,0.95);border-color:rgba(255,255,255,0.1);color:#aaa } .sp { border-color:#444;border-top-color:#F59E0B } }`;

/** 宿主元素基础 style（不含 top/left，由 JS 控制） */
const HOST_BASE =
  "position:absolute!important;z-index:2147483647!important;" +
  "width:auto!important;height:auto!important;margin:0!important;padding:0!important;" +
  "transform:none!important;filter:none!important;clip:auto!important;" +
  "overflow:visible!important;display:block!important;opacity:1!important;pointer-events:auto!important;";

export function getScoreOverlayScript(score: AnswerScore): string {
  const { score: num, comment } = score;
  const stars = getStars(num);
  const hex = getScoreHex(num);
  const esc = comment
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  const expandHTML = `<div class="num">${num.toFixed(1)}</div><div class="stars">${stars}</div><div class="comment">${esc}</div>`;
  const collapseHTML = `<span class="badge-star">⭐</span><span class="badge-num">${num.toFixed(1)}</span>`;
  const styles = cardStyles(hex).replace(/\n/g, " ");

  return `(function(){
try {
  var old = document.getElementById('__nayai_score_overlay');
  if (old) old.remove();

  var host = document.createElement('div');
  host.id = '__nayai_score_overlay';
  host.setAttribute('style', ${JSON.stringify(HOST_BASE)});
  var shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>${styles}</style><div class="card" id="c">${expandHTML}</div>';
  document.documentElement.appendChild(host);

  ${POSITION_LOGIC}
  __nayPos(host);

  var collapseTimer = setTimeout(doCollapse, 5000);
  function doCollapse() {
    var c = shadow.getElementById('c');
    if (!c || c.classList.contains('collapsed')) return;
    c.classList.add('collapsed');
    c.innerHTML = '${collapseHTML}';
  }
  function doExpand() {
    var c = shadow.getElementById('c');
    if (!c || !c.classList.contains('collapsed')) return;
    c.classList.remove('collapsed');
    c.innerHTML = '${expandHTML}';
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(doCollapse, 5000);
  }
  host.addEventListener('click', function() {
    var c = shadow.getElementById('c');
    if (c && c.classList.contains('collapsed')) doExpand(); else doCollapse();
  });
  console.log('[nayai-desk] score overlay injected: ${num.toFixed(1)}');
} catch(e) { console.error('[nayai-desk] overlay error:', e); }
})()`;
}

export function getScoreLoadingScript(statusText = "评分中..."): string {
  const styles = LOADING_STYLES.replace(/\n/g, " ");
  return `(function(){
try {
  var old = document.getElementById('__nayai_score_overlay');
  if (old) old.remove();

  var host = document.createElement('div');
  host.id = '__nayai_score_overlay';
  host.setAttribute('style', ${JSON.stringify(HOST_BASE)});
  var shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>${styles}</style><div class="ld"><div class="sp"></div><span>${statusText}</span></div>';
  document.documentElement.appendChild(host);

  ${POSITION_LOGIC}
  __nayPos(host);
} catch(e) { console.error('[nayai-desk] loading overlay error:', e); }
})()`;
}

export function getRemoveScoreOverlayScript(): string {
  return `(function(){
  var el = document.getElementById('__nayai_score_overlay');
  if (el) el.remove();
})()`;
}

/* ─── 辅助函数 ─── */

function getStars(score: number): string {
  const full = Math.floor(score / 2);
  const half = score % 2 >= 1 ? 1 : 0;
  const empty = 5 - full - half;
  return "★".repeat(full) + (half ? "☆" : "") + "☆".repeat(empty);
}

function getScoreHex(score: number): string {
  if (score >= 9) return "#E74C3C"; // 橙红（神作）
  if (score >= 7) return "#27AE60"; // 绿色（推荐）
  if (score >= 5) return "#F39C12"; // 橙色（还行）
  return "#95A5A6"; // 灰色（较差）
}
