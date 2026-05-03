import { useEffect, useRef, useState, useCallback } from "react";
import { isTauriDesktop } from "../../services/webviewManager";
import { useDownloadStore } from "../../stores/downloadStore";

/** 完成后 toast 自动消失时间 */
const TOAST_AUTO_DISMISS_MS = 5000;
/** 文件大小稳定阈值，兜底 Finished 事件丢失 */
const STABLE_MS = 2000;
/** 文件大小采样间隔 */
const POLL_MS = 1000;

export function DownloadToast() {
  const records = useDownloadStore((s) => s.records);
  const addRecord = useDownloadStore((s) => s.add);
  const updateRecord = useDownloadStore((s) => s.update);
  const findByPath = useDownloadStore((s) => s.findByPath);

  // 已被用户手动关闭的 toast id（仅内存、不持久化）
  const dismissedIdsRef = useRef(new Set<string>());
  const [, forceTick] = useState(0);

  // 文件大小稳定性探测的内存状态：recordId -> { size, stableSince }
  const probesRef = useRef(new Map<string, { size: number; stableSince: number }>());

  const dismissToast = useCallback((id: string) => {
    dismissedIdsRef.current.add(id);
    forceTick((v) => v + 1);
  }, []);

  // 监听 Tauri 下载事件 → 写入 store
  useEffect(() => {
    if (!isTauriDesktop()) return;

    let unlistenStarted: (() => void) | undefined;
    let unlistenFinished: (() => void) | undefined;

    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ filename: string; path: string }>("download-started", (e) => {
        const existing = findByPath(e.payload.path);
        if (existing && existing.status === "downloading") return;
        addRecord({
          filename: e.payload.filename,
          path: e.payload.path,
          status: "downloading",
        });
      }).then((fn) => {
        unlistenStarted = fn;
      });

      listen<{ filename: string; path: string; success: boolean }>(
        "download-finished",
        (e) => {
          const { filename, path, success } = e.payload;
          const existing = findByPath(path);
          if (existing) {
            updateRecord(existing.id, {
              status: success ? "done" : "failed",
              finishedAt: Date.now(),
            });
          } else {
            addRecord({
              filename,
              path,
              status: success ? "done" : "failed",
            });
          }
        },
      ).then((fn) => {
        unlistenFinished = fn;
      });
    });

    return () => {
      unlistenStarted?.();
      unlistenFinished?.();
    };
  }, [addRecord, updateRecord, findByPath]);

  // 每 1 秒触发一次重渲，处理 toast 的 5s 自动淡出
  useEffect(() => {
    const timer = setInterval(() => forceTick((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  // 文件大小稳定性探测（兜底 Finished 事件丢失）
  useEffect(() => {
    if (!isTauriDesktop()) return;
    const hasDownloading = records.some((r) => r.status === "downloading");
    if (!hasDownloading) return;

    let stopped = false;
    const timer = setInterval(async () => {
      if (stopped) return;
      const { invoke } = await import("@tauri-apps/api/core");
      const downloading = records.filter((r) => r.status === "downloading");
      for (const r of downloading) {
        let size: number | null = null;
        try {
          size = await invoke<number | null>("get_file_size", { path: r.path });
        } catch {
          continue;
        }
        if (stopped) return;
        if (typeof size !== "number" || size <= 0) continue;
        const now = Date.now();
        const probe = probesRef.current.get(r.id);
        if (!probe || probe.size !== size) {
          probesRef.current.set(r.id, { size, stableSince: now });
          continue;
        }
        if (now - probe.stableSince >= STABLE_MS) {
          updateRecord(r.id, { status: "done", finishedAt: now });
          probesRef.current.delete(r.id);
        }
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [records, updateRecord]);

  // Toast 只显示：未被关闭 && (下载中 || 最近 5 秒内完成)
  const now = Date.now();
  const visible = records.filter((r) => {
    if (dismissedIdsRef.current.has(r.id)) return false;
    if (r.status === "downloading") return true;
    if (r.finishedAt && now - r.finishedAt < TOAST_AUTO_DISMISS_MS) return true;
    return false;
  });

  async function handleReveal(path: string) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("reveal_in_finder", { path });
    } catch (e) {
      console.error(e);
    }
  }

  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {visible.map((item) => (
        <div
          key={item.id}
          className="pointer-events-auto flex items-center gap-3 px-3.5 py-2.5 bg-white/95 backdrop-blur-md rounded-xl border border-black/[0.08] shadow-[0_4px_24px_rgba(0,0,0,0.12)] min-w-[240px] max-w-[320px] animate-slide-up"
        >
          <div className="shrink-0">
            {item.status === "downloading" && (
              <div className="w-5 h-5 rounded-full border-2 border-[#1a1a1a]/20 border-t-[#1a1a1a] animate-spin" />
            )}
            {item.status === "done" && (
              <div className="w-5 h-5 rounded-full bg-[#22c55e] flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              </div>
            )}
            {item.status === "failed" && (
              <div className="w-5 h-5 rounded-full bg-[#ef4444] flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-[#1a1a1a] truncate leading-tight">
              {item.filename}
            </p>
            <p className="text-[10px] text-[#999] mt-0.5 leading-tight">
              {item.status === "downloading" && "正在下载..."}
              {item.status === "done" && "已保存到下载文件夹"}
              {item.status === "failed" && "下载失败"}
            </p>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {item.status === "done" && (
              <button
                className="text-[10px] text-[#555] hover:text-[#1a1a1a] px-2 py-1 rounded-md hover:bg-black/[0.05] transition-colors cursor-pointer whitespace-nowrap"
                onClick={() => handleReveal(item.path)}
                title="在访达中显示"
              >
                显示
              </button>
            )}
            <button
              className="w-5 h-5 flex items-center justify-center text-[#bbb] hover:text-[#666] rounded-md hover:bg-black/[0.05] transition-colors cursor-pointer"
              onClick={() => dismissToast(item.id)}
              title="关闭"
            >
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
