import { prisma } from "@/lib/db";
import { runStructured } from "@/lib/ai/orchestrator";
import { EVENT_ANALYSIS_SCHEMA } from "@/lib/llm/provider";
import {
  buildRuleEventAnalysis,
  normalizeAnalysisArticleIds,
  toAnalysisPayload,
  type AnalysisArticleInput,
} from "@/lib/rules/event-analysis";
import type {
  ArticleClaim,
  ArticleEventType,
  EventAnalysis,
  ExtractedEntity,
  KeyNumber,
  LLMMode,
  TopicKind,
} from "@/lib/types/domain";
import { getAiSettings, getLLMMode } from "./settings";

/**
 * 事件级分析：规则分析始终可算，LLM 只负责把同一批材料组织得更好。
 *
 * 设计要点：
 * - 分析结果落库到 Event.analysis，事件页与 API 共享同一份结论；
 * - `analysis.evidenceHash` 记录生成时的事件成员指纹，成员变化后自动重算；
 * - LLM 输出经过 schema、合规后置校验与“引用必须属于本事件”的业务校验，
 *   任何一步失败都退回规则分析，页面不会空白；
 * - 写库时记录 analysisMode，便于前端标注“规则分析 / 模型整理”。
 */

const ANALYSIS_INCLUDE = {
  source: { select: { id: true, name: true, credibility: true, kind: true } },
  topics: { include: { topic: { select: { slug: true, name: true, kind: true } } } },
} as const;

interface AnalysisArticleRow {
  id: string;
  title: string;
  summary: string;
  content: string | null;
  url: string | null;
  publishedAt: Date;
  qualityScore: number;
  eventType: string;
  entities: string;
  keyNumbers: string;
  claims: string;
  source: { name: string; credibility: number };
  topics: { topic: { name: string; kind: string } }[];
}

interface AnalysisEventRow {
  id: string;
  title: string;
  eventType: string;
  evidenceHash: string | null;
  analysis: string;
  analysisMode: string;
  articles: AnalysisArticleRow[];
}

export interface EventAnalysisResult {
  analysis: EventAnalysis;
  /** 本次实际采用的模式：llm 表示模型成功，fallback / mock 表示规则分析 */
  mode: LLMMode;
  cached: boolean;
  fallbackReason?: string;
}

function parseList<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function toArticleInput(article: AnalysisArticleRow): AnalysisArticleInput {
  return {
    id: article.id,
    title: article.title,
    summary: article.summary,
    publishedAt: article.publishedAt.toISOString(),
    url: article.url,
    sourceName: article.source.name,
    sourceCredibility: article.source.credibility,
    qualityScore: article.qualityScore,
    eventType: article.eventType as ArticleEventType,
    entities: parseList<ExtractedEntity>(article.entities),
    keyNumbers: parseList<KeyNumber>(article.keyNumbers),
    claims: parseList<ArticleClaim>(article.claims),
    topics: article.topics.map((item) => ({
      name: item.topic.name,
      kind: item.topic.kind as TopicKind,
    })),
  };
}

function parseStoredAnalysis(raw: string): EventAnalysis | null {
  if (!raw || raw === "{}") return null;
  try {
    const value = JSON.parse(raw) as EventAnalysis;
    if (!value || typeof value.headline !== "string" || !Array.isArray(value.consensus)) return null;
    return value;
  } catch {
    return null;
  }
}

function citedIdsOf(analysis: EventAnalysis): string[] {
  const ids = new Set<string>();
  for (const point of analysis.consensus) point.articleIds.forEach((id) => ids.add(id));
  for (const disagreement of analysis.disagreements) {
    for (const position of disagreement.positions) position.articleIds.forEach((id) => ids.add(id));
  }
  for (const item of analysis.timeline) if (item.articleId) ids.add(item.articleId);
  for (const number of analysis.keyNumbers) if (number.articleId) ids.add(number.articleId);
  return [...ids];
}

