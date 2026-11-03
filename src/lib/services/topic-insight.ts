import { prisma } from "@/lib/db";
import { runStructured } from "@/lib/ai/orchestrator";
import { TOPIC_DIGEST_SCHEMA } from "@/lib/llm/provider";
import { mockTopicDigest, type TopicDigestInput, type TopicDigestOutput } from "@/lib/llm/mock";
import { ARTICLE_EVENT_TYPE_LABELS } from "@/lib/rules/extract";
import type { ArticleEventType, ExtractedEntity, KeyNumber, LLMMode, TopicKind } from "@/lib/types/domain";
import { getAiSettings, getLLMMode } from "@/lib/services/settings";

export const TOPIC_INSIGHT_NOTE =
  "主题洞察只对窗口内的材料做归集与对照，不判断趋势方向，也不构成任何交易或配置建议。";

export interface TopicInsight {
  topic: { id: string; slug: string; name: string; kind: TopicKind; followed: boolean; color: string };
  windowDays: number;
  stats: { articles: number; events: number; sources: number; avgCredibility: number; avgQuality: number };
  eventTypes: { type: ArticleEventType; label: string; count: number }[];
  entities: { name: string; type: string; count: number }[];
  relatedTopics: { slug: string; name: string; kind: TopicKind; count: number }[];
  keyNumbers: { label: string; value: number; unit: string; articleId: string; sourceName: string; publishedAt: string }[];
  timeline: { date: string; count: number }[];
  gaps: string[];
  digest: TopicDigestOutput & { mode: LLMMode };
  note: string;
}

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function textGaps(input: {
  articles: number;
  sources: number;
  avgQuality: number;
  withEvent: number;
  keyNumberCount: number;
  maxCredibility: number;
}): string[] {
  const gaps: string[] = [];
  if (input.articles === 0) return ["窗口内没有相关资讯，建议刷新信息源或扩大时间窗口。"];
  if (input.sources <= 1) gaps.push("窗口内只有单一来源，交叉验证不足。");
  if (input.withEvent / Math.max(1, input.articles) < 0.6) gaps.push("部分资讯尚未归入事件，事件级对照不完整。");
  if (input.keyNumberCount === 0) gaps.push("材料中缺少可核对的关键数值。");
  if (input.avgQuality < 55) gaps.push("窗口内资讯的平均质量分偏低，建议优先核对原文。");
  if (input.maxCredibility <= 2) gaps.push("最高来源档位偏低，结论需要更多来源支持。");
  return gaps.slice(0, 4);
}

/**
 * 主题级洞察：文章 → 事件类型 / 实体 / 数值 / 关联主题 / 缺口。
 * 规则统计始终生成；配置模型时额外走 topic_digest 生成一段观察，失败自动回退。
 */
