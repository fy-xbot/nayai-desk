import { useEffect, useRef } from "react";
import { useDownloadStore, type DownloadRecord } from "../../stores/downloadStore";
import { isTauriDesktop } from "../../services/webviewManager";

function formatTime(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  const sameDay =
    now.getFullYear() === d.getFullYear() &&
    now.getMonth() === d.getMonth() &&
    now.getDate() === d.getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  if (sameDay) return `今天 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const diffDay = Math.floor(diffSec / 86400);
  if (diffDay < 7) return `${diffDay} 天前`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function revealInFinder(path: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("reveal_in_finder", { path });
  } catch (e) {
    console.error("[download] reveal failed:", e);
  }
}

async function checkFileExists(path: string): Promise<boolean> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const size = await invoke<number | null>("get_file_size", { path });
    return typeof size === "number";
  } catch {
    return false;
  }
}

export function DownloadListPopover({
  onClose,
  triggerRef,
}: {
  onClose: () => void;
  /** 触发按钮的 ref：click-outside 判断时要把它视作"内部"，避免"按钮再次点击 → mousedown 先触发 onClose，随后 onClick 又把 popover 打开"的竞态 */
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  const records = useDownloadStore((s) => s.records);
  const remove = useDownloadStore((s) => s.remove);
  const clearAll = useDownloadStore((s) => s.clearAll);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (ref.current && ref.current.contains(target)) return;
      if (triggerRef?.current && triggerRef.current.contains(target)) return;
      onClose();
    }
    // 下一帧再挂，避免按钮本次点击立即触发关闭
    const t = setTimeout(() => document.addEventListener("mousedown", onClickOutside), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [onClose, triggerRef]);

  async function handleReveal(rec: DownloadRecord) {
    if (!isTauriDesktop()) return;
    const exists = await checkFileExists(rec.path);
    if (!exists) {
      // 文件被手动删除了
      alert("文件已被移动或删除");
      return;
    }
    await revealInFinder(rec.path);
  }

  return (
    <div
      ref={ref}
      className="absolute bottom-full right-0 mb-2 w-[340px] max-h-[460px] bg-white/95 backdrop-blur-md rounded-xl border border-black/[0.06] shadow-[0_8px_30px_rgba(0,0,0,0.15)] z-[200] flex flex-col overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-black/[0.04]">
        <h3 className="text-[12px] font-semibold text-[#222]">下载</h3>
        {records.length > 0 && (
          <button
            className="text-[10px] text-[#999] hover:text-[#ef4444] active:scale-95 transition-all cursor-pointer px-2 py-0.5 rounded hover:bg-red-50"
            onClick={clearAll}
            title="清空下载记录"
          >
            清空
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[#bbb]">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <p className="text-[11px] mt-2">暂无下载记录</p>
          </div>
        ) : (
          <ul className="py-1">
            {records.map((rec) => (
              <li
                key={rec.id}
                className="group flex items-start gap-2.5 px-3 py-2 hover:bg-black/[0.03] transition-colors"
              >
                <div className="shrink-0 mt-0.5">
                  {rec.status === "downloading" ? (
                    <div className="w-4 h-4 rounded-full border-2 border-[#1a1a1a]/20 border-t-[#1a1a1a] animate-spin" />
                  ) : rec.status === "done" ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className="text-[11px] font-medium text-[#1a1a1a] truncate"
                    title={rec.filename}
                  >
                    {rec.filename || "(未命名)"}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-[#aaa]">
                      {rec.status === "downloading"
                        ? "下载中…"
                        : rec.status === "failed"
                          ? "下载失败"
                          : formatTime(rec.finishedAt ?? rec.startedAt)}
                    </span>
                    {rec.status === "done" && isTauriDesktop() && (
                      <button
                        className="text-[10px] text-[#555] hover:text-[#1a1a1a] underline decoration-dotted underline-offset-2 cursor-pointer"
                        onClick={() => handleReveal(rec)}
                        title="在访达中打开"
                      >
                        打开目录
                      </button>
                    )}
                  </div>
                </div>
                <button
                  className="shrink-0 w-5 h-5 flex items-center justify-center text-[#ccc] opacity-0 group-hover:opacity-100 hover:text-[#666] rounded transition-all cursor-pointer"
                  onClick={() => remove(rec.id)}
                  title="从列表移除"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
