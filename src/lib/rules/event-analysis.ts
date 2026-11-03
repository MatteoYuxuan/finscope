/**
 * 事件级分析的规则实现（LLM 降级与 mock 模式共用）。
 *
 * 只做“材料内可核对”的整理：
 * - 共识：多个来源共同提到的实体、数值基本一致；
 * - 分歧：同一指标在不同来源的数值/说法不一致，或传闻与澄清并存；
 * - 时间线、信息缺口与影响维度也全部来自文章级抽取结果。
 *
 * 不预测涨跌、不给买卖建议。
 */
import type {
  ArticleClaim,
  ArticleEventType,
  ArticleExtraction,
  DisagreementNature,
  EventAnalysis,
  EventDisagreement,
  EventDisagreementPosition,
  EventGrouping,
  EventTimelineItem,
  ExtractedEntity,
  KeyNumber,
  TopicKind,
} from "@/lib/types/domain";
import { indicatorKeyOf } from "@/lib/rules/extract";

export interface AnalysisArticleInput {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  url?: string | null;
  sourceName: string;
  sourceCredibility: number;
  qualityScore: number;
  eventType: ArticleEventType;
  entities: ExtractedEntity[];
  keyNumbers: KeyNumber[];
  claims: ArticleClaim[];
  topics?: { name: string; kind?: TopicKind }[];
}

export interface EventAnalysisInput {
  eventTitle: string;
  articles: AnalysisArticleInput[];
  /** 聚类阶段给出的可解释分组依据；缺省时按共享实体简单描述 */
  grouping?: EventGrouping;
}

interface NumberGroup {
  label: string;
  key: string;
  unit: string;
  entries: { article: AnalysisArticleInput; number: KeyNumber }[];
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const value = key(item);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(item);
  }
  return result;
}

function groupEntities(articles: AnalysisArticleInput[]): { name: string; type: ExtractedEntity["type"]; articleIds: string[] }[] {
  const map = new Map<string, { name: string; type: ExtractedEntity["type"]; articleIds: string[] }>();
  for (const article of articles) {
    for (const entity of article.entities) {
      const key = entity.name.trim().toLowerCase();
      if (!key) continue;
      const current = map.get(key);
      if (current) {
        if (!current.articleIds.includes(article.id)) current.articleIds.push(article.id);
      } else {
        map.set(key, { name: entity.name.trim(), type: entity.type, articleIds: [article.id] });
      }
    }
  }
  return [...map.values()];
}

function normalizeUnit(unit: string): string {
  const value = unit.replace(/％/g, "%").trim();
  if (value === "亿") return "亿元";
  if (value === "万") return "万元";
  return value;
}

