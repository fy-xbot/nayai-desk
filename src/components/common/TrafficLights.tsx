import { getCurrentWindow } from "@tauri-apps/api/window";

/** 小号红绿灯：默认只显示圆点，悬停时显示 × / − / +，并变暗（macOS 效果）。 */
function LightButton({
  bgClass,
  iconStroke,
  iconPath,
  iconStrokeWidth = 2.5,
  onClick,
  title,
}: {
  bgClass: string;
  iconStroke: string;
  iconPath: React.ReactNode;
  iconStrokeWidth?: number;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      className="group relative w-[10px] h-[10px] flex items-center justify-center border-0 p-0 cursor-pointer transition-[filter,transform] duration-150 hover:brightness-90 active:scale-95 shrink-0"
      onClick={onClick}
      title={title}
    >
      {/* 视觉圆点 10px */}
      <span className={`absolute inset-0 rounded-full ${bgClass}`} />
      {/* 仅悬停时显示图标（纯 CSS，不依赖 JS 状态） */}
      <svg
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[6px] h-[6px] pointer-events-none z-[1] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        viewBox="0 0 24 24"
        fill="none"
        stroke={iconStroke}
        strokeWidth={iconStrokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {iconPath}
      </svg>
    </button>
  );
}

export function TrafficLights() {
  return (
    <div className="flex items-center gap-1 pl-2 shrink-0 relative z-10 pointer-events-auto">
      <LightButton
        bgClass="bg-[#ff5f57]"
        iconStroke="rgba(0,0,0,0.4)"
        iconStrokeWidth={3}
        iconPath={<path d="M18 6L6 18M6 6l12 12" />}
        onClick={() => getCurrentWindow().close()}
        title="关闭"
      />
      <LightButton
        bgClass="bg-[#febc2e]"
        iconStroke="rgba(0,0,0,0.4)"
        iconPath={<path d="M5 12h14" />}
        onClick={() => getCurrentWindow().minimize()}
        title="最小化"
      />
      <LightButton
        bgClass="bg-[#28c840]"
        iconStroke="rgba(0,0,0,0.4)"
        iconStrokeWidth={2}
        iconPath={<path d="M12 5v14M5 12h14" />}
        onClick={() => getCurrentWindow().toggleMaximize()}
        title="最大化"
      />
    </div>
  );
}
