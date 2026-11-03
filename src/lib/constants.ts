import type {
  AssetCategory,
  Currency,
  LiabilityCategory,
  LiquidityTier,
  RiskBand,
  TopicKind,
} from "@/lib/types/domain";

/** 全站统一风险提示：API meta、报告、导出、页面底栏复用同一份文案 */
export const DISCLAIMER_ZH =
  "本内容基于公开数据、历史统计与你录入的信息，给出资产大类、策略权重、ETF/基金筛选与再平衡建议；不推荐个股，不给目标价、止损位或买卖点，不承诺收益。回测、VaR 与压力测试均基于历史样本与假设，不代表未来。示例数据由应用内置，请勿填入真实敏感信息。投资有风险，决策前请核对数据并咨询持牌专业人士。";

export const DISCLAIMER_SHORT = "资产配置建议，不推荐个股，不承诺收益；投资有风险。";

export const DEMO_BADGE_TEXT = "演示数据 · 虚构";

export const APP_NAME = "知衡 FinScope";
export const APP_TAGLINE = "看得懂市场，配得清资产。";

/** 参考汇率：1 单位外币 = N 元人民币。固定常量，非实时行情。 */
export const DEMO_FX_RATES: Record<Currency, number> = {
  CNY: 1,
  USD: 7.15,
  HKD: 0.92,
  EUR: 7.78,
  JPY: 0.048,
};

export const FX_NOTE = "参考汇率（固定常数，非实时行情），仅用于展示折算方法。";

export const CURRENCIES: Currency[] = ["CNY", "USD", "HKD", "EUR", "JPY"];

export const CURRENCY_LABELS: Record<Currency, string> = {
  CNY: "人民币",
  USD: "美元",
  HKD: "港币",
  EUR: "欧元",
  JPY: "日元",
};

/** 类别元数据：标签、配色、默认流动性、是否计入“准现金” */
export const ASSET_CATEGORY_META: Record<
  AssetCategory,
  { label: string; short: string; color: string; liquidity: LiquidityTier; cashLike: boolean; equityLike: boolean }
> = {
  CASH: { label: "现金", short: "现金", color: "#0ea5e9", liquidity: "HIGH", cashLike: true, equityLike: false },
  DEPOSIT: { label: "银行存款", short: "存款", color: "#22c55e", liquidity: "HIGH", cashLike: true, equityLike: false },
  MONEY_FUND: { label: "货币基金", short: "货基", color: "#14b8a6", liquidity: "HIGH", cashLike: true, equityLike: false },
  BOND: { label: "债券/债基", short: "债券", color: "#6366f1", liquidity: "MEDIUM", cashLike: false, equityLike: false },
  STOCK: { label: "股票", short: "股票", color: "#f97316", liquidity: "MEDIUM", cashLike: false, equityLike: true },
  FUND: { label: "公募基金", short: "基金", color: "#ec4899", liquidity: "MEDIUM", cashLike: false, equityLike: true },
  REAL_ESTATE: { label: "房产", short: "房产", color: "#a855f7", liquidity: "LOW", cashLike: false, equityLike: false },
  INSURANCE: { label: "保险（现金价值）", short: "保险", color: "#64748b", liquidity: "LOW", cashLike: false, equityLike: false },
  OTHER: { label: "其他资产", short: "其他", color: "#94a3b8", liquidity: "MEDIUM", cashLike: false, equityLike: false },
};

export const ASSET_CATEGORIES = Object.keys(ASSET_CATEGORY_META) as AssetCategory[];

export const LIABILITY_CATEGORY_META: Record<LiabilityCategory, { label: string; color: string }> = {
  MORTGAGE: { label: "房贷", color: "#ef4444" },
  CONSUMER_LOAN: { label: "消费贷", color: "#f59e0b" },
  CARD: { label: "信用卡", color: "#f43f5e" },
  CAR_LOAN: { label: "车贷", color: "#8b5cf6" },
  OTHER: { label: "其他负债", color: "#78716c" },
};

export const LIABILITY_CATEGORIES = Object.keys(LIABILITY_CATEGORY_META) as LiabilityCategory[];

