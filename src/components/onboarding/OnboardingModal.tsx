import { useState } from "react";
import { ProviderIcon } from "../common/ProviderIcon";
import { getAllProviders } from "../../providers/registry";
import type { ProviderId } from "../../types/provider";

interface OnboardingModalProps {
  initialSelection: ProviderId[];
  onConfirm: (selected: ProviderId[]) => void | Promise<void>;
}

export function OnboardingModal({ initialSelection, onConfirm }: OnboardingModalProps) {
  const providers = getAllProviders();
  const [selected, setSelected] = useState<ProviderId[]>(
    initialSelection.length > 0 ? initialSelection : ["gpt"],
  );
  const [submitting, setSubmitting] = useState(false);

  function toggle(id: ProviderId) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : [...current, id],
    );
  }

  async function handleConfirm() {
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(selected);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/25 backdrop-blur-md p-4">
      <div className="w-full max-w-[440px] bg-[#f7f7f6] rounded-2xl border border-black/[0.08] shadow-[0_16px_48px_rgba(0,0,0,0.18)] overflow-hidden">
        <div className="px-6 pt-6 pb-4">
          <div className="w-10 h-10 rounded-xl bg-[#1a1a1a] text-white flex items-center justify-center mb-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-[#222] mb-1">选择你常用的 AI 模型</h2>
          <p className="text-[11px] text-[#999] leading-relaxed">
            勾选的模型会在 NayAI Desk 启动和新建对话时默认一起打开。之后也能在「设置 · 默认模型」里随时调整。
          </p>
        </div>

        <div className="px-5 pb-5 space-y-1.5">
          {providers.map((p) => {
            const checked = selected.includes(p.id);
            return (
              <label
                key={p.id}
                className={`flex items-center gap-3 py-2.5 px-3 rounded-xl border cursor-pointer transition-colors ${
                  checked
                    ? "bg-white border-black/[0.1] shadow-[0_1px_4px_rgba(0,0,0,0.04)]"
                    : "bg-white/50 border-black/[0.04] hover:bg-white/80"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(p.id)}
                  className="w-4 h-4 rounded border-black/[0.2] text-[#333] focus:ring-0 cursor-pointer shrink-0"
                />
                <ProviderIcon providerId={p.id} size={22} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[#333]">{p.label}</p>
                  <p className="text-[10px] text-[#aaa] truncate">{p.desc}</p>
                </div>
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-black/[0.04] bg-white/40">
          <p className="text-[10px] text-[#bbb]">
            {selected.length === 0
              ? "至少选择 1 个模型"
              : `已选 ${selected.length} 个 · 最多 6 个`}
          </p>
          <button
            disabled={selected.length === 0 || selected.length > 6 || submitting}
            onClick={handleConfirm}
            className="px-4 py-2 rounded-lg bg-[#1a1a1a] text-white text-xs font-medium hover:bg-[#333] disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            {submitting ? "正在准备…" : "开始使用"}
          </button>
        </div>
      </div>
    </div>
  );
}
