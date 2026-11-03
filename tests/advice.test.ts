import { describe, expect, it } from "vitest";
import { buildRuleAdvice } from "@/lib/rules/advice";
import { sanitizeAdvice, ADVICE_SCOPE_NOTE } from "@/lib/llm/advice-scope";
import { computePortfolioMetrics } from "@/lib/rules/metrics";
import type { Advice, AssetLike, LiabilityLike, RiskBand } from "@/lib/types/domain";

function metricsOf(
  assets: AssetLike[],
  liabilities: LiabilityLike[] = [],
  monthlySpend?: number,
) {
  return computePortfolioMetrics({ assets, liabilities, monthlySpend });
}

function adviceOf(
  assets: AssetLike[],
  options: {
    question?: string;
    liabilities?: LiabilityLike[];
    monthlySpend?: number;
    band?: RiskBand;
  } = {},
) {
  const metrics = metricsOf(assets, options.liabilities ?? [], options.monthlySpend);
  return buildRuleAdvice({
    question: options.question ?? "我的资产配置合理吗？",
    metrics,
    findings: [],
    riskBand: options.band ?? "BALANCED",
  });
}

const cash = (amount: number): AssetLike => ({
  name: "活期",
  category: "CASH",
  currency: "CNY",
  amount,
});

describe("规则建议：基本分支", () => {
  it("没有资产时只给补数据指引，不编造配置结论", () => {
    const advice = adviceOf([]);
    expect(advice.action).toBe("HOLD");
    expect(advice.confidence).toBe("low");
    expect(advice.allocations).toHaveLength(0);
    expect(advice.steps.length).toBeGreaterThanOrEqual(2);
    expect(advice.risks.length).toBeGreaterThanOrEqual(1);
    expect(advice.summary).toContain("还没有录入资产");
  });

  it("单一类别过高时给出降比目标，并排在最高优先级", () => {
    const advice = adviceOf(
      [
        { name: "自住房产", category: "REAL_ESTATE", currency: "CNY", amount: 1_000_000 },
        cash(10_000),
      ],
      { monthlySpend: 5_000 },
    );

    const housing = advice.allocations.find((item) => item.category.includes("房产"));
    expect(housing).toBeDefined();
    expect(housing?.direction).toBe("reduce");
    expect(housing?.targetShare).toBe(50);
    expect(housing?.priority).toBe("high");
    expect(advice.action).toBe("REBALANCE");
    expect(advice.steps[0].priority).toBe("high");
  });

  it("权益占比低于风险区间时建议提高，并对买入类问题给出 BUY", () => {
    const advice = adviceOf([cash(40_000), { name: "定存", category: "DEPOSIT", currency: "CNY", amount: 60_000 }], {
      question: "现在该不该买点基金？",
      band: "BALANCED",
    });

    const equity = advice.allocations.find((item) => item.category.includes("权益"));
    expect(equity?.direction).toBe("increase");
    expect(advice.action).toBe("BUY");
  });

  it("权益占比高于风险区间时建议降低，并对卖出类问题给出 SELL", () => {
    const advice = adviceOf(
      [
        { name: "股票账户", category: "STOCK", currency: "CNY", amount: 300_000 },
        cash(100_000),
      ],
      { question: "要不要减仓？", band: "CONSERVATIVE" },
    );

    const equity = advice.allocations.find((item) => item.category.includes("权益"));
    expect(equity?.direction).toBe("reduce");
    expect(advice.action).toBe("SELL");
  });

  it("外币占比超过 30% 时提出降比", () => {
    const advice = adviceOf([
      { name: "美元货基", category: "MONEY_FUND", currency: "USD", amount: 20_000 },
      cash(10_000),
    ]);

    const foreign = advice.allocations.find((item) => item.category === "外币资产");
    expect(foreign?.direction).toBe("reduce");
    expect(foreign?.targetShare).toBe(30);
    expect(advice.risks.join("")).toContain("外币");
  });

  it("问个股时保留结构建议，只追加范围说明", () => {
    const advice = adviceOf([cash(100_000)], { question: "600519 能买吗，目标价多少？" });
    expect(advice.steps.length).toBeGreaterThan(0);
    expect(advice.scopeNote).toContain("不在本工具的建议范围");
    expect(advice.scopeNote).not.toContain("600519");
    expect(advice.allocations.length).toBeGreaterThan(0);
  });

  it("负债率偏高时优先降负债", () => {
    const advice = adviceOf(
      [cash(100_000)],
      {
        liabilities: [
          {
            name: "消费贷",
            category: "CONSUMER_LOAN",
            currency: "CNY",
            amount: 90_000,
            interestRate: 9.5,
            monthlyPayment: 3_000,
          },
        ],
        monthlySpend: 6_000,
      },
    );
    expect(advice.steps.some((item) => item.step.includes("负债率"))).toBe(true);
    expect(advice.risks.join("")).toContain("负债率");
  });

  it("置信度随数据完整度下降", () => {
    const sparse = adviceOf([cash(10_000)]);
    expect(sparse.confidence).toBe("low");
  });
});

describe("建议范围收敛：sanitizeAdvice", () => {
  const base = (overrides: Partial<Advice> = {}): Advice => ({
    action: "REBALANCE",
    summary: "把集中度降下来。",
    allocations: [
      {
        category: "权益类",
        currentShare: 20,
        targetShare: 30,
        direction: "increase",
        priority: "medium",
        rationale: "低于参考区间。",
      },
    ],
    steps: [{ step: "分批调整", priority: "medium", rationale: "降低择时风险。" }],
    risks: ["市场有波动。"],
    confidence: "medium",
    horizon: "medium",
    ...overrides,
  });

  it("具体标的、目标价与涨跌预测被替换，而不是拒答", () => {
    const input = base({
      summary: "建议买入 600519，目标价 1800 元，预计上涨 30%。",
      steps: [
        {
          step: "稳赚的机会，建议买入 300750，止损位 180 元。",
          priority: "high",
          rationale: "必涨。",
        },
      ],
    });

    const result = sanitizeAdvice(input);
    expect(result.adjusted).toBe(true);
    expect(result.labels.length).toBeGreaterThanOrEqual(2);
    expect(result.labels).toContain("标的推荐");
    expect(result.labels).toContain("收益承诺");
    expect(result.advice.summary).not.toContain("600519");
    expect(result.advice.summary).not.toContain("1800");
    expect(result.advice.summary).not.toContain("预计上涨");
    expect(result.advice.summary).toContain("已省略");
    expect(result.advice.steps[0].step).not.toContain("300750");
    expect(result.advice.steps[0].step).not.toContain("止损位");
    expect(result.advice.scopeNote).toBe(ADVICE_SCOPE_NOTE);
  });

  it("合规的结构建议不会被改写", () => {
    const result = sanitizeAdvice(base());
    expect(result.adjusted).toBe(false);
    expect(result.labels).toHaveLength(0);
    expect(result.advice.summary).toBe("把集中度降下来。");
    expect(result.advice.scopeNote).toBeUndefined();
  });
});
