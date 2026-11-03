import { prisma } from "@/lib/db";
import { DEMO_ARTICLES_BY_SOURCE, DEMO_SOURCES } from "@/lib/demo/dataset";
import { clusterArticles, type ClusterInput } from "@/lib/rules/cluster";
import { extractArticle, inferCurrency, inferRegion } from "@/lib/rules/extract";
import { scoreQuality } from "@/lib/rules/quality";
import { analyzeSentiment } from "@/lib/rules/sentiment";
import { hashString, normalizeTitle } from "@/lib/rules/text";
import { impactDimensionsFromTopics, matchTopics } from "@/lib/rules/topics";
import type {
  ArticleClaim,
  ArticleEventType,
  ArticleLike,
  ExtractedEntity,
  KeyNumber,
  Sentiment,
  TopicKind,
  TopicLike,
} from "@/lib/types/domain";
import { FeedError, fetchFeed } from "@/lib/ingest/feed";
import { mockArticleExtractionBatch, mockEventSummary } from "@/lib/llm/mock";
import { ARTICLE_EXTRACTION_BATCH_SCHEMA, EVENT_SUMMARY_SCHEMA } from "@/lib/llm/provider";
import { runTask } from "@/lib/llm/provider";
import { runStructured } from "@/lib/ai/orchestrator";
import { ensureEventAnalyses } from "./analysis";
import { getAiSettings, getLLMMode } from "./settings";

export interface ArticleDTO {
  id: string;
  title: string;
  summary: string;
  content: string | null;
  url: string | null;
  publishedAt: string;
  source: { id: string; name: string; credibility: number; kind: string };
  region: string;
  currency: string | null;
  sentiment: string;
  impactDims: string[];
  qualityScore: number;
  qualityFlags: string[];
  eventId: string | null;
  /** 规则/模型抽取出的实体、事件类型、关键数值与主张，供聚类、事件分析与来源对照使用 */
  entities: ExtractedEntity[];
  eventType: ArticleEventType;
  keyNumbers: KeyNumber[];
  claims: ArticleClaim[];
  extractionMode: string;
  topics: { slug: string; name: string; kind: TopicKind; score: number; hits: string[] }[];
}

export function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

export function parseJsonValue<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

type ArticleWithRelations = {
  id: string;
  title: string;
  summary: string;
  content: string | null;
  url: string | null;
  publishedAt: Date;
  region: string;
  currency: string | null;
  sentiment: string;
  impactDims: string;
  qualityScore: number;
  qualityFlags: string;
  eventId: string | null;
  entities: string;
  eventType: string;
  keyNumbers: string;
  claims: string;
  extractionMode: string;
  source: { id: string; name: string; credibility: number; kind: string };
  topics: { score: number; hits: string; topic: { slug: string; name: string; kind: string } }[];
};

export function serializeArticle(article: ArticleWithRelations): ArticleDTO {
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    content: article.content,
    url: article.url,
    publishedAt: article.publishedAt.toISOString(),
    source: {
      id: article.source.id,
      name: article.source.name,
      credibility: article.source.credibility,
      kind: article.source.kind,
    },
    region: article.region,
    currency: article.currency,
    sentiment: article.sentiment,
    impactDims: parseJsonArray(article.impactDims),
    qualityScore: article.qualityScore,
    qualityFlags: parseJsonArray(article.qualityFlags),
    eventId: article.eventId,
    entities: parseJsonValue<ExtractedEntity[]>(article.entities, []),
    eventType: article.eventType as ArticleEventType,
    keyNumbers: parseJsonValue<KeyNumber[]>(article.keyNumbers, []),
    claims: parseJsonValue<ArticleClaim[]>(article.claims, []),
    extractionMode: article.extractionMode,
    topics: article.topics.map((item) => ({
      slug: item.topic.slug,
      name: item.topic.name,
      kind: item.topic.kind as TopicKind,
      score: item.score,
      hits: parseJsonArray(item.hits),
    })),
  };
}

