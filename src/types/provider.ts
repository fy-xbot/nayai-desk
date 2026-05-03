export type ProviderId =
  | "gpt"
  | "gemini"
  | "claude"
  | "deepseek"
  | "doubao"
  | "kimi"
  | "qwen"
  | "ernie"
  | "perplexity"
  | "grok";

/** 模型所属地区，用于"添加模型"菜单分组展示 */
export type ProviderRegion = "US" | "CN";

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  color: string;
  desc: string;
  url: string;
  region: ProviderRegion;
}

export interface Panel {
  id: string;
  providerId: ProviderId;
  createdAt: number;
}

export type LayoutMode = "columns" | "rows" | "grid";

export type PromptMode = "broadcast" | "single";

export interface PromptImagePayload {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  dataUrl: string;
}

export interface ConversationImageMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
}

export interface ConversationMessage {
  id: string;
  text: string;
  images?: ConversationImageMeta[];
  targets: ProviderId[];
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  providerIds: ProviderId[];
  messages: ConversationMessage[];
  createdAt: number;
  updatedAt: number;
  /** 各模型网页侧真实的会话 id（从 URL 提取），用于精确切换 */
  remoteChatIds?: Partial<Record<ProviderId, string>>;
}

/* ─── AI 评分相关类型 ─── */

export interface AnswerScore {
  providerId: ProviderId;
  /** 0-10，保留一位小数 */
  score: number;
  /** 豆瓣风格一句话短评（≤15字） */
  comment: string;
}

export interface ExtractedAnswer {
  providerId: ProviderId;
  panelId: string;
  text: string;
  extractedAt: number;
}

export type ScoringStatus = "idle" | "extracting" | "judging" | "done" | "error";

export interface JudgeConfig {
  provider: "deepseek" | "openai" | "anthropic" | "custom";
  apiKey: string;
  model: string;
  baseUrl: string;
}
