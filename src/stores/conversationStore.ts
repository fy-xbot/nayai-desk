import { create } from "zustand";
import type {
  Conversation,
  ConversationMessage,
  ConversationImageMeta,
  ProviderId,
} from "../types/provider";
import { generateId } from "../utils/id";

const STORAGE_KEY = "nayaidesk_conversations";
const LEGACY_STORAGE_KEYS = ["nayai_desk_conversations"];
const DEFAULT_PROVIDERS: ProviderId[] = ["gpt", "gemini", "doubao"];

function loadFromStorage(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    for (const key of LEGACY_STORAGE_KEYS) {
      const legacyRaw = localStorage.getItem(key);
      if (!legacyRaw) continue;
      localStorage.setItem(STORAGE_KEY, legacyRaw);
      return JSON.parse(legacyRaw);
    }
    return [];
  } catch {
    return [];
  }
}

function saveToStorage(conversations: Conversation[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  } catch {
    // quota exceeded, silently fail
  }
}

interface ConversationState {
  conversations: Conversation[];
  activeId: string;

  createConversation: (providerIds?: ProviderId[]) => string;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  setActive: (id: string) => void;
  addMessage: (
    text: string,
    targets: ProviderId[],
    images?: ConversationImageMeta[],
  ) => void;
  updateProviders: (providerIds: ProviderId[]) => void;
  setRemoteChatId: (providerId: ProviderId, chatId: string) => void;
  getActive: () => Conversation | undefined;
}

export const useConversationStore = create<ConversationState>((set, get) => {
  const saved = loadFromStorage();
  const initial: Conversation | undefined = saved[0];

  return {
    conversations: saved,
    activeId: initial?.id ?? "",

    createConversation: (providerIds) => {
      const id = generateId();
      const conv: Conversation = {
        id,
        title: "",
        providerIds: providerIds ?? DEFAULT_PROVIDERS,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const next = [conv, ...get().conversations];
      set({ conversations: next, activeId: id });
      saveToStorage(next);
      return id;
    },

    deleteConversation: (id) => {
      const { conversations, activeId } = get();
      const next = conversations.filter((c) => c.id !== id);
      let newActive = activeId;
      if (activeId === id) {
        newActive = next[0]?.id ?? "";
      }
      set({ conversations: next, activeId: newActive });
      saveToStorage(next);
    },

    renameConversation: (id, title) => {
      const next = get().conversations.map((c) =>
        c.id === id ? { ...c, title, updatedAt: Date.now() } : c,
      );
      set({ conversations: next });
      saveToStorage(next);
    },

    setActive: (id) => {
      set({ activeId: id });
    },

    addMessage: (text, targets, images = []) => {
      const { conversations, activeId } = get();
      const msg: ConversationMessage = {
        id: generateId(),
        text,
        images,
        targets,
        createdAt: Date.now(),
      };
      const next = conversations.map((c) => {
        if (c.id !== activeId) return c;
        const fallbackTitle = images.length > 0 ? `[图片] ${text}`.trim() : text;
        const title = c.title || fallbackTitle.slice(0, 30) || "新对话";
        return {
          ...c,
          title,
          messages: [...c.messages, msg],
          updatedAt: Date.now(),
        };
      });
      set({ conversations: next });
      saveToStorage(next);
    },

    updateProviders: (providerIds) => {
      const { conversations, activeId } = get();
      const next = conversations.map((c) =>
        c.id === activeId
          ? { ...c, providerIds, updatedAt: Date.now() }
          : c,
      );
      set({ conversations: next });
      saveToStorage(next);
    },

    setRemoteChatId: (providerId, chatId) => {
      const { conversations, activeId } = get();
      const active = conversations.find((c) => c.id === activeId);
      if (!active) return;
      // 相同则不写，避免无限触发
      if (active.remoteChatIds?.[providerId] === chatId) return;
      const next = conversations.map((c) =>
        c.id === activeId
          ? {
              ...c,
              remoteChatIds: { ...(c.remoteChatIds || {}), [providerId]: chatId },
              updatedAt: Date.now(),
            }
          : c,
      );
      set({ conversations: next });
      saveToStorage(next);
    },

    getActive: () => {
      const { conversations, activeId } = get();
      return conversations.find((c) => c.id === activeId);
    },
  };
});
