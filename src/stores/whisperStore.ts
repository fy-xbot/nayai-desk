import { create } from "zustand";
import {
  cancelVoiceRecording,
  downloadWhisperModel,
  getWhisperModelStatus,
  listenWhisperProgress,
  startVoiceRecording,
  stopVoiceRecording,
  transcribeWhisper,
  type WhisperProgressPayload,
} from "../services/whisperService";
import { isTauriDesktop } from "../services/webviewManager";

export type WhisperPhase = "idle" | "checking" | "downloading" | "ready" | "recording" | "transcribing" | "error";

interface WhisperState {
  phase: WhisperPhase;
  modelReady: boolean;
  modelPath: string;
  progress: number;
  downloaded: number;
  total: number;
  error: string | null;
  lastText: string;
  initialized: boolean;
  initAutoDownload: () => Promise<void>;
  toggleRecording: () => Promise<string | null>;
  cancelRecording: () => Promise<void>;
}

let progressUnlisten: (() => void) | null = null;

function progressRatio(payload: WhisperProgressPayload) {
  if (!payload.total) return 0;
  return Math.max(0, Math.min(1, payload.downloaded / payload.total));
}

export const useWhisperStore = create<WhisperState>((set, get) => ({
  phase: "idle",
  modelReady: false,
  modelPath: "",
  progress: 0,
  downloaded: 0,
  total: 0,
  error: null,
  lastText: "",
  initialized: false,

  initAutoDownload: async () => {
    if (!isTauriDesktop()) return;
    const current = get();
    if (current.phase === "downloading" || current.phase === "checking") return;
    if (current.initialized && current.phase !== "error") return;
    set({ phase: "checking", error: null, initialized: true });

    try {
      if (!progressUnlisten) {
        progressUnlisten = await listenWhisperProgress((payload) => {
          if (payload.phase === "download") {
            set({
              phase: "downloading",
              progress: progressRatio(payload),
              downloaded: payload.downloaded,
              total: payload.total,
              error: null,
            });
          } else if (payload.phase === "ready") {
            set({
              phase: "ready",
              modelReady: true,
              progress: 1,
              downloaded: payload.downloaded,
              total: payload.total,
              error: null,
            });
          } else if (payload.phase === "error") {
            set({ phase: "error", error: payload.message || "模型下载失败" });
          }
        });
      }

      const status = await getWhisperModelStatus();
      if (status.exists) {
        set({
          phase: "ready",
          modelReady: true,
          modelPath: status.path,
          progress: 1,
          downloaded: status.size,
          total: status.size,
          error: null,
        });
        return;
      }

      set({ phase: "downloading", modelReady: false, progress: 0, downloaded: 0, total: 0 });
      await downloadWhisperModel();
      const next = await getWhisperModelStatus();
      set({
        phase: next.exists ? "ready" : "error",
        modelReady: next.exists,
        modelPath: next.path,
        progress: next.exists ? 1 : get().progress,
        downloaded: next.size,
        total: next.size || get().total,
        error: next.exists ? null : "模型下载后未找到有效文件",
      });
    } catch (err) {
      set({
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  toggleRecording: async () => {
    if (!isTauriDesktop()) return null;
    const state = get();

    if (!state.modelReady) {
      await get().initAutoDownload();
      if (!get().modelReady) return null;
    }

    if (state.phase === "recording") {
      set({ phase: "transcribing", error: null });
      try {
        const audio = await stopVoiceRecording();
        const text = await transcribeWhisper(audio, "zh");
        set({ phase: "ready", lastText: text, error: null });
        return text;
      } catch (err) {
        set({ phase: "error", error: err instanceof Error ? err.message : String(err) });
        return null;
      }
    }

    if (state.phase === "transcribing" || state.phase === "downloading" || state.phase === "checking") {
      return null;
    }

    try {
      await startVoiceRecording();
      set({ phase: "recording", error: null, lastText: "" });
      return null;
    } catch (err) {
      set({ phase: "error", error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  cancelRecording: async () => {
    await cancelVoiceRecording();
    set((s) => ({ phase: s.modelReady ? "ready" : "idle" }));
  },
}));
