import type {
  Advice,
  ArticleExtraction,
  CheckupResult,
  EventAnalysis,
  ExposureItem,
  Finding,
  PortfolioMetrics,
  RiskBand,
} from "@/lib/types/domain";
import { RISK_BAND_META } from "@/lib/constants";
import { buildRuleAdvice } from "@/lib/rules/advice";
import { extractArticle } from "@/lib/rules/extract";
import { buildRuleEventAnalysis, type EventAnalysisInput } from "@/lib/rules/event-analysis";
import { formatCny, formatCompactYuan, formatPercent } from "@/lib/rules/money";
import type { RankedPassage } from "./retrieve";

/**
 * Mock 生成器：不调用任何外部服务，输出结构与 LLM 完全一致。
 * 设计为确定性函数（同样的输入 → 同样的输出），便于单元测试和答辩复现。
 */

export interface ArticleExtractionInput {
  index: number;
  title: string;
  summary: string;
  content?: string | null;
  sourceName?: string;
}

export interface ArticleExtractionBatchOutput {
  items: (ArticleExtraction & { index: number })[];
}

/** 规则抽取的批量包装：LLM 不可用时保证入库流程与契约不变 */
export function mockArticleExtractionBatch(input: {
  articles: ArticleExtractionInput[];
}): ArticleExtractionBatchOutput {
  return {
    items: input.articles.map((article) => ({
      index: article.index,
      ...extractArticle({
        title: article.title,
        summary: article.summary,
        content: article.content,
        sourceName: article.sourceName,
      }),
    })),
  };
}

export interface EventSummaryInput {
  articles: { title: string; summary: string; sourceName?: string; publishedAt?: string }[];
  topicNames: string[];
  regions: string[];
  currencies: string[];
}

export interface EventSummaryOutput {
  title: string;
  summary: string;
  themes: string[];
  industries: string[];
  regions: string[];
  currencies: string[];
}

function firstSentence(text: string, max = 80): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const cut = cleaned.split(/[。！？!?]/)[0] ?? cleaned;
  return cut.length > max ? `${cut.slice(0, max)}…` : cut;
}

export function mockEventSummary(input: EventSummaryInput): EventSummaryOutput {
  const { articles } = input;
  if (articles.length === 0) {
    return { title: "空事件", summary: "没有可汇总的资讯。", themes: [], industries: [], regions: [], currencies: [] };
  }

  const baseTitle = articles[0].title.replace(/[【】\[\]]/g, "").trim();
  const title = articles.length > 1 ? `${baseTitle}（${articles.length} 条报道）` : baseTitle;

  const points: string[] = [];
  for (const article of articles.slice(0, 3)) {
    const sentence = firstSentence(article.summary || article.title, 70);
    if (!sentence) continue;
    points.push(articles.length > 1 ? `${article.sourceName ?? "某来源"}称，${sentence}` : sentence);
  }
  const summary = `${points.join("；")}。${articles.length > 1 ? "以上为同一事件下不同来源的表述，细节以原文为准。" : "细节以原文为准。"}`;

  const themes = input.topicNames.slice(0, 4);
  const industries = input.topicNames.slice(0, 2);
  return {
    title,
    summary,
    themes: themes.length > 0 ? themes : ["综合"],
    industries,
    regions: [...new Set(input.regions)].slice(0, 3),
    currencies: [...new Set(input.currencies)].slice(0, 3),
  };
}

export interface ClusterExplainOutput {
  explanation: string;
}

export function mockClusterExplain(input: {
  titles: string[];
  sharedKeywords: string[];
  similarity: number;
  timeGapHours: number;
  rule: string;
}): ClusterExplainOutput {
  const keywords = input.sharedKeywords.slice(0, 5).join("、") || "标题主体";
  const ruleText =
    input.rule === "JACCARD"
      ? "标题词集合的重合度超过阈值"
      : "标题与摘要的 TF-IDF 余弦相似度超过阈值";
  return {
    explanation: `这 ${input.titles.length} 条资讯共享「${keywords}」等关键词，${ruleText}（相似度 ${input.similarity.toFixed(2)}），发布时间相差约 ${input.timeGapHours.toFixed(1)} 小时，因此被归为同一事件。系统按“代表元”方式比较，避免多条近似资讯被链式误并。`,
  };
}

export interface BriefInput {
  events: {
    title: string;
    summary: string;
    articleCount: number;
    sourceCount: number;
    credibility: number;
    themes: string[];
  }[];
  topics: { name: string; kindLabel: string; articleCount: number }[];
  metrics: PortfolioMetrics;
  findings: { title: string; level: string }[];
  exposure: { topicName: string; share: number; assetCount: number }[];
}

