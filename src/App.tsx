import { useEffect, useCallback, useState, useRef } from "react";
import { Sidebar } from "./components/sidebar/Sidebar";
import { TopBar } from "./components/topbar/TopBar";
import { ProviderColumn } from "./components/workspace/ProviderColumn";
import { PromptInput } from "./components/input/PromptInput";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { DownloadToast } from "./components/download/DownloadToast";
import { DownloadListPopover } from "./components/download/DownloadListPopover";
import { OnboardingModal } from "./components/onboarding/OnboardingModal";
import { ProviderIcon } from "./components/common/ProviderIcon";
import { WhisperModelToast } from "./components/voice/WhisperModelToast";
import { usePanelStore, getRepositionOpts } from "./stores/panelStore";
import { useUIStore } from "./stores/uiStore";
import { useConversationStore } from "./stores/conversationStore";
import { useDownloadStore } from "./stores/downloadStore";
import { useWhisperStore } from "./stores/whisperStore";
import { getAllProviders } from "./providers/registry";
import { useIsMobile } from "./hooks/useIsMobile";
import {
  repositionAllWebviews,
  refreshAllWebviews,
  setCurrentLayout,
  setSidebarCollapsed as setWebviewSidebarCollapsed,
  hideAllWebviews,
  showAllWebviews,
  setFocusMode,
  updateFocusOverlays,
  applyZoomToAllWebviews,
  applyHideChromeToAllWebviews,
  navigateWebview,
  startUrlPolling,
  isTauriDesktop,
} from "./services/webviewManager";
import { buildChatUrl, getProviderHomeUrl } from "./providers/chatUrls";
import type { ProviderId } from "./types/provider";

