/**
 * 领域类型：规则层、服务层、前端共享。
 * 说明：这些类型只描述“结构”，所有计算口径见 src/lib/rules/*。
 */

export type Currency = "CNY" | "USD" | "HKD" | "EUR" | "JPY";

export type AssetCategory =
  | "CASH"
  | "DEPOSIT"
  | "MONEY_FUND"
  | "BOND"
  | "STOCK"
  | "FUND"
  | "REAL_ESTATE"
  | "INSURANCE"
  | "OTHER";

export type LiabilityCategory =
  | "MORTGAGE"
  | "CONSUMER_LOAN"
  | "CARD"
  | "CAR_LOAN"
  | "OTHER";

export type LiquidityTier = "HIGH" | "MEDIUM" | "LOW";

export type RiskBand =
  | "CONSERVATIVE"
  | "STEADY"
  | "BALANCED"
  | "GROWTH"
  | "AGGRESSIVE";

export type TopicKind =
  | "industry"
  | "macro"
  | "fx"
  | "policy"
  | "company"
  | "commodity";

export type Sentiment = "neutral" | "positive" | "negative" | "mixed";

/** 文章级抽取：实体、事件类型、关键数值、主张 */
export type EntityType = "ORG" | "PERSON" | "LOCATION" | "PRODUCT" | "INDICATOR" | "POLICY";

export interface ExtractedEntity {
  name: string;
  type: EntityType;
  role?: string;
}

export type ArticleEventType =
  | "macro_data"
  | "policy"
  | "company_event"
  | "market_move"
  | "industry_survey"
  | "rumor"
  | "other";

export type ClaimKind = "fact" | "claim" | "estimate" | "opinion" | "denial";

export interface KeyNumber {
  label: string;
  value: number;
  unit: string;
  period?: string;
  context?: string;
}

export interface ArticleClaim {
  text: string;
  kind: ClaimKind;
  sourceName?: string;
}

export interface ArticleExtraction {
  entities: ExtractedEntity[];
  eventType: ArticleEventType;
  keyNumbers: KeyNumber[];
  claims: ArticleClaim[];
  regions: string[];
  currencies: string[];
}

export type FindingLevel = "info" | "warn" | "risk";

/** AI 产物的来源模式；fallback 表示 LLM 失败后已降级为规则模板 */
export type LLMMode = "mock" | "llm" | "fallback";

export interface AssetLike {
  id?: string;
  name: string;
  category: AssetCategory;
  currency: Currency;
  amount: number;
  institution?: string | null;
  industry?: string | null;
  liquidity?: LiquidityTier | null;
  maturityMonths?: number | null;
  note?: string | null;
}

export interface LiabilityLike {
  id?: string;
  name: string;
  category: LiabilityCategory;
  currency: Currency;
  amount: number;
  interestRate?: number | null;
  monthlyPayment?: number | null;
  remainingMonths?: number | null;
  note?: string | null;
}

export interface CategorySlice {
  key: string;
  label: string;
  valueCny: number;
  share: number;
  count: number;
  color: string;
}

export interface PortfolioMetrics {
  totalAssetsCny: number;
  totalLiabilitiesCny: number;
  netWorthCny: number;
  debtRatio: number | null;
  categoryMix: CategorySlice[];
  currencyMix: CategorySlice[];
  liquidityMix: CategorySlice[];
  maturityMix: CategorySlice[];
  hhi: number;
  topCategoryShare: number;
  top3Share: number;
  emergencyMonths: number | null;
  monthlySpend: number | null;
  equityShare: number | null;
  foreignShare: number;
  longTermShare: number;
  liquidAssetsCny: number;
  completeness: number;
  missingFields: string[];
  assetCount: number;
  liabilityCount: number;
  monthlyDebtPayment: number;
}

export interface Finding {
  id: string;
  level: FindingLevel;
  title: string;
  detail: string;
  evidence: string;
  todo?: string;
}

export interface CheckupResult {
  findings: Finding[];
  levelCounts: Record<FindingLevel, number>;
  headlines: { label: string; value: string; hint?: string }[];
  riskBand: RiskBand | null;
  generatedAt: string;
}

export interface RiskProfileResult {
  score: number;
  band: RiskBand;
  bandLabel: string;
  equityRange: [number, number];
  answered: number;
}

export interface ArticleLike {
  id?: string;
  title: string;
  summary: string;
  content?: string | null;
  url?: string | null;
  publishedAt: Date | string;
  region?: string | null;
  currency?: string | null;
  qualityScore?: number;
  sourceId?: string;
  sourceName?: string;
  sourceCredibility?: number;
  topics?: { slug: string; name: string; score: number }[];
}

export interface TopicLike {
  id?: string;
  slug: string;
  name: string;
  kind: TopicKind;
  keywords: string[];
  color?: string;
  followed?: boolean;
  sortOrder?: number;
}

export interface ClusterExplain {
  sharedKeywords: string[];
  sharedEntities: string[];
  similarity: number;
  timeGapHours: number;
  rule: "JACCARD" | "COSINE" | "TITLE" | "ENTITY";
}

export interface ClusterMember {
  index: number;
  title: string;
  publishedAt: string;
}

