import { getProvider } from "../providers/registry";
import { parseChatIdFromUrl } from "../providers/chatUrls";
import {
  getInjectionScript,
  getHideChromeScript,
  getForceLightScript,
  LOGIN_HASH_KEY,
} from "../providers/injectionScripts";
import {
  ANSWER_HASH_KEY,
  getExtractionScript,
  getClearAnswerHashScript,
} from "../providers/extractionScripts";
import {
  getScoreOverlayScript,
  getScoreLoadingScript,
  getRemoveScoreOverlayScript,
} from "../providers/scoreOverlayScript";
import { useConversationStore } from "../stores/conversationStore";
import { useUIStore } from "../stores/uiStore";
import {
  isTauri as _isTauri,
  isTauriDesktop as _isTauriDesktop,
  isTauriMobile as _isTauriMobile,
  supportsNativePanelWebviews as _supportsNativePanelWebviews,
} from "../utils/platform";
import type {
  ProviderId,
  Panel,
  LayoutMode,
  PromptImagePayload,
} from "../types/provider";

export const isTauri = _isTauri;
export const isTauriDesktop = _isTauriDesktop;
export const isTauriMobile = _isTauriMobile;
export const supportsNativePanelWebviews = _supportsNativePanelWebviews;
export { isWeb } from "../utils/platform";

interface WebviewEntry {
  label: string;
  providerId: ProviderId;
}

const SIDEBAR_WIDTH_EXPANDED = 200;
const SIDEBAR_WIDTH_COLLAPSED = 52;
const TOPBAR_HEIGHT = 40;
const TOPBAR_HEIGHT_MOBILE = 44;
const PANEL_HEADER_HEIGHT = 0;
/** 非 columns 布局（rows / grid）下每个 panel 顶部保留的悬浮标签高度（React 绘制，不被 webview 覆盖） */
const FLOATING_TAB_AREA = 36;
const INPUT_BAR_HEIGHT_DEFAULT = 142;
let _inputBarHeight = INPUT_BAR_HEIGHT_DEFAULT;
export const GAP = 4;
/** 内容区左侧留白，让第一列与侧边栏之间保留和列间一致的间距 */
export const CONTENT_PADDING_LEFT = GAP;
/** 内容区右侧留白，避免最后一列贴到窗口边框 */
export const CONTENT_PADDING_RIGHT = 8;

const entries = new Map<string, WebviewEntry>();

export function setInputBarHeight(height: number): void {
  _inputBarHeight = Math.max(INPUT_BAR_HEIGHT_DEFAULT, Math.round(height));
}

export function getInputBarHeight(): number {
  return _inputBarHeight;
}

function getWebviewZoom(): number {
  return useUIStore.getState().webviewZoom;
}

let _currentLayout: LayoutMode = "columns";
let _panelWidths: number[] = [];
let _sidebarCollapsed = false;

export function setSidebarCollapsed(collapsed: boolean) {
  _sidebarCollapsed = collapsed;
}

export function getSidebarWidth(): number {
  if (useUIStore.getState().isMobile) {
    return _sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : 0; // 展开时是浮层，不占空间；折叠时占 52px
  }
  return _sidebarCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED;
}

export function setCurrentLayout(layout: LayoutMode) {
  _currentLayout = layout;
}

export function setPanelWidths(widths: number[]) {
  _panelWidths = widths;
}

export function getPanelWidths(): number[] {
  return _panelWidths;
}

