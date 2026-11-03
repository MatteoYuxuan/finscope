import type { Advice } from "@/lib/types/domain";

/**
 * 范围收敛（不是拦截）：
 * 产品只给“配置与结构建议”，不点名个股/基金代码、不给目标价、不预测点位。
 * 模型偶尔会越界，这里把具体标的与点位替换掉，并在 scopeNote 说明原因；
 * 回答本身仍然保留，不会降级为拒答。
 *
 * 实现说明：所有规则合并成一个正则，单次替换，避免多次替换把占位符再匹配一次。
 */
const SCOPE_PATTERN =
  /(?<pick>推荐买入|强烈推荐|值得买入|建议买入)[^。；\n]{0,40}|(?<trade>目标价|止损位|买入点|卖出点)[^。；\n]{0,24}|(?<move>涨到|跌到|预计上涨|预计下跌|将会涨到|将会跌到)[^。；\n]{0,24}|(?<promise>必涨|必跌|稳赚|保本保收益|翻倍|零风险)|(?<code>\b(?:60|68|00|30|43|83|87)\d{4}\b)/g;

const LABELS = {
  pick: "标的推荐",
  trade: "交易点位",
  move: "涨跌预测",
  promise: "收益承诺",
  code: "股票代码",
} as const;

const PLACEHOLDER = "（具体标的/点位已省略）";
const NOTE_TEXT = "具体标的、目标价与点位不在本工具的建议范围；以上为配置与结构层面的建议。";

export interface SanitizeAdviceResult {
  advice: Advice;
  /** 是否替换过越界内容 */
  adjusted: boolean;
  labels: string[];
}

type ScopeGroup = keyof typeof LABELS;

export function sanitizeAdvice(advice: Advice): SanitizeAdviceResult {
  const labels = new Set<string>();

  const clean = (text: string): string =>
    text.replace(SCOPE_PATTERN, (_match, ...args: unknown[]) => {
      const groups = args[args.length - 1] as Record<ScopeGroup, string | undefined> | undefined;
      if (groups) {
        for (const key of Object.keys(LABELS) as ScopeGroup[]) {
          if (groups[key]) {
            labels.add(LABELS[key]);
            break;
          }
        }
      }
      return PLACEHOLDER;
    });

  const cleaned: Advice = {
    ...advice,
    summary: clean(advice.summary),
    allocations: advice.allocations.map((item) => ({
      ...item,
      rationale: clean(item.rationale),
    })),
    steps: advice.steps.map((item) => ({
      ...item,
      step: clean(item.step),
      rationale: clean(item.rationale),
    })),
    risks: advice.risks.map((item) => clean(item)),
  };

  if (labels.size > 0) {
    cleaned.scopeNote = advice.scopeNote ?? NOTE_TEXT;
  }

  return { advice: cleaned, adjusted: labels.size > 0, labels: [...labels] };
}

export { NOTE_TEXT as ADVICE_SCOPE_NOTE };
