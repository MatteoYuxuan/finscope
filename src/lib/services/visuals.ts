import { prisma } from "@/lib/db";
import { runStructured } from "@/lib/ai/orchestrator";
import { mockVisualSelect } from "@/lib/llm/mock";
import { VISUAL_SELECTION_SCHEMA } from "@/lib/llm/provider";
import { DISCLAIMER_ZH } from "@/lib/constants";
import type { ChartSpec, LLMMode } from "@/lib/types/domain";
import {
  buildEventCandidates,
  buildExposureCandidates,
  buildIntelCandidates,
  buildPortfolioCandidates,
  buildTopicCandidates,
  describeCandidates,
  type IntelSourceLike,
  type IntelTopicLike,
  type VisualCandidate,
} from "@/lib/visuals/catalog";
import { ensureEventAnalysis } from "./analysis";
import { listEvents } from "./intel";
import { loadPortfolio } from "./portfolio";
import { loadExposure } from "./report";
import { getAiSettings, getLLMMode } from "./settings";
import { getTopicInsight } from "./topic-insight";

/**
 * 可视化编排：
 *   规则聚合数据 → 候选集 → 模型选择（只选 id）→ 服务端注入完整 spec。
 *
 * 这样模型无法编造图表数据，每张图都能追溯到 DB 字段；
 * 无模型时用确定性模板选择，保证“摘要 + 图表 + 表格/时间线 + 待办”始终成立。
 */

export interface VisualsResult {
  visuals: ChartSpec[];
  mode: LLMMode;
  note: string;
  /** 候选总数，便于前端提示“还有哪些表达可以看” */
  candidateCount: number;
}

const MAX_VISUALS = 4;

async function selectVisuals(candidates: VisualCandidate[], context: string, max = MAX_VISUALS): Promise<VisualsResult> {
  if (candidates.length === 0) {
    return { visuals: [], mode: "mock", note: "当前没有足够数据生成图表，先用文字说明。", candidateCount: 0 };
  }

  const mode = await getLLMMode();
  const ai = await getAiSettings();
  const described = describeCandidates(candidates);
  const ids = new Set(candidates.map((candidate) => candidate.id));

  const result = await runStructured({
    task: "visual_select",
    schema: VISUAL_SELECTION_SCHEMA,
    payload: { context, max, candidates: described },
    mode,
    cacheTtlMs: ai.cacheTtlHours * 3_600_000,
    ref: { type: "visual", id: context.slice(0, 40) },
    fallback: () => mockVisualSelect({ candidates: described, context, max }),
    validate: (data) => {
      const unknown = data.selected.map((item) => item.candidateId).filter((id) => !ids.has(id));
      if (unknown.length > 0) throw new Error(`选择了不存在的图表候选：${unknown.join(", ")}`);
      return data;
    },
  });

  let selected = result.data.selected;
  if (selected.length === 0) {
    selected = mockVisualSelect({ candidates: described, context, max }).selected;
  }

  const seen = new Set<string>();
  const visuals: ChartSpec[] = [];
  for (const item of selected) {
    if (seen.has(item.candidateId)) continue;
    const candidate = candidates.find((entry) => entry.id === item.candidateId);
    if (!candidate) continue;
    seen.add(item.candidateId);
    visuals.push({
      ...candidate.spec,
      rationale: item.reason || candidate.spec.rationale,
      citations: candidate.spec.citations.length > 0 ? candidate.spec.citations : [],
      disclaimer: candidate.spec.disclaimer ?? DISCLAIMER_ZH,
    });
    if (visuals.length >= max) break;
  }

  return {
    visuals,
    mode: result.meta.mode,
    note:
      result.meta.mode === "llm"
        ? `模型从 ${candidates.length} 个候选里选择了 ${visuals.length} 种表达方式。`
        : `按数据特征从 ${candidates.length} 个候选里选择了 ${visuals.length} 种表达方式（规则模式）。`,
    candidateCount: candidates.length,
  };
}