export interface BriefOutput {
  headline: string;
  sections: { title: string; body: string }[];
  todos: string[];
}

export function mockBrief(input: BriefInput): BriefOutput {
  const { events, topics, metrics, findings, exposure } = input;
  const eventCount = events.length;
  const articleCount = events.reduce((acc, event) => acc + event.articleCount, 0);
  const sourceCount = new Set(events.map((event) => event.sourceCount)).size;

  const headline =
    eventCount > 0
      ? `本周 ${eventCount} 个事件、${articleCount} 条资讯，主线集中在${topThemes(events)}`
      : "本周暂无新增资讯，可先刷新信息源";

  const lines: string[] = [];
  events.slice(0, 3).forEach((event, index) => {
    lines.push(
      `[${index + 1}] ${event.title}：${event.summary.slice(0, 90)}（${event.articleCount} 条报道 / ${event.sourceCount} 个来源，可信度 ${event.credibility}/100）`,
    );
  });

  const sections = [
    {
      title: "一、本周信息主线",
      body:
        lines.length > 0
          ? `按事件聚合后，本周共识别 ${eventCount} 个事件。\n\n${lines.join("\n\n")}`
          : "本周暂无可聚合的新资讯。可以在「市场情报台」刷新内置样例集，或检查信息源是否被停用。",
    },
    {
      title: "二、关注主题的动向",
      body:
        topics.length > 0
          ? topics
              .slice(0, 5)
              .map((topic) => `· ${topic.name}（${topic.kindLabel}）：本周关联 ${topic.articleCount} 条资讯`)
              .join("\n") +
            "\n\n以上仅为资讯条数与主题分布，不代表对相关行业或价格的判断。"
          : "你还没有关注任何主题，可在「主题追踪」里勾选行业、宏观、汇率或政策主题。",
    },
    {
      title: "三、我的资产结构提示",
      body: [
        `总资产 ${formatCny(metrics.totalAssetsCny)}，总负债 ${formatCny(metrics.totalLiabilitiesCny)}，净资产 ${formatCny(metrics.netWorthCny)}。`,
        `最大类别占比 ${formatPercent(metrics.topCategoryShare)}，HHI ${metrics.hhi.toFixed(3)}，外币资产占比 ${formatPercent(metrics.foreignShare)}。`,
        exposure.length > 0
          ? `与你关注主题可能相关的资产条目：${exposure
              .slice(0, 3)
              .map((item) => `${item.topicName}（${formatPercent(item.share)}，${item.assetCount} 条）`)
              .join("；")}。这是粗粒度匹配，不是风险敞口模型。`
          : "暂无可关联的主题暴露，可先在资产里补充行业标签。",
        findings.length > 0
          ? `本期体检共 ${findings.length} 条提示，其中最需要先看的是「${findings[0].title}」。`
          : "结构体检暂未发现需要提示的项目。",
      ].join("\n\n"),
    },
    {
      title: "四、信息质量与缺口",
      body: `资产信息完整度 ${metrics.completeness}%。${
        metrics.missingFields.length > 0
          ? `主要缺口：${metrics.missingFields.slice(0, 3).join("；")}。`
          : "字段填写较完整。"
      }资讯侧请优先阅读标注了原文链接、且来源可信度较高的条目；对“据传”“内幕”类表述保持警惕。`,
    },
  ];

  const todos = buildTodos(metrics, findings);
  return { headline, sections, todos };
}