function groupNumbers(articles: AnalysisArticleInput[]): NumberGroup[] {
  const map = new Map<string, NumberGroup>();
  for (const article of articles) {
    // 同一篇文章对同一指标只保留一个数值，避免同一来源在分歧里重复出现
    const seen = new Set<string>();
    for (const number of article.keyNumbers) {
      const indicator = indicatorKeyOf(number.label) ?? number.label.trim();
      if (!indicator) continue;
      const unit = normalizeUnit(number.unit);
      // 单位不同的数值不可直接比较：58% 与 3 个百分点、12 亿元与 12 个月不是同一口径
      const key = `${indicator}|${unit}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const group = map.get(key) ?? {
        label: number.label || indicator,
        key: indicator,
        unit,
        entries: [],
      };
      group.entries.push({ article, number });
      map.set(key, group);
    }
  }
  return [...map.values()];
}

function natureOf(key: string): DisagreementNature {
  if (key === "过渡期" || key === "时间安排") return "时间安排";
  if (key === "订单金额" || key === "金额") return "事实描述";
  return "数据口径";
}

function pickPosition(entry: { article: AnalysisArticleInput; number: KeyNumber }): EventDisagreementPosition {
  return {
    stance: `${entry.article.sourceName} 报道为 ${entry.number.value}${entry.number.unit}`,
    articleIds: [entry.article.id],
    sourceNames: [entry.article.sourceName],
    ...(entry.number.context ? { quote: truncate(entry.number.context, 100) } : {}),
  };
}

function buildNumberDisagreements(groups: NumberGroup[]): EventDisagreement[] {
  const results: EventDisagreement[] = [];
  for (const group of groups) {
    if (group.entries.length < 2) continue;
    // 分歧必须发生在不同来源之间；同一来源的两篇报道不算“来源分歧”
    const sourceNames = new Set(group.entries.map((entry) => entry.article.sourceName));
    if (sourceNames.size < 2) continue;
    const values = group.entries.map((entry) => entry.number.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const base = Math.max(Math.abs(min), Math.abs(max), 1);
    // 口径差异要足够大：同一指标相差 5% 以内视为“基本一致”，不制造假分歧
    if ((max - min) / base < 0.05) continue;
    const positions = group.entries
      .slice()
      .sort((a, b) => b.article.sourceCredibility - a.article.sourceCredibility)
      .slice(0, 4)
      .map(pickPosition);
    results.push({
      topic: `${group.label}口径存在差异`,
      nature: natureOf(group.key),
      positions,
    });
  }
  return results;
}

function buildRumorDisagreement(articles: AnalysisArticleInput[]): EventDisagreement | null {
  const rumorArticle = articles.find(
    (article) =>
      article.eventType === "rumor" ||
      article.claims.some((claim) => claim.kind === "claim"),
  );
  const denialArticle = articles.find((article) =>
    article.claims.some((claim) => claim.kind === "denial"),
  );
  if (!rumorArticle || !denialArticle || rumorArticle.id === denialArticle.id) return null;
  const rumorClaim =
    rumorArticle.claims.find((claim) => claim.kind === "claim") ?? rumorArticle.claims[0];
  const denialClaim =
    denialArticle.claims.find((claim) => claim.kind === "denial") ?? denialArticle.claims[0];
  const positions: EventDisagreementPosition[] = [
    {
      stance: `${rumorArticle.sourceName}：${truncate(rumorClaim?.text ?? "报道了相关传闻", 80)}`,
      articleIds: [rumorArticle.id],
      sourceNames: [rumorArticle.sourceName],
      ...(rumorClaim ? { quote: truncate(rumorClaim.text, 100) } : {}),
    },
    {
      stance: `${denialArticle.sourceName}：${truncate(denialClaim?.text ?? "发布了澄清说明", 80)}`,
      articleIds: [denialArticle.id],
      sourceNames: [denialArticle.sourceName],
      ...(denialClaim ? { quote: truncate(denialClaim.text, 100) } : {}),
    },
  ];
  return { topic: "传闻与澄清", nature: "事实描述", positions };
}

function buildConsensus(
  articles: AnalysisArticleInput[],
  entities: ReturnType<typeof groupEntities>,
  numbers: NumberGroup[],
): EventAnalysis["consensus"] {
  const points: EventAnalysis["consensus"] = [];

  for (const entity of entities) {
    if (entity.articleIds.length < 2) continue;
    if (!["ORG", "POLICY", "INDICATOR", "PRODUCT"].includes(entity.type)) continue;
    points.push({
      point: `多个来源均提到「${entity.name}」`,
      articleIds: entity.articleIds.slice(0, 6),
    });
    if (points.length >= 3) break;
  }

  for (const group of numbers) {
    if (group.entries.length < 2) continue;
    const values = group.entries.map((entry) => entry.number.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const base = Math.max(Math.abs(min), Math.abs(max), 1);
    if ((max - min) / base >= 0.05) continue;
    points.push({
      point: `「${group.label}」在多个来源中基本一致（约 ${values[0]}${group.unit}）`,
      articleIds: uniqueBy(
        group.entries.map((entry) => ({ id: entry.article.id })),
        (item) => item.id,
      )
        .slice(0, 6)
        .map((item) => item.id),
    });
    if (points.length >= 4) break;
  }

  if (points.length === 0) {
    const representative =
      articles.find((article) => article.claims.some((claim) => claim.kind === "fact")) ??
      articles[0];
    const fact =
      representative?.claims.find((claim) => claim.kind === "fact") ?? representative?.claims[0];
    if (representative && fact) {
      points.push({
        point: `代表报道称：${truncate(fact.text, 100)}`,
        articleIds: [representative.id],
      });
    }
  }

  return points.slice(0, 4);
}

function buildImpactDims(articles: AnalysisArticleInput[], eventType: ArticleEventType): string[] {
  const dims: string[] = [];
  for (const article of articles) {
    for (const topic of article.topics ?? []) {
      const dim =
        topic.kind === "macro"
          ? "宏观"
          : topic.kind === "industry"
            ? "行业"
            : topic.kind === "company"
              ? "公司"
              : topic.kind === "fx"
                ? "汇率"
                : topic.kind === "policy"
                  ? "政策"
                  : null;
      if (dim && !dims.includes(dim)) dims.push(dim);
    }
  }
  if (dims.length === 0) {
    const fallback: Record<ArticleEventType, string> = {
      macro_data: "宏观",
      policy: "政策",
      company_event: "公司",
      market_move: "汇率",
      industry_survey: "行业",
      rumor: "公司",
      other: "宏观",
    };
    dims.push(fallback[eventType]);
  }
  return dims.slice(0, 4);
}

function buildGaps(articles: AnalysisArticleInput[], numbers: KeyNumber[]): string[] {
  const gaps: string[] = [];
  const noUrl = articles.filter((article) => !article.url).length;
  if (noUrl > 0) gaps.push(`${noUrl} 篇报道没有原文链接，无法进一步核对原文`);
  const sources = new Set(articles.map((article) => article.sourceName));
  if (sources.size < 2) gaps.push("目前仅有 1 个来源，缺少交叉验证");
  if (numbers.length === 0) gaps.push("报道中没有可核对的关键数值");
  const lowQuality = articles.filter((article) => article.qualityScore < 55).length;
  if (lowQuality > 0) gaps.push(`${lowQuality} 篇报道信息完整度偏低（质量分低于 55）`);
  const maxCredibility = Math.max(...articles.map((article) => article.sourceCredibility), 0);
  if (maxCredibility <= 2) gaps.push("来源档位整体偏低，相关内容需谨慎对待");
  return gaps.length > 0 ? gaps.slice(0, 5) : ["暂未发现明显信息缺口，仍需关注后续披露"];
}

function buildGrouping(input: EventAnalysisInput): EventGrouping | undefined {
  if (input.grouping) return input.grouping;
  if (input.articles.length < 2) return undefined;
  const entities = groupEntities(input.articles).filter((entity) => entity.articleIds.length >= 2);
  const times = input.articles
    .map((article) => new Date(article.publishedAt).getTime())
    .filter((time) => Number.isFinite(time));
  const timeGapHours =
    times.length > 1 ? Math.round(((Math.max(...times) - Math.min(...times)) / 36e5) * 10) / 10 : 0;
  const shared = entities.slice(0, 4).map((entity) => entity.name);
  return {
    rule: shared.length > 0 ? "ENTITY" : "TEXT",
    similarity: shared.length > 0 ? 0.7 : 0.42,
    timeGapHours,
    sharedKeywords: [],
    sharedEntities: shared,
    reason:
      shared.length > 0
        ? `多篇报道共享实体「${shared.join("、")}」，时间跨度约 ${timeGapHours} 小时，按实体与主题规则归为同一事件。`
        : `多篇报道在时间窗内围绕同一主题，按文本相似度规则归为同一事件。`,
  };
}

export function buildRuleEventAnalysis(input: EventAnalysisInput): EventAnalysis {
  const articles = input.articles;
  const entities = groupEntities(articles);
  const numbers = groupNumbers(articles);
  const keyNumbers = uniqueBy(
    numbers.flatMap((group) =>
      group.entries.map((entry) => ({
        label: entry.number.label,
        value: entry.number.value,
        unit: entry.number.unit,
        articleId: entry.article.id,
        sourceName: entry.article.sourceName,
      })),
    ),
    (item) => `${item.label}|${item.value}|${item.unit}`,
  ).slice(0, 12);

  const disagreements = buildNumberDisagreements(numbers);
  const rumor = buildRumorDisagreement(articles);
  if (rumor) disagreements.unshift(rumor);

  const timeline: EventTimelineItem[] = articles
    .slice()
    .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime())
    .slice(0, 12)
    .map((article) => ({
      at: article.publishedAt,
      label: truncate(article.title, 60),
      articleId: article.id,
    }));

  const avgCredibility =
    articles.reduce((acc, article) => acc + article.sourceCredibility, 0) /
    Math.max(articles.length, 1);
  const sources = new Set(articles.map((article) => article.sourceName)).size;
  const eventType = articles[0]?.eventType ?? "other";

  return {
    headline: truncate(input.eventTitle, 80),
    consensus: buildConsensus(articles, entities, numbers),
    disagreements: disagreements.slice(0, 3),
    timeline,
    keyNumbers,
    entities: entities.slice(0, 12).map((entity) => ({ name: entity.name, type: entity.type })),
    gaps: buildGaps(articles, numbers.flatMap((group) => group.entries.map((entry) => entry.number))),
    impactDims: buildImpactDims(articles, eventType),
    confidenceNote: `规则计算：${articles.length} 篇报道、${sources} 个来源，来源档位均值 ${avgCredibility.toFixed(1)}/5；共识与分歧均来自原文抽取，不代表事实认定。`,
    grouping: buildGrouping(input),
    generatedAt: new Date().toISOString(),
  };
}

/** 供 LLM 输出校验与清洗复用 */
export function normalizeAnalysisArticleIds(
  analysis: EventAnalysis,
  validIds: Set<string>,
): EventAnalysis {
  const keepIds = (ids: string[]) => ids.filter((id) => validIds.has(id));
  return {
    ...analysis,
    consensus: analysis.consensus
      .map((point) => ({ ...point, articleIds: keepIds(point.articleIds) }))
      .filter((point) => point.articleIds.length > 0),
    disagreements: analysis.disagreements
      .map((disagreement) => ({
        ...disagreement,
        positions: disagreement.positions
          .map((position) => ({ ...position, articleIds: keepIds(position.articleIds) }))
          .filter((position) => position.articleIds.length > 0),
      }))
      .filter((disagreement) => disagreement.positions.length >= 2),
    timeline: analysis.timeline
      .map((item) => ({
        ...item,
        articleId: item.articleId && validIds.has(item.articleId) ? item.articleId : undefined,
      }))
      .filter((item) => Number.isFinite(new Date(item.at).getTime())),
  };
}

/** 供 LLM 提示词使用的紧凑文章材料 */
export interface AnalysisArticlePayload extends ArticleExtraction {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  sourceName: string;
  sourceCredibility: number;
}

export function toAnalysisPayload(article: AnalysisArticleInput): AnalysisArticlePayload {
  return {
    id: article.id,
    title: article.title,
    summary: truncate(article.summary, 300),
    publishedAt: article.publishedAt,
    sourceName: article.sourceName,
    sourceCredibility: article.sourceCredibility,
    entities: article.entities,
    eventType: article.eventType,
    keyNumbers: article.keyNumbers,
    claims: article.claims,
    regions: [],
    currencies: [],
  };
}
