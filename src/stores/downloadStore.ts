import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { generateId } from "../utils/id";

export type DownloadStatus = "downloading" | "done" | "failed";

export interface DownloadRecord {
  id: string;
  filename: string;
  path: string;
  startedAt: number;
  finishedAt?: number;
  status: DownloadStatus;
}

interface DownloadState {
  records: DownloadRecord[];
  /** 下载列表 popover 是否展开 */
  showPanel: boolean;
  add: (data: { filename: string; path: string; status?: DownloadStatus }) => DownloadRecord;
  update: (id: string, patch: Partial<Omit<DownloadRecord, "id">>) => void;
  findByPath: (path: string) => DownloadRecord | undefined;
  remove: (id: string) => void;
  clearAll: () => void;
  setShowPanel: (show: boolean) => void;
  togglePanel: () => void;
}

/** 持久化上限，避免 localStorage 膨胀 */
const MAX_RECORDS = 50;

export const useDownloadStore = create<DownloadState>()(
  persist(
    (set, get) => ({
      records: [],
      showPanel: false,
      add: (data) => {
        const rec: DownloadRecord = {
          id: generateId(),
          filename: data.filename,
          path: data.path,
          startedAt: Date.now(),
          status: data.status ?? "downloading",
        };
        set((s) => ({ records: [rec, ...s.records].slice(0, MAX_RECORDS) }));
        return rec;
      },
      update: (id, patch) =>
        set((s) => ({
          records: s.records.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),
      findByPath: (path) => get().records.find((r) => r.path === path),
      remove: (id) =>
        set((s) => ({ records: s.records.filter((r) => r.id !== id) })),
      clearAll: () => set({ records: [] }),
      setShowPanel: (show) => set({ showPanel: show }),
      togglePanel: () => set((s) => ({ showPanel: !s.showPanel })),
    }),
    {
      name: "nayai-downloads",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // 只持久化记录本身，不持久化 UI 状态
      partialize: (state) => ({ records: state.records }),
    },
  ),
);
