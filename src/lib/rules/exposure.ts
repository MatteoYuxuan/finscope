import { ASSET_CATEGORY_META } from "@/lib/constants";
import type { AssetLike, ExposureItem, TopicKind, TopicLike } from "@/lib/types/domain";
import { convertToCnyCents } from "./fx";
import { centsToYuan } from "./money";

const EXPOSURE_NOTE =
  "按你填写的资产类别、币种与行业标签做的粗粒度匹配，可能遗漏或误配；这是解释性关联，不是投资分析。";

interface TopicRule {
  weight: number;
  reason: string;
  match: (asset: AssetLike, topic: TopicLike, keywords: string[]) => boolean;
}

const KIND_RULES: Record<TopicKind, TopicRule> = {
  fx: {
    weight: 1,
    reason: "以外币计价，汇率折算会影响其人民币价值",
    match: (asset, topic, keywords) => {
      if (asset.currency !== "CNY") return true;
      const text = `${asset.name}${asset.note ?? ""}`;
      return keywords.some((keyword) => text.includes(keyword));
    },
  },
  industry: {
    weight: 1,
    reason: "所属行业与该主题相关（按你填写的行业标签匹配）",
    match: (asset, topic, keywords) => {
      const text = `${asset.industry ?? ""}${asset.name}${asset.note ?? ""}`;
      if (keywords.some((keyword) => text.includes(keyword))) return true;
      // 权益类资产即便没填行业，也可能间接暴露；按 0.5 权重计入
      return ASSET_CATEGORY_META[asset.category]?.equityLike === true;
    },
  },
  company: {
    weight: 1,
    reason: "与该公司的产业链或行业标签相关",
    match: (asset, topic, keywords) => {
      const text = `${asset.industry ?? ""}${asset.name}${asset.note ?? ""}`;
      return keywords.some((keyword) => text.includes(keyword));
    },
  },
  macro: {
    weight: 0.5,
    reason: "宏观变量会通过整体资产价格与利率环境影响所有类别",
    match: () => true,
  },
  policy: {
    weight: 0.5,
    reason: "政策变化可能影响相关行业的经营环境",
    match: (asset, topic, keywords) => {
      if (keywords.length === 0) return true;
      const text = `${asset.industry ?? ""}${asset.name}${asset.note ?? ""}`;
      return keywords.some((keyword) => text.includes(keyword)) || topic.kind === "policy";
    },
  },
  commodity: {
    weight: 1,
    reason: "大宗商品价格会传导到相关行业成本",
    match: (asset, topic, keywords) => {
      const text = `${asset.industry ?? ""}${asset.name}${asset.note ?? ""}`;
      return keywords.some((keyword) => text.includes(keyword));
    },
  },
};

/**
 * 情报 × 资产：把“关注的主题”映射到“我的资产条目”。
 * 输出的是粗粒度暴露占比（按权重折算），不是风险敞口模型。
 */
export function mapExposure(
  assets: AssetLike[],
  topics: TopicLike[],
  totalAssetsCny?: number,
): ExposureItem[] {
  const totalCents =
    totalAssetsCny !== undefined
      ? Math.round(totalAssetsCny * 100)
      : assets.reduce((acc, asset) => {
          try {
            return acc + convertToCnyCents(asset.amount, asset.currency);
          } catch {
            return acc;
          }
        }, 0);

  const items: ExposureItem[] = [];

  for (const topic of topics) {
    const rule = KIND_RULES[topic.kind] ?? KIND_RULES.macro;
    const matched: ExposureItem["matchedAssets"] = [];
    let weightedCents = 0;

    for (const asset of assets) {
      if (!rule.match(asset, topic, topic.keywords)) continue;
      let cents = 0;
      try {
        cents = convertToCnyCents(asset.amount, asset.currency);
      } catch {
        continue;
      }
      weightedCents += Math.round(cents * rule.weight);
      matched.push({
        id: asset.id,
        name: asset.name,
        category: asset.category,
        amountCny: centsToYuan(cents),
        reason: rule.reason,
      });
    }

    if (matched.length === 0) continue;

    items.push({
      topic: {
        id: topic.id,
        slug: topic.slug,
        name: topic.name,
        kind: topic.kind,
        color: topic.color,
      },
      exposureShare: totalCents > 0 ? Math.round((weightedCents / totalCents) * 10000) / 10000 : 0,
      matchedAssets: matched.sort((a, b) => b.amountCny - a.amountCny),
      note: EXPOSURE_NOTE,
    });
  }

  return items.sort((a, b) => b.exposureShare - a.exposureShare);
}

export { EXPOSURE_NOTE };
