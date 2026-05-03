import { useCallback, useRef } from "react";
import { ProviderIcon } from "../common/ProviderIcon";
import { FloatingPanelTab } from "../topbar/FloatingPanelTab";
import { getProvider } from "../../providers/registry";
import { usePanelStore, getRepositionOpts } from "../../stores/panelStore";
import {
  isWeb,
  isTauriMobile,
  openProviderUrl,
  repositionAllWebviews,
  getSidebarWidth,
  GAP,
  CONTENT_PADDING_LEFT,
  CONTENT_PADDING_RIGHT,
} from "../../services/webviewManager";
import type { Panel, LayoutMode } from "../../types/provider";

interface Props {
  panel: Panel;
  layout: LayoutMode;
  total: number;
  canClose: boolean;
  index: number;
}

export function ProviderColumn({ panel, layout, total, index }: Props) {
  const setFocusedPanel = usePanelStore((s) => s.setFocusedPanel);
  const panelWidths = usePanelStore((s) => s.panelWidths);
  const provider = getProvider(panel.providerId);
  const resizeRef = useRef<HTMLDivElement>(null);
  const isMobileBrowserMode = isTauriMobile();

  const sizeClass =
    layout === "columns"
      ? "min-w-0"
      : layout === "rows"
        ? "flex-1 min-h-0 w-full"
        : "min-h-0 w-1/2";
  const flexStyle =
    layout === "columns"
      ? { flex: panelWidths[index] ?? 1 }
      : undefined;

  const isLastCol = index === total - 1;
  const canResize = !isWeb() && !isMobileBrowserMode && layout === "columns" && !isLastCol;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!canResize) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;

      let widths = usePanelStore.getState().panelWidths;
      if (widths.length !== total) {
        widths = Array(total).fill(1);
      }
      const startWidths = [...widths];

      const onMove = (me: MouseEvent) => {
        const delta = me.clientX - startX;
        const sw = getSidebarWidth();
        const totalWeight = startWidths.reduce((a, b) => a + b, 0);
        const availableWidth =
          window.innerWidth
          - sw
          - CONTENT_PADDING_LEFT
          - CONTENT_PADDING_RIGHT
          - GAP * Math.max(total - 1, 0);
        const pixelPerWeight = availableWidth / totalWeight;
        const deltaWeight = delta / pixelPerWeight;

        const next = [...startWidths];
        next[index] = Math.max(startWidths[index] + deltaWeight, 0.2);
        next[index + 1] = Math.max(startWidths[index + 1] - deltaWeight, 0.2);

        usePanelStore.getState().setPanelWidths(next);
        repositionAllWebviews(usePanelStore.getState().panels, getRepositionOpts());
      };

      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [canResize, index, total],
  );

  // 非竖排布局下，每个 panel 顶部渲染圆角悬浮标签，代替全局 TopBar 的功能
  const showFloatingTab = layout !== "columns" && !isWeb() && !isMobileBrowserMode;

  return (
    <div
      className={`flex flex-col ${sizeClass} relative overflow-hidden bg-[#F5F5F5] transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]`}
      style={
          layout === "grid"
            ? { height: `${100 / Math.ceil(total / 2)}%` }
            : layout === "columns"
              ? flexStyle
              : undefined
        }
      onClick={() => setFocusedPanel(panel.id)}
    >
      {showFloatingTab && (
        <div className="absolute top-1.5 left-1.5 z-30 pointer-events-none">
          <FloatingPanelTab panel={panel} />
        </div>
      )}
      {/* Web：iframe 内嵌；桌面 Tauri：占位区供 native webview 覆盖；移动 Tauri：应用内浏览器打开 */}
      {isWeb() ? (
        <iframe
          title={provider.label}
          src={provider.url}
          className="flex-1 min-h-0 w-full border-0 bg-[#F5F5F5]"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      ) : isMobileBrowserMode ? (
        <div className="flex-1 min-h-0 overflow-auto bg-[radial-gradient(circle_at_top,_rgba(16,163,127,0.1),_transparent_40%),linear-gradient(180deg,#fafaf9_0%,#f2f1ef_100%)] px-5 py-6">
          <div className="mx-auto flex h-full max-w-md flex-col justify-between rounded-[28px] border border-black/[0.06] bg-white/92 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.06)] backdrop-blur">
            <div>
              <div
                className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl"
                style={{ backgroundColor: `${provider.color}18` }}
              >
                <ProviderIcon providerId={panel.providerId} size={24} />
              </div>
              <div className="flex items-center gap-2">
                <h3 className="text-[22px] font-semibold tracking-[-0.02em] text-[#1a1a1a]">
                  {provider.label}
                </h3>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ backgroundColor: `${provider.color}14`, color: provider.color }}
                >
                  iOS
                </span>
              </div>
              <p className="mt-2 text-[13px] leading-6 text-[#5d5d5c]">
                {provider.desc}
              </p>
              <p className="mt-4 rounded-2xl bg-[#f6f5f3] px-3 py-2 text-[11px] leading-5 text-[#8a8a88] break-all">
                {provider.url}
              </p>
            </div>

            <div className="mt-6 space-y-3">
              <button
                className="flex h-12 w-full items-center justify-center rounded-2xl bg-[#1a1a1a] text-[13px] font-medium text-white transition-colors hover:bg-[#2b2b2b] active:scale-[0.99]"
                onClick={() => { void openProviderUrl(panel.providerId, "inAppBrowser"); }}
              >
                在应用内浏览器打开
              </button>
              <button
                className="flex h-11 w-full items-center justify-center rounded-2xl border border-black/[0.08] bg-[#f7f6f4] text-[13px] font-medium text-[#4b4b49] transition-colors hover:bg-[#f1efec] active:scale-[0.99]"
                onClick={() => { void openProviderUrl(panel.providerId, "system"); }}
              >
                在 Safari 打开
              </button>
              <p className="text-[11px] leading-5 text-[#999895]">
                这些站点通常会阻止 iframe 嵌入。移动端暂时改为应用内浏览器查看，保证网页能正常打开。
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 bg-[#F5F5F5] flex items-center justify-center animate-pulse">
          <div className="text-center px-4">
            <div className="mx-auto mb-3 opacity-50">
              <ProviderIcon providerId={panel.providerId} size={32} />
            </div>
            <p className="text-xs text-[#999] font-medium opacity-50">{provider.label}</p>
            <div className="mt-3 w-24 h-2 bg-black/[0.04] rounded-full mx-auto" />
            <div className="mt-1.5 w-16 h-2 bg-black/[0.04] rounded-full mx-auto" />
          </div>
        </div>
      )}

      {canResize && (
        <div
          ref={resizeRef}
          className="absolute top-0 -right-[6px] w-[12px] h-full cursor-col-resize z-20 group/resize"
          onMouseDown={handleResizeStart}
        >
          <div className="absolute inset-x-[3px] top-0 h-full group-hover/resize:bg-blue-400/20 transition-colors" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[4px] h-12 rounded-full bg-black/[0.08] group-hover/resize:bg-blue-500/60 group-active/resize:bg-blue-600/80 transition-colors" />
        </div>
      )}
    </div>
  );
}
