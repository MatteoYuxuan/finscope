import { DISCLAIMER_ZH } from "@/lib/constants";
import { clamp } from "@/lib/rules/money";
import type {
  CategorySlice,
  ChartPoint,
  ChartSpec,
  Citation,
  Finding,
  PortfolioMetrics,
} from "@/lib/types/domain";

/**
 * 可视化候选集（服务端构建，纯数据）。
 *
 * 设计要点：
 * - 候选先由规则从数据库聚合出来，模型只在候选里挑，不允许编造数据；
 * - 每个 spec 都带数据来源（source）与引用（citations），保证图上数字可追溯；
 * - 所有 spec 统一附免责声明，前端渲染时可直接展示。
 */

export interface VisualCandidate {
  id: string;
  title: string;
  type: ChartSpec["type"];
  /** 给选择器/模型看的一句话理由：这类数据适合用什么表达 */
  rationale: string;
  spec: ChartSpec;
}

export interface PortfolioVisualInput {
  metrics: PortfolioMetrics;
  liabilityMix: CategorySlice[];
  findings: Finding[];
}

export interface ExposureVisualInput {
  items: {
    topicName: string;
    topicKind?: string;
    exposureShare: number;
    matchedCount: number;
    note?: string;
  }[];
  /** 暴露测算基准（总资产），用于说明占比口径 */
  totalAssetsCny: number;
}

export interface IntelEventLike {
  id: string;
  title: string;
  eventType: string;
  articleCount: number;
  sourceCount: number;
  credibility: number;
  lastSeenAt: string;
}

export interface IntelTopicLike {
  slug: string;
  name: string;
  articleCount: number;
  color?: string;
}

export interface IntelSourceLike {
  name: string;
  kind: string;
  credibility: number;
  articleCount: number;
  enabled?: boolean;
  lastStatus?: string | null;
}

export interface IntelVisualInput {
  events: IntelEventLike[];
  topics: IntelTopicLike[];
  sources: IntelSourceLike[];
  relations?: { from: string; to: string; weight: number }[];
}

const PALETTE = ["#12b886", "#2563eb", "#7c3aed", "#f59e0b", "#ef4444", "#0891b2", "#84cc16", "#a16207"];

const METRIC_CITATION: Citation = {
  type: "metric",
  id: "portfolio",
  label: "资产结构指标（Asset / Liability 表聚合）",
};

function specBase(id: string, title: string, type: ChartSpec["type"]): ChartSpec {
  return {
    id,
    type,
    title,
    citations: [],
    source: "本地数据库",
    disclaimer: DISCLAIMER_ZH,
  };
}

function slicePoints(slices: CategorySlice[]): ChartPoint[] {
  return slices.map((slice, index) => ({
    label: slice.label,
    value: slice.valueCny,
    color: slice.color || PALETTE[index % PALETTE.length],
  }));
}

