/** 是否在 Tauri 壳内（桌面或移动） */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** 是否在纯浏览器环境（非 Tauri） */
export function isWeb(): boolean {
  return !isTauri();
}

/** 是否 Tauri 桌面（macOS / Windows / Linux） */
export function isTauriDesktop(): boolean {
  if (!isTauri()) return false;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return !/Android|iPhone|iPad|iPod/i.test(ua);
}

/** 是否 Tauri 移动端（Android / iOS），供后续布局分支用 */
export function isTauriMobile(): boolean {
  if (!isTauri()) return false;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

/** 当前平台是否支持桌面端那套多原生子 webview 布局 */
export function supportsNativePanelWebviews(): boolean {
  return isTauriDesktop();
}

/** 当前平台是否支持通过脚本把统一输入注入到各模型网页 */
export function supportsPromptAutomation(): boolean {
  return isTauriDesktop();
}
