import type { ProviderId, ProviderMeta } from "../types/provider";

const PROVIDER_REGISTRY: Record<ProviderId, ProviderMeta> = {
  gpt: {
    id: "gpt",
    label: "GPT",
    color: "#10a37f",
    desc: "OpenAI ChatGPT",
    url: "https://chatgpt.com",
    region: "US",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    color: "#4285f4",
    desc: "Google Gemini",
    url: "https://gemini.google.com/app",
    region: "US",
  },
  claude: {
    id: "claude",
    label: "Claude",
    color: "#D97757",
    desc: "Anthropic Claude",
    url: "https://claude.ai/new",
    region: "US",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    color: "#4d6bfe",
    desc: "DeepSeek Chat",
    url: "https://chat.deepseek.com",
    region: "CN",
  },
  doubao: {
    id: "doubao",
    label: "豆包",
    color: "#f56c2d",
    desc: "字节跳动豆包",
    url: "https://www.doubao.com/chat/",
    region: "CN",
  },
  kimi: {
    id: "kimi",
    label: "Kimi",
    color: "#1F2937",
    desc: "Moonshot Kimi",
    url: "https://kimi.moonshot.cn/",
    region: "CN",
  },
  qwen: {
    id: "qwen",
    label: "千问",
    color: "#615ced",
    desc: "通义千问",
    url: "https://www.qianwen.com/",
    region: "CN",
  },
  ernie: {
    id: "ernie",
    label: "文心一言",
    color: "#2932E1",
    desc: "百度文心一言",
    url: "https://yiyan.baidu.com/",
    region: "CN",
  },
  perplexity: {
    id: "perplexity",
    label: "Perplexity",
    color: "#20808D",
    desc: "Perplexity AI",
    url: "https://www.perplexity.ai/",
    region: "US",
  },
  grok: {
    id: "grok",
    label: "Grok",
    color: "#f97316",
    desc: "xAI Grok",
    url: "https://grok.com",
    region: "US",
  },
};

export function getProvider(id: ProviderId): ProviderMeta {
  return PROVIDER_REGISTRY[id];
}

export function getAllProviders(): ProviderMeta[] {
  return Object.values(PROVIDER_REGISTRY);
}