function toWebviewLabel(panelId: string): string {
  return `pv-${panelId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

async function getWindowSize() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const mainWindow = getCurrentWindow();
  const factor = await mainWindow.scaleFactor();
  const winSize = await mainWindow.innerSize();
  return {
    width: winSize.width / factor,
    height: winSize.height / factor,
  };
}

/** rows/grid 布局下全局 TopBar 不渲染，webview 从 y=0 开始（每个 panel 内部再留悬浮标签空间） */
function defaultTopBarHeight(layout: LayoutMode): number {
  return layout === "columns" ? TOPBAR_HEIGHT : 0;
}

function calcPanelRect(
  index: number,
  total: number,
  layout: LayoutMode,
  winW: number,
  winH: number,
  topBarHeight: number = defaultTopBarHeight(layout),
) {
  const sw = getSidebarWidth();
  const contentX = sw + CONTENT_PADDING_LEFT;
  const contentW = winW - sw - CONTENT_PADDING_LEFT - CONTENT_PADDING_RIGHT;
  // rows / grid 布局：顶部没有全局 TopBar，每个 panel 内部预留 FLOATING_TAB_AREA 给悬浮标签
  const perPanelTopReserve = layout === "columns" ? 0 : FLOATING_TAB_AREA;
  const contentH = winH - topBarHeight - _inputBarHeight;

  if (layout === "columns") {
    const gapTotal = GAP * Math.max(total - 1, 0);
    const available = contentW - gapTotal;

    const hasCustom = _panelWidths.length === total && _panelWidths.every((w) => w > 0);
    let widths: number[];
    if (hasCustom) {
      const sum = _panelWidths.reduce((a, b) => a + b, 0);
      widths = _panelWidths.map((w) => Math.max((w / sum) * available, 80));
      const totalW = widths.reduce((a, b) => a + b, 0);
      if (totalW > available) {
        const scale = available / totalW;
        widths = widths.map((w) => w * scale);
      }
    } else {
      widths = Array(total).fill(available / total);
    }

    let xOffset = contentX;
    for (let i = 0; i < index; i++) {
      xOffset += widths[i] + GAP;
    }
    return {
      x: xOffset,
      y: topBarHeight + PANEL_HEADER_HEIGHT,
      width: widths[index],
      height: Math.max(contentH - PANEL_HEADER_HEIGHT, 80),
    };
  }

  if (layout === "rows") {
    const gapTotal = GAP * Math.max(total - 1, 0);
    // 每行都预留 FLOATING_TAB_AREA，这样悬浮标签不会被 webview 覆盖
    const rowH = (contentH - total * (PANEL_HEADER_HEIGHT + perPanelTopReserve) - gapTotal) / total;
    return {
      x: contentX,
      y: topBarHeight + index * (PANEL_HEADER_HEIGHT + perPanelTopReserve + rowH + GAP) + PANEL_HEADER_HEIGHT + perPanelTopReserve,
      width: Math.max(contentW, 80),
      height: Math.max(rowH, 80),
    };
  }

  const cols = 2;
  const rows = Math.ceil(total / cols);
  const gapW = GAP * (cols - 1);
  const gapH = GAP * Math.max(rows - 1, 0);
  const cellW = (contentW - gapW) / cols;
  const cellH = (contentH - rows * (PANEL_HEADER_HEIGHT + perPanelTopReserve) - gapH) / rows;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    x: contentX + col * (cellW + GAP),
    y: topBarHeight + row * (PANEL_HEADER_HEIGHT + perPanelTopReserve + cellH + GAP) + PANEL_HEADER_HEIGHT + perPanelTopReserve,
    width: Math.max(cellW, 80),
    height: Math.max(cellH, 80),
  };
}

export async function createWebview(
  panelId: string,
  providerId: ProviderId,
  colIndex: number,
  totalCols: number,
): Promise<void> {
  if (!supportsNativePanelWebviews() || entries.has(panelId)) return;

  const { invoke } = await import("@tauri-apps/api/core");
  const label = toWebviewLabel(panelId);
  const provider = getProvider(providerId);
  const { width: winW, height: winH } = await getWindowSize();
  const rect = calcPanelRect(colIndex, totalCols, _currentLayout, winW, winH);

  try {
    const { hideWebviewChrome, forceLightMode } = useUIStore.getState();
    // 强制浅色脚本需要优先执行（页面任何 JS 之前），随后注入 chrome 隐藏样式
    const initScript = [
      getForceLightScript(forceLightMode),
      getHideChromeScript(providerId, hideWebviewChrome),
    ].join("\n");

    await invoke("create_provider_webview", {
      label,
      url: provider.url,
      providerId,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      initScript,
    });
    entries.set(panelId, { label, providerId });
    const { Webview } = await import("@tauri-apps/api/webview");
    const wv = await Webview.getByLabel(label);
    if (wv) await wv.setZoom(getWebviewZoom());
  } catch (e) {
    console.error(`[webview] failed to create ${label}:`, e);
  }
}

let _focusMode: { enabled: boolean; focusedPanelId: string } = {
  enabled: false,
  focusedPanelId: "",
};

export function setFocusMode(enabled: boolean, focusedPanelId: string) {
  _focusMode = { enabled, focusedPanelId };
}

const OVERLAY_INJECT = `
(function(){
  let el = document.getElementById('__nayai_desk_overlay');
  if (!el) {
    el = document.createElement('div');
    el.id = '__nayai_desk_overlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.22);pointer-events:all;transition:opacity 0.2s;';
    document.documentElement.appendChild(el);
  }
  el.style.display = 'block';
})();
`;

const OVERLAY_REMOVE = `
(function(){
  const el = document.getElementById('__nayai_desk_overlay');
  if (el) el.style.display = 'none';
})();
`;

export interface RepositionOptions {
  isMobile?: boolean;
  focusedPanelId?: string;
  /** 若设置，只让该 panel 铺满整个工作区，其他 panel 的 webview 移出屏幕 */
  maximizedPanelId?: string | null;
}

export async function repositionAllWebviews(
  panels: Panel[],
  options?: RepositionOptions,
): Promise<void> {
  if (!supportsNativePanelWebviews()) return;
  // 设置面板、浮动菜单等打开时 webview 必须保持隐藏，不被任何重排带回
  if (_hidden) return;
  if (useUIStore.getState().showSettings) {
    void hideAllWebviews();
    return;
  }

  const { Webview } = await import("@tauri-apps/api/webview");
  const { LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
  const { invoke } = await import("@tauri-apps/api/core");
  const { width: winW, height: winH } = await getWindowSize();

  const isMobile = options?.isMobile ?? useUIStore.getState().isMobile;
  const focusedPanelId = options?.focusedPanelId;
  const maximizedPanelId = options?.maximizedPanelId ?? null;

  for (let i = 0; i < panels.length; i++) {
    const entry = entries.get(panels[i].id);
    if (!entry) continue;

    let rect: { x: number; y: number; width: number; height: number };
    if (maximizedPanelId) {
      // 最大化模式：目标 panel 铺满工作区；其他 panel 移出屏幕
      if (panels[i].id === maximizedPanelId) {
        // rows/grid 模式下没有全局 TopBar，但每个 panel 保留悬浮标签空间；
        // columns 模式下留 TopBar 高度。直接借用当前 app 布局来决定
        const maxLayout: LayoutMode = _currentLayout === "columns" ? "columns" : "rows";
        rect = calcPanelRect(0, 1, maxLayout, winW, winH);
      } else {
        rect = { x: -9999, y: -9999, width: 1, height: 1 };
      }
    } else if (isMobile && focusedPanelId) {
      if (panels[i].id === focusedPanelId) {
        rect = calcPanelRect(0, 1, "columns", winW, winH, TOPBAR_HEIGHT_MOBILE);
      } else {
        rect = { x: -9999, y: -9999, width: 1, height: 1 };
      }
    } else {
      rect = calcPanelRect(i, panels.length, _currentLayout, winW, winH);
    }

    try {
      const wv = await Webview.getByLabel(entry.label);
      if (!wv) continue;
      await wv.setSize(new LogicalSize(rect.width, rect.height));
      await wv.setPosition(new LogicalPosition(rect.x, rect.y));
      await wv.setZoom(getWebviewZoom());

      const isUnfocused =
        _focusMode.enabled && panels[i].id !== _focusMode.focusedPanelId;
      try {
        await invoke("inject_script", {
          label: entry.label,
          script: isUnfocused ? OVERLAY_INJECT : OVERLAY_REMOVE,
        });
      } catch { /* webview may not be ready */ }
      try {
        const hideChrome = useUIStore.getState().hideWebviewChrome;
        await invoke("inject_script", {
          label: entry.label,
          script: getHideChromeScript(entry.providerId, hideChrome),
        });
      } catch { /* webview may not be ready */ }
    } catch (e) {
      console.error(`[webview] reposition error for ${entry.label}:`, e);
    }
  }
}

/** 将「隐藏网页顶栏/输入框」设置应用到所有内嵌网页（设置里切换时调用） */
export async function applyHideChromeToAllWebviews(panels: Panel[]): Promise<void> {
  if (!supportsNativePanelWebviews()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const hideChrome = useUIStore.getState().hideWebviewChrome;
  for (const panel of panels) {
    const entry = entries.get(panel.id);
    if (!entry) continue;
    try {
      await invoke("inject_script", {
        label: entry.label,
        script: getHideChromeScript(entry.providerId, hideChrome),
      });
    } catch { /* ignore */ }
  }
}

/** 将「强制浅色」设置应用到所有内嵌网页（设置里切换时调用）
 *  关闭时：仅清理我们加的 meta/style，不会把页面切回深色（要刷新才生效）
 *  开启时：对已经渲染的页面尽力移除 dark class + 写 localStorage；但页面如果已经
 *  应用了深色 CSS，最佳做法还是 refresh webview。调用方按需决定是否刷新。
 */
export async function applyForceLightToAllWebviews(panels: Panel[]): Promise<void> {
  if (!supportsNativePanelWebviews()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const enabled = useUIStore.getState().forceLightMode;
  for (const panel of panels) {
    const entry = entries.get(panel.id);
    if (!entry) continue;
    try {
      await invoke("inject_script", {
        label: entry.label,
        script: getForceLightScript(enabled),
      });
    } catch { /* ignore */ }
  }
}

export async function updateFocusOverlays(panels: Panel[]): Promise<void> {
  if (!supportsNativePanelWebviews()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  for (const panel of panels) {
    const entry = entries.get(panel.id);
    if (!entry) continue;
    const isUnfocused =
      _focusMode.enabled && panel.id !== _focusMode.focusedPanelId;
    try {
      await invoke("inject_script", {
        label: entry.label,
        script: isUnfocused ? OVERLAY_INJECT : OVERLAY_REMOVE,
      });
    } catch { /* webview may not be ready */ }
  }
}

/** 将当前缩放比例应用到所有内嵌网页（供 UI 缩放按钮调用） */
export async function applyZoomToAllWebviews(panels: Panel[]): Promise<void> {
  if (!supportsNativePanelWebviews()) return;
  const zoom = getWebviewZoom();
  const { Webview } = await import("@tauri-apps/api/webview");
  for (const panel of panels) {
    const entry = entries.get(panel.id);
    if (!entry) continue;
    try {
      const wv = await Webview.getByLabel(entry.label);
      if (wv) await wv.setZoom(zoom);
    } catch { /* ignore */ }
  }
}

let _hidden = false;

export async function hideAllWebviews(): Promise<void> {
  if (!supportsNativePanelWebviews() || _hidden) return;
  _hidden = true;
  const labels = [...entries.values()].map((e) => e.label);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("hide_provider_webviews", { labels });
  } catch { /* ignore */ }
  const { Webview } = await import("@tauri-apps/api/webview");
  for (const [, entry] of entries) {
    try {
      const wv = await Webview.getByLabel(entry.label);
      if (wv) await wv.hide();
    } catch { /* ignore */ }
  }
}

export async function showAllWebviews(
  panels: Panel[],
  options?: RepositionOptions,
): Promise<void> {
  if (!supportsNativePanelWebviews() || !_hidden) return;
  _hidden = false;
  const { Webview } = await import("@tauri-apps/api/webview");
  for (const panel of panels) {
    const entry = entries.get(panel.id);
    if (!entry) continue;
    try {
      const wv = await Webview.getByLabel(entry.label);
      if (wv) await wv.show();
    } catch { /* ignore */ }
  }
  await repositionAllWebviews(panels, options);
}

export async function closeAllWebviews(panels: Panel[]): Promise<void> {
  for (const panel of panels) {
    await closeWebview(panel.id);
  }
}

export async function closeWebview(panelId: string): Promise<void> {
  const entry = entries.get(panelId);
  if (!entry) return;
  if (supportsNativePanelWebviews()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("close_provider_webview", { label: entry.label });
    } catch (e) {
      console.error(`[webview] close error for ${entry.label}:`, e);
    }
  }
  entries.delete(panelId);
  lastUrls.delete(panelId);
}

export async function injectPrompt(
  panelId: string,
  prompt: string,
): Promise<void> {
  return injectPromptPayload(panelId, prompt, []);
}

export async function injectPromptPayload(
  panelId: string,
  prompt: string,
  images: PromptImagePayload[],
): Promise<void> {
  if (!supportsNativePanelWebviews()) return;
  const entry = entries.get(panelId);
  if (!entry) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const script = getInjectionScript(entry.providerId, prompt, images);
  try {
    await invoke("inject_script", { label: entry.label, script });
  } catch (e) {
    console.error(`[webview] inject error for ${entry.label}:`, e);
  }
}

export async function broadcastPrompt(
  panelIds: string[],
  prompt: string,
): Promise<void> {
  await broadcastPromptPayload(panelIds, prompt, []);
}

export async function broadcastPromptPayload(
  panelIds: string[],
  prompt: string,
  images: PromptImagePayload[],
): Promise<void> {
  await Promise.allSettled(panelIds.map((id) => injectPromptPayload(id, prompt, images)));
}

/**
 * 把当前 panel 导航到指定 URL（用于按 chatId 深链跳转）。
 */
export async function navigateWebview(
  panelId: string,
  url: string,
): Promise<void> {
  if (!supportsNativePanelWebviews() || !url) return;
  const entry = entries.get(panelId);
  if (!entry) return;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("navigate_webview", { label: entry.label, url });
  } catch (e) {
    console.error(`[webview] navigate error for ${entry.label}:`, e);
  }
}

/**
 * 读取 panel 当前 URL。
 */
export async function getWebviewUrl(panelId: string): Promise<string | null> {
  if (!supportsNativePanelWebviews()) return null;
  const entry = entries.get(panelId);
  if (!entry) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<string>("get_webview_url", { label: entry.label });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// URL 变化轮询：每 interval 读一次所有 panel 的 URL，解析出 chatId 回写到
// 当前 activeConversation 的 remoteChatIds 中，供后续切换会话时深链跳转。
// ---------------------------------------------------------------------------

const lastUrls = new Map<string, string>();
let _pollTimer: ReturnType<typeof setInterval> | null = null;

/** 回答提取：panelId → resolve 回调，pollAllUrls 检测到 hash 信号后调用 */
const _answerCallbacks = new Map<string, (text: string) => void>();

/** 从 URL hash 中解析登录探测和回答提取脚本写入的标记 */
function parseHashSignals(url: string): {
  cleanedUrl: string;
  loginState: "ready" | "needs_login" | null;
  answerBase64: string | null;
} {
  const hashIdx = url.indexOf("#");
  if (hashIdx < 0)
    return { cleanedUrl: url, loginState: null, answerBase64: null };
  const base = url.substring(0, hashIdx);
  const rawHash = url.substring(hashIdx + 1);
  const parts = rawHash.split("&");
  let loginState: "ready" | "needs_login" | null = null;
  let answerBase64: string | null = null;
  const kept: string[] = [];
  for (const p of parts) {
    if (p.startsWith(`${LOGIN_HASH_KEY}=`)) {
      const v = p.substring(LOGIN_HASH_KEY.length + 1);
      if (v === "ready" || v === "needs_login") loginState = v;
    } else if (p.startsWith(`${ANSWER_HASH_KEY}=`)) {
      answerBase64 = p.substring(ANSWER_HASH_KEY.length + 1);
    } else if (p) {
      kept.push(p);
    }
  }
  const cleanedHash = kept.join("&");
  const cleanedUrl = cleanedHash ? `${base}#${cleanedHash}` : base;
  return { cleanedUrl, loginState, answerBase64 };
}

