import { prisma } from "@/lib/db";
import { RISK_BAND_META, TOPIC_KIND_META } from "@/lib/constants";
import { mockBrief, mockCheckupNarrative } from "@/lib/llm/mock";
import { BRIEF_SCHEMA, CHECKUP_SCHEMA, llmMetaToApi, runTask } from "@/lib/llm/provider";
import { composeBriefMarkdown, composeCheckupMarkdown, reportTitle } from "@/lib/report/markdown";
import { runCheckup } from "@/lib/rules/checkup";
import { mapExposure } from "@/lib/rules/exposure";
import type { ExposureItem, TopicKind, TopicLike } from "@/lib/types/domain";
import { ARTICLE_INCLUDE, listEvents, serializeArticle } from "./intel";
import { getLatestRiskProfile, loadCheckup, loadPortfolio } from "./portfolio";
import { getLLMMode } from "./settings";

export interface ReportDTO {
  id: string;
  type: string;
  title: string;
  markdown: string;
  mode: string;
  createdAt: string;
  payload: unknown;
}

function parsePayload(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function serializeReport(row: {
  id: string;
  type: string;
  title: string;
  markdown: string;
  payload: string | null;
  mode: string;
  createdAt: Date;
}): ReportDTO {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    markdown: row.markdown,
    mode: row.mode,
    createdAt: row.createdAt.toISOString(),
    payload: parsePayload(row.payload),
  };
}

