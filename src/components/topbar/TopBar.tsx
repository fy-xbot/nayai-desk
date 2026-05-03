import { useRef, useState, useCallback, useEffect } from "react";
import { ProviderIcon } from "../common/ProviderIcon";
import { usePanelStore } from "../../stores/panelStore";
import { useUIStore } from "../../stores/uiStore";
import { getProvider } from "../../providers/registry";
import { isTauriMobile, openProviderUrl, refreshWebview } from "../../services/webviewManager";

const DRAG_THRESHOLD = 4;

interface TopBarProps {
  isMobile?: boolean;
}

export function TopBar({ isMobile = false }: TopBarProps) {
  const panels = usePanelStore((s) => s.panels);
  const focusedPanelId = usePanelStore((s) => s.focusedPanelId);
  const setFocusedPanel = usePanelStore((s) => s.setFocusedPanel);
  const removePanel = usePanelStore((s) => s.removePanel);
  const reorderPanels = usePanelStore((s) => s.reorderPanels);
  const loginStatus = usePanelStore((s) => s.loginStatus);
  const maximizedPanelId = usePanelStore((s) => s.maximizedPanelId);
  const toggleMaximize = usePanelStore((s) => s.toggleMaximize);
  const promptMode = useUIStore((s) => s.promptMode);
  const layout = useUIStore((s) => s.layout);
  const panelWidths = usePanelStore((s) => s.panelWidths);
  const isMobileBrowserMode = isTauriMobile();

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLDivElement | null)[]>([]);
  const draggingRef = useRef(false);
  const sourceIdxRef = useRef<number | null>(null);

  const getTabIndexAtX = useCallback((clientX: number) => {
    for (let i = 0; i < tabRefs.current.length; i++) {
      const el = tabRefs.current[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return i;
    }
    return null;
  }, []);

  const handleMouseDown = useCallback(
    (idx: number, e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      let started = false;
      sourceIdxRef.current = idx;

      const onMove = (me: MouseEvent) => {
        if (!started) {
          const dx = Math.abs(me.clientX - startX);
          const dy = Math.abs(me.clientY - startY);
          if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
          started = true;
          draggingRef.current = true;
          setDragIdx(idx);
        }
        const hoverIdx = getTabIndexAtX(me.clientX);
        setOverIdx(hoverIdx);
      };

      const onUp = (me: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        const srcIdx = sourceIdxRef.current;
        if (started && srcIdx !== null) {
          const dropIdx = getTabIndexAtX(me.clientX);
          if (dropIdx !== null && dropIdx !== srcIdx) {
            reorderPanels(srcIdx, dropIdx);
          }
          setDragIdx(null);
          setOverIdx(null);
          setTimeout(() => {
            draggingRef.current = false;
            sourceIdxRef.current = null;
          }, 0);
        } else {
          sourceIdxRef.current = null;
        }
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [getTabIndexAtX, reorderPanels],
  );

  const handleClick = useCallback(
    (panelId: string) => {
      if (draggingRef.current) return;
      setFocusedPanel(panelId);
    },
    [setFocusedPanel],
  );

  useEffect(() => {
    tabRefs.current = tabRefs.current.slice(0, panels.length);
  }, [panels.length]);

  const tabFlexClass = isMobile
    ? "flex-none min-w-[100px]"
    : "min-w-0 flex-1";
  const containerClass = isMobile
    ? "flex items-end h-[44px] bg-[#F5F5F5] shrink-0 pt-[6px] gap-1 relative overflow-x-auto overflow-y-hidden"
    : "flex items-end h-[40px] bg-[#F5F5F5] shrink-0 pt-[6px] pl-1 gap-1 relative";
  const btnTouchClass = isMobile ? "min-w-[44px] min-h-[44px]" : "";

  return (
    <div
      ref={containerRef}
      className={containerClass}
    >
      {panels.map((panel, idx) => {
        const p = getProvider(panel.providerId);
        const isDragging = dragIdx === idx;
        const isOver = overIdx === idx && dragIdx !== null && dragIdx !== idx;
        const isFocused = panel.id === focusedPanelId;
        const isActive = isFocused || promptMode === "broadcast";
        const isBroadcastActive = promptMode === "broadcast" && isActive;
        const tabFlexStyle =
          !isMobile && layout === "columns" && panelWidths.length === panels.length
            ? { flex: panelWidths[idx] ?? 1 }
            : undefined;
        return (
          <div
            key={panel.id}
            ref={(el) => { tabRefs.current[idx] = el; }}
            onMouseDown={isMobile ? undefined : (e) => handleMouseDown(idx, e)}
            onClick={() => handleClick(panel.id)}
            style={tabFlexStyle}
            className={`group ${tabFlexClass} flex items-center justify-between min-w-0 px-3 h-full rounded-t-xl transition-all relative z-[1] ${
              isMobile ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
            } ${isDragging ? "scale-105 shadow-lg !z-10 opacity-90" : ""} ${
              isActive || isBroadcastActive
                ? "bg-white z-[2] tab-active"
                : isOver
                  ? "bg-[#eae9e8]"
                  : "bg-[#e6e5e4] hover:bg-[#eae9e8]"
            }`}
          >
            <div className="flex items-center gap-1.5 min-w-0">
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
                className={`text-[11px] font-medium truncate ${
                  isActive || isBroadcastActive ? "text-[#333]" : "text-[#777]"
                }`}
              >
                {p.label}
              </span>
            </div>

            <div className="flex items-center gap-0.5 shrink-0">
              <button
                className={`rounded-md flex items-center justify-center text-[#bbb] hover:text-[#333] hover:bg-black/[0.07] active:scale-95 transition-all cursor-pointer w-5 h-5 min-w-[20px] min-h-[20px] ${btnTouchClass}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isMobileBrowserMode) {
                    void openProviderUrl(panel.providerId, "inAppBrowser");
                  } else {
                    void refreshWebview(panel.id);
                  }
                }}
                title={isMobileBrowserMode ? `打开 ${p.label}` : "刷新"}
              >
                {isMobileBrowserMode ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17L17 7" />
                    <path d="M8 7h9v9" />
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-2.636-6.364" />
                    <path d="M21 3v6h-6" />
                  </svg>
                )}
              </button>

              {!isMobileBrowserMode && panels.length > 1 && (
                <button
                  className={`rounded-md flex items-center justify-center hover:bg-black/[0.07] active:scale-95 transition-all cursor-pointer w-5 h-5 min-w-[20px] min-h-[20px] ${btnTouchClass} ${
                    maximizedPanelId === panel.id ? "text-[#333]" : "text-[#bbb] hover:text-[#333]"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleMaximize(panel.id);
                  }}
                  title={maximizedPanelId === panel.id ? "还原" : "最大化"}
                >
                  {maximizedPanelId === panel.id ? (
                    // 还原（收缩）图标
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 14h6v6" />
                      <path d="M20 10h-6V4" />
                      <path d="M14 10L21 3" />
                      <path d="M3 21l7-7" />
                    </svg>
                  ) : (
                    // 最大化（展开）图标
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
                  className={`rounded-md flex items-center justify-center text-[#bbb] hover:text-[#333] hover:bg-black/[0.07] active:scale-95 transition-all cursor-pointer w-5 h-5 min-w-[20px] min-h-[20px] ${btnTouchClass}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    removePanel(panel.id);
                  }}
                  title="关闭"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