async function pollAllUrls() {
  if (!supportsNativePanelWebviews() || entries.size === 0) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const { usePanelStore } = await import("../stores/panelStore");
  for (const [panelId, entry] of entries) {
    let url: string;
    try {
      url = await invoke<string>("get_webview_url", { label: entry.label });
    } catch {
      continue;
    }
    if (!url) continue;

    // 从 hash 中解析登录状态和回答提取结果
    const { cleanedUrl, loginState, answerBase64 } = parseHashSignals(url);
    if (loginState) {
      const prev = usePanelStore.getState().loginStatus[panelId];
      if (prev !== loginState) {
        usePanelStore.getState().setLoginStatus(panelId, loginState);
      }
    }

    // 如果有回答提取结果，解码并通知 pending 回调
    if (answerBase64 !== null) {
      try {
        const text = answerBase64
          ? decodeURIComponent(escape(atob(answerBase64)))
          : "";
        const cb = _answerCallbacks.get(panelId);
        if (cb) {
          _answerCallbacks.delete(panelId);
          cb(text);
        }
        // 清除 hash 中的 answer 标记
        await invoke("inject_script", {
          label: entry.label,
          script: getClearAnswerHashScript(),
        }).catch(() => {});
      } catch (e) {
        console.error(`[webview] answer decode error for ${panelId}:`, e);
      }
    }

    if (lastUrls.get(panelId) === cleanedUrl) continue;
    lastUrls.set(panelId, cleanedUrl);
    const chatId = parseChatIdFromUrl(entry.providerId, cleanedUrl);
    if (!chatId) continue;
    useConversationStore.getState().setRemoteChatId(entry.providerId, chatId);
  }
}

