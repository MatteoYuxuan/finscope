import { RISK_BAND_META, THRESHOLDS } from "@/lib/constants";
import type {
  CheckupResult,
  Finding,
  FindingLevel,
  PortfolioMetrics,
  RiskBand,
} from "@/lib/types/domain";
import { formatCny, formatCompactYuan, formatPercent } from "./money";

/**
 * 结构体检：只给“结构性风险提示”和“可执行待办”，不给买卖建议、不给目标比例。
 * 每条 finding 都必须带证据（具体指标值），便于答辩时解释“为什么触发”。
 */
export function runCheckup(
  metrics: PortfolioMetrics,
  riskBand: RiskBand | null,
): CheckupResult {
  const findings: Finding[] = [];

  if (metrics.assetCount === 0) {
    findings.push({
      id: "NO_DATA",
      level: "info",
      title: "还没有资产数据",
      detail: "先录入或导入一份资产清单，系统才能计算结构指标。也可以在设置页恢复示例数据。",
      evidence: "资产条数 = 0",
      todo: "在「资产录入」页手动添加，或导入示例 CSV",
    });
    return finalize(findings, metrics, riskBand);
  }

  // 1) 类别集中度
  const top = metrics.categoryMix[0];
  if (top && metrics.topCategoryShare > THRESHOLDS.topCategory) {
    const risk = metrics.topCategoryShare > THRESHOLDS.topCategoryRisk;
    findings.push({
      id: "CONCENTRATION_CATEGORY",
      level: risk ? "risk" : "warn",
      title: `资产集中在「${top.label}」`,
      detail: `「${top.label}」占全部资产的 ${formatPercent(metrics.topCategoryShare)}，属于单一类别主导。这类资产的价格或流动性变化会直接放大到整体净资产上。`,
      evidence: `topCategoryShare = ${formatPercent(metrics.topCategoryShare)}（阈值 50%）`,
      todo: "核对这类资产的实际可变现能力，并补充其他类别的记录",
    });
  }

  // 2) HHI
  if (metrics.hhi > THRESHOLDS.hhi) {
    findings.push({
      id: "CONCENTRATION_HHI",
      level: "warn",
      title: "分散度偏低（HHI 偏高）",
      detail: `赫芬达尔指数 HHI = ${metrics.hhi.toFixed(3)}（把各类别占比平方后求和），越接近 1 越集中。当前结构对单一类别的依赖较明显。`,
      evidence: `HHI = ${metrics.hhi.toFixed(3)}（阈值 0.25）`,
      todo: "梳理“如果最大那一类暂时无法变现，还剩下多少可用资产”",
    });
  }

  // 3) 流动性 / 应急金
  if (metrics.emergencyMonths !== null) {
    if (metrics.emergencyMonths < THRESHOLDS.emergencyWarn) {
      const risk = metrics.emergencyMonths < THRESHOLDS.emergencyRisk;
      findings.push({
        id: "LIQUIDITY_LOW",
        level: risk ? "risk" : "warn",
        title: "应急金覆盖月数不足",
        detail: `按你填写的月必要支出 ${formatCny(metrics.monthlySpend ?? 0)}计算，现金类资产（现金/存款/货基）约可覆盖 ${metrics.emergencyMonths} 个月。突发支出时可能需要动用其他资产。`,
        evidence: `emergencyMonths = ${metrics.emergencyMonths}（阈值 3 个月）`,
        todo: "确认月必要支出是否填写准确，并盘点可快速动用的资金",
      });
    }
  } else {
    findings.push({
      id: "EMERGENCY_MISSING",
      level: "info",
      title: "缺少月必要支出，无法估算应急金月数",
      detail: "应急金月数 = 现金类资产 ÷ 每月必要支出。没有分母就无法判断流动性是否够用。",
      evidence: "monthlySpend 未设置",
      todo: "到「设置」页填写每月必要生活支出（虚构数字即可）",
    });
  }

  // 4) 币种暴露
  if (metrics.foreignShare > THRESHOLDS.foreignShare) {
    findings.push({
      id: "CURRENCY_EXPOSURE",
      level: "warn",
      title: "外币资产占比偏高",
      detail: `按演示汇率折算后，非人民币资产占 ${formatPercent(metrics.foreignShare)}。汇率波动会通过折算直接影响以人民币计价的净资产，方向取决于外币升贬。`,
      evidence: `foreignShare = ${formatPercent(metrics.foreignShare)}（阈值 30%）`,
      todo: "核对各币种金额与折算口径，确认这是否符合你的实际安排",
    });
  }

  // 5) 期限错配
  const highLiquidityShare =
    metrics.liquidityMix.find((item) => item.key === "HIGH")?.share ?? 0;
  if (
    metrics.longTermShare > THRESHOLDS.longTermShare &&
    highLiquidityShare < THRESHOLDS.longTermLowLiquidity
  ) {
    findings.push({
      id: "MATURITY_MISMATCH",
      level: "warn",
      title: "长期资产占比高、短期可用资金少",
      detail: `期限在 3 年以上的资产占 ${formatPercent(metrics.longTermShare)}，而高流动性资产仅 ${formatPercent(highLiquidityShare)}。若近期有用钱计划，可能面临“账面有钱、手上没钱”的错配。`,
      evidence: `longTermShare = ${formatPercent(metrics.longTermShare)}，highLiquidity = ${formatPercent(highLiquidityShare)}`,
      todo: "列出未来 12 个月的大额支出，对比可动用资金",
    });
  }

  // 6) 负债率
  if (metrics.debtRatio !== null && metrics.debtRatio > THRESHOLDS.debtRatioWarn) {
    const risk = metrics.debtRatio > THRESHOLDS.debtRatioRisk;
    findings.push({
      id: "DEBT_RATIO_HIGH",
      level: risk ? "risk" : "warn",
      title: "负债率偏高",
      detail: `总负债 ${formatCny(metrics.totalLiabilitiesCny)}，占总资产的 ${formatPercent(metrics.debtRatio)}。负债率越高，收入波动时的缓冲空间越小。`,
      evidence: `debtRatio = ${formatPercent(metrics.debtRatio)}（阈值 50%）`,
      todo: "核对月供金额与剩余期限是否填写完整",
    });
  }

  // 7) 高成本负债
  const highRateDebt = metrics.monthlyDebtPayment > 0;
  if (highRateDebt) {
    findings.push({
      id: "DEBT_PAYMENT_TRACKED",
      level: "info",
      title: "已记录月供，可进一步核对成本",
      detail: `按你填写的月供合计约 ${formatCny(metrics.monthlyDebtPayment)}/月。若某笔负债年化利率明显高于其他负债，它在结构中的“成本占比”值得单独看一眼。`,
      evidence: `monthlyDebtPayment = ${formatCny(metrics.monthlyDebtPayment)}`,
      todo: "在负债列表补全利率字段，便于按成本排序",
    });
  }

  // 8) 信息完整度
  if (metrics.completeness < THRESHOLDS.completenessLow) {
    findings.push({
      id: "COMPLETENESS_LOW",
      level: "info",
      title: "信息完整度偏低，指标可能失真",
      detail: `当前完整度 ${metrics.completeness}%。缺失字段会让期限、流动性、行业关联的判断变得粗糙。`,
      evidence: metrics.missingFields.join("；") || `completeness = ${metrics.completeness}%`,
      todo: "按缺失提示补齐字段即可，不必一次填完",
    });
  }

  // 9) 风险带偏离（只描述偏离，不给调整建议）
  if (riskBand && metrics.equityShare !== null) {
    const meta = RISK_BAND_META[riskBand];
    const [min, max] = meta.equityRange;
    const share = metrics.equityShare;
    if (share < min - 0.05 || share > max + 0.05) {
      findings.push({
        id: "RISK_BAND_DEVIATION",
        level: "info",
        title: "权益类占比与问卷结果存在偏离",
        detail: `问卷结果属于「${meta.label}」，对应权益类占比区间约 ${formatPercent(min, 0)}–${formatPercent(max, 0)}；当前股票+基金合计约 ${formatPercent(share)}。这是结构提示，不是调仓建议。`,
        evidence: `equityShare = ${formatPercent(share)}，band = ${riskBand}`,
        todo: "确认基金是否包含债券型，必要时补充备注",
      });
    }
  }

  return finalize(findings, metrics, riskBand);
}

function finalize(
  findings: Finding[],
  metrics: PortfolioMetrics,
  riskBand: RiskBand | null,
): CheckupResult {
  const levelCounts: Record<FindingLevel, number> = { info: 0, warn: 0, risk: 0 };
  for (const finding of findings) levelCounts[finding.level] += 1;

  const headlines = [
    { label: "净资产", value: `${formatCny(metrics.netWorthCny)}`, hint: "总资产 − 总负债" },
    { label: "负债率", value: formatPercent(metrics.debtRatio), hint: "总负债 ÷ 总资产" },
    {
      label: "应急金月数",
      value: metrics.emergencyMonths === null ? "未设置" : `${metrics.emergencyMonths} 个月`,
      hint: "现金类 ÷ 月必要支出",
    },
    { label: "最大类别占比", value: formatPercent(metrics.topCategoryShare), hint: "集中度" },
    { label: "HHI", value: metrics.hhi.toFixed(3), hint: "0–1，越高越集中" },
    {
      label: "风险画像",
      value: riskBand ? RISK_BAND_META[riskBand].label : "未测评",
      hint: "仅用于结构提示",
    },
  ];

  return {
    findings,
    levelCounts,
    headlines,
    riskBand,
    generatedAt: new Date().toISOString(),
  };
}
