import { useScoreStore } from "../stores/scoreStore";
import { useConversationStore } from "../stores/conversationStore";
import { getProvider } from "../providers/registry";
import {
  extractAnswerFromWebview,
  injectScoreLoading,
  injectScoreResult,
  removeScoreOverlay,
  getProviderIdForPanel,
} from "./webviewManager";
import type {
  Panel,
  ProviderId,
  AnswerScore,
  ExtractedAnswer,
  JudgeConfig,
} from "../types/provider";

const JUDGE_SYSTEM_PROMPT = `你是一个公正的 AI 回答质量评审。请对多个 AI 模型针对同一问题的回答打分。

评分规则：
- 综合准确性、完整性、清晰度、实用性四个维度
- 总分 0-10，保留一位小数
- 为每个模型写一句 15 字以内的短评（类似豆瓣短评风格，干脆直接）

严格以如下 JSON 数组返回，不要输出任何其他内容：
[
  { "providerId": "gpt", "score": 8.5, "comment": "代码完整，讲解到位" }
]`;

function getDefaultBaseUrl(provider: JudgeConfig["provider"]): string {
  switch (provider) {
    case "deepseek":
      return "https://api.deepseek.com";
    case "openai":
      return "https://api.openai.com";
    case "anthropic":
      return "https://api.anthropic.com";
    default:
      return "";
  }
}

function buildUserPrompt(
  prompt: string,
  answers: { providerId: ProviderId; text: string }[],
): string {
  let msg = `## 用户问题\n${prompt}\n\n## 各模型回答\n\n`;
  for (const a of answers) {
    const label = getProvider(a.providerId).label;
    msg += `### ${label} (${a.providerId})\n${a.text || "(提取失败，无内容)"}\n\n`;
  }
  return msg;
}

/**
 * 用户点击「AI 评分」后的完整管线。
 */
export async function runScoring(
  panels: Panel[],
  signal?: AbortSignal,
): Promise<void> {
  const store = useScoreStore.getState();
  const convStore = useConversationStore.getState();

  // 检查 API Key
  if (!store.judgeConfig.apiKey) {
    throw new Error("请先在设置中配置裁判模型的 API Key");
  }

  // 取最后一条用户消息作为 prompt
  const active = convStore.getActive();
  const msgs = active?.messages;
  const lastMsg = msgs && msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
  if (!lastMsg) throw new Error("没有可评分的消息");

  store.startRound(lastMsg.text);

  // 在所有 panel 上显示 loading 卡片
  await Promise.allSettled(panels.map((p) => injectScoreLoading(p.id)));

  // 批量提取各 panel 的最后一条回答
  const answers: ExtractedAnswer[] = [];
  const extractResults = await Promise.allSettled(
    panels.map(async (panel) => {
      const providerId = getProviderIdForPanel(panel.id);
      if (!providerId) return null;
      try {
        const text = await extractAnswerFromWebview(panel.id);
        const answer: ExtractedAnswer = {
          providerId,
          panelId: panel.id,
          text,
          extractedAt: Date.now(),
        };
        store.addExtractedAnswer(answer);
        return answer;
      } catch (e) {
        console.warn(`[scoring] extract failed for ${providerId}:`, e);
        const answer: ExtractedAnswer = {
          providerId,
          panelId: panel.id,
          text: "",
          extractedAt: Date.now(),
        };
        store.addExtractedAnswer(answer);
        return answer;
      }
    }),
  );

  for (const r of extractResults) {
    if (r.status === "fulfilled" && r.value) {
      answers.push(r.value);
    }
  }

  if (signal?.aborted) {
    store.setError("评分已取消");
    await Promise.allSettled(panels.map((p) => removeScoreOverlay(p.id)));
    return;
  }

  const validAnswers = answers.filter((a) => a.text.length > 0);
  if (validAnswers.length === 0) {
    store.setError("未能提取到任何回答");
    await Promise.allSettled(panels.map((p) => removeScoreOverlay(p.id)));
    return;
  }

  // 调用 LLM 裁判
  store.setJudging();
  try {
    const scores = await judgeAnswers(
      lastMsg.text,
      validAnswers.map((a) => ({ providerId: a.providerId, text: a.text })),
      store.judgeConfig,
      signal,
    );
    store.setScores(scores);

    // 将评分结果注入到各 panel 的 webview
    await Promise.allSettled(
      panels.map(async (panel) => {
        const providerId = getProviderIdForPanel(panel.id);
        const score = scores.find((s) => s.providerId === providerId);
        if (score) {
          await injectScoreResult(panel.id, score);
        } else {
          await removeScoreOverlay(panel.id);
        }
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    store.setError(msg);
    await Promise.allSettled(panels.map((p) => removeScoreOverlay(p.id)));
    throw e;
  }
}

async function judgeAnswers(
  prompt: string,
  answers: { providerId: ProviderId; text: string }[],
  config: JudgeConfig,
  signal?: AbortSignal,
): Promise<AnswerScore[]> {
  const baseUrl = config.baseUrl || getDefaultBaseUrl(config.provider);
  if (!baseUrl) throw new Error("未配置裁判模型的 API 地址");

  const userPrompt = buildUserPrompt(prompt, answers);

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM API 错误 (${res.status}): ${body.substring(0, 200)}`);
  }

  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content || "";

  // 解析 JSON，兼容数组直接返回或 { scores: [...] } 包裹
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`裁判返回的 JSON 解析失败: ${content.substring(0, 200)}`);
  }

  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>).scores)
      ? (parsed as Record<string, unknown>).scores
      : null;

  if (!arr) {
    throw new Error(`裁判返回格式不符合预期: ${content.substring(0, 200)}`);
  }

  return (arr as Record<string, unknown>[]).map((item) => ({
    providerId: String(item.providerId) as ProviderId,
    score: Math.round(Number(item.score) * 10) / 10,
    comment: String(item.comment || ""),
  }));
}

/**
 * 清除所有 panel 上的评分卡片（发新消息时调用）。
 */
export async function clearAllScoreOverlays(
  panels: Panel[],
): Promise<void> {
  useScoreStore.getState().clearRound();
  await Promise.allSettled(panels.map((p) => removeScoreOverlay(p.id)));
}