export function startUrlPolling(intervalMs = 2000) {
  if (_pollTimer != null) return;
  _pollTimer = setInterval(() => {
    void pollAllUrls();
  }, intervalMs);
  // 启动后立即执行一次，避免首轮等待
  void pollAllUrls();
}

export function stopUrlPolling() {
  if (_pollTimer == null) return;
  clearInterval(_pollTimer);
  _pollTimer = null;
}

/** 发送消息后追加一次短间隔捕获，加快新会话 chatId 的回填 */
export function schedulePollBurst(delays: number[] = [700, 1500, 3000, 6000]) {
  for (const d of delays) {
    setTimeout(() => {
      void pollAllUrls();
    }, d);
  }
}

export async function refreshWebview(panelId: string): Promise<void> {
  if (isTauriMobile()) {
    const { usePanelStore } = await import("../stores/panelStore");
    const panel = usePanelStore.getState().panels.find((p) => p.id === panelId);
    if (panel) {
      await openProviderUrl(panel.providerId, "inAppBrowser");
    }
    return;
  }
  if (!supportsNativePanelWebviews()) return;
  const entry = entries.get(panelId);
  if (!entry) return;
  const { invoke } = await import("@tauri-apps/api/core");
  const provider = getProvider(entry.providerId);
  try {
    await invoke("navigate_webview", { label: entry.label, url: provider.url });
  } catch {
    try {
      await invoke("inject_script", { label: entry.label, script: "location.reload();" });
    } catch (e) {
      console.error(`[webview] refresh error for ${entry.label}:`, e);
    }
  }
}

