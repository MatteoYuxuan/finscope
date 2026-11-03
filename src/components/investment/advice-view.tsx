"use client";

import { AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, CircleDollarSign, Info, Minus, ShieldAlert, Target } from "lucide-react";
import { Badge, Card, CardHead } from "@/components/ui";
import type { Advice, AnalysisResult } from "@/lib/types/investment";
import { cn } from "@/lib/client/api";

const pct = (value: number | null | undefined, digits = 1) => (value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`);
const money = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(1)} 万`;
  return `${Math.round(value).toLocaleString("zh-CN")}`;
};

const PRIORITY_TONE = { high: "danger", medium: "warn", low: "neutral" } as const;
const CONF_TONE = { high: "brand", medium: "warn", low: "danger" } as const;

export function AdviceView({ advice, analysis }: { advice: Advice; analysis: AnalysisResult }) {
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <div className="border-b border-brand-100 bg-gradient-to-br from-brand-50 via-white to-white px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={CONF_TONE[advice.confidence]}>置信度 {advice.confidence === "high" ? "较高" : advice.confidence === "medium" ? "中等" : "较低"}</Badge>
            <Badge tone="info">{advice.regime?.label ?? analysis.market.regime.label}</Badge>
            <span className="text-[10px] text-ink-400">数据截至 {analysis.meta.data_end}</span>
          </div>
          <p className="mt-2 text-[15px] font-semibold leading-relaxed text-ink-950">{advice.summary}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">{advice.confidence_note}</p>
        </div>
        <div className="grid gap-px bg-ink-100 sm:grid-cols-4">
          {[
            { label: "市场状态", value: advice.regime?.label ?? "—", hint: `${advice.regime?.score ?? "—"}/100` },
            { label: "目标预期收益", value: pct(analysis.target.expected_return), hint: "历史估计，非承诺" },
            { label: "目标波动率", value: pct(analysis.target.expected_volatility), hint: `夏普 ${analysis.target.expected_sharpe?.toFixed(2) ?? "—"}` },
            { label: "建议换手率", value: pct(analysis.target.turnover), hint: "单边" },
          ].map((item) => (
            <div key={item.label} className="bg-white px-4 py-3">
              <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">{item.label}</p>
              <p className="tabular mt-1 text-base font-semibold text-ink-950">{item.value}</p>
              <p className="text-[10px] text-ink-400">{item.hint}</p>
            </div>
          ))}
        </div>
      </Card>

      {advice.manager_summary || advice.regime_narrative ? (
        <Card>
          <CardHead title="AI 解读" desc="组合经理撰写的解释；数字仍以量化引擎为准，审查员已检查越界与一致性。" />
          <div className="space-y-3 px-5 py-4">
            {advice.manager_summary ? <p className="text-[13px] font-medium leading-relaxed text-ink-900">{advice.manager_summary}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ["市场状态", advice.regime_narrative],
                ["配置调整", advice.allocation_narrative],
                ["风险", advice.risk_narrative],
                ["目标与现金流", advice.goal_narrative],
                ["执行顺序", advice.action_narrative],
              ].filter(([, text]) => text).map(([label, text]) => (
                <div key={String(label)} className="rounded-xl bg-ink-50/70 px-3 py-2.5">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
                  <p className="text-[11px] leading-relaxed text-ink-600">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="大类配置调整" desc="目标权重由风险平价 / 均值方差 / Black-Litterman 集成后，经约束投影得到。" />
          <div className="divide-y divide-ink-50">
            {advice.allocation.map((item) => (
              <div key={item.asset_class} className="flex items-start gap-3 px-5 py-3">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-ink-800">{item.label}</span>
                    <span className="tabular text-xs text-ink-600">
                      {pct(item.current)} → <b className="text-ink-950">{pct(item.target)}</b>
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-500">{item.rationale}</p>
                </div>
                <Direction delta={item.delta} />
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHead title="执行清单" desc="按优先级排序；金额为估算，实际以交易时价格与最小交易单位为准。" />
          <div className="divide-y divide-ink-50">
            {advice.actions.map((action, index) => (
              <div key={`${action.action}-${index}`} className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <Badge tone={PRIORITY_TONE[action.priority]}>{action.priority === "high" ? "高" : action.priority === "medium" ? "中" : "低"}</Badge>
                  <span className="text-xs font-medium text-ink-800">{action.action}</span>
                  {action.amount ? <span className="tabular ml-auto text-[11px] text-ink-500">约 {money(action.amount)} 元</span> : null}
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-500">{action.rationale}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="ETF / 基金落地方案" desc="目标权重来自优化器；备选项目标权重为 0，仅用于同类比较。" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-xs">
            <thead>
              <tr className="border-b border-ink-100 text-left text-[10px] uppercase tracking-wide text-ink-400">
                <th className="px-4 py-2 font-medium">代码</th>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">类别</th>
                <th className="px-3 py-2 text-right font-medium">目标权重</th>
                <th className="px-3 py-2 text-right font-medium">费率</th>
                <th className="px-4 py-2 font-medium">依据</th>
              </tr>
            </thead>
            <tbody>
              {advice.instruments.map((item) => (
                <tr key={item.code} className={cn("border-b border-ink-50 last:border-0", item.is_alternative && "text-ink-400")}>
                  <td className="px-4 py-2 font-mono text-[11px]">{item.code}</td>
                  <td className="px-3 py-2 text-ink-700">{item.name}</td>
                  <td className="px-3 py-2">{item.class_label}</td>
                  <td className="tabular px-3 py-2 text-right font-medium">{item.is_alternative ? "备选" : pct(item.target_weight)}</td>
                  <td className="tabular px-3 py-2 text-right">{item.fee === null || item.fee === undefined ? "—" : pct(item.fee, 2)}</td>
                  <td className="px-4 py-2 text-[11px]">{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="主要风险" desc="来自 VaR、压力测试、集中度与数据局限。" right={<ShieldAlert className="h-4 w-4 text-amber-500" />} />
          <ul className="space-y-2 px-5 py-4">
            {advice.risks.map((risk, index) => (
              <li key={index} className="flex gap-2 text-[11px] leading-relaxed text-ink-600">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                {risk}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHead title="目标与现金流" desc="应急金、教育金、养老与负债优先级。" right={<Target className="h-4 w-4 text-brand-600" />} />
          <div className="space-y-2 px-5 py-4 text-[11px] text-ink-600">
            <div className="flex items-center justify-between rounded-lg bg-ink-50/70 px-3 py-2">
              <span>月结余</span>
              <span className="tabular font-semibold text-ink-900">{money(advice.goal?.cashflow?.monthly_surplus)} 元</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-ink-50/70 px-3 py-2">
              <span>应急金覆盖</span>
              <span className="tabular font-semibold text-ink-900">
                {advice.goal?.emergency_fund?.months_covered ?? "—"} / {advice.goal?.emergency_fund?.target_months ?? 6} 个月
              </span>
            </div>
            {(advice.goal?.goals ?? []).slice(0, 3).map((goal) => (
              <div key={goal.name} className="flex items-center justify-between rounded-lg bg-ink-50/70 px-3 py-2">
                <span>{goal.name}缺口</span>
                <span className="tabular font-semibold text-ink-900">{money(goal.gap)} 元 · 月供 {money(goal.required_monthly)}</span>
              </div>
            ))}
            <div className="flex items-start gap-2 rounded-lg border border-sky-100 bg-sky-50/60 px-3 py-2 text-sky-800">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{advice.goal?.high_interest_debt?.note ?? "未发现高成本负债。"}</span>
            </div>
          </div>
        </Card>
      </div>

      {advice.critic && !advice.critic.pass ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardHead title="审查提示" desc="审查员发现以下问题，已降低置信度。" right={<AlertTriangle className="h-4 w-4 text-amber-600" />} />
          <ul className="list-disc space-y-1 px-8 py-3 text-[11px] text-amber-800">
            {advice.critic.issues.map((issue, index) => <li key={index}>{issue}</li>)}
          </ul>
        </Card>
      ) : (
        <Card className="border-brand-100 bg-brand-50/40">
          <div className="flex items-start gap-2 px-5 py-3 text-[11px] text-brand-800">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>审查通过：未发现个股推荐、目标价或收益承诺；目标权重合计与约束校验通过。</span>
          </div>
        </Card>
      )}
    </div>
  );
}

function Direction({ delta }: { delta: number }) {
  if (Math.abs(delta) < 0.005) return <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-300" aria-label="维持" />;
  const up = delta > 0;
  return (
    <span className={cn("flex shrink-0 items-center gap-0.5 text-[10px] font-medium", up ? "text-brand-700" : "text-red-600")}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {pct(Math.abs(delta))}
    </span>
  );
}

export function CompactAdviceCard({ advice }: { advice: Advice }) {
  return (
    <Card>
      <CardHead title="最新建议" desc={advice.generated_at ? new Date(advice.generated_at).toLocaleString("zh-CN") : undefined} right={<CircleDollarSign className="h-4 w-4 text-brand-600" />} />
      <div className="px-5 py-4">
        <p className="text-sm font-medium leading-relaxed text-ink-900">{advice.summary}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {advice.allocation.filter((item) => Math.abs(item.delta) >= 0.02).slice(0, 4).map((item) => (
            <Badge key={item.asset_class} tone={item.delta > 0 ? "brand" : "danger"}>
              {item.label} {item.delta > 0 ? "+" : ""}{pct(item.delta)}
            </Badge>
          ))}
        </div>
      </div>
    </Card>
  );
}
