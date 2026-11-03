import type { ArticleLike, TopicKind, TopicLike } from "@/lib/types/domain";
import { countMatches } from "./text";

export interface TopicMatch {
  topic: TopicLike;
  score: number;
  hits: string[];
}

export interface MatchOptions {
  /** 标题命中权重（默认 2） */
  titleWeight?: number;
  /** 分数归一化分母（默认 4） */
  divisor?: number;
}

/**
 * 主题匹配：标题权重高于正文，score = min(1, (titleHits*w + bodyHits) / divisor)。
 * 只做关键词层面的相关性判断，不含语义模型。
 */
export function matchTopics(
  article: Pick<ArticleLike, "title" | "summary" | "content">,
  topics: TopicLike[],
  options: MatchOptions = {},
): TopicMatch[] {
  const titleWeight = options.titleWeight ?? 2;
  const divisor = options.divisor ?? 4;
  const body = `${article.summary ?? ""}\n${article.content ?? ""}`;

  const matches: TopicMatch[] = [];
  for (const topic of topics) {
    if (!topic.keywords || topic.keywords.length === 0) continue;
    const titleHits = countMatches(article.title ?? "", topic.keywords).hits;
    const bodyHits = countMatches(body, topic.keywords).hits.filter((hit) => !titleHits.includes(hit));
    const weight = titleHits.length * titleWeight + bodyHits.length;
    if (weight <= 0) continue;
    const score = Math.min(1, weight / divisor);
    matches.push({ topic, score, hits: [...titleHits, ...bodyHits] });
  }

  return matches.sort((a, b) => b.score - a.score);
}

/** 主题种类 → 影响维度（用于文章详情的影响维度展示） */
export function impactDimensionsFromTopics(topics: { kind: TopicKind }[]): string[] {
  const mapping: Record<TopicKind, string> = {
    macro: "宏观",
    industry: "行业",
    company: "公司",
    fx: "汇率",
    policy: "政策",
    commodity: "行业",
  };
  const dims = new Set<string>();
  for (const topic of topics) dims.add(mapping[topic.kind]);
  return [...dims];
}

export function topicSlugsOf(matches: TopicMatch[]): string[] {
  return matches.map((match) => match.topic.slug);
}