export const ARTICLE_INCLUDE = {
  source: { select: { id: true, name: true, credibility: true, kind: true } },
  topics: { include: { topic: { select: { slug: true, name: true, kind: true } } } },
} as const;

export interface RefreshDetail {
  sourceId: string;
  name: string;
  added: number;
  skipped: number;
  status: "ok" | "empty" | "error" | "skipped";
  error?: string;
}

export interface RefreshResult {
  sources: number;
  added: number;
  skipped: number;
  errors: number;
  /** 本轮用模型升级抽取的文章数（规则结果被替换的数量） */
  extracted: number;
  events: number;
  mode: "mock" | "llm" | "fallback";
  details: RefreshDetail[];
}

interface IngestDraft {
  title: string;
  summary: string;
  content: string | null;
  url: string | null;
  publishedAt: Date;
  region: string;
  currency: string | null;
  isDemo: boolean;
}

type IngestOutcome = { status: "added" | "skipped"; id?: string };

/** 单条入库：去重 → 规则抽取 → 主题匹配 → 质量分/情绪 → 写库。 */
async function ingestDraft(
  source: { id: string; credibility: number },
  topicLikes: TopicLike[],
  draft: IngestDraft,
): Promise<IngestOutcome> {
  const contentHash = hashString(`${source.id}|${normalizeTitle(draft.title)}`);
  const exists = await prisma.article.findUnique({ where: { contentHash }, select: { id: true } });
  if (exists) return { status: "skipped" };

  const matches = matchTopics(
    { title: draft.title, summary: draft.summary, content: draft.content },
    topicLikes,
  );
  const matchedTopics = matches.slice(0, 4);
  const quality = scoreQuality({
    title: draft.title,
    summary: draft.summary,
    content: draft.content,
    url: draft.url,
    publishedAt: draft.publishedAt,
    sourceCredibility: source.credibility,
  });
  const sentiment = analyzeSentiment(`${draft.title}${draft.summary}`);
  const extraction = extractArticle({
    title: draft.title,
    summary: draft.summary,
    content: draft.content,
  });

  const created = await prisma.article.create({
    data: {
      sourceId: source.id,
      title: draft.title,
      summary: draft.summary,
      content: draft.content,
      url: draft.url,
      publishedAt: draft.publishedAt,
      region: draft.region,
      currency: draft.currency,
      sentiment: sentiment.sentiment,
      impactDims: JSON.stringify(impactDimensionsFromTopics(matchedTopics.map((m) => m.topic))),
      qualityScore: quality.score,
      qualityFlags: JSON.stringify(quality.flags),
      contentHash,
      isDemo: draft.isDemo,
      entities: JSON.stringify(extraction.entities),
      eventType: extraction.eventType,
      keyNumbers: JSON.stringify(extraction.keyNumbers),
      claims: JSON.stringify(extraction.claims),
      extractionMode: "rule",
      extractedAt: new Date(),
      topics: {
        create: matchedTopics.map((match) => ({
          topicId: match.topic.id as string,
          score: match.score,
          hits: JSON.stringify(match.hits),
        })),
      },
    },
    select: { id: true },
  });
  return { status: "added", id: created.id };
}

/**
 * 刷新信息源。
 * - 内置样例源：读取随仓库分发的样例集，不联网，保证离线也能跑通全链路；
 * - HTTP 源：真实抓取 RSS / Atom / JSON，单源失败只记录到 lastError，不影响其它源；
 * - 去重键 =「来源 + 归一化标题」，同一事件的多家报道会被保留，交给聚类层合并。
 */
