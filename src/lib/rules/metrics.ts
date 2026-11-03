import { ASSET_CATEGORY_META, LIABILITY_CATEGORY_META, MATURITY_BUCKETS } from "@/lib/constants";
import type {
  AssetLike,
  CategorySlice,
  LiabilityLike,
  LiquidityTier,
  PortfolioMetrics,
} from "@/lib/types/domain";
import { convertToCnyCents } from "./fx";
import { centsToYuan, clamp } from "./money";

export interface MetricsInput {
  assets: AssetLike[];
  liabilities: LiabilityLike[];
  /** 每月必要生活支出（元）。未填写时应急金月数返回 null */
  monthlySpend?: number | null;
}

interface Bucket {
  cents: number;
  count: number;
}

function ratio(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return part / total;
}

function toSlices(
  buckets: Map<string, Bucket>,
  totalCents: number,
  labelOf: (key: string) => string,
  colorOf: (key: string) => string,
): CategorySlice[] {
  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      label: labelOf(key),
      valueCny: centsToYuan(bucket.cents),
      share: ratio(bucket.cents, totalCents),
      count: bucket.count,
      color: colorOf(key),
    }))
    .sort((a, b) => b.valueCny - a.valueCny);
}

function addTo(map: Map<string, Bucket>, key: string, cents: number) {
  const existing = map.get(key) ?? { cents: 0, count: 0 };
  map.set(key, { cents: existing.cents + cents, count: existing.count + 1 });
}

function maturityBucketOf(months: number | null | undefined): string {
  if (months === null || months === undefined || !Number.isFinite(months)) return "unknown";
  for (const bucket of MATURITY_BUCKETS) {
    if (bucket.key === "unknown") continue;
    if (months <= bucket.max) return bucket.key;
  }
  return "60+";
}

/**
 * 资产结构指标。
 * 所有金额先折算为人民币“分”后聚合，再统一还原为元，保证可复现、无浮点漂移。
 * 空数据不会产生 NaN / Infinity：比率一律返回 null 或 0。
 */
export function computePortfolioMetrics(input: MetricsInput): PortfolioMetrics {
  const { assets, liabilities } = input;
  const monthlySpend =
    input.monthlySpend !== null && input.monthlySpend !== undefined && input.monthlySpend > 0
      ? input.monthlySpend
      : null;

  let totalAssetsCents = 0;
  let totalLiabilitiesCents = 0;
  let cashLikeCents = 0;
  let equityCents = 0;
  let foreignCents = 0;
  let longTermCents = 0;

  const categoryBuckets = new Map<string, Bucket>();
  const currencyBuckets = new Map<string, Bucket>();
  const liquidityBuckets = new Map<string, Bucket>();
  const maturityBuckets = new Map<string, Bucket>();

  for (const asset of assets) {
    const meta = ASSET_CATEGORY_META[asset.category] ?? ASSET_CATEGORY_META.OTHER;
    let cents = 0;
    try {
      cents = convertToCnyCents(asset.amount, asset.currency);
    } catch {
      cents = 0; // 未知币种由写入层拦截；这里兜底避免整页崩溃
    }
    totalAssetsCents += cents;

    addTo(categoryBuckets, asset.category, cents);

    const currency = asset.currency || "CNY";
    addTo(currencyBuckets, currency, cents);
    if (currency !== "CNY") foreignCents += cents;

    const liquidity: LiquidityTier = asset.liquidity ?? meta.liquidity;
    addTo(liquidityBuckets, liquidity, cents);

    const maturityKey = maturityBucketOf(asset.maturityMonths);
    const maturityMeta = MATURITY_BUCKETS.find((b) => b.key === maturityKey);
    addTo(maturityBuckets, maturityKey, cents);

    if (meta.cashLike) cashLikeCents += cents;
    if (meta.equityLike) equityCents += cents;

    const months = asset.maturityMonths;
    if (monthsMoveToLongTerm(maturityMeta?.key, months)) longTermCents += cents;
  }

  for (const liability of liabilities) {
    try {
      totalLiabilitiesCents += convertToCnyCents(liability.amount, liability.currency);
    } catch {
      /* 同上：数据已校验，异常时忽略该条，不污染整体 */
    }
  }

  const categoryMix = toSlices(
    categoryBuckets,
    totalAssetsCents,
    (key) => ASSET_CATEGORY_META[key as keyof typeof ASSET_CATEGORY_META]?.label ?? key,
    (key) => ASSET_CATEGORY_META[key as keyof typeof ASSET_CATEGORY_META]?.color ?? "#94a3b8",
  );
  const currencyMix = toSlices(currencyBuckets, totalAssetsCents, (key) => key, () => "#0ea5e9");
  const liquidityMix = toSlices(
    liquidityBuckets,
    totalAssetsCents,
    (key) => ({ HIGH: "高流动性", MEDIUM: "中流动性", LOW: "低流动性" })[key] ?? key,
    (key) => ({ HIGH: "#22c55e", MEDIUM: "#f59e0b", LOW: "#ef4444" })[key] ?? "#94a3b8",
  );
  const maturityMix = toSlices(
    maturityBuckets,
    totalAssetsCents,
    (key) => MATURITY_BUCKETS.find((b) => b.key === key)?.label ?? key,
    () => "#6366f1",
  );

  const hhi = categoryMix.reduce((acc, slice) => acc + slice.share * slice.share, 0);
  const topCategoryShare = categoryMix[0]?.share ?? 0;
  const top3Share = categoryMix.slice(0, 3).reduce((acc, slice) => acc + slice.share, 0);

  const monthlySpendCents = monthlySpend ? Math.round(monthlySpend * 100) : 0;
  const emergencyMonths =
    monthlySpendCents > 0 ? Math.round((cashLikeCents / monthlySpendCents) * 10) / 10 : null;

  const monthlyDebtPayment = liabilities.reduce((acc, item) => {
    if (!item.monthlyPayment || !Number.isFinite(item.monthlyPayment)) return acc;
    try {
      return acc + convertToCnyCents(item.monthlyPayment, item.currency);
    } catch {
      return acc;
    }
  }, 0);

  const { completeness, missingFields } = computeCompleteness(assets, liabilities);

  return {
    totalAssetsCny: centsToYuan(totalAssetsCents),
    totalLiabilitiesCny: centsToYuan(totalLiabilitiesCents),
    netWorthCny: centsToYuan(totalAssetsCents - totalLiabilitiesCents),
    debtRatio:
      totalAssetsCents > 0 ? clamp(totalLiabilitiesCents / totalAssetsCents, 0, 10) : null,
    categoryMix,
    currencyMix,
    liquidityMix,
    maturityMix,
    hhi: Math.round(hhi * 10000) / 10000,
    topCategoryShare: Math.round(topCategoryShare * 10000) / 10000,
    top3Share: Math.round(top3Share * 10000) / 10000,
    emergencyMonths,
    monthlySpend,
    equityShare: totalAssetsCents > 0 ? Math.round((equityCents / totalAssetsCents) * 10000) / 10000 : null,
    foreignShare: totalAssetsCents > 0 ? Math.round((foreignCents / totalAssetsCents) * 10000) / 10000 : 0,
    longTermShare: totalAssetsCents > 0 ? Math.round((longTermCents / totalAssetsCents) * 10000) / 10000 : 0,
    liquidAssetsCny: centsToYuan(cashLikeCents),
    completeness,
    missingFields,
    assetCount: assets.length,
    liabilityCount: liabilities.length,
    monthlyDebtPayment: centsToYuan(monthlyDebtPayment),
  };
}

