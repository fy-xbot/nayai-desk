import { useState, useRef, useEffect, lazy, Suspense } from "react";
import { useUIStore } from "../../stores/uiStore";
import { useConversationStore } from "../../stores/conversationStore";
import { ProviderIcon } from "../common/ProviderIcon";
import { isTauri, hideAllWebviews } from "../../services/webviewManager";
import type { LayoutMode } from "../../types/provider";

const TrafficLights = lazy(() =>
  import("../common/TrafficLights").then((m) => ({ default: m.TrafficLights }))
);

const layoutIcons: Record<LayoutMode, { title: string; path: string }> = {
  columns: { title: "竖排布局", path: "M3 3h7v18H3zM14 3h7v18h-7z" },
  rows: { title: "横排布局", path: "M3 3h18v7H3zM3 14h18v7H3z" },
  grid: { title: "网格布局", path: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" },
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return new Date(ts).toLocaleDateString("zh-CN");
}

interface Props {
  onSwitchConversation: (id: string) => void;
  onNewConversation: () => void;
  isMobile?: boolean;
}

export function Sidebar({ onSwitchConversation, onNewConversation, isMobile = false }: Props) {
  const layout = useUIStore((s) => s.layout);
  const cycleLayout = useUIStore((s) => s.cycleLayout);
  const setShowSettings = useUIStore((s) => s.setShowSettings);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const showTrafficLights = isTauri() && !isMobile;

  const startDraggingRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    import("@tauri-apps/api/core").then((m) => {
      startDraggingRef.current = () => m.invoke("start_dragging");
    });
  }, []);

  const handleDragRegionMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startDraggingRef.current?.();
  };

  const conversations = useConversationStore((s) => s.conversations);
  const activeId = useConversationStore((s) => s.activeId);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const renameConversation = useConversationStore((s) => s.renameConversation);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const icon = layoutIcons[layout];

  function startRename(id: string, currentTitle: string) {
    setEditingId(id);
    setEditTitle(currentTitle);
  }

  function commitRename(id: string) {
    if (editTitle.trim()) {
      renameConversation(id, editTitle.trim());
    }
    setEditingId(null);
  }

  if (collapsed) {
    return (
      <aside className="flex flex-col w-[52px] bg-[#f0f0ef] shrink-0 h-full items-center border-r border-black/[0.04]">
        <div className="flex items-center h-[28px] shrink-0 w-full">
          {showTrafficLights && (
            <Suspense fallback={<div className="w-10 shrink-0" />}>
              <div className="shrink-0 relative z-10">
                <TrafficLights />
              </div>
            </Suspense>
          )}
          <div
            data-tauri-drag-region
            className="flex-1 h-full min-w-0 cursor-grab active:cursor-grabbing"
            onMouseDown={handleDragRegionMouseDown}
          />
        </div>

        <button
          className="mt-1.5 w-9 h-9 rounded-lg flex items-center justify-center text-[#888] hover:bg-white/60 hover:text-[#555] active:scale-95 transition-all cursor-pointer min-w-[44px] min-h-[44px]"
          onClick={onNewConversation}
          title="新对话"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>

        <div className="flex-1" />

        <div className="flex flex-col items-center gap-1 pb-3">
          {!isMobile && (
            <button
              className="w-9 h-9 rounded-lg text-[#888] flex items-center justify-center hover:bg-white/60 hover:text-[#555] active:scale-95 transition-all cursor-pointer min-w-[44px] min-h-[44px]"
              title={icon.title}
              onClick={cycleLayout}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={icon.path} />
              </svg>
            </button>
          )}

          <button
            className="w-9 h-9 rounded-lg text-[#888] flex items-center justify-center hover:bg-white/60 hover:text-[#555] active:scale-95 transition-all cursor-pointer min-w-[44px] min-h-[44px]"
            title="设置"
            onClick={async () => { await hideAllWebviews(); setShowSettings(true); }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>

          <button
            className="w-9 h-9 rounded-lg text-[#888] flex items-center justify-center hover:bg-white/60 hover:text-[#555] active:scale-95 transition-all cursor-pointer min-w-[44px] min-h-[44px]"
            title="展开侧边栏"
            onClick={toggleSidebar}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </aside>
    );
  }

  // 小屏展开：浮层抽屉，不占主内容宽度
  if (isMobile) {
    return (
      <>
        {/* 底层永远是 52px 的折叠侧栏 */}
        <aside className="flex flex-col w-[52px] bg-[#f0f0ef] shrink-0 h-full items-center border-r border-black/[0.04]">
          <div className="flex items-center h-[28px] shrink-0 w-full" />
          <button
            className="mt-1.5 w-9 h-9 rounded-lg flex items-center justify-center text-[#888] hover:bg-white/60 hover:text-[#555] active:scale-95 transition-all cursor-pointer min-w-[44px] min-h-[44px]"
            onClick={onNewConversation}
            title="新对话"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <div className="flex-1" />
          <div className="flex flex-col items-center gap-1 pb-3">
            <button
              className="w-9 h-9 rounded-lg text-[#888] flex items-center justify-center hover:bg-white/60 hover:text-[#555] active:scale-95 transition-all cursor-pointer min-w-[44px] min-h-[44px]"
              title="设置"
              onClick={async () => { await hideAllWebviews(); setShowSettings(true); }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            <button
              className="w-9 h-9 rounded-lg text-[#888] flex items-center justify-center hover:bg-white/60 hover:text-[#555] active:scale-95 transition-all cursor-pointer min-w-[44px] min-h-[44px]"
              title="展开侧边栏"
              onClick={toggleSidebar}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
          </div>
        </aside>

        {/* 浮层抽屉：通过 CSS 控制滑入滑出 */}
        <div className={`fixed inset-0 z-[90] transition-all duration-300 ${!collapsed ? "visible" : "invisible pointer-events-none"}`}>
          <div
            className={`absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${!collapsed ? "opacity-100" : "opacity-0"}`}
            onClick={toggleSidebar}
            aria-hidden
          />
          <aside className={`absolute left-0 top-0 bottom-0 w-[min(280px,85vw)] bg-[#f0f0ef] border-r border-black/[0.06] shadow-2xl flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${!collapsed ? "translate-x-0" : "-translate-x-full"}`}>
            <div className="flex items-center justify-between h-12 px-3 shrink-0 border-b border-black/[0.04]">
            <span className="text-sm font-medium text-[#333]">对话</span>
            <button
              className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#888] hover:bg-white/60 hover:text-[#555] active:scale-95 transition-all -mr-2"
              title="收起"
              onClick={toggleSidebar}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </div>
          <div className="px-3 pt-3 pb-2">
            <button
              className="w-full flex items-center justify-center gap-1.5 h-11 rounded-lg text-[13px] font-medium text-[#555] bg-white/80 border border-black/[0.06] hover:bg-white active:scale-95 transition-all cursor-pointer"
              onClick={onNewConversation}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              新对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
            <div className="px-2 pt-2 pb-1.5 text-[10px] font-semibold text-[#b0b0b0] uppercase tracking-wider">
              对话
            </div>
            {conversations.length === 0 && (
              <p className="px-2 py-4 text-[11px] text-[#c0c0c0] text-center">暂无对话</p>
            )}
            {conversations.map((conv) => {
              const isActive = conv.id === activeId;
              const isEditing = editingId === conv.id;
              return (
                <div
                  key={conv.id}
                  className={`group flex items-center gap-2 rounded-lg px-2.5 py-2.5 cursor-pointer transition-colors min-h-[44px] ${
                    isActive ? "bg-white shadow-[0_0.5px_2px_rgba(0,0,0,0.05)]" : "hover:bg-white/60"
                  }`}
                  onClick={() => { if (!isEditing) { onSwitchConversation(conv.id); toggleSidebar(); } }}
                >
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <input
                        className="w-full text-[12px] font-medium text-[#333] bg-transparent outline-none border-b border-black/[0.1] pb-0.5"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={() => commitRename(conv.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(conv.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <p className="text-[12px] font-medium text-[#444] truncate leading-tight">
                        {conv.title || "新对话"}
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 mt-1">
                      {conv.providerIds.slice(0, 4).map((pid) => (
                        <ProviderIcon key={pid} providerId={pid} size={11} />
                      ))}
                      {conv.providerIds.length > 4 && (
                        <span className="text-[9px] text-[#bbb]">+{conv.providerIds.length - 4}</span>
                      )}
                    </div>
                  </div>
                  {/* 时间 / 操作按钮互斥显示：默认显示时间，active 或 hover 时切换为按钮 */}
                  <div className="shrink-0 flex items-center">
                    <span className={`text-[10px] text-[#b8b8b8] whitespace-nowrap ${
                      isActive ? "hidden" : "group-hover:hidden"
                    }`}>
                      {timeAgo(conv.updatedAt)}
                    </span>
                    <div className={`items-center gap-0.5 ${
                      isActive ? "flex" : "hidden group-hover:flex"
                    }`}>
                      <button
                        className="w-8 h-8 rounded flex items-center justify-center text-[#bbb] hover:text-[#555] hover:bg-black/[0.05] active:scale-95 transition-all cursor-pointer"
                        title="重命名"
                        onClick={(e) => { e.stopPropagation(); startRename(conv.id, conv.title || "新对话"); }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        </svg>
                      </button>
                      <button
                        className="w-8 h-8 rounded flex items-center justify-center text-[#bbb] hover:text-red-400 hover:bg-red-50 active:scale-95 transition-all cursor-pointer"
                        title="删除"
                        onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="px-3 py-3 border-t border-black/[0.04] flex items-center justify-end gap-1">
            <button
              className="min-w-[44px] min-h-[44px] rounded-lg text-[#888] flex items-center justify-center hover:bg-white/60 hover:text-[#555] active:scale-95 transition-all"
              title="设置"
              onClick={async () => { await hideAllWebviews(); setShowSettings(true); toggleSidebar(); }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>
        </aside>
        </div>
      </>
    );
  }

  const appBrand = (
    <div className="flex flex-col items-center gap-1 px-3 py-3 border-b border-black/[0.04]">
      <img src="/app-icon.png" alt="" className="w-9 h-9 shrink-0 object-contain" />
      <span className="text-[13px] font-semibold text-[#333] leading-tight">NayAI Desk</span>
      <span className="text-[10px] text-[#888] leading-tight text-center">多模型 AI 聚合工作台</span>
    </div>
  );

  // 桌面展开：固定 200px 侧栏
  return (
    <aside className="flex flex-col w-[200px] bg-[#f0f0ef] shrink-0 h-full border-r border-black/[0.04]">
      <div className="flex items-center h-[28px] shrink-0 w-full">
        {showTrafficLights && (
          <Suspense fallback={<div className="w-10 shrink-0" />}>
            <TrafficLights />
          </Suspense>
        )}
        <div
          data-tauri-drag-region
          className="flex-1 h-full min-w-0 cursor-grab active:cursor-grabbing"
          onMouseDown={handleDragRegionMouseDown}
        />
      </div>

      {appBrand}

      <div className="px-3 pt-2 mb-2">
        <button
          className="w-full flex items-center justify-center gap-1.5 h-[32px] rounded-lg text-[11px] font-medium text-[#555] bg-white/80 border border-black/[0.06] shadow-[0_0.5px_2px_rgba(0,0,0,0.04)] hover:bg-white hover:shadow-[0_1px_4px_rgba(0,0,0,0.06)] active:scale-95 transition-all cursor-pointer"
          onClick={onNewConversation}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          新对话
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        <div className="px-2 pt-2 pb-1.5 text-[10px] font-semibold text-[#b0b0b0] uppercase tracking-wider">
          对话
        </div>
        {conversations.length === 0 && (
          <p className="px-2 py-4 text-[11px] text-[#c0c0c0] text-center">暂无对话</p>
        )}
        {conversations.map((conv) => {
          const isActive = conv.id === activeId;
          const isEditing = editingId === conv.id;
          return (
            <div
              key={conv.id}
              className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer transition-colors ${
                isActive ? "bg-white shadow-[0_0.5px_2px_rgba(0,0,0,0.05)]" : "hover:bg-white/60"
              }`}
              onClick={() => { if (!isEditing) onSwitchConversation(conv.id); }}
            >
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    className="w-full text-[12px] font-medium text-[#333] bg-transparent outline-none border-b border-black/[0.1] pb-0.5"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => commitRename(conv.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(conv.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <p className="text-[12px] font-medium text-[#444] truncate leading-tight">
                    {conv.title || "新对话"}
                  </p>
                )}
                <div className="flex items-center gap-1.5 mt-1">
                  {conv.providerIds.slice(0, 4).map((pid) => (
                    <ProviderIcon key={pid} providerId={pid} size={11} />
                  ))}
                  {conv.providerIds.length > 4 && (
                    <span className="text-[9px] text-[#bbb]">+{conv.providerIds.length - 4}</span>
                  )}
                </div>
              </div>

              {/* 时间 / 操作按钮互斥显示：默认显示时间，active 或 hover 时切换为按钮 */}
              <div className="shrink-0 flex items-center">
                <span className={`text-[9px] text-[#c0c0c0] whitespace-nowrap ${
                  isActive ? "hidden" : "group-hover:hidden"
                }`}>
                  {timeAgo(conv.updatedAt)}
                </span>
                <div className={`items-center gap-0.5 ${
                  isActive ? "flex" : "hidden group-hover:flex"
                }`}>
                  <button
                    className="w-5 h-5 rounded flex items-center justify-center text-[#bbb] hover:text-[#555] hover:bg-black/[0.05] active:scale-95 transition-all cursor-pointer"
                    title="重命名"
                    onClick={(e) => { e.stopPropagation(); startRename(conv.id, conv.title || "新对话"); }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                  </button>
                  <button
                    className="w-5 h-5 rounded flex items-center justify-center text-[#bbb] hover:text-red-400 hover:bg-red-50 active:scale-95 transition-all cursor-pointer"
                    title="删除"
                    onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-3 border-t border-black/[0.04] flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            className="w-8 h-8 rounded-lg text-[#888] flex items-center justify-center hover:bg-white/60 hover:text-[#555] active:scale-95 transition-all cursor-pointer"
            title={icon.title}
            onClick={cycleLayout}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={icon.path} />
            </svg>
          </button>

          <button
            className="w-8 h-8 rounded-lg text-[#888] flex items-center justify-center hover:bg-white/60 hover:text-[#555] active:scale-95 transition-all cursor-pointer"
            title="设置"
            onClick={async () => { await hideAllWebviews(); setShowSettings(true); }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>

        <button
          className="w-8 h-8 rounded-lg text-[#888] flex items-center justify-center hover:bg-white/60 hover:text-[#555] active:scale-95 transition-all cursor-pointer"
          title="折叠侧边栏"
          onClick={toggleSidebar}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
