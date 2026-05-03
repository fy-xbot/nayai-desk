import { ProviderIcon } from "../common/ProviderIcon";
import { usePanelStore } from "../../stores/panelStore";
import { useUIStore } from "../../stores/uiStore";
import { getProvider } from "../../providers/registry";
import { refreshWebview } from "../../services/webviewManager";
import type { Panel } from "../../types/provider";

interface Props {
  panel: Panel;
}

/**
 * 非竖排布局（rows / grid）下，每个 panel 顶部悬浮的圆角标签。
 * 功能等同 TopBar 的单个 tab：显示图标、登录状态点、标签，点击选中，
 * 并提供刷新 / 最大化 / 关闭按钮。不支持拖拽重排（列数/行数由 layout 决定）。
 */
export function FloatingPanelTab({ panel }: Props) {
  const setFocusedPanel = usePanelStore((s) => s.setFocusedPanel);
  const focusedPanelId = usePanelStore((s) => s.focusedPanelId);
  const loginStatus = usePanelStore((s) => s.loginStatus);
  const panels = usePanelStore((s) => s.panels);
  const maximizedPanelId = usePanelStore((s) => s.maximizedPanelId);
  const toggleMaximize = usePanelStore((s) => s.toggleMaximize);
  const removePanel = usePanelStore((s) => s.removePanel);
  const promptMode = useUIStore((s) => s.promptMode);
  const provider = getProvider(panel.providerId);

  const isFocused = panel.id === focusedPanelId;
  const isBroadcast = promptMode === "broadcast";
  const isActive = isFocused || isBroadcast;

  return (
    <div
      className={`pointer-events-auto inline-flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-full border shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-colors backdrop-blur-md ${
        isActive
          ? "bg-white/95 border-black/[0.06]"
          : "bg-white/70 border-black/[0.04] hover:bg-white/90"
      }`}
      onClick={(e) => {
        e.stopPropagation();
        setFocusedPanel(panel.id);
      }}
    >
      <ProviderIcon providerId={panel.providerId} size={14} />
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
          loginStatus[panel.id] === "ready" ? "bg-emerald-500" : "bg-gray-300"
        }`}
        title={
          loginStatus[panel.id] === "ready"
            ? "已登录"
            : loginStatus[panel.id] === "needs_login"
              ? "未登录"
              : "登录状态未知"
        }
      />
      <span
        className={`text-[11px] font-medium truncate max-w-[120px] ${
          isActive ? "text-[#333]" : "text-[#666]"
        }`}
      >
        {provider.label}
      </span>

      <button
        className="rounded-full flex items-center justify-center text-[#bbb] hover:text-[#333] hover:bg-black/[0.06] active:scale-95 transition-all cursor-pointer w-5 h-5 ml-0.5"
        onClick={(e) => {
          e.stopPropagation();
          void refreshWebview(panel.id);
        }}
        title="刷新"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-2.636-6.364" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>

      {panels.length > 1 && (
        <button
          className={`rounded-full flex items-center justify-center hover:bg-black/[0.06] active:scale-95 transition-all cursor-pointer w-5 h-5 ${
            maximizedPanelId === panel.id ? "text-[#333]" : "text-[#bbb] hover:text-[#333]"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            void toggleMaximize(panel.id);
          }}
          title={maximizedPanelId === panel.id ? "还原" : "最大化"}
        >
          {maximizedPanelId === panel.id ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 14h6v6" />
              <path d="M20 10h-6V4" />
              <path d="M14 10L21 3" />
              <path d="M3 21l7-7" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6" />
              <path d="M9 21H3v-6" />
              <path d="M21 3l-7 7" />
              <path d="M3 21l7-7" />
            </svg>
          )}
        </button>
      )}

      {panels.length > 1 && (
        <button
          className="rounded-full flex items-center justify-center text-[#bbb] hover:text-[#333] hover:bg-black/[0.06] active:scale-95 transition-all cursor-pointer w-5 h-5"
          onClick={(e) => {
            e.stopPropagation();
            void removePanel(panel.id);
          }}
          title="关闭"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