async function followedTopics(slugs?: string[]): Promise<TopicLike[]> {
  const rows = await prisma.topic.findMany({
    where: slugs && slugs.length > 0 ? { slug: { in: slugs } } : { followed: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    kind: row.kind as TopicKind,
    keywords: (() => {
      try {
        const parsed = JSON.parse(row.keywords);
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    })(),
    color: row.color,
    followed: row.followed,
  }));
}

export async function loadExposure(slugs?: string[]): Promise<{
  exposure: ExposureItem[];
  topics: TopicLike[];
}> {
  const [portfolio, topics] = await Promise.all([loadPortfolio(), followedTopics(slugs)]);
  const exposure = mapExposure(portfolio.assets, topics, portfolio.metrics.totalAssetsCny);
  return { exposure, topics };
}

export interface BriefResult {
  report: ReportDTO;
  events: Awaited<ReturnType<typeof listEvents>>;
  exposure: ExposureItem[];
  metrics: Awaited<ReturnType<typeof loadPortfolio>>["metrics"];
  checkup: Awaited<ReturnType<typeof loadCheckup>>["checkup"];
  mode: string;
  degraded: boolean;
  degradeReason?: string;
}

/** 生成周报：情报事件 + 主题动向 + 我的资产结构 + 待办，落库并可导出 Markdown */
export async function generateBrief(options: { topicSlugs?: string[]; days?: number } = {}): Promise<BriefResult> {
  const mode = await getLLMMode();
  const days = Math.min(Math.max(options.days ?? 7, 1), 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [portfolio, riskProfile, events, topics] = await Promise.all([
    loadPortfolio(),
    getLatestRiskProfile(),
    listEvents(20),
    followedTopics(options.topicSlugs),
  ]);

  const topicIds = topics.map((topic) => topic.id).filter((id): id is string => typeof id === "string");
  const topicRows = topicIds.length
    ? await prisma.articleTopic.findMany({
        where: { topicId: { in: topicIds }, article: { publishedAt: { gte: since } } },
        select: { topicId: true },
      })
    : [];
  const countMap = new Map<string, number>();
  for (const row of topicRows) {
    countMap.set(row.topicId, (countMap.get(row.topicId) ?? 0) + 1);
  }

  const checkup = runCheckup(portfolio.metrics, riskProfile?.band ?? null);
  const exposure = mapExposure(portfolio.assets, topics, portfolio.metrics.totalAssetsCny);

  const payload = {
    events: events.map((event) => ({
      title: event.title,
      summary: event.summary,
      articleCount: event.articleCount,
      sourceCount: event.sourceCount,
      credibility: event.credibility,
      themes: event.themes,
    })),
    topics: topics.map((topic) => ({
      name: topic.name,
      kindLabel: TOPIC_KIND_META[topic.kind].label,
      articleCount: (topic.id ? countMap.get(topic.id) : 0) ?? 0,
    })),
    metrics: {
      totalAssetsCny: portfolio.metrics.totalAssetsCny,
      totalLiabilitiesCny: portfolio.metrics.totalLiabilitiesCny,
      netWorthCny: portfolio.metrics.netWorthCny,
      debtRatio: portfolio.metrics.debtRatio,
      topCategoryShare: portfolio.metrics.topCategoryShare,
      hhi: portfolio.metrics.hhi,
      foreignShare: portfolio.metrics.foreignShare,
      emergencyMonths: portfolio.metrics.emergencyMonths,
      completeness: portfolio.metrics.completeness,
      missingFields: portfolio.metrics.missingFields,
    },
    findings: checkup.findings.map((finding) => ({ title: finding.title, level: finding.level, evidence: finding.evidence })),
    exposure: exposure.map((item) => ({
      topicName: item.topic.name,
      share: item.exposureShare,
      assetCount: item.matchedAssets.length,
    })),
  };

  const result = await runTask({
    task: "brief_narrative",
    mode,
    payload,
    schema: BRIEF_SCHEMA,
    fallback: () =>
      mockBrief({
        events: payload.events,
        topics: payload.topics,
        metrics: portfolio.metrics,
        findings: payload.findings,
        exposure: payload.exposure,
      }),
  });

  const generatedAt = new Date();
  const markdown = composeBriefMarkdown({
    headline: result.data.headline,
    sections: result.data.sections,
    todos: result.data.todos,
    events,
    exposure,
    metrics: portfolio.metrics,
    checkup,
    mode: result.meta.mode,
    generatedAt,
  });

  const row = await prisma.report.create({
    data: {
      type: "BRIEF",
      title: reportTitle("BRIEF", generatedAt),
      markdown,
      mode: result.meta.mode,
      payload: JSON.stringify({
        eventIds: events.map((event) => event.id),
        topics: payload.topics,
        metrics: payload.metrics,
        findings: payload.findings,
        exposure: payload.exposure,
        headline: result.data.headline,
        llm: llmMetaToApi(result.meta),
      }),
      citations: JSON.stringify(events.map((event) => ({ id: event.id, label: event.title, type: "event" }))),
    },
  });

  return {
    report: serializeReport(row),
    events,
    exposure,
    metrics: portfolio.metrics,
    checkup,
    mode: result.meta.mode,
    degraded: result.meta.degraded,
    ...(result.meta.reason ? { degradeReason: result.meta.reason } : {}),
  };
}

export interface CheckupReportResult {
  report: ReportDTO;
  metrics: Awaited<ReturnType<typeof loadCheckup>>["metrics"];
  checkup: Awaited<ReturnType<typeof loadCheckup>>["checkup"];
  riskProfile: Awaited<ReturnType<typeof loadCheckup>>["riskProfile"];
  mode: string;
  degraded: boolean;
  degradeReason?: string;
}

export async function generateCheckupReport(): Promise<CheckupReportResult> {
  const mode = await getLLMMode();
  const bundle = await loadCheckup();

  const result = await runTask({
    task: "checkup_narrative",
    mode,
    payload: {
      metrics: bundle.metrics,
      findings: bundle.checkup.findings.map((finding) => ({
        title: finding.title,
        level: finding.level,
        detail: finding.detail,
        evidence: finding.evidence,
      })),
      riskBand: bundle.riskProfile?.band ?? null,
    },
    schema: CHECKUP_SCHEMA,
    fallback: () => mockCheckupNarrative({
      metrics: bundle.metrics,
      checkup: bundle.checkup,
      riskBand: bundle.riskProfile?.band ?? null,
    }),
  });

  const generatedAt = new Date();
  const markdown = composeCheckupMarkdown({
    metrics: bundle.metrics,
    checkup: bundle.checkup,
    riskBandLabel: bundle.riskProfile ? RISK_BAND_META[bundle.riskProfile.band].label : null,
    riskScore: bundle.riskProfile?.score ?? null,
    mode: result.meta.mode,
    generatedAt,
    summary: result.data.summary,
    highlights: result.data.highlights,
    recommendations: result.data.recommendations,
  });

  const row = await prisma.report.create({
    data: {
      type: "CHECKUP",
      title: reportTitle("CHECKUP", generatedAt),
      markdown,
      mode: result.meta.mode,
      payload: JSON.stringify({
        metrics: bundle.metrics,
        findings: bundle.checkup.findings,
        riskBand: bundle.riskProfile?.band ?? null,
        riskScore: bundle.riskProfile?.score ?? null,
        summary: result.data.summary,
        highlights: result.data.highlights,
        recommendations: result.data.recommendations,
        llm: llmMetaToApi(result.meta),
      }),
      citations: JSON.stringify([]),
    },
  });

  return {
    report: serializeReport(row),
    metrics: bundle.metrics,
    checkup: bundle.checkup,
    riskProfile: bundle.riskProfile,
    mode: result.meta.mode,
    degraded: result.meta.degraded,
    ...(result.meta.reason ? { degradeReason: result.meta.reason } : {}),
  };
}

export async function listReports(type?: string): Promise<Omit<ReportDTO, "markdown" | "payload">[]> {
  const rows = await prisma.report.findMany({
    where: type ? { type } : undefined,
    orderBy: { createdAt: "desc" },
    select: { id: true, type: true, title: true, mode: true, createdAt: true },
    take: 50,
  });
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    mode: row.mode,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getReport(id: string): Promise<ReportDTO | null> {
  const row = await prisma.report.findUnique({ where: { id } });
  return row ? serializeReport(row) : null;
}

export async function deleteReport(id: string): Promise<void> {
  await prisma.report.delete({ where: { id } });
}

/** 供简报页预览：最近文章引用（含来源），用于“本期事件”下钻 */
export async function recentCitationArticles(limit = 12) {
  const rows = await prisma.article.findMany({
    include: ARTICLE_INCLUDE,
    orderBy: { publishedAt: "desc" },
    take: limit,
  });
  return rows.map((row) => serializeArticle(row));
}