async function intelCandidatesFor(context: { limit?: number } = {}): Promise<{ candidates: VisualCandidate[]; context: string }> {
  const [events, topics, sources, links] = await Promise.all([
    listEvents(context.limit ?? 20),
    prisma.topic.findMany({
      orderBy: { sortOrder: "asc" },
      select: { slug: true, name: true, color: true, _count: { select: { articles: true } } },
    }),
    prisma.source.findMany({
      orderBy: { name: "asc" },
      select: { name: true, kind: true, credibility: true, enabled: true, lastStatus: true, _count: { select: { articles: true } } },
    }),
    prisma.articleTopic.findMany({
      select: { articleId: true, topic: { select: { slug: true } } },
      take: 4000,
    }),
  ]);

  const topicLikes: IntelTopicLike[] = topics.map((topic) => ({
    slug: topic.slug,
    name: topic.name,
    articleCount: topic._count.articles,
    color: topic.color,
  }));
  const sourceLikes: IntelSourceLike[] = sources.map((source) => ({
    name: source.name,
    kind: source.kind,
    credibility: source.credibility,
    articleCount: source._count.articles,
    enabled: source.enabled,
    lastStatus: source.lastStatus,
  }));

  const byArticle = new Map<string, string[]>();
  for (const link of links) {
    const list = byArticle.get(link.articleId) ?? [];
    list.push(link.topic.slug);
    byArticle.set(link.articleId, list);
  }
  const pairCounts = new Map<string, number>();
  for (const slugs of byArticle.values()) {
    for (let i = 0; i < slugs.length; i += 1) {
      for (let j = i + 1; j < slugs.length; j += 1) {
        const key = [slugs[i], slugs[j]].sort().join("|");
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
      }
    }
  }
  const relations = [...pairCounts.entries()]
    .map(([key, weight]) => {
      const [from, to] = key.split("|");
      return { from, to, weight };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12);

  return {
    candidates: buildIntelCandidates({ events, topics: topicLikes, sources: sourceLikes, relations }),
    context: "最近的情报事件、主题分布与来源质量",
  };
}

/** 情报 × 资产关联候选：把 exposure 规则的输出转成图表候选 */
async function exposureCandidatesFor(portfolio: Awaited<ReturnType<typeof loadPortfolio>>): Promise<VisualCandidate[]> {
  const { exposure } = await loadExposure();
  return buildExposureCandidates({
    totalAssetsCny: portfolio.metrics.totalAssetsCny,
    items: exposure.map((item) => ({
      topicName: item.topic.name,
      topicKind: item.topic.kind,
      exposureShare: item.exposureShare,
      matchedCount: item.matchedAssets.length,
      note: item.note,
    })),
  });
}

export async function getPortfolioVisuals(): Promise<VisualsResult> {
  const portfolio = await loadPortfolio();
  const exposureCandidates = await exposureCandidatesFor(portfolio);
  const candidates = [
    // 主题暴露是「情报 × 资产」的核心出口，放在前面，规则模式下也优先被选中
    ...exposureCandidates,
    ...buildPortfolioCandidates({
      metrics: portfolio.metrics,
      liabilityMix: portfolio.liabilityMix,
      findings: [],
    }),
  ];
  return selectVisuals(candidates, "我的资产结构：类别、币种、流动性、期限、负债、应急金，以及资产暴露在哪些主题");
}

export async function getDashboardVisuals(): Promise<VisualsResult> {
  const portfolio = await loadPortfolio();
  const [intel, exposureCandidates] = await Promise.all([intelCandidatesFor({ limit: 20 }), exposureCandidatesFor(portfolio)]);
  const candidates = [
    ...exposureCandidates.slice(0, 1),
    ...buildPortfolioCandidates({
      metrics: portfolio.metrics,
      liabilityMix: portfolio.liabilityMix,
      findings: [],
    }).slice(0, 4),
    ...intel.candidates,
  ];
  return selectVisuals(candidates, `${intel.context}，以及我的资产结构概览与主题暴露`, 4);
}

export async function getTopicVisuals(slug: string, days = 30): Promise<VisualsResult | null> {
  const insight = await getTopicInsight(slug, { days });
  if (!insight) return null;
  const candidates = buildTopicCandidates({
    slug: insight.topic.slug,
    name: insight.topic.name,
    eventTypes: insight.eventTypes,
    timeline: insight.timeline,
    entities: insight.entities,
    keyNumbers: insight.keyNumbers.map((item) => ({
      label: item.label,
      value: item.value,
      unit: item.unit,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
    })),
    gaps: insight.gaps,
  });
  return selectVisuals(candidates, `主题「${insight.topic.name}」在近 ${days} 天的资讯与事件`);
}

export async function getEventVisuals(eventId: string): Promise<VisualsResult | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true },
  });
  if (!event) return null;

  const [analysis, articles] = await Promise.all([
    ensureEventAnalysis(eventId),
    prisma.article.findMany({
      where: { eventId },
      orderBy: { publishedAt: "asc" },
      select: {
        id: true,
        title: true,
        summary: true,
        publishedAt: true,
        url: true,
        qualityScore: true,
        source: { select: { name: true, credibility: true } },
      },
    }),
  ]);

  const candidates = buildEventCandidates({
    eventId: event.id,
    eventTitle: event.title,
    timeline: analysis?.analysis.timeline ?? [],
    keyNumbers: analysis?.analysis.keyNumbers ?? [],
    articles: articles.map((article) => ({
      id: article.id,
      title: article.title,
      sourceName: article.source.name,
      credibility: article.source.credibility,
      qualityScore: article.qualityScore,
      publishedAt: article.publishedAt.toISOString(),
      url: article.url,
    })),
  });

  const context = analysis
    ? `事件「${event.title}」：${analysis.analysis.headline}；${analysis.analysis.disagreements.length} 处分歧、${analysis.analysis.gaps.length} 个信息缺口`
    : `事件「${event.title}」的报道与来源`;
  return selectVisuals(candidates, context, 3);
}

/** 供结构化问答使用：资产与情报的图表候选，由问答结果里的 candidateId 再回填 */
export async function getChatCandidates(): Promise<{ candidates: VisualCandidate[]; context: string }> {
  const [portfolio, intel] = await Promise.all([loadPortfolio(), intelCandidatesFor({ limit: 12 })]);
  const exposureCandidates = await exposureCandidatesFor(portfolio);
  const candidates = [
    ...exposureCandidates,
    ...buildPortfolioCandidates({
      metrics: portfolio.metrics,
      liabilityMix: portfolio.liabilityMix,
      findings: [],
    }),
    ...intel.candidates,
  ];
  return { candidates, context: `${intel.context}，以及我的资产结构与主题暴露` };
}