/** 资产结构候选：占比 / 层级 / 指标 / 风险矩阵 / 待办 */
export function buildPortfolioCandidates(input: PortfolioVisualInput): VisualCandidate[] {
  const { metrics, liabilityMix, findings } = input;
  const candidates: VisualCandidate[] = [];

  if (metrics.categoryMix.length > 0) {
    const spec = specBase("pf-category", "资产类别占比", "donut");
    spec.unit = "元";
    spec.points = slicePoints(metrics.categoryMix);
    spec.source = "Asset 表按 category 汇总，外币按参考汇率折算为 CNY";
    spec.citations = [METRIC_CITATION];
    spec.rationale = "看资产集中在哪些类别，适合用占比环图";
    candidates.push({ id: "pf-category", title: spec.title, type: "donut", rationale: spec.rationale!, spec });
  }

  if (metrics.currencyMix.length > 0) {
    const spec = specBase("pf-currency", "币种分布", "donut");
    spec.unit = "元";
    spec.points = slicePoints(metrics.currencyMix);
    spec.source = "Asset 表按 currency 汇总后折算为 CNY";
    spec.citations = [METRIC_CITATION];
    spec.rationale = "关注汇率暴露时，币种占比最直观";
    candidates.push({ id: "pf-currency", title: spec.title, type: "donut", rationale: spec.rationale!, spec });
  }

  if (metrics.liquidityMix.length > 0) {
    const spec = specBase("pf-liquidity", "流动性分层", "hbar");
    spec.unit = "万元";
    spec.points = metrics.liquidityMix.map((slice, index) => ({
      label: slice.label,
      value: Math.round(slice.valueCny / 1000) / 10,
      color: slice.color || PALETTE[index % PALETTE.length],
    }));
    spec.source = "Asset 表按 liquidity 分层汇总";
    spec.citations = [METRIC_CITATION];
    spec.rationale = "应急资金安排看流动性分层，横向条形便于比较金额";
    candidates.push({ id: "pf-liquidity", title: spec.title, type: "hbar", rationale: spec.rationale!, spec });
  }

  if (metrics.maturityMix.length > 0) {
    const spec = specBase("pf-maturity", "期限结构", "hbar");
    spec.unit = "万元";
    spec.points = metrics.maturityMix.map((slice, index) => ({
      label: slice.label,
      value: Math.round(slice.valueCny / 1000) / 10,
      color: slice.color || PALETTE[index % PALETTE.length],
    }));
    spec.source = "Asset 表按 maturityMonths 分桶汇总";
    spec.citations = [METRIC_CITATION];
    spec.rationale = "看资金被锁定的时间分布，适合期限分桶条形图";
    candidates.push({ id: "pf-maturity", title: spec.title, type: "hbar", rationale: spec.rationale!, spec });
  }

  const structurePoints: ChartPoint[] = [
    { label: "负债率", value: Number(((metrics.debtRatio ?? 0) * 100).toFixed(1)), color: "#ef4444" },
    { label: "最大类别占比", value: Number((metrics.topCategoryShare * 100).toFixed(1)), color: "#f59e0b" },
    { label: "前三大占比", value: Number((metrics.top3Share * 100).toFixed(1)), color: "#a16207" },
    { label: "外币占比", value: Number((metrics.foreignShare * 100).toFixed(1)), color: "#0891b2" },
    { label: "权益类占比", value: Number(((metrics.equityShare ?? 0) * 100).toFixed(1)), color: "#2563eb" },
    { label: "长期资产占比", value: Number((metrics.longTermShare * 100).toFixed(1)), color: "#7c3aed" },
  ];
  const structureSpec = specBase("pf-structure", "结构指标一览", "bar");
  structureSpec.unit = "%";
  structureSpec.points = structurePoints;
  structureSpec.source = "PortfolioMetrics 计算值（负债率、HHI 相关占比、币种与期限占比）";
  structureSpec.citations = [METRIC_CITATION];
  structureSpec.rationale = "多个百分比指标放在一张条形图里比较，比逐条文字更快定位偏高项";
  structureSpec.note = `HHI ${metrics.hhi.toFixed(3)}，信息完整度 ${metrics.completeness}%`;
  candidates.push({ id: "pf-structure", title: structureSpec.title, type: "bar", rationale: structureSpec.rationale!, spec: structureSpec });

  const emergency = metrics.emergencyMonths;
  const emergencySpec = specBase("pf-emergency", "应急金月数", "grouped_bar");
  emergencySpec.unit = "个月";
  emergencySpec.points = [{ label: "当前", value: emergency ?? 0, value2: 6 }];
  emergencySpec.series = [
    { key: "value", label: "当前月数", color: "#12b886" },
    { key: "value2", label: "参考下限", color: "#94a3b8" },
  ];
  emergencySpec.source = "应急金 = 现金类与高流动性资产 / 每月必要支出";
  emergencySpec.citations = [METRIC_CITATION];
  emergencySpec.rationale = "把当前值与参考下限放在一起，差距一目了然";
  emergencySpec.note = emergency === null ? "未填写每月必要支出，无法计算月数" : `每月必要支出参考值已用于计算`;
  candidates.push({ id: "pf-emergency", title: emergencySpec.title, type: "grouped_bar", rationale: emergencySpec.rationale!, spec: emergencySpec });

  const matrixPoints = structurePoints
    .filter((point) => point.label !== "前三大占比")
    .map((point) => ({
      label: point.label,
      x: point.value,
      y: thresholdOf(point.label),
      group: point.value > thresholdOf(point.label) ? "高于参考" : "参考范围内",
    }));
  if (matrixPoints.length > 0) {
    const matrix = specBase("pf-risk-matrix", "结构风险矩阵", "risk_matrix");
    matrix.matrix = matrixPoints;
    matrix.axes = { x: "当前值（%）", y: "参考阈值（%）" };
    matrix.source = "PortfolioMetrics 当前值与 rules/checkup 阈值对照";
    matrix.citations = [METRIC_CITATION];
    matrix.rationale = "同时看“当前值”和“离阈值多远”，适合二维矩阵而不是单一柱状图";
    candidates.push({ id: "pf-risk-matrix", title: matrix.title, type: "risk_matrix", rationale: matrix.rationale!, spec: matrix });
  }

  if (findings.length > 0) {
    const checklist = specBase("pf-findings", "结构提示与待办", "checklist");
    checklist.checklist = findings.slice(0, 6).map((finding) => ({
      text: finding.todo ? `${finding.title}：${finding.todo}` : finding.title,
      hint: `${finding.level === "risk" ? "重点" : finding.level === "warn" ? "关注" : "提示"} · ${finding.detail}`,
    }));
    checklist.source = "rules/checkup 规则输出（Finding）";
    checklist.citations = [METRIC_CITATION];
    checklist.rationale = "待办型信息用清单表达，比图表更适合逐条处理";
    candidates.push({ id: "pf-findings", title: checklist.title, type: "checklist", rationale: checklist.rationale!, spec: checklist });
  }

  if (liabilityMix.length > 0) {
    const spec = specBase("pf-liability", "负债构成", "donut");
    spec.unit = "元";
    spec.points = slicePoints(liabilityMix);
    spec.source = "Liability 表按 category 汇总";
    spec.citations = [METRIC_CITATION];
    spec.rationale = "负债结构也是风险来源，占比环图便于看集中度";
    candidates.push({ id: "pf-liability", title: spec.title, type: "donut", rationale: spec.rationale!, spec });
  }

  return candidates;
}