export const LIQUIDITY_LABELS: Record<LiquidityTier, string> = {
  HIGH: "高流动性（随时可用）",
  MEDIUM: "中流动性（数日内可变现）",
  LOW: "低流动性（不易快速变现）",
};

export const MATURITY_BUCKETS = [
  { key: "0-3", label: "3 个月内", max: 3 },
  { key: "4-12", label: "4–12 个月", max: 12 },
  { key: "13-36", label: "1–3 年", max: 36 },
  { key: "37-60", label: "3–5 年", max: 60 },
  { key: "60+", label: "5 年以上", max: Number.POSITIVE_INFINITY },
  { key: "unknown", label: "未填期限", max: -1 },
] as const;

/** 风险带：仅用于“结构偏离提示”，不构成适当性建议 */
export const RISK_BAND_META: Record<
  RiskBand,
  { label: string; color: string; equityRange: [number, number]; cashFloor: number }
> = {
  CONSERVATIVE: { label: "保守型", color: "#0ea5e9", equityRange: [0, 0.1], cashFloor: 0.5 },
  STEADY: { label: "稳健型", color: "#22c55e", equityRange: [0.1, 0.25], cashFloor: 0.35 },
  BALANCED: { label: "平衡型", color: "#eab308", equityRange: [0.25, 0.45], cashFloor: 0.2 },
  GROWTH: { label: "成长型", color: "#f97316", equityRange: [0.45, 0.65], cashFloor: 0.1 },
  AGGRESSIVE: { label: "进取型", color: "#ef4444", equityRange: [0.65, 1], cashFloor: 0.05 },
};

export const RISK_BANDS = Object.keys(RISK_BAND_META) as RiskBand[];

export const TOPIC_KIND_META: Record<TopicKind, { label: string; color: string }> = {
  industry: { label: "行业", color: "#2563eb" },
  macro: { label: "宏观", color: "#7c3aed" },
  fx: { label: "汇率", color: "#0891b2" },
  policy: { label: "政策", color: "#16a34a" },
  company: { label: "公司", color: "#ea580c" },
  commodity: { label: "大宗商品", color: "#a16207" },
};

/** 文章级事件类型的中文标签：文章、事件、图表共用 */
export const ARTICLE_EVENT_TYPE_LABELS: Record<string, string> = {
  macro_data: "宏观数据",
  policy: "政策监管",
  company_event: "公司事件",
  market_move: "市场行情",
  industry_survey: "行业调研",
  rumor: "传闻待证",
  other: "其他",
};

export const QUALITY_FLAG_LABELS: Record<string, string> = {
  NO_URL: "无原文链接",
  CLICKBAIT: "标题党用词",
  RUMOR: "未经证实表述",
  NO_NUMBER: "无具体数据",
  TOO_SHORT: "正文过短",
  NO_SOURCE_TIME: "缺少来源时间",
  LOW_CREDIBILITY_SOURCE: "来源可信度低",
};

export const IMPACT_DIMENSIONS = ["宏观", "行业", "公司", "汇率", "政策", "流动性"] as const;
export type ImpactDimension = (typeof IMPACT_DIMENSIONS)[number];

/** 体检阈值集中管理，便于测试与答辩讲解 */
export const THRESHOLDS = {
  hhi: 0.25,
  topCategory: 0.5,
  topCategoryRisk: 0.7,
  emergencyWarn: 3,
  emergencyRisk: 1,
  foreignShare: 0.3,
  longTermShare: 0.6,
  longTermLowLiquidity: 0.15,
  debtRatioWarn: 0.5,
  debtRatioRisk: 0.7,
  highRate: 8,
  completenessLow: 60,
  cluster: { jaccard: 0.42, cosine: 0.55, windowHours: 72, entityOverlap: 0.7 },
} as const;

export const REPORT_TYPE_LABELS: Record<string, string> = {
  BRIEF: "情报简报",
  CHECKUP: "结构体检",
};

export const PAGE_SIZE_DEFAULT = 12;

export const STORAGE_KEYS = {
  lastTab: "finscope:intel:tab",
  importedOnce: "finscope:imported",
} as const;