export async function refreshAllWebviews(panels: Panel[]): Promise<void> {
  await Promise.allSettled(panels.map((p) => refreshWebview(p.id)));
}

/**
 * 在对应 webview 内执行「登录/就绪」检测脚本。
 * 限制：Tauri 的 webview.eval() 不会把脚本返回值传回前端，所以前端无法拿到 true/false，
 * 需要后端提供「带返回值的 eval」才能把登录状态回写到 store。目前仅执行脚本，不更新 loginStatus。
 */
export async function injectDetectScript(
  panelId: string,
  script: string,
): Promise<void> {
  if (!supportsNativePanelWebviews()) return;
  const entry = entries.get(panelId);
  if (!entry) return;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("inject_script", { label: entry.label, script });
  } catch (e) {
    console.error(`[webview] detect error for ${entry.label}:`, e);
  }
}

export async function openProviderUrl(
  providerId: ProviderId,
  target: "inAppBrowser" | "system" = "inAppBrowser",
): Promise<void> {
  const provider = getProvider(providerId);
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(provider.url, target === "inAppBrowser" && isTauriMobile() ? "inAppBrowser" : undefined);
    return;
  }

  window.open(provider.url, "_blank", "noopener,noreferrer");
}

// ---------------------------------------------------------------------------
// AI 评分：回答提取 + 评分卡片注入
// ---------------------------------------------------------------------------

