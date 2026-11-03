import { DISCLAIMER_ZH, FX_NOTE, REPORT_TYPE_LABELS } from "@/lib/constants";
import { formatCny, formatCompactYuan, formatPercent } from "@/lib/rules/money";
import type { CheckupResult, ExposureItem, FindingLevel, PortfolioMetrics } from "@/lib/types/domain";
import type { EventDTO } from "@/lib/services/intel";

const LEVEL_LABEL: Record<FindingLevel, string> = { info: "提示", warn: "关注", risk: "重点" };

function stamp(date = new Date()): string {
  const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
  return iso.slice(0, 16).replace("T", " ");
}

function dayLabel(date = new Date()): string {
  return stamp(date).slice(0, 10);
}

export interface BriefMarkdownInput {
  headline: string;
  sections: { title: string; body: string }[];
  todos: string[];
  events: EventDTO[];
  exposure: ExposureItem[];
  metrics: PortfolioMetrics;
  checkup: CheckupResult;
  mode: string;
  generatedAt?: Date;
}

export function composeBriefMarkdown(input: BriefMarkdownInput): string {
  const { headline, sections, todos, events, exposure, metrics, checkup } = input;
  const lines: string[] = [];

  lines.push(`# 本周情报简报 · ${dayLabel(input.generatedAt)}`);
  lines.push("");
  lines.push(`> 数据来源：本地工作区 ｜ 生成模式：${input.mode} ｜ 生成时间：${stamp(input.generatedAt)}`);
  lines.push(`> ${headline}`);
  lines.push("");

  for (const section of sections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    lines.push(section.body.trim());
    lines.push("");
  }

  lines.push("## 五、本期事件清单");
  lines.push("");
  if (events.length === 0) {
    lines.push("_本期没有可展示的事件，请先在「市场情报台」刷新信息源。_");
  } else {
    lines.push("| # | 事件 | 报道数 / 来源数 | 可信度 | 信息完整度 |");
    lines.push("| --- | --- | --- | --- | --- |");
    events.slice(0, 8).forEach((event, index) => {
      lines.push(
        `| ${index + 1} | ${event.title.replace(/\|/g, "｜")} | ${event.articleCount} / ${event.sourceCount} | ${event.credibility}/100 | ${event.completeness}% |`,
      );
    });
  }
  lines.push("");

  lines.push("## 六、与我的资产关联（粗粒度匹配）");
  lines.push("");
  if (exposure.length === 0) {
    lines.push("_暂无可关联的主题暴露。可在「主题追踪」关注主题，或在资产里补充行业标签。_");
  } else {
    lines.push("| 主题 | 可能相关的资产 | 条目数 | 粗略占比 |");
    lines.push("| --- | --- | --- | --- |");
    for (const item of exposure.slice(0, 6)) {
      const names = item.matchedAssets
        .slice(0, 3)
        .map((asset) => asset.name)
        .join("、");
      lines.push(
        `| ${item.topic.name} | ${names || "—"} | ${item.matchedAssets.length} | ${formatPercent(item.exposureShare)} |`,
      );
    }
    lines.push("");
    lines.push(`> ${exposure[0]?.note ?? ""}`);
  }
  lines.push("");

  lines.push("## 七、结构提示与待办");
  lines.push("");
  lines.push(
    `净资产 **${formatCny(metrics.netWorthCny)}**，负债率 ${formatPercent(metrics.debtRatio)}，应急金 ${
      metrics.emergencyMonths === null ? "未设置" : `${metrics.emergencyMonths} 个月`
    }，信息完整度 ${metrics.completeness}%。`,
  );
  lines.push("");
  if (checkup.findings.length > 0) {
    for (const finding of checkup.findings.slice(0, 5)) {
      lines.push(`- **［${LEVEL_LABEL[finding.level]}］${finding.title}**：${finding.detail}（依据：${finding.evidence}）`);
    }
  } else {
    lines.push("- 本期未触发明显结构提示项。");
  }
  lines.push("");
  lines.push("待办清单：");
  lines.push("");
  for (const todo of todos) lines.push(`- [ ] ${todo}`);
  lines.push("");

  lines.push("## 数据口径");
  lines.push("");
  lines.push(`- 金额统一折算为人民币元；${FX_NOTE}`);
  lines.push("- 事件聚类基于标题/摘要的词汇重合度与 TF-IDF 余弦相似度，属于统计相似，不代表事实同一。");
  lines.push("- 可信度 = 来源档位 40% + 交叉来源 30% + 资讯质量分 30%，为规则计算结果。");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`**免责声明**：${DISCLAIMER_ZH}`);
  lines.push("");
  return lines.join("\n");
}

