import { describe, expect, it } from "vitest";
import { DISCLAIMER_ZH } from "@/lib/constants";
import { composeCheckupMarkdown, reportTitle } from "@/lib/report/markdown";
import { runCheckup } from "@/lib/rules/checkup";
import { computePortfolioMetrics } from "@/lib/rules/metrics";

const metrics = computePortfolioMetrics({
  assets: [
    { name: "活期", category: "CASH", currency: "CNY", amount: 10000 },
    { name: "股票", category: "STOCK", currency: "CNY", amount: 50000 },
  ],
  liabilities: [{ name: "消费贷", category: "CONSUMER_LOAN", currency: "CNY", amount: 10000 }],
  monthlySpend: 5000,
});
const checkup = runCheckup(metrics, "BALANCED");

describe("报告 Markdown 组合", () => {
  const markdown = composeCheckupMarkdown({
    metrics,
    checkup,
    riskBandLabel: "平衡型",
    riskScore: 53,
    mode: "mock",
    summary: "这是一段示例摘要。",
    highlights: ["集中度较高", "应急金覆盖 2 个月"],
  });

  it("包含标题、演示标识与生成模式", () => {
    expect(markdown).toContain("# 资产结构体检报告");
    expect(markdown).toContain("数据来源：本地工作区");
    expect(markdown).toContain("mock");
  });

  it("包含摘要、核心指标、结构提示与待办", () => {
    expect(markdown).toContain("## 摘要");
    expect(markdown).toContain("这是一段示例摘要。");
    expect(markdown).toContain("## 一、核心指标");
    expect(markdown).toContain("- [ ]");
  });

  it("结尾一定带免责声明", () => {
    expect(markdown).toContain("免责声明");
    expect(markdown).toContain(DISCLAIMER_ZH);
  });

  it("报告中不出现买卖建议式表述", () => {
    // 免责声明里会说明“不给目标价/止损位”，这是边界声明，不是建议本身。
    const body = markdown.split("**免责声明**")[0];
    expect(body).not.toMatch(/建议(买入|卖出|加仓|减仓|清仓)/);
    expect(body).not.toMatch(/目标价|止损位/);
  });

  it("报告标题按类型与日期生成", () => {
    const date = new Date("2026-11-02T10:00:00+08:00");
    expect(reportTitle("BRIEF", date)).toContain("情报简报");
    expect(reportTitle("CHECKUP", date)).toContain("结构体检");
    expect(reportTitle("BRIEF", date)).toContain("2026-11-02");
  });
});
