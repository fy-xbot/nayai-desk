import type { ProviderId } from "../../types/provider";
import OpenAI from "@lobehub/icons/es/OpenAI";
import Gemini from "@lobehub/icons/es/Gemini";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Grok from "@lobehub/icons/es/Grok";
import Qwen from "@lobehub/icons/es/Qwen";
import Claude from "@lobehub/icons/es/Claude";
import Wenxin from "@lobehub/icons/es/Wenxin";
import Perplexity from "@lobehub/icons/es/Perplexity";

const KIMI_LOGO_URL = "https://statics.moonshot.cn/kimi-web-seo/assets/kimi-logo-CegIMkbU.png";

interface Props {
  providerId: ProviderId;
  size?: number;
  className?: string;
}

export function ProviderIcon({ providerId, size = 16, className = "" }: Props) {
  switch (providerId) {
    case "gpt":
      return <OpenAI size={size} className={className} />;
    case "gemini":
      return <Gemini.Color size={size} className={className} />;
    case "claude":
      return <Claude.Color size={size} className={className} />;
    case "doubao":
      return (
        <img
          src="https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/doubao/chat/favicon.png"
          alt="豆包"
          width={size}
          height={size}
          className={`rounded-full object-cover ${className}`}
          style={{ width: size, height: size }}
        />
      );
    case "kimi":
      return (
        <img
          src={KIMI_LOGO_URL}
          alt="Kimi"
          width={size}
          height={size}
          className={`object-contain ${className}`}
          style={{ width: size, height: size }}
        />
      );
    case "deepseek":
      return <DeepSeek.Color size={size} className={className} />;
    case "qwen":
      return <Qwen.Color size={size} className={className} />;
    case "ernie":
      return <Wenxin.Color size={size} className={className} />;
    case "perplexity":
      return <Perplexity.Color size={size} className={className} />;
    case "grok":
      return <Grok size={size} className={className} />;
    default:
      return null;
  }
}
