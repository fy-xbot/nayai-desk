import { useState } from "react";
import { ProviderIcon } from "../common/ProviderIcon";
import { useUIStore } from "../../stores/uiStore";
import { usePanelStore } from "../../stores/panelStore";
import { useScoreStore } from "../../stores/scoreStore";
import { getAllProviders } from "../../providers/registry";
import {
  isTauri,
  applyHideChromeToAllWebviews,
  applyForceLightToAllWebviews,
  refreshAllWebviews,
} from "../../services/webviewManager";
import type { LayoutMode, JudgeConfig } from "../../types/provider";

const layouts: { id: LayoutMode; label: string; icon: string }[] = [
  { id: "columns", label: "竖排", icon: "M3 3h7v18H3zM14 3h7v18h-7z" },
  { id: "rows", label: "横排", icon: "M3 3h18v7H3zM3 14h18v7H3z" },
  { id: "grid", label: "网格", icon: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z" },
];

export function SettingsPanel() {
  const showSettings = useUIStore((s) => s.showSettings);
  const setShowSettings = useUIStore((s) => s.setShowSettings);
  const layout = useUIStore((s) => s.layout);
  const setLayout = useUIStore((s) => s.setLayout);
  const hideWebviewChrome = useUIStore((s) => s.hideWebviewChrome);
  const setHideWebviewChrome = useUIStore((s) => s.setHideWebviewChrome);
  const forceLightMode = useUIStore((s) => s.forceLightMode);
  const setForceLightMode = useUIStore((s) => s.setForceLightMode);
  const sendWithShiftEnter = useUIStore((s) => s.sendWithShiftEnter);
  const setSendWithShiftEnter = useUIStore((s) => s.setSendWithShiftEnter);
  const defaultProviders = useUIStore((s) => s.defaultProviders);
  const toggleDefaultProvider = useUIStore((s) => s.toggleDefaultProvider);
  const isMobile = useUIStore((s) => s.isMobile);
  const panels = usePanelStore((s) => s.panels);

  const providers = getAllProviders();

  async function clearProviderData(providerId: string) {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("clear_provider_data", { providerId });
      alert(`已清除 ${providerId} 的登录数据，重启后生效`);
    } catch {
      alert("该功能需要重启应用后手动清除数据目录");
    }
  }

  const panelWidthClass = isMobile ? "w-full" : "w-[340px]";

  return (
    <div className={`fixed inset-0 z-[100] transition-all duration-300 ${showSettings ? "visible" : "invisible pointer-events-none"}`}>
      <div 
        className={`absolute inset-0 bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${showSettings ? "opacity-100" : "opacity-0"}`} 
        onClick={() => setShowSettings(false)} 
        aria-hidden 
      />
      <div className={`absolute right-0 top-0 bottom-0 ${panelWidthClass} bg-[#f7f7f6] border-l border-black/[0.08] shadow-2xl flex flex-col overflow-y-auto transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${showSettings ? "translate-x-0" : "translate-x-full"}`}>
        {/* Header */}
        <div className="flex items-center justify-between h-14 px-5 border-b border-black/[0.06] shrink-0">
          <h2 className="text-sm font-semibold text-[#333]">设置</h2>
          <button
            className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center text-[#999] hover:text-[#555] hover:bg-black/[0.05] active:scale-95 transition-all cursor-pointer -mr-2"
            onClick={() => setShowSettings(false)}
            title="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 px-5 py-4 space-y-6">
          {/* Layout：小屏单列时隐藏 */}
          {!isMobile && (
          <section>
            <h3 className="text-[11px] font-semibold text-[#aaa] uppercase tracking-wider mb-3">布局模式</h3>
            <div className="flex gap-2">
              {layouts.map((l) => (
                <button
                  key={l.id}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-3 rounded-xl border active:scale-95 transition-all cursor-pointer ${
                    layout === l.id
                      ? "bg-white border-black/[0.1] shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
                      : "bg-transparent border-black/[0.04] hover:bg-white/60"
                  }`}
                  onClick={() => setLayout(l.id)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={layout === l.id ? "#333" : "#999"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d={l.icon} />
                  </svg>
                  <span className={`text-[10px] font-medium ${layout === l.id ? "text-[#333]" : "text-[#999]"}`}>
                    {l.label}
                  </span>
                </button>
              ))}
            </div>
          </section>
          )}

          {/* 模型网页通用偏好 */}
          {isTauri() && (
            <section>
              <h3 className="text-[11px] font-semibold text-[#aaa] uppercase tracking-wider mb-3">
                模型网页
              </h3>
              <div className="space-y-2">
                <div>
                  <label className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-white/60 border border-black/[0.04] cursor-pointer">
                    <span className="text-[11px] text-[#444]">强制浅色模式</span>
                    <input
                      type="checkbox"
                      checked={forceLightMode}
                      onChange={async (e) => {
                        const v = e.target.checked;
                        setForceLightMode(v);
                        await applyForceLightToAllWebviews(panels);
                        // 切换后刷新让深色主题彻底回浅色（反之同理）
                        await refreshAllWebviews(panels);
                      }}
                      className="w-4 h-4 rounded border-black/[0.2] text-[#333] focus:ring-0 cursor-pointer"
                    />
                  </label>
                  <p className="text-[10px] text-[#999] mt-1.5 px-1">
                    新打开的模型网页强制浅色展示；关闭后回到模型自身主题，页面会自动刷新
                  </p>
                </div>

                <div>
                  <label className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-white/60 border border-black/[0.04] cursor-pointer">
                    <span className="text-[11px] text-[#444]">隐藏网页内顶栏、输入框与辅助提示</span>
                    <input
                      type="checkbox"
                      checked={hideWebviewChrome}
                      onChange={async (e) => {
                        const v = e.target.checked;
                        setHideWebviewChrome(v);
                        await applyHideChromeToAllWebviews(panels);
                      }}
                      className="w-4 h-4 rounded border-black/[0.2] text-[#333] focus:ring-0 cursor-pointer"
                    />
                  </label>
                  <p className="text-[10px] text-[#999] mt-1.5 px-1">
                    开启后仅使用底部统一输入框，各模型页面自带的顶栏、输入框和免责声明等辅助提示会被隐藏
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Default Providers */}
          <section>
            <h3 className="text-[11px] font-semibold text-[#aaa] uppercase tracking-wider mb-1">默认模型</h3>
            <p className="text-[10px] text-[#999] mb-2 px-1">勾选的模型会在启动和新建对话时默认打开，至少保留 1 个</p>
            <div className="space-y-1">
              {providers.map((p) => {
                const checked = defaultProviders.includes(p.id);
                const isOnlyOne = checked && defaultProviders.length <= 1;
                return (
                  <div key={p.id} className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-white/60 border border-black/[0.04]">
                    <label className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isOnlyOne}
                        onChange={() => toggleDefaultProvider(p.id)}
                        title={isOnlyOne ? "至少保留一个默认模型" : "设为默认"}
                        className="w-4 h-4 rounded border-black/[0.2] text-[#333] focus:ring-0 cursor-pointer shrink-0 disabled:opacity-60"
                      />
                      <ProviderIcon providerId={p.id} size={20} />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[#444] truncate">{p.label}</p>
                        <p className="text-[10px] text-[#aaa] truncate">{p.desc}</p>
                      </div>
                    </label>
                    {isTauri() && (
                      <button
                        className="text-[10px] text-[#bbb] hover:text-red-400 active:scale-95 transition-all cursor-pointer px-2 py-1 rounded-md hover:bg-red-50 shrink-0 ml-2"
                        onClick={() => clearProviderData(p.id)}
                        title="清除该模型的登录数据"
                      >
                        清除登录
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Shortcuts */}
          <section>
            <h3 className="text-[11px] font-semibold text-[#aaa] uppercase tracking-wider mb-3">快捷键</h3>
            <label className="flex items-center justify-between py-2.5 px-3 rounded-xl bg-white/60 border border-black/[0.04] cursor-pointer">
              <div>
                <p className="text-[11px] text-[#444]">Shift+Enter 发送</p>
                <p className="text-[10px] text-[#999] mt-0.5">
                  {sendWithShiftEnter ? "Shift+Enter 发送·Enter 换行" : "Enter 发送·Shift+Enter 换行"}
                </p>
              </div>
              <input
                type="checkbox"
                checked={sendWithShiftEnter}
                onChange={(e) => setSendWithShiftEnter(e.target.checked)}
                className="w-4 h-4 rounded border-black/[0.2] text-[#333] focus:ring-0 cursor-pointer"
              />
            </label>
          </section>

          {/* AI 评分 */}
          <ScoringConfigSection />

          {/* About */}
          <section>
            <h3 className="text-[11px] font-semibold text-[#aaa] uppercase tracking-wider mb-3">关于</h3>
            <div className="text-[11px] text-[#999] space-y-1">
              <p>NayAI Desk v0.1.0</p>
              <p>聚合多个 AI 模型的桌面工作台</p>
              <p className="text-[10px] text-[#ccc] mt-2">登录数据保存在本地，不会上传至任何服务器</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ─── AI 评分配置子组件 ─── */

const JUDGE_PRESETS: { id: JudgeConfig["provider"]; label: string; baseUrl: string; model: string }[] = [
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com", model: "gpt-4o-mini" },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com", model: "claude-3-haiku-20240307" },
  { id: "custom", label: "自定义", baseUrl: "", model: "" },
];

function ScoringConfigSection() {
  const judgeConfig = useScoreStore((s) => s.judgeConfig);
  const setJudgeConfig = useScoreStore((s) => s.setJudgeConfig);
  const [showKey, setShowKey] = useState(false);

  const activePreset = JUDGE_PRESETS.find((p) => p.id === judgeConfig.provider) ?? JUDGE_PRESETS[0];

  function handleProviderChange(id: JudgeConfig["provider"]) {
    const preset = JUDGE_PRESETS.find((p) => p.id === id)!;
    setJudgeConfig({
      provider: id,
      baseUrl: preset.baseUrl,
      model: preset.model || judgeConfig.model,
    });
  }

  return (
    <section>
      <h3 className="text-[11px] font-semibold text-[#aaa] uppercase tracking-wider mb-3">AI 评分</h3>
      <div className="space-y-2">
        {/* Provider selector */}
        <div className="py-2.5 px-3 rounded-xl bg-white/60 border border-black/[0.04]">
          <p className="text-[11px] text-[#444] mb-2">裁判模型</p>
          <div className="flex gap-1.5 flex-wrap">
            {JUDGE_PRESETS.map((p) => (
              <button
                key={p.id}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all cursor-pointer ${
                  judgeConfig.provider === p.id
                    ? "bg-[#1a1a1a] text-white"
                    : "bg-[#f0f0ef] text-[#777] hover:bg-[#e5e5e4]"
                }`}
                onClick={() => handleProviderChange(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* API Key */}
        <div className="py-2.5 px-3 rounded-xl bg-white/60 border border-black/[0.04]">
          <p className="text-[11px] text-[#444] mb-1.5">API Key</p>
          <div className="flex items-center gap-1.5">
            <input
              type={showKey ? "text" : "password"}
              value={judgeConfig.apiKey}
              onChange={(e) => setJudgeConfig({ apiKey: e.target.value })}
              placeholder={`输入 ${activePreset.label} API Key`}
              className="flex-1 text-[11px] bg-[#f5f5f4] border border-black/[0.06] rounded-lg px-2.5 py-1.5 outline-none focus:border-black/[0.15] transition-colors"
            />
            <button
              className="text-[10px] text-[#999] hover:text-[#555] px-1.5 py-1 cursor-pointer"
              onClick={() => setShowKey(!showKey)}
              title={showKey ? "隐藏" : "显示"}
            >
              {showKey ? "隐藏" : "显示"}
            </button>
          </div>
        </div>

        {/* Model name */}
        <div className="py-2.5 px-3 rounded-xl bg-white/60 border border-black/[0.04]">
          <p className="text-[11px] text-[#444] mb-1.5">模型名称</p>
          <input
            type="text"
            value={judgeConfig.model}
            onChange={(e) => setJudgeConfig({ model: e.target.value })}
            placeholder="例如 deepseek-chat"
            className="w-full text-[11px] bg-[#f5f5f4] border border-black/[0.06] rounded-lg px-2.5 py-1.5 outline-none focus:border-black/[0.15] transition-colors"
          />
        </div>

        {/* Base URL (只在自定义时展开) */}
        {judgeConfig.provider === "custom" && (
          <div className="py-2.5 px-3 rounded-xl bg-white/60 border border-black/[0.04]">
            <p className="text-[11px] text-[#444] mb-1.5">API 地址</p>
            <input
              type="text"
              value={judgeConfig.baseUrl}
              onChange={(e) => setJudgeConfig({ baseUrl: e.target.value })}
              placeholder="https://api.example.com"
              className="w-full text-[11px] bg-[#f5f5f4] border border-black/[0.06] rounded-lg px-2.5 py-1.5 outline-none focus:border-black/[0.15] transition-colors"
            />
            <p className="text-[10px] text-[#999] mt-1">需兼容 OpenAI /v1/chat/completions 接口</p>
          </div>
        )}

        <p className="text-[10px] text-[#999] px-1">
          用于 AI 评分功能的裁判模型。回答文本会发送到该 API 进行评分，Key 仅存于本地。
        </p>
      </div>
    </section>
  );
}
