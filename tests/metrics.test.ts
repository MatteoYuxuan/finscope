import { describe, expect, it } from "vitest";
import type { AssetLike, LiabilityLike } from "@/lib/types/domain";
import { computeCompleteness, computePortfolioMetrics, liabilityMix } from "@/lib/rules/metrics";

const assets: AssetLike[] = [
  { name: "工资卡活期", category: "CASH", currency: "CNY", amount: 10000, liquidity: "HIGH" },
  { name: "沪深300指数基金", category: "STOCK", currency: "CNY", amount: 20000, industry: "宽基指数" },
  { name: "美股科技ETF", category: "FUND", currency: "USD", amount: 1000, industry: "科技", maturityMonths: 60 },
];

const liabilities: LiabilityLike[] = [
  { name: "消费分期", category: "CONSUMER_LOAN", currency: "CNY", amount: 5000, interestRate: 9.5, monthlyPayment: 500, remainingMonths: 10 },
];

describe("资产结构指标", () => {
  const metrics = computePortfolioMetrics({ assets, liabilities, monthlySpend: 5000 });

  it("总资产 / 总负债 / 净资产按人民币分聚合", () => {
    expect(metrics.totalAssetsCny).toBe(37150);
    expect(metrics.totalLiabilitiesCny).toBe(5000);
    expect(metrics.netWorthCny).toBe(32150);
    expect(metrics.assetCount).toBe(3);
    expect(metrics.liabilityCount).toBe(1);
  });

  it("负债率、外币占比、权益占比、长期占比", () => {
    expect(metrics.debtRatio).toBeCloseTo(5000 / 37150, 6);
    expect(metrics.foreignShare).toBeCloseTo(0.1925, 4);
    expect(metrics.equityShare).toBeCloseTo(0.731, 3);
    expect(metrics.longTermShare).toBeCloseTo(0.1925, 4);
  });

  it("HHI 为各类别占比平方和，最大类别占比正确", () => {
    expect(metrics.topCategoryShare).toBeCloseTo(0.5384, 4);
    expect(metrics.hhi).toBeGreaterThan(0.39);
    expect(metrics.hhi).toBeLessThan(0.4);
  });

  it("应急金月数 = 现金类 ÷ 月必要支出", () => {
    expect(metrics.liquidAssetsCny).toBe(10000);
    expect(metrics.emergencyMonths).toBe(2);
    expect(metrics.monthlyDebtPayment).toBe(500);
  });

  it("类别/币种/流动性构成按金额降序", () => {
    expect(metrics.categoryMix[0].key).toBe("STOCK");
    expect(metrics.currencyMix[0].key).toBe("CNY");
    expect(metrics.liquidityMix.map((item) => item.key)).toContain("HIGH");
  });
});

describe("边界情况不会产生 NaN", () => {
  it("空资产清单", () => {
    const empty = computePortfolioMetrics({ assets: [], liabilities: [] });
    expect(empty.totalAssetsCny).toBe(0);
    expect(empty.debtRatio).toBeNull();
    expect(empty.equityShare).toBeNull();
    expect(empty.emergencyMonths).toBeNull();
    expect(empty.hhi).toBe(0);
    expect(Number.isNaN(empty.foreignShare)).toBe(false);
    expect(empty.completeness).toBe(0);
    expect(empty.missingFields[0]).toContain("尚未录入");
  });

  it("未填写月支出时应急金月数为 null，而不是 Infinity", () => {
    const noSpend = computePortfolioMetrics({ assets, liabilities: [] });
    expect(noSpend.emergencyMonths).toBeNull();
  });
});

describe("信息完整度", () => {
  it("按可选字段填充率计算，并给出缺失提示", () => {
    const { completeness, missingFields } = computeCompleteness(assets, liabilities);
    expect(completeness).toBeGreaterThan(0);
    expect(completeness).toBeLessThan(100);
    expect(missingFields.length).toBeGreaterThan(0);
  });
});

describe("负债构成", () => {
  it("按类别聚合且带颜色", () => {
    const mix = liabilityMix(liabilities);
    expect(mix).toHaveLength(1);
    expect(mix[0].key).toBe("CONSUMER_LOAN");
    expect(mix[0].share).toBe(1);
    expect(mix[0].color).toMatch(/^#/);
  });
});
