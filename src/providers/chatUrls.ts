import type { ProviderId } from "../types/provider";

/**
 * 各家模型网页的会话 URL 规则：
 * - parse：从当前 URL 解析出 chatId；解析不到（在 home/登录页等）返回 null
 * - build：给定 chatId 构造会话深链
 * - home：点击"新对话"时 navigate 到的地址（= 该站点空会话页面）
 */
interface ChatUrlPattern {
  parse: (url: string) => string | null;
  build: (chatId: string) => string;
  home: string;
}

const patterns: Record<ProviderId, ChatUrlPattern> = {
  gpt: {
    parse: (url) => {
      const m = url.match(/^https?:\/\/chatgpt\.com\/c\/([a-zA-Z0-9-]+)/);
      return m ? m[1] : null;
    },
    build: (id) => `https://chatgpt.com/c/${id}`,
    home: "https://chatgpt.com/",
  },
  gemini: {
    parse: (url) => {
      const m = url.match(/^https?:\/\/gemini\.google\.com\/app\/([a-zA-Z0-9]+)/);
      return m ? m[1] : null;
    },
    build: (id) => `https://gemini.google.com/app/${id}`,
    home: "https://gemini.google.com/app",
  },
  claude: {
    parse: (url) => {
      // claude.ai/chat/<uuid>
      const m = url.match(/^https?:\/\/claude\.ai\/chat\/([a-zA-Z0-9-]+)/);
      return m ? m[1] : null;
    },
    build: (id) => `https://claude.ai/chat/${id}`,
    home: "https://claude.ai/new",
  },
  doubao: {
    parse: (url) => {
      const m = url.match(/^https?:\/\/www\.doubao\.com\/chat\/([a-zA-Z0-9-]+)/);
      return m ? m[1] : null;
    },
    build: (id) => `https://www.doubao.com/chat/${id}`,
    home: "https://www.doubao.com/chat/",
  },
  kimi: {
    parse: (url) => {
      // kimi.moonshot.cn/chat/<id>
      const m = url.match(/^https?:\/\/kimi\.moonshot\.cn\/chat\/([a-zA-Z0-9-_]+)/);
      return m ? m[1] : null;
    },
    build: (id) => `https://kimi.moonshot.cn/chat/${id}`,
    home: "https://kimi.moonshot.cn/",
  },
  ernie: {
    parse: (url) => {
      // yiyan.baidu.com 的对话路径支持 /chat/<id>、/?sessionId=<id> 等多形态，做宽松匹配
      const m =
        url.match(/^https?:\/\/yiyan\.baidu\.com\/chat\/([a-zA-Z0-9_-]+)/) ||
        url.match(/^https?:\/\/yiyan\.baidu\.com\/.*\bsessionId=([a-zA-Z0-9_-]+)/);
      return m ? m[1] : null;
    },
    build: (id) => `https://yiyan.baidu.com/chat/${id}`,
    home: "https://yiyan.baidu.com/",
  },
  perplexity: {
    parse: (url) => {
      // perplexity.ai 会话形如 /search/<slug>-<uuid> 或 /search/<slug>-<hash>
      const m = url.match(/^https?:\/\/(?:www\.)?perplexity\.ai\/search\/([a-zA-Z0-9_-]+)/);
      return m ? m[1] : null;
    },
    build: (id) => `https://www.perplexity.ai/search/${id}`,
    home: "https://www.perplexity.ai/",
  },
  deepseek: {
    parse: (url) => {
      const m = url.match(/^https?:\/\/chat\.deepseek\.com\/a\/chat\/s\/([a-zA-Z0-9-]+)/);
      return m ? m[1] : null;
    },
    build: (id) => `https://chat.deepseek.com/a/chat/s/${id}`,
    home: "https://chat.deepseek.com",
  },
  qwen: {
    parse: (url) => {
      // 同时兼容 www.qianwen.com / qianwen.com（新域名）与 tongyi.aliyun.com（旧域名兜底）
      const m =
        url.match(/^https?:\/\/(?:www\.)?qianwen\.com\/chat\/([a-zA-Z0-9]+)/) ||
        url.match(/^https?:\/\/tongyi\.aliyun\.com\/qianwen\/\?.*\bsessionId=([a-zA-Z0-9_-]+)/);
      return m ? m[1] : null;
    },
    build: (id) => `https://www.qianwen.com/chat/${id}`,
    home: "https://www.qianwen.com/",
  },
  grok: {
    parse: (url) => {
      const m = url.match(/^https?:\/\/grok\.com\/chat\/([a-zA-Z0-9-]+)/);
      return m ? m[1] : null;
    },
    build: (id) => `https://grok.com/chat/${id}`,
    home: "https://grok.com",
  },
};

export function parseChatIdFromUrl(
  providerId: ProviderId,
  url: string,
): string | null {
  return patterns[providerId].parse(url);
}

export function buildChatUrl(providerId: ProviderId, chatId: string): string {
  return patterns[providerId].build(chatId);
}

export function getProviderHomeUrl(providerId: ProviderId): string {
  return patterns[providerId].home;
}
