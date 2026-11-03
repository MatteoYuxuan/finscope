import type { Sentiment } from "@/lib/types/domain";

/**
 * 轻量情绪词典：只做文本统计标签（中性/偏正/偏负/混合）。
 * 明确不用于涨跌预测——UI 与报告均标注“情绪标签仅为文本统计”。
 */
const POSITIVE = [
  "增长",
  "回升",
  "改善",
  "扩张",
  "利好",
  "上涨",
  "走高",
  "走强",
  "突破",
  "创新高",
  "提振",
  "复苏",
  "企稳",
  "超预期",
  "盈利",
  "增持",
  "回暖",
  "放宽",
  "降准",
  "降息",
  "支持",
  "加快",
  "提升",
];

const NEGATIVE = [
  "下跌",
  "走低",
  "走弱",
  "收缩",
  "下滑",
  "亏损",
  "风险",
  "承压",
  "违约",
  "下调",
  "低于预期",
  "裁员",
  "收紧",
  "处罚",
  "调查",
  "爆雷",
  "回落",
  "萎缩",
  "加息",
  "限制",
  "放缓",
  "承压",
];

const NEGATIONS = ["不", "未", "没有", "并非", "否认", "难以"];

function countOccurrences(text: string, words: string[]): number {
  let total = 0;
  for (const word of words) {
    let index = text.indexOf(word);
    while (index !== -1) {
      // 否定窗口：词前 3 个字符内出现否定词则视为反向
      const windowStart = Math.max(0, index - 3);
      const prefix = text.slice(windowStart, index);
      const negated = NEGATIONS.some((n) => prefix.includes(n));
      total += negated ? -1 : 1;
      index = text.indexOf(word, index + word.length);
    }
  }
  return total;
}

export interface SentimentResult {
  sentiment: Sentiment;
  positive: number;
  negative: number;
  /** 用于 UI 提示的百分比强度（0..1），不代表任何预测 */
  intensity: number;
}

export function analyzeSentiment(text: string): SentimentResult {
  const positive = Math.max(0, countOccurrences(text, POSITIVE));
  const negative = Math.max(0, countOccurrences(text, NEGATIVE));
  const total = positive + negative;

  let sentiment: Sentiment = "neutral";
  if (total > 0 && positive > 0 && negative > 0) {
    const ratio = positive / negative;
    if (ratio >= 2) sentiment = "positive";
    else if (ratio <= 0.5) sentiment = "negative";
    else sentiment = "mixed";
  } else if (positive > 0) {
    sentiment = "positive";
  } else if (negative > 0) {
    sentiment = "negative";
  }

  return {
    sentiment,
    positive,
    negative,
    intensity: total === 0 ? 0 : Math.min(1, total / 8),
  };
}

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  neutral: "中性",
  positive: "偏正面",
  negative: "偏负面",
  mixed: "多空交织",
};

export const SENTIMENT_COLORS: Record<Sentiment, string> = {
  neutral: "#64748b",
  positive: "#16a34a",
  negative: "#dc2626",
  mixed: "#d97706",
};
