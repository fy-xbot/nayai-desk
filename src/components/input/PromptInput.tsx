import { useRef, useEffect, useState, useCallback, type ReactNode } from "react";
import { ProviderIcon } from "../common/ProviderIcon";
import { usePanelStore, getRepositionOpts } from "../../stores/panelStore";
import { useUIStore } from "../../stores/uiStore";
import {
  broadcastPromptPayload,
  injectPromptPayload,
  setInputBarHeight,
  repositionAllWebviews,
  schedulePollBurst,
  isTauriDesktop,
  isTauriMobile,
} from "../../services/webviewManager";
import { useConversationStore } from "../../stores/conversationStore";
import { useWhisperStore } from "../../stores/whisperStore";
import { useScoreStore } from "../../stores/scoreStore";
import { runScoring, clearAllScoreOverlays } from "../../services/scoringService";
import { useAutoResize } from "../../hooks/useAutoResize";
import { getProvider } from "../../providers/registry";
import type { PromptImagePayload, ProviderId } from "../../types/provider";
import { generateId } from "../../utils/id";

const MAX_PASTED_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function getImageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function readClipboardImages(
  data: DataTransfer,
  remaining: number,
): Promise<PromptImagePayload[]> {
  const files = Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file)
    .slice(0, remaining);

  const result: PromptImagePayload[] = [];
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) continue;
    const dataUrl = await fileToDataUrl(file);
    const { width, height } = await getImageSize(dataUrl);
    result.push({
      id: generateId(),
      name: file.name || `pasted-image-${result.length + 1}.png`,
      mimeType: file.type || "image/png",
      size: file.size,
      width,
      height,
      dataUrl,
    });
  }
  return result;
}

interface PromptInputProps {
  floatingActions?: ReactNode;
}