function topThemes(events: BriefInput["events"]): string {
  const counts = new Map<string, number>();
  for (const event of events) {
    for (const theme of event.themes) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return sorted.length > 0 ? sorted.map(([theme]) => theme).join("、") : "综合信息";
}

function buildTodos(metrics: PortfolioMetrics, findings: BriefInput["findings"]): string[] {
  const todos = new Set<string>();
  for (const finding of findings.slice(0, 3)) {
    todos.add(`按「${finding.title}」的提示，先确认相关金额与期限是否记录准确`);
  }
  if (metrics.emergencyMonths !== null && metrics.emergencyMonths < 3) {
    todos.add("把应急金补到 3–6 个月的必要支出，放在可随时取用的账户");
  }
  if (metrics.foreignShare > 0.3) {
    todos.add("把外币资产占比降到 30% 以内，或确认这部分与未来外币支出匹配");
  }
  if (metrics.topCategoryShare > 0.5) {
    todos.add("把最大单一类别的占比降到 50% 以内，分散到不同类别");
  }
  if (metrics.missingFields.length > 0) todos.add(`补齐缺失字段：${metrics.missingFields[0]}`);
  if (todos.size === 0) todos.add("保持每周更新一次资产与关注主题，并复核结构指标");
  return [...todos].slice(0, 5);
}

export interface CheckupNarrativeInput {
  metrics: PortfolioMetrics;
  checkup: CheckupResult;
  riskBand: RiskBand | null;
}

export interface CheckupNarrativeOutput {
  summary: string;
  highlights: string[];
  recommendations: { title: string; detail: string; priority: "high" | "medium" | "low" }[];
}

export function mockCheckupNarrative(input: CheckupNarrativeInput): CheckupNarrativeOutput {
  const { metrics, checkup } = input;
  const top = checkup.findings[0];
  const second = checkup.findings[1];
  const band = input.riskBand ? RISK_BAND_META[input.riskBand].label : "未测评";

  const summary = top
    ? `本次体检最值得先看的是「${top.title}」。${second ? `其次是「${second.title}」。` : ""}当前净资产 ${formatCny(metrics.netWorthCny)}，负债率 ${formatPercent(metrics.debtRatio)}，信息完整度 ${metrics.completeness}%，风险画像为「${band}」。下面给出结构层面的调整方向，供你结合自身情况取舍。`
    : `当前结构未触发明显提示项：净资产 ${formatCny(metrics.netWorthCny)}，负债率 ${formatPercent(metrics.debtRatio)}，信息完整度 ${metrics.completeness}%。可以继续保持记录习惯，并定期复核数据口径与目标比例。`;

  const highlights = checkup.findings.slice(0, 4).map((finding) => `${finding.title}：${finding.evidence}`);
  if (highlights.length === 0) {
    highlights.push(`最大类别占比 ${formatPercent(metrics.topCategoryShare)}`, `HHI ${metrics.hhi.toFixed(3)}`);
  }

  const priorityOf = (level: Finding["level"]): "high" | "medium" | "low" =>
    level === "risk" ? "high" : level === "warn" ? "medium" : "low";

  const recommendations = checkup.findings.slice(0, 4).map((finding) => ({
    title: finding.title,
    detail: finding.todo ?? finding.detail,
    priority: priorityOf(finding.level),
  }));

  if (recommendations.length < 2) {
    if (metrics.emergencyMonths !== null && metrics.emergencyMonths < 6) {
      recommendations.push({
        title: "把应急金补到 3–6 个月",
        detail: `当前应急金约 ${metrics.emergencyMonths.toFixed(1)} 个月必要支出，建议逐步补到 3–6 个月，放在随取随用的账户。`,
        priority: "high",
      });
    } else {
      recommendations.push({
        title: "每季度复核一次目标比例",
        detail: "按你的风险画像设定类别目标比例，每季度对照一次实际占比，偏离过大时再调整。",
        priority: "low",
      });
    }
  }

  return { summary, highlights, recommendations };
}

export interface ChatMockInput {
  question: string;
  passages: RankedPassage[];
  metrics: PortfolioMetrics;
  findings: Finding[];
  riskBand: RiskBand;
  exposure?: ExposureItem[];
  monthlySpend?: number | null;
}

export interface ChatOutput {
  answer: string;
  citedIds: string[];
  advice: Advice;
  todos?: string[];
  visualCandidateIds?: string[];
}

export function mockChat(input: ChatMockInput): ChatOutput {
  const { passages, metrics } = input;
  const advice = buildRuleAdvice({
    question: input.question,
    metrics,
    findings: input.findings,
    riskBand: input.riskBand,
    exposure: input.exposure,
    monthlySpend: input.monthlySpend ?? metrics.monthlySpend,
  });

  const materialBullets = passages.slice(0, 3).map((item, index) => {
    const meta = item.passage.meta?.sourceName ? `（${item.passage.meta.sourceName}）` : "";
    return `[${index + 1}] ${item.passage.label}${meta}：${firstSentence(item.passage.text, 90)}`;
  });

  const stepBullets = advice.steps.slice(0, 4).map((item, index) => `${index + 1}. ${item.step}`);
  const allocationLines = advice.allocations.slice(0, 4).map(
    (item) =>
      `- ${item.category}：当前 ${item.currentShare.toFixed(0)}% → 目标 ${item.targetShare.toFixed(0)}%（${item.direction === "reduce" ? "降低" : item.direction === "increase" ? "提高" : "保持"}）`,
  );

  const lines = [
    "结合你录入的资产结构，可以先这样看：",
    "",
    advice.summary,
    "",
    ...(allocationLines.length > 0 ? ["配置方向：", ...allocationLines, ""] : []),
    "建议的下一步：",
    ...stepBullets,
    "",
    ...(passages.length > 0 ? ["与本问题相关的材料：", ...materialBullets, ""] : []),
    `主要风险：${advice.risks[0] ?? "结构调整需要结合自身收支与风险承受能力，分批执行更稳妥。"}`,
    ...(advice.scopeNote ? ["", advice.scopeNote] : []),
    "",
    "> 以上是基于你录入的数据给出的结构建议，投资有风险，仅供参考。",
  ];

  return {
    answer: lines.join("\n"),
    citedIds: passages.slice(0, 3).map((item) => item.passage.id),
    advice,
    todos: [
      "按建议先核对当前各类别占比与目标比例的差距",
      metrics.completeness < 80 ? "到「资产录入」补全缺失的类别或期限字段" : "到「结构分析」查看调整后的结构指标变化",
    ],
    visualCandidateIds: [],
  };
}

/**
 * 事件分析的规则兜底：与 EVENT_ANALYSIS_SCHEMA 同契约。
 * 无模型时仍然给出共识、分歧、时间线与信息缺口，保证页面不空。
 */
export function mockEventAnalysis(input: EventAnalysisInput): EventAnalysis {
  return buildRuleEventAnalysis(input);
}

export interface TopicDigestInput {
  topicName: string;
  windowDays: number;
  articleCount: number;
  eventCount: number;
  sourceCount: number;
  eventTypes: { label: string; count: number }[];
  entities: { name: string; count: number }[];
  gaps: string[];
}

export interface TopicDigestOutput {
  summary: string;
  observations: string[];
  gaps: string[];
}

/** 主题观察的规则兜底：只复述窗口内的统计与缺口，不做趋势判断 */
export function mockTopicDigest(input: TopicDigestInput): TopicDigestOutput {
  const typeText =
    input.eventTypes.length > 0
      ? input.eventTypes
          .slice(0, 3)
          .map((item) => `${item.label} ${item.count} 个`)
          .join("、")
      : "暂未形成事件";
  const entityText =
    input.entities.length > 0
      ? `高频实体包括 ${input.entities.slice(0, 4).map((item) => item.name).join("、")}`
      : "尚未抽取到稳定实体";

  return {
    summary: `近 ${input.windowDays} 天「${input.topicName}」共有 ${input.articleCount} 条资讯、${input.eventCount} 个事件，来自 ${input.sourceCount} 个来源。事件类型以 ${typeText} 为主。以上只是对窗口内材料的归集，不代表对趋势的判断。`,
    observations: [
      `${entityText}。`,
      input.eventCount > 0
        ? `信息主要集中在 ${input.eventTypes[0]?.label ?? "相关事件"}，可到事件详情查看共识与分歧。`
        : "当前窗口内还没有形成可分析的事件，建议刷新信息源或扩大时间窗口。",
      input.gaps[0] ?? "暂未发现明显的信息缺口。",
    ],
    gaps: input.gaps.slice(0, 3),
  };
}

export interface VisualCandidateLike {
  id: string;
  title: string;
  type: string;
  rationale: string;
}

export interface VisualSelectInput {
  candidates: VisualCandidateLike[];
  context: string;
  max?: number;
}

export interface VisualSelectOutput {
  selected: { candidateId: string; reason: string }[];
  note?: string;
}

/** 表达方式优先级：先互补（时间线/矩阵/关系/占比），再补表格与清单 */
const VISUAL_TYPE_PRIORITY = [
  "timeline",
  "line",
  "risk_matrix",
  "relation_graph",
  "donut",
  "hbar",
  "bar",
  "grouped_bar",
  "table",
  "checklist",
];

/**
 * 图表选择的规则兜底：按表达方式多样性挑选，避免两张图讲同一件事。
 * 与 LLM 输出同一契约，保证无模型时也能展示“摘要素 + 图表 + 表格/时间线 + 待办”。
 */
export function mockVisualSelect(input: VisualSelectInput): VisualSelectOutput {
  const max = Math.min(Math.max(input.max ?? 4, 1), 6);
  const picked: { candidateId: string; reason: string }[] = [];
  const pickedIds = new Set<string>();
  const usedTypes = new Set<string>();

  for (const type of VISUAL_TYPE_PRIORITY) {
    if (picked.length >= max) break;
    if (usedTypes.has(type)) continue;
    const candidate = input.candidates.find((item) => item.type === type && !pickedIds.has(item.id));
    if (!candidate) continue;
    picked.push({ candidateId: candidate.id, reason: candidate.rationale.slice(0, 60) });
    pickedIds.add(candidate.id);
    usedTypes.add(type);
  }

  for (const candidate of input.candidates) {
    if (picked.length >= max) break;
    if (pickedIds.has(candidate.id)) continue;
    picked.push({ candidateId: candidate.id, reason: candidate.rationale.slice(0, 60) });
    pickedIds.add(candidate.id);
  }

  return {
    selected: picked,
    note: picked.length === 0 ? "当前没有合适的数据可视化，改用文字说明。" : undefined,
  };
}