export async function refreshSources(sourceIds?: string[]): Promise<RefreshResult> {
  const sources = await prisma.source.findMany({
    where: sourceIds && sourceIds.length > 0 ? { id: { in: sourceIds } } : { enabled: true },
    orderBy: { createdAt: "asc" },
  });
  const topics = await prisma.topic.findMany();
  const topicLikes: TopicLike[] = topics.map((topic) => ({
    id: topic.id,
    slug: topic.slug,
    name: topic.name,
    kind: topic.kind as TopicKind,
    keywords: parseJsonArray(topic.keywords),
    color: topic.color,
    followed: topic.followed,
  }));

  const demoKeyByName = new Map(DEMO_SOURCES.map((source) => [source.name, source.key]));
  const details: RefreshDetail[] = [];
  const addedIds: string[] = [];
  let added = 0;
  let skipped = 0;
  let errors = 0;

  for (const source of sources) {
    let drafts: IngestDraft[] = [];
    let status: RefreshDetail["status"] = "ok";
    let error: string | undefined;

    if (source.isSample) {
      const demoKey = demoKeyByName.get(source.name);
      const demoArticles = demoKey ? (DEMO_ARTICLES_BY_SOURCE.get(demoKey) ?? []) : [];
      drafts = demoArticles.map((demo) => ({
        title: demo.title,
        summary: demo.summary,
        content: demo.content,
        url: demo.url,
        publishedAt: new Date(Date.now() - demo.minutesAgo * 60_000),
        region: demo.region,
        currency: demo.currency,
        isDemo: true,
      }));
    } else if (source.kind === "MANUAL" || !source.url) {
      status = "skipped";
      error = "手动信息源不参与自动抓取";
    } else {
      try {
        const feed = await fetchFeed(source);
        drafts = feed.items.map((item) => {
          const text = `${item.title}${item.summary}`;
          return {
            title: item.title,
            summary: item.summary,
            content: item.content,
            url: item.url,
            publishedAt: item.publishedAt,
            region: inferRegion(text),
            currency: inferCurrency(text),
            isDemo: false,
          };
        });
      } catch (caught) {
        status = "error";
        error = caught instanceof FeedError ? caught.reason : (caught as Error).message;
      }
    }

    let sourceAdded = 0;
    let sourceSkipped = 0;
    if (status !== "skipped" && status !== "error") {
      for (const draft of drafts) {
        const result = await ingestDraft(source, topicLikes, draft);
        if (result.status === "added") {
          sourceAdded += 1;
          if (result.id) addedIds.push(result.id);
        } else {
          sourceSkipped += 1;
        }
      }
      if (drafts.length === 0) status = "empty";
    }
    if (status === "error") errors += 1;

    await prisma.source.update({
      where: { id: source.id },
      data: {
        lastFetchedAt: new Date(),
        lastStatus: status === "error" ? "error" : sourceAdded > 0 || sourceSkipped > 0 ? "ok" : "empty",
        lastError: error ?? null,
      },
    });

    added += sourceAdded;
    skipped += sourceSkipped;
    details.push({ sourceId: source.id, name: source.name, added: sourceAdded, skipped: sourceSkipped, status, ...(error ? { error } : {}) });
  }

  const aiSettings = await getAiSettings();
  let extracted = 0;
  if (addedIds.length > 0 && aiSettings.autoAnalyze) {
    const enrichment = await enrichArticleExtractions({
      articleIds: addedIds,
      limit: aiSettings.maxExtractionsPerRefresh,
      cacheTtlMs: aiSettings.cacheTtlHours * 3_600_000,
    });
    extracted = enrichment.upgraded;
  }

  const reclusterResult = added > 0 ? await recluster({ enhanceWithLLM: true }) : { events: 0 };

  return {
    sources: sources.length,
    added,
    skipped,
    errors,
    extracted,
    events: reclusterResult.events,
    mode: (await getLLMMode()) as RefreshResult["mode"],
    details,
  };
}

