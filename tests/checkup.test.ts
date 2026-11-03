import { describe, expect, it } from "vitest";
import { runCheckup } from "@/lib/rules/checkup";
import { computePortfolioMetrics } from "@/lib/rules/metrics";
import type { AssetLike, LiabilityLike } from "@/lib/types/domain";

function metricsOf(assets: AssetLike[], liabilities: LiabilityLike[] = [], monthlySpend?: number) {
  return computePortfolioMetrics({ assets, liabilities, monthlySpend });
}

describe("结构体检：触发条件", () => {
  it("没有数据时只给一条引导提示", () => {
    const checkup = runCheckup(metricsOf([]), null);
    expect(checkup.findings).toHaveLength(1);
    expect(checkup.findings[0].id).toBe("NO_DATA");
    expect(checkup.levelCounts.info).toBe(1);
  });

  it("单一类别占满时，集中度提示为 risk 级", () => {
    const checkup = runCheckup(
      metricsOf([{ name: "自住房产", category: "REAL_ESTATE", currency: "CNY", amount: 1_000_000 }]),
      null,
    );
    const concentration = checkup.findings.find((item) => item.id === "CONCENTRATION_CATEGORY");
    expect(concentration).toBeDefined();
    expect(concentration?.level).toBe("risk");
    expect(concentration?.evidence).toContain("100.0%");
  });

  it("集中度 > 0.25 触发 HHI 提示，且证据里带具体数值", () => {
    const checkup = runCheckup(
      metricsOf([
        { name: "活期", category: "CASH", currency: "CNY", amount: 9000 },
        { name: "基金", category: "FUND", currency: "CNY", amount: 1000 },
      ]),
      null,
    );
    const hhi = checkup.findings.find((item) => item.id === "CONCENTRATION_HHI");
    expect(hhi?.level).toBe("warn");
    expect(hhi?.evidence).toMatch(/HHI = 0\.\d{3}/);
  });

  it("应急金不足 3 个月触发 warn，不足 1 个月触发 risk", () => {
    const warn = runCheckup(
      metricsOf([{ name: "活期", category: "CASH", currency: "CNY", amount: 10000 }], [], 5000),
      null,
    );
    expect(warn.findings.find((item) => item.id === "LIQUIDITY_LOW")?.level).toBe("warn");

    const risk = runCheckup(
      metricsOf([{ name: "活期", category: "CASH", currency: "CNY", amount: 3000 }], [], 5000),
      null,
    );
    expect(risk.findings.find((item) => item.id === "LIQUIDITY_LOW")?.level).toBe("risk");
  });

  it("缺少月支出时提示补全分母", () => {
    const checkup = runCheckup(
      metricsOf([{ name: "活期", category: "CASH", currency: "CNY", amount: 10000 }]),
      null,
    );
    expect(checkup.findings.some((item) => item.id === "EMERGENCY_MISSING")).toBe(true);
  });

  it("外币占比超过 30% 触发币种提示", () => {
    const checkup = runCheckup(
      metricsOf([
        { name: "美股ETF", category: "FUND", currency: "USD", amount: 1000 },
        { name: "活期", category: "CASH", currency: "CNY", amount: 1000 },
      ]),
      null,
    );
    const currency = checkup.findings.find((item) => item.id === "CURRENCY_EXPOSURE");
    expect(currency?.level).toBe("warn");
    expect(currency?.detail).toContain("汇率波动");
  });

  it("负债率超过 50% 触发 warn，超过 70% 触发 risk", () => {
    const warn = runCheckup(
      metricsOf(
        [{ name: "房产", category: "REAL_ESTATE", currency: "CNY", amount: 100000 }],
        [{ name: "房贷", category: "MORTGAGE", currency: "CNY", amount: 60000 }],
      ),
      null,
    );
    expect(warn.findings.find((item) => item.id === "DEBT_RATIO_HIGH")?.level).toBe("warn");

    const risk = runCheckup(
      metricsOf(
        [{ name: "房产", category: "REAL_ESTATE", currency: "CNY", amount: 100000 }],
        [{ name: "房贷", category: "MORTGAGE", currency: "CNY", amount: 80000 }],
      ),
      null,
    );
    expect(risk.findings.find((item) => item.id === "DEBT_RATIO_HIGH")?.level).toBe("risk");
  });

  it("权益占比明显偏离问卷区间时给 info 级偏离提示", () => {
    const checkup = runCheckup(
      metricsOf([
        { name: "股票", category: "STOCK", currency: "CNY", amount: 9000 },
        { name: "活期", category: "CASH", currency: "CNY", amount: 1000 },
      ]),
      "CONSERVATIVE",
    );
    const deviation = checkup.findings.find((item) => item.id === "RISK_BAND_DEVIATION");
    expect(deviation?.level).toBe("info");
    expect(deviation?.detail).toContain("不是调仓建议");
  });
});

describe("结构体检：输出契约", () => {
  it("levelCounts 与 findings 数量一致，headlines 固定 6 项", () => {
    const checkup = runCheckup(
      metricsOf([
        { name: "活期", category: "CASH", currency: "CNY", amount: 10000 },
        { name: "股票", category: "STOCK", currency: "CNY", amount: 30000 },
      ], [], 6000),
      "BALANCED",
    );
    const total = checkup.levelCounts.info + checkup.levelCounts.warn + checkup.levelCounts.risk;
    expect(total).toBe(checkup.findings.length);
    expect(checkup.headlines).toHaveLength(6);
    expect(checkup.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("所有文案都不给出买卖建议", () => {
    const checkup = runCheckup(
      metricsOf([{ name: "房产", category: "REAL_ESTATE", currency: "CNY", amount: 1_000_000 }], [], 5000),
      "GROWTH",
    );
    const text = checkup.findings.map((item) => `${item.title}${item.detail}${item.todo ?? ""}`).join("");
    expect(text).not.toMatch(/建议(买入|卖出|加仓|减仓|清仓)/);
    expect(text).not.toMatch(/目标价|止损位/);
  });
});