/**
 * 情报 × 资产关联候选：主题暴露占比 + 匹配明细表。
 * 这是「我的资产暴露在哪些主题」的唯一图形化出口，占比来自 exposure 规则层。
 */
export function buildExposureCandidates(input: ExposureVisualInput): VisualCandidate[] {
  const items = input.items
    .filter((item) => item.exposureShare > 0)
    .sort((a, b) => b.exposureShare - a.exposureShare)
    .slice(0, 8);
  if (items.length === 0) return [];

  const candidates: VisualCandidate[] = [];

  const share = specBase("pf-exposure", "主题暴露占比", "hbar");
  share.unit = "%";
  share.points = items.map((item, index) => ({
    label: item.topicName,
    value: Number((item.exposureShare * 100).toFixed(1)),
    color: PALETTE[index % PALETTE.length],
  }));
  share.source = "exposure 规则：按主题类型（汇率/行业/公司/大宗 1.0，宏观/政策 0.5）匹配资产文本后折算";
  share.citations = [METRIC_CITATION];
  share.rationale = "要回答“我的资产暴露在哪些主题”，横向条形能直接比较占比";
  share.note = "粗粒度解释性关联，可能遗漏或误配；不是投资分析";
  candidates.push({ id: "pf-exposure", title: share.title, type: "hbar", rationale: share.rationale!, spec: share });

  const detail = specBase("pf-exposure-detail", "主题暴露明细", "table");
  detail.table = {
    columns: [
      { key: "topic", label: "主题" },
      { key: "share", label: "暴露占比", align: "right" },
      { key: "matched", label: "关联资产", align: "right" },
      { key: "note", label: "说明" },
    ],
    rows: items.map((item) => ({
      topic: item.topicName,
      share: `${(item.exposureShare * 100).toFixed(1)}%`,
      matched: item.matchedCount,
      note: item.note ?? "—",
    })),
  };
  detail.source = `按总资产 ${Math.round(input.totalAssetsCny).toLocaleString("zh-CN")} 元折算的暴露比例`;
  detail.citations = [METRIC_CITATION];
  detail.rationale = "占比之外还要知道匹配了哪些资产、为什么匹配，表格能保留解释";
  detail.note = "匹配依据来自资产类别、币种、行业与备注文本，可回到资产页核对";
  candidates.push({ id: "pf-exposure-detail", title: detail.title, type: "table", rationale: detail.rationale!, spec: detail });

  return candidates;
}

