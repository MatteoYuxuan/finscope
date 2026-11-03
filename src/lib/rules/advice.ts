import { RISK_BAND_META } from "@/lib/constants";
import { formatCny } from "@/lib/rules/money";
import type {
  Advice,
  AdviceAction,
  AdviceAllocation,
  AdviceConfidence,
  AdvicePriority,
  AdviceStep,
  ExposureItem,
  Finding,
  PortfolioMetrics,
  RiskBand,
} from "@/lib/types/domain";

/**
 * 规则建议引擎：在没有模型、或模型输出不可用时，仍然给出可解释的配置与结构建议。
 *
 * 边界：只做结构层面的方向、比例与优先级；不点名个股、不给目标价、不预测点位。
 * 所有数字来自 PortfolioMetrics / Finding，可在页面上回溯到资产录入与结构体检。
 */

export interface RuleAdviceInput {
  question: string;
  metrics: PortfolioMetrics;
  findings: Finding[];
  riskBand: RiskBand | null;
  riskScore?: number | null;
  exposure?: ExposureItem[];
  monthlySpend?: number | null;
}

const PRIORITY_ORDER: Record<AdvicePriority, number> = { high: 0, medium: 1, low: 2 };

const STOCK_PICK_LIKE = /(推荐.*(股票|基金|债券|标的|个股)|买哪只|哪只.*(好|值得)|给个代码|目标价|止损位|会涨吗|会跌吗|涨到多少|跌到多少)/;
const ALLOCATION_LIKE = /(怎么配置|如何配置|配置比例|仓位|调仓|该配多少|买多少比例)/;
const BUY_LIKE = /(该不该买|能不能买|可以买吗|要不要买|值得买|加仓|买入|上车)/;
const SELL_LIKE = /(该不该卖|要不要卖|减仓|清仓|卖出|下车)/;

const pct = (value: number | null | undefined): number => Math.round((value ?? 0) * 1000) / 10;

