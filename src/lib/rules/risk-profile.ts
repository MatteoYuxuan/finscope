import { RISK_BAND_META } from "@/lib/constants";
import type { RiskBand, RiskProfileResult } from "@/lib/types/domain";

export interface RiskQuestion {
  id: string;
  title: string;
  hint?: string;
  options: { label: string; score: number }[];
}

/** 10 题 × 5 档，每档 0–4 分，总分 0–40 → 折算 0–100 */
export const RISK_QUESTIONS: RiskQuestion[] = [
  {
    id: "q1",
    title: "这笔钱大概多久之后会用到？",
    options: [
      { label: "1 年内可能要用", score: 0 },
      { label: "1–3 年", score: 1 },
      { label: "3–5 年", score: 2 },
      { label: "5 年以上", score: 3 },
      { label: "长期不动用", score: 4 },
    ],
  },
  {
    id: "q2",
    title: "如果持有的资产一个月内下跌 10%，你会？",
    options: [
      { label: "立刻全部换成现金", score: 0 },
      { label: "卖掉大部分", score: 1 },
      { label: "先观望", score: 2 },
      { label: "继续持有", score: 3 },
      { label: "再补一点", score: 4 },
    ],
  },
  {
    id: "q3",
    title: "你的收入稳定性如何？",
    options: [
      { label: "不稳定，波动很大", score: 0 },
      { label: "较不稳定", score: 1 },
      { label: "一般", score: 2 },
      { label: "比较稳定", score: 3 },
      { label: "非常稳定", score: 4 },
    ],
  },
  {
    id: "q4",
    title: "目前每月结余（收入减支出）大致是？",
    options: [
      { label: "基本没有结余", score: 0 },
      { label: "不到 10%", score: 1 },
      { label: "10%–25%", score: 2 },
      { label: "25%–40%", score: 3 },
      { label: "40% 以上", score: 4 },
    ],
  },
  {
    id: "q5",
    title: "你对“净值波动”的接受程度是？",
    options: [
      { label: "完全不能接受", score: 0 },
      { label: "小幅波动可以", score: 1 },
      { label: "能接受阶段性回撤", score: 2 },
      { label: "能接受较大回撤", score: 3 },
      { label: "只看长期结果", score: 4 },
    ],
  },
  {
    id: "q6",
    title: "你目前的负债情况是？",
    options: [
      { label: "负债较重、月供压力大", score: 0 },
      { label: "有一定负债", score: 1 },
      { label: "负债适中", score: 2 },
      { label: "负债很轻", score: 3 },
      { label: "几乎没有负债", score: 4 },
    ],
  },
  {
    id: "q7",
    title: "除了这笔资产，你还有多少可动用的应急资金？",
    options: [
      { label: "几乎没有", score: 0 },
      { label: "不到 3 个月支出", score: 1 },
      { label: "3–6 个月支出", score: 2 },
      { label: "6–12 个月支出", score: 3 },
      { label: "12 个月以上", score: 4 },
    ],
  },
  {
    id: "q8",
    title: "你对金融产品的了解程度？",
    options: [
      { label: "几乎不了解", score: 0 },
      { label: "知道存款和货基", score: 1 },
      { label: "了解基金与债券", score: 2 },
      { label: "了解股票与资产配置", score: 3 },
      { label: "有系统的投资知识", score: 4 },
    ],
  },
  {
    id: "q9",
    title: "未来 1–2 年是否有大额支出计划？",
    options: [
      { label: "有，且金额很大", score: 0 },
      { label: "有，金额中等", score: 1 },
      { label: "可能有", score: 2 },
      { label: "大概率没有", score: 3 },
      { label: "确定没有", score: 4 },
    ],
  },
  {
    id: "q10",
    title: "如果这笔钱三年内不能动，你的感受是？",
    options: [
      { label: "完全不能接受", score: 0 },
      { label: "会比较焦虑", score: 1 },
      { label: "可以接受", score: 2 },
      { label: "没什么问题", score: 3 },
      { label: "完全可以", score: 4 },
    ],
  },
];

export const RISK_QUESTION_COUNT = RISK_QUESTIONS.length;

/** 0–100 分档：<20 保守 / <40 稳健 / <60 平衡 / <80 成长 / ≥80 进取 */
export function bandOfScore(score: number): RiskBand {
  if (score < 20) return "CONSERVATIVE";
  if (score < 40) return "STEADY";
  if (score < 60) return "BALANCED";
  if (score < 80) return "GROWTH";
  return "AGGRESSIVE";
}

/** answers 为每题选项的 score（0–4），长度必须等于题目数 */
export function scoreRiskProfile(answers: number[]): RiskProfileResult {
  if (!Array.isArray(answers) || answers.length !== RISK_QUESTION_COUNT) {
    throw new RangeError(`问卷需要 ${RISK_QUESTION_COUNT} 个答案，实际收到 ${answers?.length ?? 0} 个`);
  }
  let total = 0;
  for (const [index, answer] of answers.entries()) {
    const question = RISK_QUESTIONS[index];
    const valid = question.options.some((option) => option.score === answer);
    if (!valid) throw new RangeError(`第 ${index + 1} 题的答案超出可选范围：${answer}`);
    total += answer;
  }
  const score = Math.round((total / (RISK_QUESTION_COUNT * 4)) * 100);
  const band = bandOfScore(score);
  return {
    score,
    band,
    bandLabel: RISK_BAND_META[band].label,
    equityRange: RISK_BAND_META[band].equityRange,
    answered: answers.length,
  };
}

export function emptyAnswers(): null[] {
  return Array.from({ length: RISK_QUESTION_COUNT }, () => null);
}