export interface ArticleCluster {
  signature: string;
  title: string;
  summary: string;
  members: ClusterMember[];
  memberIndexes: number[];
  articleCount: number;
  sourceCount: number;
  credibility: number;
  completeness: number;
  firstSeenAt: string;
  lastSeenAt: string;
  themes: string[];
  industries: string[];
  regions: string[];
  currencies: string[];
  sentiment: Sentiment;
  eventType: ArticleEventType;
  entities: { name: string; type: EntityType }[];
  explain: ClusterExplain;
}

/** 事件级分析：共识、分歧、时间线、信息缺口（R2 由规则 / LLM 生成并持久化） */
export type DisagreementNature = "数据口径" | "事实描述" | "时间安排" | "因果解释";

export interface EventConsensusPoint {
  point: string;
  articleIds: string[];
}

export interface EventDisagreementPosition {
  stance: string;
  articleIds: string[];
  sourceNames: string[];
  quote?: string;
}

export interface EventDisagreement {
  topic: string;
  nature: DisagreementNature;
  positions: EventDisagreementPosition[];
}

export interface EventTimelineItem {
  at: string;
  label: string;
  articleId?: string;
}

/** 事件为何被归为一组：规则可解释，避免“黑箱聚类” */
export interface EventGrouping {
  rule: string;
  similarity: number;
  timeGapHours: number;
  sharedKeywords: string[];
  sharedEntities: string[];
  reason: string;
}

export interface EventAnalysis {
  headline: string;
  consensus: EventConsensusPoint[];
  disagreements: EventDisagreement[];
  timeline: EventTimelineItem[];
  keyNumbers: { label: string; value: number; unit: string; articleId?: string; sourceName?: string }[];
  entities: { name: string; type: EntityType }[];
  gaps: string[];
  impactDims: string[];
  confidenceNote: string;
  grouping?: EventGrouping;
  /** 生成该分析时的事件成员指纹；成员变化后用于判断是否需要重算 */
  evidenceHash?: string;
  generatedAt?: string;
}

export interface Citation {
  type: "article" | "asset" | "liability" | "metric" | "event" | "topic";
  id: string;
  label: string;
  snippet?: string;
  meta?: Record<string, string>;
}

export interface ExposureItem {
  topic: { id?: string; slug: string; name: string; kind: TopicKind; color?: string };
  exposureShare: number;
  matchedAssets: { id?: string; name: string; category: string; amountCny: number; reason: string }[];
  note: string;
}

/**
 * 建议契约（Advice）。
 *
 * 产品边界：给“配置与结构建议”，不点名具体股票/基金、不给目标价、不预测点位。
 * 建议必须能回溯到用户录入的资产、风险画像与本地资讯；规则模式与模型模式共用同一契约。
 */
export type AdviceAction = "BUY" | "SELL" | "HOLD" | "REBALANCE" | "WAIT";
export type AdvicePriority = "high" | "medium" | "low";
export type AdviceConfidence = "low" | "medium" | "high";
export type AdviceDirection = "increase" | "reduce" | "hold";
export type AdviceHorizon = "short" | "medium" | "long";

export interface AdviceAllocation {
  /** 资产类别标签，与 ASSET_CATEGORY_META 的中文 label 对齐，如「股票」「存款」 */
  category: string;
  /** 当前占比（百分数 0–100） */
  currentShare: number;
  /** 目标占比（百分数 0–100） */
  targetShare: number;
  direction: AdviceDirection;
  priority: AdvicePriority;
  rationale: string;
}

export interface AdviceStep {
  step: string;
  priority: AdvicePriority;
  rationale: string;
}

export interface Advice {
  action: AdviceAction;
  /** 1–2 句结论 */
  summary: string;
  allocations: AdviceAllocation[];
  steps: AdviceStep[];
  risks: string[];
  confidence: AdviceConfidence;
  horizon?: AdviceHorizon;
  /** 命中「个股/点位」类问题时，说明为什么只给结构建议（不是拒答） */
  scopeNote?: string;
}

/**
 * 图表契约（chart spec）。
 *
 * 模型只决定“用哪种表达、选哪个候选、给什么标题与理由”，数据由服务端按
 * dataRef 从数据库聚合后注入，因此图上的每个数字都能追溯到具体表与字段。
 */
export type ChartType =
  | "donut"
  | "bar"
  | "hbar"
  | "line"
  | "grouped_bar"
  | "table"
  | "timeline"
  | "risk_matrix"
  | "relation_graph"
  | "checklist";

export interface ChartPoint {
  label: string;
  value: number;
  value2?: number;
  group?: string;
  color?: string;
}

export interface ChartSeries {
  key: string;
  label: string;
  color?: string;
}

export interface ChartTableColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface ChartSpec {
  id: string;
  type: ChartType;
  title: string;
  subtitle?: string;
  unit?: string;
  points?: ChartPoint[];
  series?: ChartSeries[];
  table?: { columns: ChartTableColumn[]; rows: Record<string, string | number>[] };
  timeline?: { at: string; label: string; detail?: string }[];
  matrix?: { label: string; x: number; y: number; size?: number; group?: string }[];
  nodes?: { id: string; label: string; group?: string; weight?: number }[];
  edges?: { from: string; to: string; label?: string }[];
  checklist?: { text: string; hint?: string }[];
  axes?: { x?: string; y?: string };
  citations: Citation[];
  /** 数据来源说明，例如「Asset 表按 category 聚合」 */
  source: string;
  rationale?: string;
  note?: string;
  disclaimer?: string;
}

export interface VisualSelection {
  candidateId: string;
  reason?: string;
}