export interface CheckupMarkdownInput {
  metrics: PortfolioMetrics;
  checkup: CheckupResult;
  riskBandLabel: string | null;
  riskScore: number | null;
  mode: string;
  generatedAt?: Date;
  summary?: string;
  highlights?: string[];
  recommendations?: { title: string; detail: string; priority: "high" | "medium" | "low" }[];
}

export function composeCheckupMarkdown(input: CheckupMarkdownInput): string {
  const { metrics, checkup } = input;
  const lines: string[] = [];

  lines.push(`# 资产结构体检报告 · ${dayLabel(input.generatedAt)}`);
  lines.push("");
  lines.push(`> 数据来源：本地工作区 ｜ 生成模式：${input.mode} ｜ 生成时间：${stamp(input.generatedAt)}`);
  lines.push("");

  if (input.summary) {
    lines.push("## 摘要");
    lines.push("");
    lines.push(input.summary);
    lines.push("");
    if (input.highlights && input.highlights.length > 0) {
      for (const highlight of input.highlights) lines.push(`- ${highlight}`);
      lines.push("");
    }
  }

  lines.push("## 一、核心指标");
  lines.push("");
  lines.push("| 指标 | 数值 | 口径 |");
  lines.push("| --- | --- | --- |");
  for (const item of checkup.headlines) {
    lines.push(`| ${item.label} | ${item.value} | ${item.hint ?? ""} |`);
  }
  lines.push(`| 风险画像 | ${input.riskBandLabel ?? "未测评"} | ${input.riskScore === null ? "—" : `问卷得分 ${input.riskScore}/100`} |`);
  lines.push("");

  lines.push("## 二、结构提示");
  lines.push("");
  if (checkup.findings.length === 0) {
    lines.push("_本次体检未触发提示项。_");
  } else {
    for (const finding of checkup.findings) {
      lines.push(`### ［${LEVEL_LABEL[finding.level]}］${finding.title}`);
      lines.push("");
      lines.push(finding.detail);
      lines.push("");
      lines.push(`- 依据：\`${finding.evidence}\``);
      if (finding.todo) lines.push(`- 待办：${finding.todo}`);
      lines.push("");
    }
  }

  lines.push("## 三、类别结构");
  lines.push("");
  lines.push("| 类别 | 金额（元） | 占比 |");
  lines.push("| --- | --- | --- |");
  for (const slice of metrics.categoryMix) {
    lines.push(`| ${slice.label} | ${formatCompactYuan(slice.valueCny)} | ${formatPercent(slice.share)} |`);
  }
  lines.push("");

  lines.push("## 四、调整建议");
  lines.push("");
  const PRIORITY_LABEL: Record<string, string> = { high: "优先", medium: "其次", low: "可缓" };
  if (input.recommendations && input.recommendations.length > 0) {
    for (const item of input.recommendations) {
      lines.push(`### ［${PRIORITY_LABEL[item.priority] ?? item.priority}］${item.title}`);
      lines.push("");
      lines.push(item.detail);
      lines.push("");
    }
  } else {
    lines.push("_暂无额外建议，按结构提示逐项核对即可。_");
    lines.push("");
  }

  lines.push("## 五、待办清单");
  lines.push("");
  const todos = checkup.findings.map((finding) => finding.todo).filter(Boolean) as string[];
  if (todos.length === 0) lines.push("- 保持每月更新一次资产记录。");
  else for (const todo of todos) lines.push(`- [ ] ${todo}`);
  lines.push("");

  lines.push("## 数据口径");
  lines.push("");
  lines.push(`- ${FX_NOTE}`);
  lines.push("- 应急金月数 = 现金类资产 ÷ 每月必要支出；现金类包含现金、银行存款、货币基金。");
  lines.push("- 负债率 = 总负债 ÷ 总资产；期限结构按剩余期限分桶。");
  lines.push("- 所有阈值集中定义在 `src/lib/constants.ts` 的 `THRESHOLDS`，可审计、可测试。");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`**免责声明**：${DISCLAIMER_ZH}`);
  lines.push("");
  return lines.join("\n");
}

export function reportTitle(type: string, date = new Date()): string {
  return `${REPORT_TYPE_LABELS[type] ?? type} · ${stamp(date)}`;
}
