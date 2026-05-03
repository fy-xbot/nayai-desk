import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PromptMode, LayoutMode, ProviderId } from "../types/provider";

interface UIState {
  promptMode: PromptMode;
  inputValue: string;
  showProviderMenu: boolean;
  showSettings: boolean;
  sidebarCollapsed: boolean;
  layout: LayoutMode;
  /** 是否小屏/移动端（用于布局与 webview 定位） */
  isMobile: boolean;
  /** 内嵌网页缩放 0.5–1.5，0.9 即 90% */
  webviewZoom: number;
  /** 是否隐藏模型网页内的顶栏、输入框和辅助提示，仅用底部统一输入 */
  hideWebviewChrome: boolean;
  /** 是否强制打开的模型网页使用浅色模式 */
  forceLightMode: boolean;
  /** true = Shift+Enter 发送，Enter 换行；false = Enter 发送，Shift+Enter 换行 */
  sendWithShiftEnter: boolean;
  /** 默认模型列表：启动和新建对话时默认打开这些模型（至少保留 1 个） */
  defaultProviders: ProviderId[];
  /** 新用户首次引导弹窗是否已看过 */
  hasSeenDefaultModelPrompt: boolean;
  setPromptMode: (mode: PromptMode) => void;
  setInputValue: (value: string) => void;
  setShowProviderMenu: (show: boolean) => void;
  toggleProviderMenu: () => void;
  setShowSettings: (show: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setLayout: (layout: LayoutMode) => void;
  cycleLayout: () => void;
  setMobile: (v: boolean) => void;
  setWebviewZoom: (zoom: number) => void;
  setHideWebviewChrome: (v: boolean) => void;
  setForceLightMode: (v: boolean) => void;
  setSendWithShiftEnter: (v: boolean) => void;
  setDefaultProviders: (ids: ProviderId[]) => void;
  toggleDefaultProvider: (id: ProviderId) => void;
  markDefaultModelPromptSeen: () => void;
}

const LAYOUT_ORDER: LayoutMode[] = ["columns", "rows", "grid"];

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      promptMode: "broadcast",
      inputValue: "",
      showProviderMenu: false,
      showSettings: false,
      sidebarCollapsed: false,
      layout: "columns",
      isMobile: false,
      webviewZoom: 0.9,
      hideWebviewChrome: false,
      forceLightMode: true,
      sendWithShiftEnter: true,
      defaultProviders: ["gpt", "gemini", "doubao"],
      hasSeenDefaultModelPrompt: false,
      setPromptMode: (mode) => set({ promptMode: mode }),
      setInputValue: (value) => set({ inputValue: value }),
      setShowProviderMenu: (show) => set({ showProviderMenu: show }),
      toggleProviderMenu: () =>
        set((s) => ({ showProviderMenu: !s.showProviderMenu })),
      setShowSettings: (show) => set({ showSettings: show }),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setLayout: (layout) => set({ layout }),
      cycleLayout: () =>
        set((s) => {
          const idx = LAYOUT_ORDER.indexOf(s.layout);
          return { layout: LAYOUT_ORDER[(idx + 1) % LAYOUT_ORDER.length] };
        }),
      setMobile: (v) => set({ isMobile: v }),
      setWebviewZoom: (zoom) =>
        set({ webviewZoom: Math.max(0.5, Math.min(1.5, zoom)) }),
      setHideWebviewChrome: (v) => set({ hideWebviewChrome: v }),
      setForceLightMode: (v) => set({ forceLightMode: v }),
      setSendWithShiftEnter: (v) => set({ sendWithShiftEnter: v }),
      setDefaultProviders: (ids) =>
        set({ defaultProviders: ids.length > 0 ? ids : ["gpt"] }),
      toggleDefaultProvider: (id) =>
        set((s) => {
          const has = s.defaultProviders.includes(id);
          // 至少保留一个默认模型
          if (has && s.defaultProviders.length <= 1) return {};
          return {
            defaultProviders: has
              ? s.defaultProviders.filter((x) => x !== id)
              : [...s.defaultProviders, id],
          };
        }),
      markDefaultModelPromptSeen: () =>
        set({ hasSeenDefaultModelPrompt: true }),
    }),
    {
      name: "nayai-ui-preferences",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // 只持久化用户偏好，不持久化会话级运行时状态
      partialize: (state) => ({
        layout: state.layout,
        webviewZoom: state.webviewZoom,
        hideWebviewChrome: state.hideWebviewChrome,
        forceLightMode: state.forceLightMode,
        sendWithShiftEnter: state.sendWithShiftEnter,
        defaultProviders: state.defaultProviders,
        hasSeenDefaultModelPrompt: state.hasSeenDefaultModelPrompt,
      }),
    },
  ),
);
