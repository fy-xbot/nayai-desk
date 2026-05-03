import { create } from "zustand";
import type { ProviderId, Panel } from "../types/provider";
import { generateId } from "../utils/id";
import {
  createWebview,
  closeWebview,
  repositionAllWebviews,
  closeAllWebviews,
  injectDetectScript,
  supportsNativePanelWebviews,
  setPanelWidths as setWebviewPanelWidths,
} from "../services/webviewManager";
import { getLoginDetectScript } from "../providers/injectionScripts";
import { useConversationStore } from "./conversationStore";
import { useUIStore } from "./uiStore";

type LoginStatus = "unknown" | "ready" | "needs_login";

interface PanelState {
  panels: Panel[];
  panelWidths: number[];
  focusedPanelId: string;
  initialized: boolean;
  loginStatus: Record<string, LoginStatus>;
  /** 当前最大化的 panel id；null = 无最大化，多 panel 正常平铺 */
  maximizedPanelId: string | null;
  setPanelWidths: (widths: number[]) => void;
  addPanel: (providerId: ProviderId) => Promise<void>;
  removePanel: (panelId: string) => Promise<void>;
  reorderPanels: (fromIdx: number, toIdx: number) => Promise<void>;
  setFocusedPanel: (panelId: string) => void;
  setLoginStatus: (panelId: string, status: LoginStatus) => void;
  initPanels: (providerIds: ProviderId[]) => Promise<void>;
  replacePanels: (providerIds: ProviderId[]) => Promise<void>;
  startLoginDetection: () => void;
  toggleMaximize: (panelId: string) => Promise<void>;
}

/** 统一构造 repositionAllWebviews 的 options（外部可直接复用，保证各动作布局一致） */
export function getRepositionOpts() {
  const uiState = useUIStore.getState();
  const { focusedPanelId, maximizedPanelId } = usePanelStore.getState();
  return {
    isMobile: uiState.isMobile,
    focusedPanelId,
    maximizedPanelId,
  };
}