function thresholdOf(label: string): number {
  switch (label) {
    case "负债率":
      return 50;
    case "最大类别占比":
      return 50;
    case "外币占比":
      return 30;
    case "权益类占比":
      return 60;
    case "长期资产占比":
      return 60;
    default:
      return 50;
  }
}

/** 情报候选：主题分布 / 事件时间线 / 来源对照 / 可信度 / 关系图 / 事件表 */
export function buildIntelCandidates(input: IntelVisualInput): VisualCandidate[] {
  const { events, topics, sources, relations = [] } = input;
  const candidates: VisualCandidate[] = [];

  const typeCounts = new Map<string, number>();
  for (const event of events) typeCounts.set(event.eventType || "other", (typeCounts.get(event.eventType || "other") ?? 0) + 1);
  if (typeCounts.size > 0) {
    const spec = specBase("intel-event-types", "事件类型分布", "bar");
    spec.unit = "个";
    spec.points = [...typeCounts.entries()].map(([type, count], index) => ({
      label: EVENT_TYPE_SHORT[type] ?? type,
      value: count,
      color: PALETTE[index % PALETTE.length],
    }));
    spec.source = "Event 表按 eventType 计数";
    spec.citations = [{ type: "event", id: "list", label: "最近事件列表" }];
    spec.rationale = "想了解最近情报以什么类型为主，用类型计数条形图";
    candidates.push({ id: "intel-event-types", title: spec.title, type: "bar", rationale: spec.rationale!, spec });
  }

  const topicPoints = topics
    .filter((topic) => topic.articleCount > 0)
    .sort((a, b) => b.articleCount - a.articleCount)
    .slice(0, 8)
    .map((topic, index) => ({
      label: topic.name,
      value: topic.articleCount,
      color: topic.color || PALETTE[index % PALETTE.length],
    }));
  if (topicPoints.length > 0) {
    const spec = specBase("intel-topics", "资讯主题分布", "hbar");
    spec.unit = "条";
    spec.points = topicPoints;
    spec.source = "ArticleTopic 关联表按主题计数";
    spec.citations = [{ type: "topic", id: "list", label: "主题列表" }];
    spec.rationale = "主题多、名称长，横向条形更易读";
    candidates.push({ id: "intel-topics", title: spec.title, type: "hbar", rationale: spec.rationale!, spec });
  }

  const days = new Map<string, number>();
  for (const event of events) {
    const key = event.lastSeenAt.slice(0, 10);
    days.set(key, (days.get(key) ?? 0) + 1);
  }
  if (days.size > 1) {
    const spec = specBase("intel-timeline", "事件时间分布", "line");
    spec.unit = "个";
    spec.points = [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, value]) => ({ label: label.slice(5), value }));
    spec.source = "Event 表按 lastSeenAt 日期聚合";
    spec.citations = [{ type: "event", id: "list", label: "最近事件列表" }];
    spec.rationale = "看情报在时间上的疏密，折线/时间序列比表格直观";
    candidates.push({ id: "intel-timeline", title: spec.title, type: "line", rationale: spec.rationale!, spec });
  }

  if (sources.length > 0) {
    const spec = specBase("intel-sources", "来源对照", "table");
    spec.table = {
      columns: [
        { key: "name", label: "来源" },
        { key: "kind", label: "类型" },
        { key: "credibility", label: "档位", align: "right" },
        { key: "articleCount", label: "条数", align: "right" },
        { key: "status", label: "状态" },
      ],
      rows: sources.map((source) => ({
        name: source.name,
        kind: source.kind,
        credibility: `${source.credibility}/5`,
        articleCount: source.articleCount,
        status: source.enabled === false ? "已停用" : source.lastStatus ?? "—",
      })),
    };
    spec.source = "Source 表与 Article 关联计数";
    spec.citations = [{ type: "article", id: "list", label: "资讯来源" }];
    spec.rationale = "比较来源档位、条数与抓取状态，表格比图形更精确";
    candidates.push({ id: "intel-sources", title: spec.title, type: "table", rationale: spec.rationale!, spec });
  }

  if (events.length > 0) {
    const credibilityPoints = [
      { label: "低（<50）", value: 0, color: "#ef4444" },
      { label: "中（50–69）", value: 0, color: "#f59e0b" },
      { label: "较高（70–84）", value: 0, color: "#2563eb" },
      { label: "高（≥85）", value: 0, color: "#12b886" },
    ];
    for (const event of events) {
      const bucket = event.credibility >= 85 ? 3 : event.credibility >= 70 ? 2 : event.credibility >= 50 ? 1 : 0;
      credibilityPoints[bucket].value += 1;
    }
    const spec = specBase("intel-credibility", "事件可信度分布", "bar");
    spec.unit = "个";
    spec.points = credibilityPoints;
    spec.source = "Event.credibility 分桶计数（来源档位 40% + 交叉来源 30% + 质量分 30%）";
    spec.citations = [{ type: "event", id: "list", label: "最近事件列表" }];
    spec.rationale = "要说明“哪些结论更可靠”，可信度分桶比单条罗列更有整体感";
    candidates.push({ id: "intel-credibility", title: spec.title, type: "bar", rationale: spec.rationale!, spec });
  }

  if (topics.length > 0 && relations.length > 0) {
    const spec = specBase("intel-relations", "主题关系图", "relation_graph");
    spec.nodes = topics.slice(0, 8).map((topic, index) => ({
      id: topic.slug,
      label: topic.name,
      group: `${index % 3}`,
      weight: topic.articleCount,
    }));
    const ids = new Set(spec.nodes.map((node) => node.id));
    spec.edges = relations
      .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
      .slice(0, 12)
      .map((edge) => ({ from: edge.from, to: edge.to, label: `${edge.weight}` }));
    spec.source = "ArticleTopic 共现关系（同一文章的主题两两相连）";
    spec.citations = [{ type: "topic", id: "list", label: "主题列表" }];
    spec.rationale = "主题之间是否经常一起出现，关系图比条形图更能表达结构";
    if (spec.edges.length > 0) {
      candidates.push({ id: "intel-relations", title: spec.title, type: "relation_graph", rationale: spec.rationale!, spec });
    }
  }

  if (events.length > 0) {
    const spec = specBase("intel-events", "事件清单", "table");
    spec.table = {
      columns: [
        { key: "title", label: "事件" },
        { key: "articleCount", label: "报道", align: "right" },
        { key: "sourceCount", label: "来源", align: "right" },
        { key: "credibility", label: "可信度", align: "right" },
        { key: "date", label: "最近更新" },
      ],
      rows: events.slice(0, 10).map((event) => ({
        title: event.title,
        articleCount: event.articleCount,
        sourceCount: event.sourceCount,
        credibility: event.credibility,
        date: event.lastSeenAt.slice(0, 10),
      })),
    };
    spec.source = "Event 表（按 lastSeenAt 排序）";
    spec.citations = [{ type: "event", id: "list", label: "最近事件列表" }];
    spec.rationale = "需要逐条核对的事件列表，用表格而不是图形";
    candidates.push({ id: "intel-events", title: spec.title, type: "table", rationale: spec.rationale!, spec });
  }

  return candidates;
}