async function analyzeWithArticles(
  event: AnalysisEventRow,
  options: { force?: boolean; mode?: LLMMode } = {},
): Promise<EventAnalysisResult> {
  const articles = event.articles
    .slice()
    .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())
    .map(toArticleInput);
  const validIds = new Set(articles.map((article) => article.id));
  const ruleAnalysis = buildRuleEventAnalysis({ eventTitle: event.title, articles });
  const mode = options.mode ?? (await getLLMMode());
  const ai = await getAiSettings();

  const payload = {
    eventId: event.id,
    eventTitle: event.title,
    eventType: event.eventType,
    articleCount: articles.length,
    sourceCount: new Set(articles.map((article) => article.sourceName)).size,
    grouping: ruleAnalysis.grouping,
    topics: [...new Set(articles.flatMap((article) => (article.topics ?? []).map((topic) => topic.name)))].slice(0, 8),
    // 控制单次 prompt 体积：事件成员通常 2–6 篇，超出时取最早与最新之外的前 8 篇。
    articles: articles.slice(0, 8).map(toAnalysisPayload),
  };

  const result = await runStructured<EventAnalysis>({
    task: "event_analysis",
    schema: EVENT_ANALYSIS_SCHEMA,
    payload,
    fallback: () => ruleAnalysis,
    mode,
    cacheTtlMs: options.force ? 0 : ai.cacheTtlHours * 3_600_000,
    ref: { type: "event", id: event.id },
    validate: (data) => {
      const cited = citedIdsOf(data);
      const outside = cited.filter((id) => !validIds.has(id));
      if (outside.length > 0) {
        throw new Error(`引用了不属于本事件的文章：${outside.join("、")}`);
      }
      return data;
    },
  });

  let analysis: EventAnalysis;
  if (result.meta.mode === "llm") {
    const raw = result.data as EventAnalysis & { groupingReason?: string };
    analysis = normalizeAnalysisArticleIds(
      {
        ...raw,
        grouping: ruleAnalysis.grouping
          ? {
              ...ruleAnalysis.grouping,
              reason: raw.groupingReason?.trim() || ruleAnalysis.grouping.reason,
            }
          : undefined,
      },
      validIds,
    );
    // 模型没有给出可用共识时，用规则结论兜底，避免页面出现空卡。
    if (analysis.consensus.length === 0) analysis.consensus = ruleAnalysis.consensus;
  } else {
    analysis = ruleAnalysis;
  }

  const stored: EventAnalysis = {
    ...analysis,
    evidenceHash: event.evidenceHash ?? undefined,
    generatedAt: new Date().toISOString(),
  };

  await prisma.event.update({
    where: { id: event.id },
    data: {
      analysis: JSON.stringify(stored),
      analysisMode: result.meta.mode,
      analysisAt: new Date(),
    },
  });

  return {
    analysis: stored,
    mode: result.meta.mode,
    cached: result.cached,
    fallbackReason: result.meta.reason,
  };
}

async function loadEvent(eventId: string): Promise<AnalysisEventRow | null> {
  return prisma.event.findUnique({
    where: { id: eventId },
    include: {
      articles: { include: ANALYSIS_INCLUDE, orderBy: { publishedAt: "asc" } },
    },
  });
}

/**
 * 读取事件分析；没有、成员变化、模式升级或 force 时重算并落库。
 * 事件页 GET 直接调用它，因此首次打开事件就会得到完整分析。
 */
export async function ensureEventAnalysis(
  eventId: string,
  options: { force?: boolean; mode?: LLMMode } = {},
): Promise<EventAnalysisResult | null> {
  const event = await loadEvent(eventId);
  if (!event) return null;

  const stored = parseStoredAnalysis(event.analysis);
  const mode = options.mode ?? (await getLLMMode());
  const fresh =
    !options.force &&
    stored !== null &&
    stored.evidenceHash === (event.evidenceHash ?? undefined) &&
    (mode !== "llm" || event.analysisMode === "llm");
  if (fresh) {
    return {
      analysis: stored,
      mode: event.analysisMode as LLMMode,
      cached: true,
    };
  }

  return analyzeWithArticles(event, options);
}

/**
 * 批量重算（供 recluster / seed / 手动刷新使用）。
 * 只处理最近活跃的前 limit 个事件，避免一次刷新把预算耗尽。
 */
export async function ensureEventAnalyses(
  options: { limit?: number; force?: boolean } = {},
): Promise<{ analyzed: number; failed: number }> {
  const take = Math.min(Math.max(options.limit ?? 6, 0), 20);
  if (take === 0) return { analyzed: 0, failed: 0 };

  const events = await prisma.event.findMany({
    select: { id: true },
    orderBy: { lastSeenAt: "desc" },
    take,
  });

  let analyzed = 0;
  let failed = 0;
  for (const event of events) {
    try {
      await ensureEventAnalysis(event.id, { force: options.force });
      analyzed += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[analysis] 事件 ${event.id} 分析失败：`, error);
    }
  }
  return { analyzed, failed };
}