export const usePanelStore = create<PanelState>((set, get) => ({
  panels: [],
  panelWidths: [],
  focusedPanelId: "",
  initialized: false,
  loginStatus: {},
  maximizedPanelId: null,

  setPanelWidths: (widths) => {
    set({ panelWidths: widths });
    setWebviewPanelWidths(widths);
  },

  toggleMaximize: async (panelId) => {
    const { maximizedPanelId, panels } = get();
    // 同一 panel 再次点击 → 退出最大化；其他 panel 点击 → 切换到该 panel 最大化
    const next = maximizedPanelId === panelId ? null : panelId;
    set({ maximizedPanelId: next });
    if (!supportsNativePanelWebviews()) return;
    await repositionAllWebviews(panels, getRepositionOpts());
  },

  initPanels: async (providerIds: ProviderId[]) => {
    if (get().initialized) return;
    // 同一 providerId 同一会话只允许一个 panel
    const uniqueIds = Array.from(new Set(providerIds));
    const panels: Panel[] = uniqueIds.map((pid) => ({
      id: generateId(),
      providerId: pid,
      createdAt: Date.now(),
    }));
    const widths = panels.map(() => 1);
    set({ panels, panelWidths: widths, focusedPanelId: panels[0]?.id ?? "", initialized: true });
    setWebviewPanelWidths(widths);
    if (!supportsNativePanelWebviews()) return;
    for (let i = 0; i < panels.length; i++) {
      await createWebview(panels[i].id, panels[i].providerId, i, panels.length);
    }
  },

  replacePanels: async (providerIds: ProviderId[]) => {
    const { panels: old } = get();
    if (supportsNativePanelWebviews()) await closeAllWebviews(old);

    // 同一 providerId 同一会话只允许一个 panel
    const uniqueIds = Array.from(new Set(providerIds));
    const panels: Panel[] = uniqueIds.map((pid) => ({
      id: generateId(),
      providerId: pid,
      createdAt: Date.now(),
    }));
    const widths = panels.map(() => 1);
    set({ panels, panelWidths: widths, focusedPanelId: panels[0]?.id ?? "", loginStatus: {}, maximizedPanelId: null });
    setWebviewPanelWidths(widths);
    if (!supportsNativePanelWebviews()) return;
    for (let i = 0; i < panels.length; i++) {
      await createWebview(panels[i].id, panels[i].providerId, i, panels.length);
    }
  },

  addPanel: async (providerId) => {
    // 已存在同 providerId 的 panel 则跳过（同一会话只允许一个实例）
    if (get().panels.some((p) => p.providerId === providerId)) return;
    const id = generateId();
    const panel: Panel = { id, providerId, createdAt: Date.now() };
    const newPanels = [...get().panels, panel];
    const newWidths = [...get().panelWidths, 1];
    set({ panels: newPanels, panelWidths: newWidths });
    setWebviewPanelWidths(newWidths);
    useConversationStore.getState().updateProviders(newPanels.map((p) => p.providerId));
    if (!supportsNativePanelWebviews()) return;
    await createWebview(id, providerId, newPanels.length - 1, newPanels.length);
    await repositionAllWebviews(newPanels, getRepositionOpts());
  },

  reorderPanels: async (fromIdx, toIdx) => {
    const { panels, panelWidths } = get();
    if (fromIdx < 0 || fromIdx >= panels.length || toIdx < 0 || toIdx >= panels.length) return;
    const next = [...panels];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    const nextWidths = [...panelWidths];
    const [w] = nextWidths.splice(fromIdx, 1);
    nextWidths.splice(toIdx, 0, w);
    set({ panels: next, panelWidths: nextWidths });
    setWebviewPanelWidths(nextWidths);
    useConversationStore.getState().updateProviders(next.map((p) => p.providerId));
    if (!supportsNativePanelWebviews()) return;
    await repositionAllWebviews(next, getRepositionOpts());
  },

  removePanel: async (panelId) => {
    const { panels, panelWidths, focusedPanelId, loginStatus, maximizedPanelId } = get();
    if (panels.length <= 1) return;
    const idx = panels.findIndex((p) => p.id === panelId);
    const next = panels.filter((p) => p.id !== panelId);
    const nextWidths = idx >= 0 ? panelWidths.filter((_, i) => i !== idx) : panelWidths;
    let newFocused = focusedPanelId;
    if (focusedPanelId === panelId) {
      newFocused = next[0].id;
    }
    const newStatus = { ...loginStatus };
    delete newStatus[panelId];
    // 如果被关闭的正是最大化的 panel，需要同时清除 maximized 状态
    const newMaximized = maximizedPanelId === panelId ? null : maximizedPanelId;
    set({
      panels: next,
      panelWidths: nextWidths,
      focusedPanelId: newFocused,
      loginStatus: newStatus,
      maximizedPanelId: newMaximized,
    });
    setWebviewPanelWidths(nextWidths);
    useConversationStore.getState().updateProviders(next.map((p) => p.providerId));
    if (!supportsNativePanelWebviews()) return;
    await closeWebview(panelId);
    await repositionAllWebviews(next, getRepositionOpts());
  },

  setFocusedPanel: (panelId) => {
    set((s) => {
      // 若当前有最大化面板，切换焦点时自动把最大化转移到新焦点，保持"最大化看哪个 tab"体验
      if (s.maximizedPanelId && s.maximizedPanelId !== panelId) {
        return { focusedPanelId: panelId, maximizedPanelId: panelId };
      }
      return { focusedPanelId: panelId };
    });
  },

  setLoginStatus: (panelId, status) => {
    set((s) => ({
      loginStatus: { ...s.loginStatus, [panelId]: status },
    }));
  },

  startLoginDetection: () => {
    if (!supportsNativePanelWebviews()) return;
    const detect = async () => {
      const { panels } = get();
      for (const panel of panels) {
        const script = getLoginDetectScript(panel.providerId);
        try {
          await injectDetectScript(panel.id, script);
        } catch {
          // webview may not be ready yet
        }
      }
    };
    // 页面起步 4s 后先跑一次；前 30s 每 5s 一次尽快转绿；
    // 之后每 15s 一次持续监听登录状态变化。
    setTimeout(detect, 4000);
    const early = setInterval(detect, 5000);
    setTimeout(() => {
      clearInterval(early);
      setInterval(detect, 15000);
    }, 30000);
  },
}));