const EVENT_TYPE_SHORT: Record<string, string> = {
  macro_data: "宏观数据",
  policy: "政策监管",
  company_event: "公司事件",
  market_move: "市场行情",
  industry_survey: "行业调研",
  rumor: "传闻待证",
  other: "其他",
};

export interface TopicVisualInput {
  slug: string;
  name: string;
  eventTypes: { type: string; label: string; count: number }[];
  timeline: { date: string; count: number }[];
  entities: { name: string; count: number }[];
  keyNumbers: { label: string; value: number; unit: string; sourceName?: string; publishedAt?: string }[];
  gaps: string[];
}

export function buildTopicCandidates(input: TopicVisualInput): VisualCandidate[] {
  const candidates: VisualCandidate[] = [];
  const topicCitation: Citation = { type: "topic", id: input.slug, label: input.name };

  if (input.eventTypes.length > 0) {
    const spec = specBase("topic-types", "事件类型构成", "bar");
    spec.unit = "个";
    spec.points = input.eventTypes.map((item, index) => ({
      label: item.label,
      value: item.count,
      color: PALETTE[index % PALETTE.length],
    }));
    spec.source = "该主题下 Event.eventType 计数";
    spec.citations = [topicCitation];
    spec.rationale = "判断这个主题最近以什么类型的消息为主";
    candidates.push({ id: "topic-types", title: spec.title, type: "bar", rationale: spec.rationale!, spec });
  }

  if (input.timeline.length > 1) {
    const spec = specBase("topic-timeline", "资讯时间线", "line");
    spec.unit = "条";
    spec.points = input.timeline.map((item) => ({ label: item.date.slice(5), value: item.count }));
    spec.source = "Article.publishedAt 按日聚合";
    spec.citations = [topicCitation];
    spec.rationale = "看主题热度在时间上的变化";
    candidates.push({ id: "topic-timeline", title: spec.title, type: "line", rationale: spec.rationale!, spec });
  }

  if (input.entities.length > 0) {
    const spec = specBase("topic-entities", "高频实体", "hbar");
    spec.unit = "次";
    spec.points = input.entities.slice(0, 8).map((item, index) => ({
      label: item.name,
      value: item.count,
      color: PALETTE[index % PALETTE.length],
    }));
    spec.source = "Article.entities 在该主题文章中的出现次数";
    spec.citations = [topicCitation];
    spec.rationale = "实体出现的频次能帮助判断消息围绕谁展开";
    candidates.push({ id: "topic-entities", title: spec.title, type: "hbar", rationale: spec.rationale!, spec });
  }

  if (input.keyNumbers.length > 0) {
    const spec = specBase("topic-numbers", "关键数值", "table");
    spec.table = {
      columns: [
        { key: "label", label: "指标" },
        { key: "value", label: "数值", align: "right" },
        { key: "source", label: "来源" },
      ],
      rows: input.keyNumbers.slice(0, 8).map((item) => ({
        label: item.label,
        value: `${item.value}${item.unit}`,
        source: item.sourceName ?? "—",
      })),
    };
    spec.source = "Article.keyNumbers（原文抽取）";
    spec.citations = [topicCitation];
    spec.rationale = "数值需要精确对照，表格比图形更合适";
    candidates.push({ id: "topic-numbers", title: spec.title, type: "table", rationale: spec.rationale!, spec });
  }

  if (input.gaps.length > 0) {
    const spec = specBase("topic-gaps", "信息缺口", "checklist");
    spec.checklist = input.gaps.map((gap) => ({ text: gap }));
    spec.source = "规则层缺口检查（来源数、事件覆盖、关键数值、质量分）";
    spec.citations = [topicCitation];
    spec.rationale = "缺口是行动项，用清单表达";
    candidates.push({ id: "topic-gaps", title: spec.title, type: "checklist", rationale: spec.rationale!, spec });
  }

  return candidates;
}