function prioritySort<T extends { priority: AdvicePriority }>(items: T[]): T[] {
  return [...items].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

function bandLabel(band: RiskBand | null): string {
  return band ? RISK_BAND_META[band].label : "未测评";
}

function equityRange(band: RiskBand | null): [number, number] {
  const range = band ? RISK_BAND_META[band].equityRange : RISK_BAND_META.BALANCED.equityRange;
  return [Math.round(range[0] * 100), Math.round(range[1] * 100)];
}

function categoryShare(metrics: PortfolioMetrics, key: string): number {
  return pct(metrics.categoryMix.find((item) => item.key === key)?.share ?? 0);
}

export function buildRuleAdvice(input: RuleAdviceInput): Advice {
  const { metrics, riskBand, question } = input;
  const steps: AdviceStep[] = [];
  const allocations: AdviceAllocation[] = [];
  const risks: string[] = [];

  if (metrics.assetCount === 0 || metrics.totalAssetsCny <= 0) {
    return {
      action: "HOLD",
      summary:
        "你还没有录入资产，暂时无法给出针对性的配置建议。先补全资产、负债与月必要支出，我可以按你的结构给出比例与优先级。",
      allocations: [],
      steps: [
        {
          step: "到「资产录入」补齐现金、存款、基金、房产等类别与金额",
          priority: "high",
          rationale: "没有资产数据时，任何比例建议都是泛泛而谈。",
        },
        {
          step: "到「结构体检」完成 10 题风险问卷",
          priority: "medium",
          rationale: "风险画像决定权益类资产的参考区间。",
        },
      ],
      risks: ["在数据补齐前，请把下面的建议视为通用框架，而不是针对你的结论。"],
      confidence: "low",
    };
  }

  const [eqLow, eqHigh] = equityRange(riskBand);
  const equity = pct(metrics.equityShare);
  const top = metrics.categoryMix[0];
  const topShare = pct(metrics.topCategoryShare);

  // 1) 应急金
  if (metrics.emergencyMonths === null || metrics.emergencyMonths < 3) {
    const target =
      metrics.monthlySpend && metrics.monthlySpend > 0 ? metrics.monthlySpend * 6 : null;
    steps.push({
      step: target
        ? `先把应急金补到 3–6 个月（约 ${formatCny(target)}）`
        : "先在设置页填写每月必要支出，再把应急金补到 3–6 个月",
      priority: "high",
      rationale: "应急金不足时，遇到收入波动容易被迫卖出长期资产。",
    });
    risks.push("应急金不足 3 个月，短期内不适合继续增加高波动资产。");
  }

  // 2) 负债
  const debtRatio = pct(metrics.debtRatio);
  if (metrics.debtRatio !== null && metrics.debtRatio > 0.5) {
    steps.push({
      step: `把负债率从 ${debtRatio}% 降到 50% 以下，优先偿还利率最高的负债`,
      priority: "high",
      rationale: "负债率偏高时，新增投资的实际风险会被杠杆放大。",
    });
    risks.push("负债率高于 50%，建议先降低负债再考虑加仓。");
  }
  if (
    metrics.monthlyDebtPayment > 0 &&
    metrics.monthlySpend &&
    metrics.monthlySpend > 0 &&
    metrics.monthlyDebtPayment / metrics.monthlySpend > 0.4
  ) {
    steps.push({
      step: "月供占月支出比例偏高，预留至少 6 个月月供的现金缓冲",
      priority: "medium",
      rationale: `月供 ${formatCny(metrics.monthlyDebtPayment)}，已占月必要支出较大比例。`,
    });
  }

  // 3) 集中度
  if (top && topShare > (riskBand === "CONSERVATIVE" ? 40 : 50)) {
    const cap = riskBand === "CONSERVATIVE" ? 40 : 50;
    allocations.push({
      category: top.label,
      currentShare: topShare,
      targetShare: cap,
      direction: "reduce",
      priority: "high",
      rationale: `「${top.label}」占比 ${topShare}%，超过 ${cap}% 的集中度参考线，单一类别波动会主导整体净值。`,
    });
    steps.push({
      step: `把「${top.label}」占比从 ${topShare}% 降到 ${cap}% 左右，分散到 2–3 个不同类别`,
      priority: "high",
      rationale: "降低单一类别集中度，可以减小单一市场波动对净资产的影响。",
    });
    risks.push(`「${top.label}」占比过高，若该类资产价格下跌，整体净值会明显回撤。`);
  }

  // 4) 外币
  const foreign = pct(metrics.foreignShare);
  if (foreign > 30) {
    allocations.push({
      category: "外币资产",
      currentShare: foreign,
      targetShare: 30,
      direction: "reduce",
      priority: "high",
      rationale: `外币资产占比 ${foreign}%，汇率波动会直接影响以人民币计价的净资产。`,
    });
    steps.push({
      step: `把外币资产占比从 ${foreign}% 降到 30% 以内，或对超出部分做汇率对冲/分批换回`,
      priority: "high",
      rationale: "控制单一币种敞口，避免汇率波动主导整体收益。",
    });
    risks.push("外币资产占比较高，人民币升值时会侵蚀折算后的净资产。");
  }

  // 5) 权益类与风险画像
  if (equity < eqLow) {
    allocations.push({
      category: "权益类（股票/基金）",
      currentShare: equity,
      targetShare: Math.round((eqLow + eqHigh) / 2),
      direction: "increase",
      priority: "medium",
      rationale: `当前权益占比 ${equity}%，低于「${bandLabel(riskBand)}」参考区间 ${eqLow}–${eqHigh}%。`,
    });
    steps.push({
      step: `把权益类占比从 ${equity}% 逐步提高到 ${eqLow}–${eqHigh}% 区间，分批建仓而不是一次到位`,
      priority: "medium",
      rationale: "长期看权益类提供增长，但需要用分批与分散控制波动。",
    });
  } else if (equity > eqHigh) {
    allocations.push({
      category: "权益类（股票/基金）",
      currentShare: equity,
      targetShare: Math.round((eqLow + eqHigh) / 2),
      direction: "reduce",
      priority: "high",
      rationale: `当前权益占比 ${equity}%，高于「${bandLabel(riskBand)}」参考区间 ${eqLow}–${eqHigh}%。`,
    });
    steps.push({
      step: `把权益类占比从 ${equity}% 降到 ${eqHigh}% 以内，优先减掉与收入/行业高度相关的持仓`,
      priority: "high",
      rationale: "权益占比超出风险承受区间，回撤可能超过你能接受的范围。",
    });
    risks.push("权益类占比高于风险画像对应区间，市场下跌时波动会更大。");
  } else {
    allocations.push({
      category: "权益类（股票/基金）",
      currentShare: equity,
      targetShare: equity,
      direction: "hold",
      priority: "low",
      rationale: `当前权益占比 ${equity}%，处于「${bandLabel(riskBand)}」参考区间 ${eqLow}–${eqHigh}% 内。`,
    });
  }

  // 6) 流动性 / 期限
  if (metrics.longTermShare > 0.6 && metrics.totalAssetsCny > 0 && metrics.liquidAssetsCny / metrics.totalAssetsCny < 0.15) {
    steps.push({
      step: "把高流动性资产（现金/存款/货基）提高到总资产的 15% 以上",
      priority: "medium",
      rationale: `长期资产占比 ${pct(metrics.longTermShare)}%，高流动性资产仅 ${pct(metrics.liquidAssetsCny / metrics.totalAssetsCny)}%。`,
    });
    risks.push("长期资产占比高、流动性薄，遇到大额支出时可能被迫折价变现。");
  }

  // 7) 主题暴露
  const topExposure = [...(input.exposure ?? [])].sort((a, b) => b.exposureShare - a.exposureShare)[0];
  if (topExposure && topExposure.exposureShare > 0.3) {
    steps.push({
      step: `关注「${topExposure.topic.name}」相关的资产暴露（约 ${pct(topExposure.exposureShare)}%），必要时降低单一主题权重`,
      priority: "medium",
      rationale: "主题暴露过高时，相关资讯的冲击会集中体现在你的资产上。",
    });
  }

  // 8) 问题意图：把「买/卖/配置」映射为动作，但不越过结构建议边界
  let action: AdviceAction = "HOLD";
  const hasReduce = allocations.some((item) => item.direction === "reduce");
  const hasIncrease = allocations.some((item) => item.direction === "increase");
  if (hasReduce && hasIncrease) action = "REBALANCE";
  else if (hasReduce) action = "SELL";
  else if (hasIncrease) action = "BUY";

  const wantsBuy = BUY_LIKE.test(question);
  const wantsSell = SELL_LIKE.test(question);
  if (wantsBuy && equity >= eqHigh) action = "HOLD";
  if (wantsBuy && equity < eqLow) action = "BUY";
  if (wantsSell && equity <= eqLow) action = "WAIT";

  if (steps.length === 0) {
    steps.push({
      step: "保持当前结构，按季度复核一次比例与期限",
      priority: "low",
      rationale: "当前未触发明显的结构提示项，重点是保持记录与定期复核。",
    });
  }

  const scopeNote = STOCK_PICK_LIKE.test(question)
    ? "具体股票、基金代码与目标价不在本工具的建议范围；下面给的是配置与结构层面的调整。"
    : undefined;

  if (ALLOCATION_LIKE.test(question) && allocations.length === 0) {
    steps.push({
      step: "按风险画像的权益区间，把资产分为「高流动性 / 稳健 / 长期」三层再分配",
      priority: "medium",
      rationale: "先分层再谈比例，比直接给一个单一数字更可执行。",
    });
  }

  const sortedSteps = prioritySort(steps);
  const sortedAllocations = prioritySort(allocations);
  const confidence: AdviceConfidence =
    metrics.completeness >= 80 && riskBand ? "high" : metrics.completeness >= 50 ? "medium" : "low";

  if (risks.length === 0) {
    risks.push("以上建议基于你录入的数据与本地资讯，市场变化或数据缺失都可能让结论失效。");
  }

  const summaryParts = [sortedSteps[0]?.step ?? "保持当前结构"];
  if (equity >= eqLow && equity <= eqHigh) {
    summaryParts.push(`权益占比 ${equity}% 处于「${bandLabel(riskBand)}」参考区间 ${eqLow}–${eqHigh}% 内。`);
  } else {
    summaryParts.push(`权益占比 ${equity}%，参考区间为 ${eqLow}–${eqHigh}%。`);
  }
  if (top && topShare > 50) summaryParts.push(`最大类别「${top.label}」占比 ${topShare}%，需要优先分散。`);

  return {
    action,
    summary: summaryParts.join(" "),
    allocations: sortedAllocations.slice(0, 6),
    steps: sortedSteps.slice(0, 6),
    risks: risks.slice(0, 4),
    confidence,
    horizon: "medium",
    ...(scopeNote ? { scopeNote } : {}),
  };
}