function monthsMoveToLongTerm(bucketKey: string | undefined, months: number | null | undefined): boolean {
  if (bucketKey === "60+" || bucketKey === "37-60") return true;
  return typeof months === "number" && months > 36;
}

export function computeCompleteness(
  assets: AssetLike[],
  liabilities: LiabilityLike[],
): { completeness: number; missingFields: string[] } {
  const assetFields: { key: string; label: string; filled: (a: AssetLike) => boolean }[] = [
    { key: "institution", label: "资产-持有机构", filled: (a) => Boolean(a.institution) },
    { key: "industry", label: "资产-所属行业", filled: (a) => Boolean(a.industry) },
    { key: "maturity", label: "资产-剩余期限", filled: (a) => typeof a.maturityMonths === "number" },
    { key: "note", label: "资产-备注", filled: (a) => Boolean(a.note) },
  ];
  const liabilityFields: { key: string; label: string; filled: (l: LiabilityLike) => boolean }[] = [
    { key: "rate", label: "负债-利率", filled: (l) => typeof l.interestRate === "number" },
    { key: "term", label: "负债-剩余期限", filled: (l) => typeof l.remainingMonths === "number" },
    { key: "note", label: "负债-备注", filled: (l) => Boolean(l.note) },
  ];

  let filledCount = 0;
  let totalCount = 0;
  const missing = new Map<string, number>();

  for (const asset of assets) {
    for (const field of assetFields) {
      totalCount += 1;
      if (field.filled(asset)) filledCount += 1;
      else missing.set(field.label, (missing.get(field.label) ?? 0) + 1);
    }
  }
  for (const liability of liabilities) {
    for (const field of liabilityFields) {
      totalCount += 1;
      if (field.filled(liability)) filledCount += 1;
      else missing.set(field.label, (missing.get(field.label) ?? 0) + 1);
    }
  }

  if (totalCount === 0) {
    return { completeness: 0, missingFields: ["尚未录入任何资产或负债"] };
  }

  const completeness = Math.round((filledCount / totalCount) * 100);
  const missingFields = [...missing.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => `${label}（${count} 条未填）`);

  return { completeness, missingFields };
}

/** 负债类别汇总（用于图表与报告） */
export function liabilityMix(liabilities: LiabilityLike[]) {
  const buckets = new Map<string, Bucket>();
  let total = 0;
  for (const item of liabilities) {
    try {
      const cents = convertToCnyCents(item.amount, item.currency);
      total += cents;
      addTo(buckets, item.category, cents);
    } catch {
      /* ignore */
    }
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => ({
      key,
      label: LIABILITY_CATEGORY_META[key as keyof typeof LIABILITY_CATEGORY_META]?.label ?? key,
      valueCny: centsToYuan(bucket.cents),
      share: ratio(bucket.cents, total),
      count: bucket.count,
      color: LIABILITY_CATEGORY_META[key as keyof typeof LIABILITY_CATEGORY_META]?.color ?? "#94a3b8",
    }))
    .sort((a, b) => b.valueCny - a.valueCny);
}