/**
 * 用模型批量升级文章抽取结果（每批最多 4 篇）。
 *
 * 只有在 llm 模式且配置完整时才真正写回；任何降级（未配置、超时、schema 不符）
 * 都保留规则抽取结果，避免把 extractionMode 标成 llm 而实际用的是模板。
 */
export async function enrichArticleExtractions(
  options: { articleIds?: string[]; limit?: number; cacheTtlMs?: number } = {},
): Promise<{ attempted: number; upgraded: number }> {
  const mode = await getLLMMode();
  if (mode !== "llm") return { attempted: 0, upgraded: 0 };

  const limit = Math.max(1, Math.min(20, options.limit ?? 8));
  const rows = await prisma.article.findMany({
    where:
      options.articleIds && options.articleIds.length > 0
        ? { id: { in: options.articleIds } }
        : { extractionMode: { not: "llm" } },
    include: { source: { select: { name: true } } },
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
  if (rows.length === 0) return { attempted: 0, upgraded: 0 };

  const aiSettings = await getAiSettings();
  const cacheTtlMs = options.cacheTtlMs ?? aiSettings.cacheTtlHours * 3_600_000;
  let upgraded = 0;

  for (let start = 0; start < rows.length; start += 4) {
    const batch = rows.slice(start, start + 4);
    const articles = batch.map((row, index) => ({
      index,
      title: row.title,
      summary: row.summary,
      content: row.content ? row.content.slice(0, 900) : null,
      sourceName: row.source.name,
      publishedAt: row.publishedAt.toISOString(),
    }));

    const result = await runStructured({
      task: "article_extract",
      schema: ARTICLE_EXTRACTION_BATCH_SCHEMA,
      payload: { articles },
      fallback: () => mockArticleExtractionBatch({ articles }),
      mode,
      cacheTtlMs,
      ref: {
        type: batch.length === 1 ? "article" : "article_batch",
        id: batch.map((row) => row.id).join(","),
      },
      validate: (data) => {
        const seen = new Set(data.items.map((item) => item.index));
        if (seen.size !== batch.length || data.items.length !== batch.length) {
          throw new Error("抽取结果条数与输入不一致");
        }
        return data;
      },
    });

    if (result.meta.mode !== "llm") continue;

    for (const item of result.data.items) {
      const row = batch[item.index];
      if (!row) continue;
      await prisma.article.update({
        where: { id: row.id },
        data: {
          entities: JSON.stringify(item.entities),
          eventType: item.eventType,
          keyNumbers: JSON.stringify(item.keyNumbers),
          claims: JSON.stringify(item.claims),
          extractionMode: "llm",
          extractedAt: new Date(),
        },
      });
      upgraded += 1;
    }
  }

  return { attempted: rows.length, upgraded };
}

function toClusterInput(article: ArticleWithRelations, sourceCredibility: number): ClusterInput {
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    content: article.content,
    url: article.url,
    publishedAt: article.publishedAt,
    region: article.region,
    currency: article.currency,
    sourceId: article.source.id,
    sourceName: article.source.name,
    sourceCredibility,
    qualityScore: article.qualityScore,
    sentiment: article.sentiment as Sentiment,
    entities: parseJsonValue<ExtractedEntity[]>(article.entities, []),
    eventType: article.eventType as ArticleEventType,
    claims: parseJsonValue<ArticleClaim[]>(article.claims, []),
    topics: article.topics.map((item) => ({
      slug: item.topic.slug,
      name: item.topic.name,
      score: item.score,
      kind: item.topic.kind as TopicKind,
    })),
  };
}

export interface ReclusterResult {
  events: number;
  assigned: number;
}

/**
 * 全量重聚类并持久化 Event。
 * 事件是“可解释的中间产物”：同一批文章重跑得到相同 signature，便于测试与复现。
 */
export async function recluster(options: { enhanceWithLLM?: boolean } = {}): Promise<ReclusterResult> {
  const articles = await prisma.article.findMany({
    include: ARTICLE_INCLUDE,
    orderBy: { publishedAt: "desc" },
  });

  const inputs = articles.map((article) => toClusterInput(article, article.source.credibility));
  const clusters = clusterArticles(inputs);
  const signatures = clusters.map((cluster) => cluster.signature);

  if (signatures.length === 0) {
    await prisma.event.deleteMany();
    return { events: 0, assigned: 0 };
  }

  await prisma.event.deleteMany({ where: { signature: { notIn: signatures } } });

  let assigned = 0;
  for (const cluster of clusters) {
    const memberRows = cluster.memberIndexes.flatMap((index) => {
      const row = articles[index];
      return row ? [row] : [];
    });
    const evidenceHash = hashString(
      memberRows
        .map((row) => `${row.id}:${normalizeTitle(row.title)}`)
        .sort()
        .join("|"),
    );

    const event = await prisma.event.upsert({
      where: { signature: cluster.signature },
      create: {
        signature: cluster.signature,
        title: cluster.title.slice(0, 120),
        summary: cluster.summary,
        themes: JSON.stringify(cluster.themes),
        industries: JSON.stringify(cluster.industries),
        regions: JSON.stringify(cluster.regions),
        currencies: JSON.stringify(cluster.currencies),
        sentiment: cluster.sentiment,
        articleCount: cluster.articleCount,
        sourceCount: cluster.sourceCount,
        credibility: cluster.credibility,
        completeness: cluster.completeness,
        eventType: cluster.eventType,
        entities: JSON.stringify(cluster.entities),
        evidenceHash,
        firstSeenAt: new Date(cluster.firstSeenAt),
        lastSeenAt: new Date(cluster.lastSeenAt),
      },
      update: {
        title: cluster.title.slice(0, 120),
        summary: cluster.summary,
        themes: JSON.stringify(cluster.themes),
        industries: JSON.stringify(cluster.industries),
        regions: JSON.stringify(cluster.regions),
        currencies: JSON.stringify(cluster.currencies),
        sentiment: cluster.sentiment,
        articleCount: cluster.articleCount,
        sourceCount: cluster.sourceCount,
        credibility: cluster.credibility,
        completeness: cluster.completeness,
        eventType: cluster.eventType,
        entities: JSON.stringify(cluster.entities),
        evidenceHash,
        firstSeenAt: new Date(cluster.firstSeenAt),
        lastSeenAt: new Date(cluster.lastSeenAt),
      },
    });

    const memberIds = cluster.memberIndexes
      .map((index) => articles[index]?.id)
      .filter((id): id is string => Boolean(id));
    if (memberIds.length > 0) {
      await prisma.article.updateMany({ where: { id: { in: memberIds } }, data: { eventId: event.id } });
      assigned += memberIds.length;
    }
  }

  if (options.enhanceWithLLM) {
    await enhanceEventSummaries(clusters.slice(0, 3));
  }

  // 事件分析是“可直接展示”的结论：规则模式也生成，成员变化后自动重算。
  // 规则分析不消耗模型预算，可以覆盖全部事件；llm 模式受设置页数量限制。
  const ai = await getAiSettings();
  if (ai.autoAnalyze) {
    const mode = await getLLMMode();
    await ensureEventAnalyses({ limit: mode === "llm" ? ai.maxAnalysesPerRefresh : 20 });
  }

  return { events: clusters.length, assigned };
}

/** LLM 模式下的可选增强：只对前 3 个事件调用，失败自动回落到规则摘要 */
async function enhanceEventSummaries(
  clusters: { signature: string; title: string; summary: string; themes: string[] }[],
): Promise<void> {
  const mode = await getLLMMode();
  if (mode !== "llm") return;

  for (const cluster of clusters) {
    const event = await prisma.event.findUnique({ where: { signature: cluster.signature } });
    if (!event) continue;
    const articles = await prisma.article.findMany({
      where: { eventId: event.id },
      include: { source: { select: { name: true } } },
      take: 5,
    });

    const result = await runTask({
      task: "event_summary",
      mode,
      payload: {
        articles: articles.map((article) => ({
          title: article.title,
          summary: article.summary,
          sourceName: article.source.name,
          publishedAt: article.publishedAt.toISOString(),
        })),
        topicNames: cluster.themes,
        regions: [...new Set(articles.map((article) => article.region))],
        currencies: [...new Set(articles.map((article) => article.currency).filter(Boolean))],
      },
      schema: EVENT_SUMMARY_SCHEMA,
      fallback: () =>
        mockEventSummary({
          articles: articles.map((article) => ({
            title: article.title,
            summary: article.summary,
            sourceName: article.source.name,
          })),
          topicNames: cluster.themes,
          regions: [...new Set(articles.map((article) => article.region))],
          currencies: [...new Set(articles.map((article) => article.currency).filter(Boolean) as string[])],
        }),
    });

    await prisma.event.update({
      where: { id: event.id },
      data: {
        title: result.data.title.slice(0, 120),
        summary: result.data.summary,
        themes: JSON.stringify(result.data.themes),
        industries: JSON.stringify(result.data.industries),
        regions: JSON.stringify(result.data.regions),
        currencies: JSON.stringify(result.data.currencies),
      },
    });
  }
}

export interface EventDTO {
  id: string;
  signature: string;
  title: string;
  summary: string;
  themes: string[];
  industries: string[];
  regions: string[];
  currencies: string[];
  sentiment: string;
  articleCount: number;
  sourceCount: number;
  credibility: number;
  completeness: number;
  eventType: ArticleEventType;
  entities: ExtractedEntity[];
  analysisMode: string;
  analysisAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export function serializeEvent(row: {
  id: string;
  signature: string;
  title: string;
  summary: string;
  themes: string;
  industries: string;
  regions: string;
  currencies: string;
  sentiment: string;
  articleCount: number;
  sourceCount: number;
  credibility: number;
  completeness: number;
  eventType: string;
  entities: string;
  analysisMode: string;
  analysisAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}): EventDTO {
  return {
    id: row.id,
    signature: row.signature,
    title: row.title,
    summary: row.summary,
    themes: parseJsonArray(row.themes),
    industries: parseJsonArray(row.industries),
    regions: parseJsonArray(row.regions),
    currencies: parseJsonArray(row.currencies),
    sentiment: row.sentiment,
    articleCount: row.articleCount,
    sourceCount: row.sourceCount,
    credibility: row.credibility,
    completeness: row.completeness,
    eventType: row.eventType as ArticleEventType,
    entities: parseJsonValue<ExtractedEntity[]>(row.entities, []),
    analysisMode: row.analysisMode,
    analysisAt: row.analysisAt ? row.analysisAt.toISOString() : null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

export async function listEvents(limit = 20) {
  const rows = await prisma.event.findMany({ orderBy: { lastSeenAt: "desc" }, take: limit });
  return rows.map(serializeEvent);
}

export async function listArticles(options: {
  q?: string;
  topic?: string;
  eventId?: string;
  limit?: number;
}): Promise<{ items: ArticleDTO[]; total: number }> {
  const where: Record<string, unknown> = {};
  if (options.topic) where.topics = { some: { topic: { slug: options.topic } } };
  if (options.eventId) where.eventId = options.eventId;
  if (options.q) {
    where.OR = [
      { title: { contains: options.q } },
      { summary: { contains: options.q } },
    ];
  }

  const take = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const [rows, total] = await Promise.all([
    prisma.article.findMany({
      where,
      include: ARTICLE_INCLUDE,
      orderBy: { publishedAt: "desc" },
      take,
    }),
    prisma.article.count({ where }),
  ]);

  return {
    items: rows.map((row) => serializeArticle(row as unknown as ArticleWithRelations)),
    total,
  };
}