/**
 * 注入提取脚本到指定 panel 的 webview，返回提取到的回答文本。
 * 脚本将回答 base64 编码后写入 URL hash，pollAllUrls 解析后通过回调返回。
 */
export function extractAnswerFromWebview(
  panelId: string,
  timeoutMs = 30000,
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    if (!supportsNativePanelWebviews()) {
      resolve("");
      return;
    }
    const entry = entries.get(panelId);
    if (!entry) {
      resolve("");
      return;
    }

    const timer = setTimeout(() => {
      _answerCallbacks.delete(panelId);
      reject(new Error(`提取超时: ${entry.providerId}`));
    }, timeoutMs);

    _answerCallbacks.set(panelId, (text) => {
      clearTimeout(timer);
      resolve(text);
    });

    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("inject_script", {
        label: entry.label,
        script: getExtractionScript(entry.providerId),
      });
    } catch (e) {
      clearTimeout(timer);
      _answerCallbacks.delete(panelId);
      reject(e);
    }
  });
}

/** 在指定 panel 的 webview 中注入 loading 评分卡片 */
export async function injectScoreLoading(panelId: string): Promise<void> {
  if (!supportsNativePanelWebviews()) return;
  const entry = entries.get(panelId);
  if (!entry) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("inject_script", {
    label: entry.label,
    script: getScoreLoadingScript(),
  }).catch(() => {});
}

/** 在指定 panel 的 webview 中注入评分结果卡片 */
export async function injectScoreResult(
  panelId: string,
  score: import("../types/provider").AnswerScore,
): Promise<void> {
  if (!supportsNativePanelWebviews()) return;
  const entry = entries.get(panelId);
  if (!entry) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("inject_script", {
    label: entry.label,
    script: getScoreOverlayScript(score),
  }).catch(() => {});
}

/** 移除指定 panel 的 webview 中的评分卡片 */
export async function removeScoreOverlay(panelId: string): Promise<void> {
  if (!supportsNativePanelWebviews()) return;
  const entry = entries.get(panelId);
  if (!entry) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("inject_script", {
    label: entry.label,
    script: getRemoveScoreOverlayScript(),
  }).catch(() => {});
}

/** 获取 panel 对应的 providerId（评分服务用） */
export function getProviderIdForPanel(panelId: string): ProviderId | null {
  const entry = entries.get(panelId);
  return entry ? entry.providerId : null;
}