function App() {
  const initPanels = usePanelStore((s) => s.initPanels);
  const replacePanels = usePanelStore((s) => s.replacePanels);
  const initialized = usePanelStore((s) => s.initialized);
  const panels = usePanelStore((s) => s.panels);
  const layout = useUIStore((s) => s.layout);
  const promptMode = useUIStore((s) => s.promptMode);
  const showSettings = useUIStore((s) => s.showSettings);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const defaultProviders = useUIStore((s) => s.defaultProviders);
  const hasSeenDefaultModelPrompt = useUIStore((s) => s.hasSeenDefaultModelPrompt);
  const setDefaultProviders = useUIStore((s) => s.setDefaultProviders);
  const markDefaultModelPromptSeen = useUIStore((s) => s.markDefaultModelPromptSeen);
  const focusedPanelId = usePanelStore((s) => s.focusedPanelId);
  const maximizedPanelId = usePanelStore((s) => s.maximizedPanelId);
  const startLoginDetection = usePanelStore((s) => s.startLoginDetection);
  const initWhisperAutoDownload = useWhisperStore((s) => s.initAutoDownload);

  const conversations = useConversationStore((s) => s.conversations);
  const activeId = useConversationStore((s) => s.activeId);
  const createConversation = useConversationStore((s) => s.createConversation);
  const setActive = useConversationStore((s) => s.setActive);
  const getActive = useConversationStore((s) => s.getActive);
  const isMobile = useIsMobile();
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const setMobile = useUIStore((s) => s.setMobile);

  // 同步 isMobile 到 store（供 webviewManager 等读取）
  useEffect(() => {
    setMobile(isMobile);
  }, [isMobile, setMobile]);

  // 小屏默认侧栏收起（抽屉）
  useEffect(() => {
    if (isMobile) setSidebarCollapsed(true);
  }, [isMobile, setSidebarCollapsed]);

  const getPanels = () => usePanelStore.getState().panels;

  // Boot: 新用户未完成引导时推迟初始化，等 onboarding 结算；其他情况照常 initPanels
  useEffect(() => {
    const ui = useUIStore.getState();
    const isNewUser = conversations.length === 0;

    // 新用户首次进入：等待 onboarding 完成后再 init（见 handleOnboardingConfirm）
    if (isNewUser && !ui.hasSeenDefaultModelPrompt) return;

    // 老用户尚未标记"看过"：直接静默标记，避免以后再打扰
    if (!isNewUser && !ui.hasSeenDefaultModelPrompt) {
      ui.markDefaultModelPromptSeen();
    }

    let providers = ui.defaultProviders;
    if (isNewUser) {
      createConversation(ui.defaultProviders);
    } else {
      const active = getActive();
      if (active) providers = active.providerIds;
    }
    initPanels(providers).then(() => {
      startLoginDetection();
      startUrlPolling();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 首次启动自动准备离线语音模型（若模型已存在只做状态检查）
  useEffect(() => {
    if (!isTauriDesktop()) return;
    void initWhisperAutoDownload();
  }, [initWhisperAutoDownload]);

  // Layout changes
  useEffect(() => {
    setCurrentLayout(layout);
    repositionAllWebviews(getPanels(), getRepositionOpts());
  }, [layout]);

  // Sidebar collapse → sync to webviewManager and update webview positions
  useEffect(() => {
    setWebviewSidebarCollapsed(sidebarCollapsed);
    repositionAllWebviews(getPanels(), getRepositionOpts());
  }, [sidebarCollapsed]);

  // Hide webviews when overlay is active (native webviews render above React)
  useEffect(() => {
    if (showSettings) {
      void hideAllWebviews();
    } else {
      void showAllWebviews(getPanels(), getRepositionOpts());
    }
  }, [showSettings]);

  // 移动端或焦点变化时重排 webview（单列时只显示当前面板）
  useEffect(() => {
    repositionAllWebviews(getPanels(), getRepositionOpts());
  }, [isMobile, focusedPanelId]);

  // Single mode: overlay unfocused webviews to block interaction
  useEffect(() => {
    const isSingle = promptMode === "single";
    setFocusMode(isSingle, focusedPanelId);
    updateFocusOverlays(usePanelStore.getState().panels);
  }, [promptMode, focusedPanelId]);

  // Window resize
  useEffect(() => {
    if (!isTauriDesktop()) return;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      getCurrentWindow()
        .onResized(() => {
          repositionAllWebviews(usePanelStore.getState().panels, getRepositionOpts());
        })
        .then((fn) => {
          unlisten = fn;
        });
    });
    return () => unlisten?.();
  }, []);

  const handleSwitchConversation = useCallback(
    async (id: string) => {
      if (id === activeId) return;
      setActive(id);
      const conv = useConversationStore
        .getState()
        .conversations.find((c) => c.id === id);
      if (!conv) return;
      await replacePanels(conv.providerIds);
      // 有 chatId 的模型深链跳转；没有的保持在 home（= 新对话起点）
      const panels = usePanelStore.getState().panels;
      await Promise.allSettled(
        panels.map((p) => {
          const chatId = conv.remoteChatIds?.[p.providerId];
          if (chatId) {
            return navigateWebview(p.id, buildChatUrl(p.providerId, chatId));
          }
          return navigateWebview(p.id, getProviderHomeUrl(p.providerId));
        }),
      );
    },
    [activeId, setActive, replacePanels],
  );

  const handleNewConversation = useCallback(async () => {
    const current = useUIStore.getState().defaultProviders;
    const id = createConversation(current);
    setActive(id);
    await replacePanels(current);
  }, [createConversation, setActive, replacePanels]);

  const handleOnboardingConfirm = useCallback(
    async (selected: ProviderId[]) => {
      setDefaultProviders(selected);
      markDefaultModelPromptSeen();
      createConversation(selected);
      await initPanels(selected);
      startLoginDetection();
      startUrlPolling();
    },
    [setDefaultProviders, markDefaultModelPromptSeen, createConversation, initPanels, startLoginDetection],
  );

  // 新用户首次进入：即使 panels 未初始化也要把 onboarding 渲染出来
  if (!initialized) {
    const isNewUser = conversations.length === 0 && !hasSeenDefaultModelPrompt;
    if (isNewUser) {
      return (
        <OnboardingModal
          initialSelection={defaultProviders}
          onConfirm={handleOnboardingConfirm}
        />
      );
    }
    return null;
  }

  const layoutClass =
    layout === "rows"
      ? "flex flex-col"
      : layout === "grid"
        ? "flex flex-wrap"
        : "flex flex-row";

  // 小屏只渲染当前选中的 1 个模型，单列全宽
  const focusedIdx = panels.findIndex((p) => p.id === focusedPanelId);
  const activePanel = focusedIdx >= 0 ? panels[focusedIdx] : panels[0];
  const maximizedPanel = maximizedPanelId
    ? panels.find((p) => p.id === maximizedPanelId)
    : undefined;
  // 最大化优先级高于 mobile：最大化模式下只渲染被最大化的 panel，占据整个工作区
  const panelsToRender = maximizedPanel
    ? [maximizedPanel]
    : isMobile && activePanel
      ? [activePanel]
      : panels;
  const activeIndex = maximizedPanel
    ? 0
    : isMobile && activePanel
      ? 0
      : focusedIdx >= 0
        ? focusedIdx
        : 0;

  return (
    <div className="flex h-full w-full bg-[#eeeeed] text-[#1a1a1a] text-sm select-none overflow-hidden rounded-2xl border border-[#c9c9c8]">
      <Sidebar
        onSwitchConversation={handleSwitchConversation}
        onNewConversation={handleNewConversation}
        isMobile={isMobile}
      />

      <main className={`flex flex-col flex-1 min-w-0 relative ${layout === "columns" ? "pr-2" : ""}`}>
        {/* 只有竖排（columns）或移动端单列视图需要全局 TopBar；rows/grid 使用每个 panel 顶部的悬浮圆角标签 */}
        {(layout === "columns" || isMobile) && <TopBar isMobile={isMobile} />}

        <div className={`${layoutClass} flex-1 min-h-0 gap-1 overflow-hidden ${layout === "columns" ? "pl-1" : ""}`}>
          {panelsToRender.map((panel, idx) => {
            // 最大化模式下 ProviderColumn 要占满整个工作区，用 rows 布局的 sizeClass（flex-1 + w-full）即可填充；
            // 仍根据原 layout 决定是否显示悬浮标签（columns 显示 TopBar，rows/grid 显示悬浮标签）。
            const panelLayout: typeof layout = maximizedPanel
              ? layout === "columns"
                ? "columns"
                : "rows"
              : isMobile
                ? "columns"
                : layout;
            return (
              <ProviderColumn
                key={panel.id}
                panel={panel}
                layout={panelLayout}
                total={maximizedPanel ? 1 : panels.length}
                canClose={panels.length > 1}
                index={maximizedPanel ? 0 : isMobile ? activeIndex : idx}
              />
            );
          })}
        </div>

        <PromptInput floatingActions={<FloatingActions />} />
      </main>

      <SettingsPanel />
      <DownloadToast />
      <WhisperModelToast />
    </div>
  );
}

function FloatingActions() {
  const panels = usePanelStore((s) => s.panels);
  const addPanel = usePanelStore((s) => s.addPanel);
  const webviewZoom = useUIStore((s) => s.webviewZoom);
  const setWebviewZoom = useUIStore((s) => s.setWebviewZoom);
  const hideWebviewChrome = useUIStore((s) => s.hideWebviewChrome);
  const setHideWebviewChrome = useUIStore((s) => s.setHideWebviewChrome);
  const showDownloadPanel = useDownloadStore((s) => s.showPanel);
  const toggleDownloadPanel = useDownloadStore((s) => s.togglePanel);
  const setShowDownloadPanel = useDownloadStore((s) => s.setShowPanel);
  const downloadingCount = useDownloadStore((s) =>
    s.records.reduce((c, r) => c + (r.status === "downloading" ? 1 : 0), 0),
  );
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const downloadBtnRef = useRef<HTMLButtonElement>(null);
  const providers = getAllProviders();
  const isDesktopTauri = isTauriDesktop();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (showMenu || showDownloadPanel) {
      hideAllWebviews();
    } else {
      const { showSettings } = useUIStore.getState();
      if (!showSettings) {
        showAllWebviews(usePanelStore.getState().panels);
      }
    }
  }, [showMenu, showDownloadPanel]);

  return (
    <div className="relative flex items-center gap-1" ref={menuRef}>
      {isDesktopTauri && (
        <div className="relative group">
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-[#333] text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[100]">
            全部刷新
          </span>
          <button
            className="w-7 h-7 rounded-lg border border-black/[0.08] flex items-center justify-center text-[#999] hover:text-[#333] hover:bg-black/[0.04] active:scale-95 transition-all cursor-pointer"
            onClick={() => refreshAllWebviews(panels)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.636-6.364" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
        </div>
      )}

      <div className="relative group">
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-[#333] text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[100]">
          添加模型
        </span>
        <button
          className="w-7 h-7 rounded-lg border border-black/[0.08] flex items-center justify-center text-[#999] hover:text-[#333] hover:bg-black/[0.04] active:scale-95 transition-all cursor-pointer"
          onClick={() => setShowMenu(!showMenu)}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>

        {showMenu && (
          <div className="absolute bottom-full left-0 mb-2 w-48 bg-white/80 backdrop-blur-md rounded-xl border border-black/[0.06] shadow-[0_8px_30px_rgba(0,0,0,0.12)] py-1.5 z-[200]">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-[#aaa] uppercase tracking-wider">
              添加模型
            </div>
            {(["US", "CN"] as const).map((region) => {
              const items = providers.filter((p) => p.region === region);
              if (items.length === 0) return null;
              return (
                <div key={region}>
                  <div className="px-3 pt-1.5 pb-1 text-[9px] font-semibold text-[#c4c4c4] uppercase tracking-wider">
                    {region === "US" ? "国外" : "国内"}
                  </div>
                  {items.map((p) => {
                    const alreadyOpen = panels.some((pan) => pan.providerId === p.id);
                    const atLimit = panels.length >= 6;
                    const disabled = alreadyOpen || atLimit;
                    return (
                      <button
                        key={p.id}
                        disabled={disabled}
                        title={
                          alreadyOpen
                            ? "该模型已添加，关闭后可再次添加"
                            : atLimit
                              ? "已达最大模型数量"
                              : undefined
                        }
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-[#444] hover:bg-[#f5f5f4] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        onClick={async () => {
                          setShowMenu(false);
                          await addPanel(p.id);
                        }}
                      >
                        <ProviderIcon providerId={p.id} size={16} />
                        <div className="flex flex-col items-start flex-1 min-w-0">
                          <span className="text-[11px] font-medium">{p.label}</span>
                          <span className="text-[9px] text-[#bbb] leading-tight">{p.desc}</span>
                        </div>
                        {alreadyOpen && (
                          <span className="text-[9px] text-[#bbb] shrink-0">已添加</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isDesktopTauri && (
        <div className="relative group">
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-[#333] text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[100]">
            {hideWebviewChrome ? "显示网页顶栏、输入框与辅助提示" : "隐藏网页顶栏、输入框与辅助提示"}
          </span>
          <button
            type="button"
            className={`w-7 h-7 rounded-lg border border-black/[0.08] flex items-center justify-center active:scale-95 transition-all cursor-pointer ${
              hideWebviewChrome ? "text-[#333] bg-black/[0.04]" : "text-[#999] hover:text-[#333] hover:bg-black/[0.04]"
            }`}
            onClick={async () => {
              const v = !hideWebviewChrome;
              setHideWebviewChrome(v);
              await applyHideChromeToAllWebviews(panels);
            }}
          >
            {hideWebviewChrome ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      )}

      {isDesktopTauri && (
        <div className="flex items-center gap-0.5 border border-black/[0.08] rounded-lg overflow-hidden">
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-[#999] hover:text-[#333] hover:bg-black/[0.04] active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="缩小"
            disabled={webviewZoom <= 0.5}
            onClick={async () => {
              setWebviewZoom(webviewZoom - 0.1);
              await applyZoomToAllWebviews(panels);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M5 12h14" />
            </svg>
          </button>
          <span className="min-w-[2.5rem] text-center text-[11px] font-medium text-[#555] tabular-nums">
            {Math.round(webviewZoom * 100)}%
          </span>
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-[#999] hover:text-[#333] hover:bg-black/[0.04] active:scale-95 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="放大"
            disabled={webviewZoom >= 1.5}
            onClick={async () => {
              setWebviewZoom(webviewZoom + 0.1);
              await applyZoomToAllWebviews(panels);
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      )}

      {isDesktopTauri && (
        <div className="relative group">
          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-[#333] text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-[100]">
            下载
          </span>
          <button
            ref={downloadBtnRef}
            type="button"
            className={`relative w-7 h-7 rounded-lg border border-black/[0.08] flex items-center justify-center active:scale-95 transition-all cursor-pointer ${
              showDownloadPanel ? "text-[#333] bg-black/[0.04]" : "text-[#999] hover:text-[#333] hover:bg-black/[0.04]"
            }`}
            onClick={() => toggleDownloadPanel()}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {downloadingCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-[#1a1a1a] text-white text-[9px] font-bold flex items-center justify-center leading-none">
                {downloadingCount}
              </span>
            )}
          </button>
          {showDownloadPanel && (
            <DownloadListPopover
              triggerRef={downloadBtnRef}
              onClose={() => setShowDownloadPanel(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default App;
