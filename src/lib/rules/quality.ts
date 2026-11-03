/**
 * 资讯质量分（0–100）：识别标题党、未证实表述、缺少出处等。
 * 这是“信息整理”的一部分，不是事实核查，也不评价观点对错。
 */

const CLICKBAIT = ["震惊", "暴涨", "暴跌", "必看", "内幕", "疯传", "炸裂", "血亏", "躺赚", "最后机会", "紧急"];
const RUMOR = ["据传", "网传", "匿名人士", "消息人士称", "据说", "传闻", "小道消息"];

export interface QualityInput {
  title: string;
  summary: string;
  content?: string | null;
  url?: string | null;
  publishedAt?: Date | string | null;
  sourceCredibility?: number;
}

export interface QualityResult {
  score: number;
  flags: string[];
  reasons: string[];
}

const NUMBER_PATTERN = /\d+(\.\d+)?\s*(%|％|亿|万|元|个|家|BP|bp|点)?/;

export function scoreQuality(input: QualityInput): QualityResult {
  let score = 50;
  const flags: string[] = [];
  const reasons: string[] = [];

  const title = input.title ?? "";
  const body = `${input.summary ?? ""}${input.content ?? ""}`;
  const fullText = `${title}${body}`;

  if (input.url && /^https?:\/\//.test(input.url)) {
    score += 15;
  } else {
    flags.push("NO_URL");
    reasons.push("缺少可核验的原文链接（-15）");
  }

  if (NUMBER_PATTERN.test(fullText)) {
    score += 10;
  } else {
    flags.push("NO_NUMBER");
    reasons.push("全文没有具体数字（-0，仅记录）");
  }

  if (body.length >= 120) {
    score += 10;
  } else {
    score -= 10;
    flags.push("TOO_SHORT");
    reasons.push("正文过短（-10）");
  }

  if (CLICKBAIT.some((word) => title.includes(word))) {
    score -= 15;
    flags.push("CLICKBAIT");
    reasons.push("标题包含煽动性用词（-15）");
  }

  if (RUMOR.some((word) => fullText.includes(word))) {
    score -= 20;
    flags.push("RUMOR");
    reasons.push("出现未经证实的表述（-20）");
  }

  const published = input.publishedAt ? new Date(input.publishedAt) : null;
  const validTime = published !== null && !Number.isNaN(published.getTime());
  if (!validTime) {
    score -= 10;
    flags.push("NO_SOURCE_TIME");
    reasons.push("缺少来源时间（-10）");
  } else {
    score += 5;
    const ageHours = (Date.now() - published.getTime()) / 36e5;
    if (ageHours > 24 * 14) {
      score -= 5;
      reasons.push("发布时间较早（-5）");
    }
  }

  if ((input.sourceCredibility ?? 3) <= 2) {
    score -= 10;
    flags.push("LOW_CREDIBILITY_SOURCE");
    reasons.push("来源可信度档位较低（-10）");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, flags, reasons };
}

export const QUALITY_LEVELS = [
  { min: 75, label: "较好", color: "#16a34a" },
  { min: 55, label: "一般", color: "#ca8a04" },
  { min: 0, label: "待核实", color: "#dc2626" },
] as const;

export function qualityLevel(score: number) {
  return QUALITY_LEVELS.find((level) => score >= level.min) ?? QUALITY_LEVELS[2];
}