export function buildEventCandidates(input: {
  eventId: string;
  eventTitle: string;
  timeline: { at: string; label: string; articleId?: string }[];
  keyNumbers: { label: string; value: number; unit: string; sourceName?: string }[];
  articles: { id: string; title: string; sourceName: string; credibility: number; qualityScore: number; publishedAt: string; url?: string | null }[];
}): VisualCandidate[] {
  const candidates: VisualCandidate[] = [];
  const eventCitation: Citation = { type: "event", id: input.eventId, label: input.eventTitle };

  if (input.timeline.length > 0) {
    const spec = specBase("event-timeline", "事件时间线", "timeline");
    spec.timeline = input.timeline.map((item) => ({ at: item.at, label: item.label }));
    spec.source = "EventAnalysis.timeline（每条可回溯到文章）";
    spec.citations = [eventCitation];
    spec.rationale = "同一事件的先后顺序用时间线表达";
    candidates.push({ id: "event-timeline", title: spec.title, type: "timeline", rationale: spec.rationale!, spec });
  }

  if (input.keyNumbers.length > 0) {
    const spec = specBase("event-numbers", "关键数值对照", "table");
    spec.table = {
      columns: [
        { key: "label", label: "指标" },
        { key: "value", label: "数值", align: "right" },
        { key: "source", label: "来源" },
      ],
      rows: input.keyNumbers.map((item) => ({
        label: item.label,
        value: `${item.value}${item.unit}`,
        source: item.sourceName ?? "—",
      })),
    };
    spec.source = "Article.keyNumbers 与 EventAnalysis.keyNumbers";
    spec.citations = [eventCitation];
    spec.rationale = "不同报道的数值需要并排核对";
    candidates.push({ id: "event-numbers", title: spec.title, type: "table", rationale: spec.rationale!, spec });
  }

  if (input.articles.length > 1) {
    const spec = specBase("event-sources", "来源对照", "table");
    spec.table = {
      columns: [
        { key: "source", label: "来源" },
        { key: "credibility", label: "档位", align: "right" },
        { key: "quality", label: "质量分", align: "right" },
        { key: "date", label: "发布时间" },
        { key: "link", label: "原文" },
      ],
      rows: input.articles.map((article) => ({
        source: article.sourceName,
        credibility: `${article.credibility}/5`,
        quality: article.qualityScore,
        date: article.publishedAt.slice(0, 10),
        link: article.url ? "有" : "无",
      })),
    };
    spec.source = "Article / Source 表";
    spec.citations = [eventCitation];
    spec.rationale = "多来源报道放在一起比较，表格最清楚";
    candidates.push({ id: "event-sources", title: spec.title, type: "table", rationale: spec.rationale!, spec });
  }

  return candidates;
}

/** 给选择器看的一行摘要：只暴露候选 id / 标题 / 类型 / 理由，不含具体数值 */
export function describeCandidates(candidates: VisualCandidate[]) {
  return candidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    type: candidate.type,
    rationale: candidate.rationale,
  }));
}

export function clampSelectionCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isFinite(count)) return 4;
  return Math.round(clamp(count, 1, 6));
}