export async function getTopicInsight(slug: string, options: { days?: number } = {}): Promise<TopicInsight | null> {
  const days = Math.min(90, Math.max(3, Math.trunc(options.days ?? 30)));
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const topic = await prisma.topic.findUnique({ where: { slug } });
  if (!topic) return null;

  const links = await prisma.articleTopic.findMany({
    where: { topicId: topic.id, article: { publishedAt: { gte: since } } },
    include: {
      article: {
        include: { source: { select: { id: true, name: true, credibility: true } } },
      },
    },
    orderBy: { article: { publishedAt: "desc" } },
    take: 120,
  });

  const articles = links.map((link) => link.article);
  const articleIds = articles.map((article) => article.id);
  const eventIds = [...new Set(articles.map((article) => article.eventId).filter((id): id is string => Boolean(id)))];

  const [events, coLinks] = await Promise.all([
    eventIds.length > 0
      ? prisma.event.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, title: true, eventType: true, articleCount: true, credibility: true, lastSeenAt: true },
          orderBy: { lastSeenAt: "desc" },
        })
      : Promise.resolve([]),
    articleIds.length > 0
      ? prisma.articleTopic.findMany({
          where: { articleId: { in: articleIds }, topicId: { not: topic.id } },
          include: { topic: { select: { slug: true, name: true, kind: true } } },
        })
      : Promise.resolve([]),
  ]);

  const eventTypeCount = new Map<ArticleEventType, number>();
  for (const event of events) {
    const type = event.eventType as ArticleEventType;
    eventTypeCount.set(type, (eventTypeCount.get(type) ?? 0) + 1);
  }
  const eventTypes = [...eventTypeCount.entries()]
    .map(([type, count]) => ({ type, label: ARTICLE_EVENT_TYPE_LABELS[type] ?? "其他", count }))
    .sort((a, b) => b.count - a.count);

  const entityCount = new Map<string, { name: string; type: string; count: number }>();
  for (const article of articles) {
    for (const entity of parseJsonArray<ExtractedEntity>(article.entities)) {
      const key = `${entity.type}:${entity.name}`;
      const current = entityCount.get(key);
      if (current) current.count += 1;
      else entityCount.set(key, { name: entity.name, type: entity.type, count: 1 });
    }
  }
  const entities = [...entityCount.values()].sort((a, b) => b.count - a.count).slice(0, 8);

  const relatedCount = new Map<string, { slug: string; name: string; kind: TopicKind; count: number }>();
  for (const link of coLinks) {
    const current = relatedCount.get(link.topic.slug);
    if (current) current.count += 1;
    else relatedCount.set(link.topic.slug, { ...link.topic, kind: link.topic.kind as TopicKind, count: 1 });
  }
  const relatedTopics = [...relatedCount.values()].sort((a, b) => b.count - a.count).slice(0, 6);

  const keyNumbers: TopicInsight["keyNumbers"] = [];
  const seenNumbers = new Set<string>();
  for (const article of articles) {
    for (const number of parseJsonArray<KeyNumber>(article.keyNumbers)) {
      const key = `${number.label}|${number.value}|${number.unit}`;
      if (seenNumbers.has(key)) continue;
      seenNumbers.add(key);
      keyNumbers.push({
        label: number.label,
        value: number.value,
        unit: number.unit,
        articleId: article.id,
        sourceName: article.source.name,
        publishedAt: article.publishedAt.toISOString(),
      });
      if (keyNumbers.length >= 8) break;
    }
    if (keyNumbers.length >= 8) break;
  }

  const timelineMap = new Map<string, number>();
  for (const article of articles) {
    const date = article.publishedAt.toISOString().slice(0, 10);
    timelineMap.set(date, (timelineMap.get(date) ?? 0) + 1);
  }
  const timeline = [...timelineMap.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const sources = new Set(articles.map((article) => article.source.id)).size;
  const avgCredibility = articles.length > 0 ? articles.reduce((sum, article) => sum + article.source.credibility, 0) / articles.length : 0;
  const avgQuality = articles.length > 0 ? articles.reduce((sum, article) => sum + article.qualityScore, 0) / articles.length : 0;
  const withEvent = articles.filter((article) => Boolean(article.eventId)).length;
  const maxCredibility = articles.reduce((max, article) => Math.max(max, article.source.credibility), 0);
  const gaps = textGaps({ articles: articles.length, sources, avgQuality, withEvent, keyNumberCount: keyNumbers.length, maxCredibility });

  const digestInput: TopicDigestInput = {
    topicName: topic.name,
    windowDays: days,
    articleCount: articles.length,
    eventCount: events.length,
    sourceCount: sources,
    eventTypes: eventTypes.map((item) => ({ label: item.label, count: item.count })),
    entities: entities.map((item) => ({ name: item.name, count: item.count })),
    gaps,
  };

  const mode = await getLLMMode();
  let digest: TopicInsight["digest"];
  if (articles.length === 0) {
    digest = { ...mockTopicDigest(digestInput), mode: "mock" };
  } else {
    const ai = await getAiSettings();
    const result = await runStructured<TopicDigestOutput>({
      task: "topic_digest",
      schema: TOPIC_DIGEST_SCHEMA,
      payload: {
        ...digestInput,
        events: events.slice(0, 8).map((event) => ({
          title: event.title,
          eventType: event.eventType,
          articleCount: event.articleCount,
          credibility: event.credibility,
        })),
        keyNumbers: keyNumbers.slice(0, 6),
      },
      fallback: () => mockTopicDigest(digestInput),
      mode,
      cacheTtlMs: ai.cacheTtlHours * 3600 * 1000,
      ref: { type: "topic", id: topic.id },
    });
    digest = { ...result.data, mode: result.meta.mode };
  }

  return {
    topic: {
      id: topic.id,
      slug: topic.slug,
      name: topic.name,
      kind: topic.kind as TopicKind,
      followed: topic.followed,
      color: topic.color,
    },
    windowDays: days,
    stats: {
      articles: articles.length,
      events: events.length,
      sources,
      avgCredibility: round(avgCredibility),
      avgQuality: round(avgQuality),
    },
    eventTypes,
    entities,
    relatedTopics,
    keyNumbers,
    timeline,
    gaps,
    digest,
    note: TOPIC_INSIGHT_NOTE,
  };
}
