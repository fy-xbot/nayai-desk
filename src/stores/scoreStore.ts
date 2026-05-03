import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ProviderId,
  AnswerScore,
  ExtractedAnswer,
  ScoringStatus,
  JudgeConfig,
} from "../types/provider";

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export interface ScoringRound {
  id: string;
  prompt: string;
  answers: ExtractedAnswer[];
  scores: AnswerScore[];
  status: ScoringStatus;
  error?: string;
  createdAt: number;
}

interface ScoreState {
  /** 当前评分轮次（只保留最新一轮） */
  currentRound: ScoringRound | null;

  /** LLM 裁判 API 配置（持久化） */
  judgeConfig: JudgeConfig;

  setJudgeConfig: (config: Partial<JudgeConfig>) => void;

  /** 用户点击「AI 评分」时调用 */
  startRound: (prompt: string) => string;

  /** 提取到某个 provider 的回答 */
  addExtractedAnswer: (answer: ExtractedAnswer) => void;

  /** 进入裁判阶段 */
  setJudging: () => void;

  /** 裁判完成，写入评分 */
  setScores: (scores: AnswerScore[]) => void;

  /** 出错 */
  setError: (error: string) => void;

  /** 清除当前评分（发新消息 / 重新评分时调用） */
  clearRound: () => void;

  /** 获取某个 provider 的评分 */
  getScoreFor: (providerId: ProviderId) => AnswerScore | undefined;
}

const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  provider: "deepseek",
  apiKey: "",
  model: "deepseek-chat",
  baseUrl: "https://api.deepseek.com",
};

export const useScoreStore = create<ScoreState>()(
  persist(
    (set, get) => ({
      currentRound: null,
      judgeConfig: { ...DEFAULT_JUDGE_CONFIG },

      setJudgeConfig: (config) =>
        set((s) => ({
          judgeConfig: { ...s.judgeConfig, ...config },
        })),

      startRound: (prompt) => {
        const id = generateId();
        set({
          currentRound: {
            id,
            prompt,
            answers: [],
            scores: [],
            status: "extracting",
            createdAt: Date.now(),
          },
        });
        return id;
      },

      addExtractedAnswer: (answer) =>
        set((s) => {
          if (!s.currentRound) return {};
          // 去重：同一个 provider 只保留最新
          const filtered = s.currentRound.answers.filter(
            (a) => a.providerId !== answer.providerId,
          );
          return {
            currentRound: {
              ...s.currentRound,
              answers: [...filtered, answer],
            },
          };
        }),

      setJudging: () =>
        set((s) =>
          s.currentRound
            ? { currentRound: { ...s.currentRound, status: "judging" } }
            : {},
        ),

      setScores: (scores) =>
        set((s) =>
          s.currentRound
            ? {
                currentRound: {
                  ...s.currentRound,
                  scores,
                  status: "done",
                },
              }
            : {},
        ),

      setError: (error) =>
        set((s) =>
          s.currentRound
            ? {
                currentRound: {
                  ...s.currentRound,
                  error,
                  status: "error",
                },
              }
            : {},
        ),

      clearRound: () => set({ currentRound: null }),

      getScoreFor: (providerId) => {
        const round = get().currentRound;
        if (!round || round.status !== "done") return undefined;
        return round.scores.find((s) => s.providerId === providerId);
      },
    }),
    {
      name: "nayai-score-config",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // 只持久化 judgeConfig，不持久化评分数据
      partialize: (state) => ({
        judgeConfig: state.judgeConfig,
      }),
    },
  ),
);
