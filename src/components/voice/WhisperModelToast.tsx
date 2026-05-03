import { useEffect, useRef, useState } from "react";
import { useWhisperStore } from "../../stores/whisperStore";

const DISMISS_MS = 5000;

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function WhisperModelToast() {
  const phase = useWhisperStore((s) => s.phase);
  const progress = useWhisperStore((s) => s.progress);
  const downloaded = useWhisperStore((s) => s.downloaded);
  const total = useWhisperStore((s) => s.total);
  const error = useWhisperStore((s) => s.error);
  const initAutoDownload = useWhisperStore((s) => s.initAutoDownload);
  const [dismissed, setDismissed] = useState(false);
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const lastPhaseRef = useRef(phase);

  useEffect(() => {
    if (phase === "ready" && lastPhaseRef.current !== "ready") {
      setReadyAt(Date.now());
    }
    if (phase === "downloading" || phase === "error") {
      setDismissed(false);
      setReadyAt(null);
    }
    lastPhaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!readyAt) return;
    const timer = setTimeout(() => setDismissed(true), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [readyAt]);

  if (dismissed) return null;
  if (phase !== "downloading" && phase !== "checking" && phase !== "ready" && phase !== "error") return null;
  if (phase === "ready" && !readyAt) return null;

  const percent = Math.round(progress * 100);
  const statusText = phase === "downloading"
    ? `正在下载离线语音模型 ${percent}%`
    : phase === "checking"
      ? "正在检查离线语音模型..."
      : phase === "ready"
        ? "离线语音模型已就绪"
        : error || "离线语音模型下载失败";

  return (
    <div className="fixed bottom-4 right-4 z-[9998] pointer-events-none">
      <div className="pointer-events-auto w-[300px] px-3.5 py-3 bg-white/95 backdrop-blur-md rounded-xl border border-black/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.12)] animate-slide-up">
        <div className="flex items-start gap-3">
          <div className="shrink-0 pt-0.5">
            {(phase === "downloading" || phase === "checking") && (
              <div className="w-5 h-5 rounded-full border-2 border-[#1a1a1a]/20 border-t-[#1a1a1a] animate-spin" />
            )}
            {phase === "ready" && (
              <div className="w-5 h-5 rounded-full bg-[#22c55e] flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
            )}
            {phase === "error" && (
              <div className="w-5 h-5 rounded-full bg-[#ef4444] flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-[#1a1a1a] leading-tight">离线语音输入</p>
            <p className="text-[10px] text-[#999] mt-0.5 leading-tight">{statusText}</p>
            {phase === "downloading" && (
              <>
                <div className="mt-2 h-1.5 rounded-full bg-black/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#1a1a1a] transition-all"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <p className="text-[9px] text-[#aaa] mt-1">
                  {formatBytes(downloaded)} / {formatBytes(total)}
                </p>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {phase === "error" && (
              <button
                className="text-[10px] text-[#555] hover:text-[#1a1a1a] px-2 py-1 rounded-md hover:bg-black/[0.05] transition-colors cursor-pointer whitespace-nowrap"
                onClick={() => { void initAutoDownload(); }}
              >
                重试
              </button>
            )}
            <button
              className="w-5 h-5 flex items-center justify-center text-[#bbb] hover:text-[#666] rounded-md hover:bg-black/[0.05] transition-colors cursor-pointer"
              onClick={() => setDismissed(true)}
              title="关闭"
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