export function PromptInput({ floatingActions }: PromptInputProps) {
  const panels = usePanelStore((s) => s.panels);
  const focusedPanelId = usePanelStore((s) => s.focusedPanelId);
  const inputValue = useUIStore((s) => s.inputValue);
  const setInputValue = useUIStore((s) => s.setInputValue);
  const promptMode = useUIStore((s) => s.promptMode);
  const setPromptMode = useUIStore((s) => s.setPromptMode);
  const sendWithShiftEnter = useUIStore((s) => s.sendWithShiftEnter);
  const addMessage = useConversationStore((s) => s.addMessage);
  const whisperPhase = useWhisperStore((s) => s.phase);
  const whisperModelReady = useWhisperStore((s) => s.modelReady);
  const whisperProgress = useWhisperStore((s) => s.progress);
  const toggleVoiceRecording = useWhisperStore((s) => s.toggleRecording);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [images, setImages] = useState<PromptImagePayload[]>([]);
  const { resize, reset } = useAutoResize(textareaRef);
  const isMobileBrowserMode = isTauriMobile();

  useEffect(() => {
    if (!isTauriDesktop() || !containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      setInputBarHeight(h);
      repositionAllWebviews(usePanelStore.getState().panels, getRepositionOpts());
    });
    ro.observe(el);
    setInputBarHeight(el.getBoundingClientRect().height);
    repositionAllWebviews(usePanelStore.getState().panels, getRepositionOpts());
    return () => ro.disconnect();
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInputValue(e.target.value);
    resize();
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const data = e.clipboardData;
    const hasImage = Array.from(data.items).some(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
    if (!hasImage) return;

    e.preventDefault();
    const remaining = Math.max(MAX_PASTED_IMAGES - images.length, 0);
    if (!remaining) return;

    const nextImages = await readClipboardImages(data, remaining);
    if (!nextImages.length) return;
    setImages((current) => [...current, ...nextImages].slice(0, MAX_PASTED_IMAGES));
  }

  async function handleSend() {
    if (isMobileBrowserMode) return;

    const text = inputValue.trim();
    const nextImages = images;
    if (!text && nextImages.length === 0) return;

    const targets = promptMode === "broadcast"
      ? panels.map((p) => p.providerId)
      : panels.find((p) => p.id === focusedPanelId)
        ? [panels.find((p) => p.id === focusedPanelId)!.providerId]
        : [];
    if (!targets.length) return;

    const imageMeta = nextImages.map(({ id, name, mimeType, size, width, height }) => ({
      id,
      name,
      mimeType,
      size,
      width,
      height,
    }));

    setInputValue("");
    setImages([]);
    reset();

    const conv = useConversationStore.getState().getActive();
    const isFirstMessage = conv ? conv.messages.length === 0 : false;

    if (promptMode === "broadcast") {
      addMessage(text, targets, imageMeta);
      const allIds = panels.map((p) => p.id);
      await broadcastPromptPayload(allIds, text, nextImages);
    } else {
      const focused = panels.find((p) => p.id === focusedPanelId);
      if (focused) addMessage(text, [focused.providerId], imageMeta);
      await injectPromptPayload(focusedPanelId, text, nextImages);
    }

    // 首次发送后，模型侧通常会很快从 home 跳到 /chat/<id>，
    // 触发几次短间隔 URL 采集以尽快回填 remoteChatIds。
    if (isFirstMessage) {
      schedulePollBurst();
    }

    // 发新消息时清除旧评分
    if (scoringStatus !== "idle") {
      void clearAllScoreOverlays(panels);
    }
  }

  async function handleVoiceToggle() {
    if (!isTauriDesktop() || isMobileBrowserMode) return;
    const text = await toggleVoiceRecording();
    if (!text) return;
    const next = inputValue.trim()
      ? `${inputValue.trimEnd()}\n${text}`
      : text;
    setInputValue(next);
    setTimeout(resize, 0);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // 中文/日韩输入法 composition 中的 Enter 仅是确认候选词，不应触发发送
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    const shouldSend = sendWithShiftEnter ? (e.key === "Enter" && e.shiftKey) : (e.key === "Enter" && !e.shiftKey);
    if (shouldSend) {
      e.preventDefault();
      void handleSend();
    }
  }

  const scoringStatus = useScoreStore((s) => s.currentRound?.status ?? "idle");
  const hasApiKey = useScoreStore((s) => !!s.judgeConfig.apiKey);
  const activeConv = useConversationStore((s) => s.getActive());
  const hasMessages = !!activeConv && activeConv.messages.length > 0;
  const [scoringInProgress, setScoringInProgress] = useState(false);
  const [scoreTip, setScoreTip] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const showTip = useCallback((msg: string) => {
    setScoreTip(msg);
    setTimeout(() => setScoreTip(null), 4000);
  }, []);

  const handleScore = useCallback(async () => {
    if (scoringInProgress || panels.length < 2) return;
    if (!hasMessages) {
      showTip("请先发送问题，等模型回答后再评分");
      return;
    }
    if (!hasApiKey) {
      showTip("请先在设置 → AI 评分中配置 API Key");
      useUIStore.getState().setShowSettings(true);
      return;
    }
    setScoringInProgress(true);
    abortRef.current = new AbortController();
    try {
      await runScoring(panels, abortRef.current.signal);
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") {
        console.error("[scoring]", e.message);
      }
    } finally {
      setScoringInProgress(false);
      abortRef.current = null;
    }
  }, [panels, scoringInProgress, hasApiKey, hasMessages, showTip]);

  const isBroadcast = promptMode === "broadcast";
  const sendDisabled = isMobileBrowserMode || (!inputValue.trim() && images.length === 0);
  const scoreDisabled = isMobileBrowserMode || panels.length < 2 || scoringInProgress || !hasMessages;
  const isRecording = whisperPhase === "recording";
  const isTranscribing = whisperPhase === "transcribing";
  const isWhisperDownloading = whisperPhase === "downloading" || whisperPhase === "checking";
  const voiceDisabled = !isTauriDesktop() || isMobileBrowserMode || isTranscribing || isWhisperDownloading;
  const voiceTitle = isRecording
    ? "停止录音并转文字"
    : isTranscribing
      ? "正在识别..."
      : isWhisperDownloading
        ? `语音模型下载中 ${Math.round(whisperProgress * 100)}%`
        : whisperModelReady
          ? "语音输入"
          : "准备语音模型";

  return (
    <div
      ref={containerRef}
      className="px-4 pb-3 pt-2 bg-[#f7f7f6] relative z-10 border-t border-black/[0.04] shrink-0"
    >
      <div className="max-w-[860px] mx-auto bg-white rounded-2xl border border-black/[0.08] shadow-[0_1px_8px_rgba(0,0,0,0.04)] focus-within:border-black/[0.14] focus-within:shadow-[0_2px_16px_rgba(0,0,0,0.07)] transition-all">
        {images.length > 0 && (
          <div className="px-3 pt-3 pb-1 flex flex-wrap gap-2">
            {images.map((image) => (
              <div
                key={image.id}
                className="relative w-16 h-16 rounded-xl overflow-hidden border border-black/[0.08] bg-[#f5f5f4] shrink-0"
              >
                <img
                  src={image.dataUrl}
                  alt={image.name}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center cursor-pointer"
                  onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}
                  title="移除图片"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="w-full bg-transparent outline-none text-[13px] text-[#1a1a1a] placeholder:text-[#c0c0c0] resize-none px-4 pt-3 pb-1 leading-relaxed"
          placeholder={
            isMobileBrowserMode
              ? "iOS 端暂时通过应用内浏览器使用各模型，统一发送功能稍后补齐..."
              : isBroadcast
              ? "输入问题，同时发送至所有模型..."
              : "发送至选中的模型..."
          }
          rows={1}
          value={inputValue}
          onChange={handleChange}
          onPaste={(e) => { void handlePaste(e); }}
          onKeyDown={handleKeyDown}
        />
        <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#f5f5f4] rounded-lg p-0.5">
              <button
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
                  isBroadcast
                    ? "bg-white text-[#1a1a1a] shadow-[0_0.5px_2px_rgba(0,0,0,0.08)]"
                    : "text-[#999] hover:text-[#666]"
                }`}
                onClick={() => setPromptMode("broadcast")}
              >
                广播
              </button>
              <button
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
                  !isBroadcast
                    ? "bg-white text-[#1a1a1a] shadow-[0_0.5px_2px_rgba(0,0,0,0.08)]"
                    : "text-[#999] hover:text-[#666]"
                }`}
                onClick={() => setPromptMode("single")}
              >
                单发
              </button>
            </div>

            <div className="flex items-center gap-1">
              {panels.map((panel) => {
                const p = getProvider(panel.providerId);
                const isActive = isBroadcast || panel.id === focusedPanelId;
                return (
                  <button
                    key={panel.id}
                    className={`inline-flex items-center gap-1 px-2 py-[3px] rounded-md text-[10px] transition-all ${
                      isActive
                        ? "text-[#555] opacity-100"
                        : "text-[#bbb] opacity-40 hover:opacity-70"
                    } ${!isBroadcast ? "cursor-pointer" : ""}`}
                    style={{ backgroundColor: isActive ? p.color + "12" : p.color + "06" }}
                    onClick={() => {
                      if (!isBroadcast) {
                        usePanelStore.getState().setFocusedPanel(panel.id);
                      }
                    }}
                    title={isBroadcast ? p.label : `切换到 ${p.label}`}
                  >
                    <span className={isActive ? "" : "grayscale"}>
                      <ProviderIcon providerId={panel.providerId as ProviderId} size={12} />
                    </span>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {panels.length >= 2 && (
              <div className="relative">
                {scoreTip && (
                  <div className="absolute bottom-full right-0 mb-2 whitespace-nowrap px-3 py-1.5 rounded-lg bg-[#1a1a1a] text-white text-[10px] shadow-lg animate-slide-up pointer-events-none">
                    {scoreTip}
                    <div className="absolute top-full right-4 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-[#1a1a1a]" />
                  </div>
                )}
                <button
                  className={`h-8 px-2.5 rounded-[10px] flex items-center gap-1.5 text-[11px] font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0 cursor-pointer ${
                    scoringInProgress
                      ? "bg-amber-50 text-amber-600 border border-amber-200"
                      : "bg-[#f5f5f4] text-[#777] hover:bg-[#ecebea] hover:text-[#333]"
                  }`}
                  disabled={scoreDisabled}
                  onClick={() => { void handleScore(); }}
                  title={!hasApiKey ? "请先在设置中配置裁判模型 API Key" : scoringInProgress ? "评分中..." : "AI 评分：提取各模型回答并打分"}
                >
                  {scoringInProgress ? (
                    <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  )}
                  {scoringInProgress ? "评分中" : "AI 评分"}
                </button>
              </div>
            )}

            <button
              className={`relative w-8 h-8 rounded-[10px] flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0 cursor-pointer ${
                isRecording
                  ? "bg-red-500 text-white shadow-[0_0_0_4px_rgba(239,68,68,0.12)]"
                  : "bg-[#f5f5f4] text-[#777] hover:bg-[#ecebea] hover:text-[#333]"
              }`}
              disabled={voiceDisabled}
              onClick={() => { void handleVoiceToggle(); }}
              title={voiceTitle}
            >
              {isRecording && (
                <span className="absolute inset-0 rounded-[10px] animate-ping bg-red-400/30" />
              )}
              {isTranscribing ? (
                <svg className="animate-spin relative z-10" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <svg className="relative z-10" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <path d="M12 19v3" />
                </svg>
              )}
            </button>

            <button
              className="w-8 h-8 rounded-[10px] bg-[#1a1a1a] text-white flex items-center justify-center hover:bg-[#333] transition-colors disabled:opacity-15 disabled:cursor-not-allowed shrink-0 cursor-pointer"
              disabled={sendDisabled}
              onClick={() => { void handleSend(); }}
              title={isMobileBrowserMode ? "移动端统一发送功能开发中" : "发送"}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="flex items-center mt-1.5">
        {floatingActions && (
          <div className="shrink-0">{floatingActions}</div>
        )}
        <p className="flex-1 text-center text-[10px] text-[#c0c0c0]">
          {isMobileBrowserMode
            ? "当前为 iOS 适配模式：网页通过应用内浏览器打开，统一发送与脚本注入暂未启用"
            : <>{sendWithShiftEnter ? "Shift+Enter 发送 · Enter 换行" : "Enter 发送 · Shift+Enter 换行"} · 支持粘贴图片 ·{" "}
          {isBroadcast
            ? "广播模式：同时发送至所有模型"
            : "单发模式：仅发送至选中模型"}</>}
        </p>
        {floatingActions && <div className="shrink-0 w-[66px]" />}
      </div>
    </div>
  );
}
