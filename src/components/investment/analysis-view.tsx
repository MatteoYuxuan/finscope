"use client";

import { useState } from "react";
import { AlertTriangle, BarChart3, Database, FileSearch, Gauge, LineChart, Target } from "lucide-react";
import { Badge, Card, CardHead, InfoNote } from "@/components/ui";
import { cn } from "@/lib/client/api";
import type { AnalysisResult } from "@/lib/types/investment";
import {
  AllocationCompareChart,
  BacktestChart,
  DrawdownChart,
  FrontierChart,
  RiskBudgetChart,
  StrategyBars,
  StressChart,
} from "./charts";

const pct = (value: number | null | undefined, digits = 1) => (value === null || value === undefined ? "—" : `${(value * 100).toFixed(digits)}%`);
const money = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(1)} 万`;
  return `${Math.round(value).toLocaleString("zh-CN")}`;
};

const TABS = [
  { key: "allocation", label: "配置", icon: BarChart3 },
  { key: "risk", label: "风险", icon: Gauge },
  { key: "backtest", label: "回测", icon: LineChart },
  { key: "goal", label: "目标", icon: Target },
  { key: "evidence", label: "数据与证据", icon: Database },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function AnalysisView({ analysis }: { analysis: AnalysisResult }) {
  const [tab, setTab] = useState<TabKey>("allocation");
  const names = Object.fromEntries(analysis.target.weights.map((item) => [item.code, item.name]));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-ink-200/80 bg-white p-1">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition sm:flex-none",
              tab === item.key ? "bg-ink-950 text-white shadow-sm" : "text-ink-500 hover:bg-ink-100 hover:text-ink-900",
            )}
          >
            <item.icon className="h-3.5 w-3.5" aria-hidden />
            {item.label}
          </button>
        ))}
      </div>

      {analysis.meta.warnings.length > 0 ? (
        <InfoNote tone="warn">
          {analysis.meta.warnings.join("；")}
        </InfoNote>
      ) : null}

      {tab === "allocation" ? <AllocationTab analysis={analysis} /> : null}
      {tab === "risk" ? <RiskTab analysis={analysis} names={names} /> : null}
      {tab === "backtest" ? <BacktestTab analysis={analysis} /> : null}
      {tab === "goal" ? <GoalTab analysis={analysis} /> : null}
      {tab === "evidence" ? <EvidenceTab analysis={analysis} /> : null}
    </div>
  );
}

function AllocationTab({ analysis }: { analysis: AnalysisResult }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHead title="当前 vs 目标大类配置" desc="目标权重经约束投影：单只 ETF 上限、权益/海外/卫星上限、现金下限。" right={<Badge tone="brand">换手 {pct(analysis.target.turnover)}</Badge>} />
          <div className="px-4 py-3">
            <AllocationCompareChart allocation={analysis.target.class_weights.map((item) => {
              const current = analysis.portfolio.current_class_weights.find((row) => row.key === item.key)?.weight ?? 0;
              return { asset_class: item.key, label: item.label, color: item.color, current, target: item.weight, delta: item.weight - current, direction: item.weight > current ? "increase" : item.weight < current ? "reduce" : "hold", rationale: "" };
            })} />
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHead title="目标组合指标" desc="基于历史收益估计；不是未来收益承诺。" />
          <div className="grid grid-cols-2 gap-px bg-ink-100">
            {[
              { label: "预期年化收益", value: pct(analysis.target.expected_return), hint: "历史均值收缩" },
              { label: "预期波动率", value: pct(analysis.target.expected_volatility), hint: "年化" },
              { label: "预期夏普", value: analysis.target.expected_sharpe?.toFixed(2) ?? "—", hint: "无风险 2%" },
              { label: "历史最大回撤", value: pct(analysis.target.max_drawdown), hint: "目标权重回测" },
            ].map((item) => (
              <div key={item.label} className="bg-white px-4 py-3">
                <p className="text-[10px] uppercase tracking-wide text-ink-400">{item.label}</p>
                <p className="tabular mt-1 text-base font-semibold text-ink-950">{item.value}</p>
                <p className="text-[10px] text-ink-400">{item.hint}</p>
              </div>
            ))}
          </div>
          <div className="border-t border-ink-100 px-4 py-3">
            <StrategyBars analysis={analysis} />
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="目标 ETF 权重" desc="优化器输出；备选工具由筛选器给出。" />
          <div className="max-h-[340px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-ink-100 text-left text-[10px] uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-2 font-medium">代码</th>
                  <th className="px-3 py-2 font-medium">名称</th>
                  <th className="px-3 py-2 text-right font-medium">目标</th>
                </tr>
              </thead>
              <tbody>
                {analysis.target.weights.map((item) => (
                  <tr key={item.code} className="border-b border-ink-50 last:border-0">
                    <td className="px-4 py-2 font-mono text-[11px]">{item.code}</td>
                    <td className="px-3 py-2 text-ink-700">{item.name}</td>
                    <td className="tabular px-3 py-2 text-right font-medium">{pct(item.weight)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHead title="再平衡交易清单" desc="按金额绝对值排序；股数为按最新价与 100 份整数倍估算。" />
          <div className="max-h-[340px] overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-ink-100 text-left text-[10px] uppercase tracking-wide text-ink-400">
                  <th className="px-4 py-2 font-medium">动作</th>
                  <th className="px-3 py-2 font-medium">标的</th>
                  <th className="px-3 py-2 text-right font-medium">金额</th>
                  <th className="px-4 py-2 text-right font-medium">份额</th>
                </tr>
              </thead>
              <tbody>
                {analysis.target.trades.filter((item) => item.action !== "HOLD").map((item) => (
                  <tr key={item.code} className="border-b border-ink-50 last:border-0">
                    <td className="px-4 py-2">
                      <Badge tone={item.action === "BUY" ? "brand" : "danger"}>{item.action === "BUY" ? "买入" : "卖出"}</Badge>
                    </td>
                    <td className="px-3 py-2 text-ink-700">{item.name}</td>
                    <td className="tabular px-3 py-2 text-right">{money(Math.abs(item.delta_value))}</td>
                    <td className="tabular px-4 py-2 text-right">{Math.abs(item.shares)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="有效前沿" desc="横轴为年化波动率，纵轴为年化预期收益；星标为目标/当前组合。" />
        <div className="px-3 py-2">
          <FrontierChart analysis={analysis} />
        </div>
      </Card>
    </div>
  );
}

function RiskTab({ analysis, names }: { analysis: AnalysisResult; names: Record<string, string> }) {
  const current = analysis.risk.current;
  const target = analysis.risk.target;
  const varCurrent = current.var["95_1m"];
  const varTarget = target.var["95_1m"];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "当前 95% / 1月 VaR", value: pct(varCurrent?.var_historical), hint: "历史法" },
          { label: "目标 95% / 1月 VaR", value: pct(varTarget?.var_historical), hint: "历史法" },
          { label: "目标 CVaR", value: pct(varTarget?.cvar_historical), hint: "尾部平均损失" },
          { label: "目标前三大集中度", value: pct(target.concentration.top3), hint: `HHI ${target.concentration.hhi}` },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-ink-200/80 bg-white px-4 py-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-ink-400">{item.label}</p>
            <p className="tabular mt-1 text-lg font-semibold text-ink-950">{item.value}</p>
            <p className="text-[10px] text-ink-400">{item.hint}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="压力测试：目标组合" desc="历史窗口 + 假设冲击；负值表示估算损失。" />
          <div className="px-3 py-2">
            <StressChart risk={target} />
          </div>
        </Card>
        <Card>
          <CardHead title="风险预算：资金 vs 风险贡献" desc="低波动资产可能占用更多资金但贡献更少风险。" />
          <div className="px-3 py-2">
            <RiskBudgetChart risk={target} names={names} />
          </div>
        </Card>
      </div>
      <Card>
        <CardHead title="相关性矩阵（近一年）" desc="颜色越深表示相关性越高；危机时相关性可能上升。" />
        <CorrelationHeatmap analysis={analysis} />
      </Card>
    </div>
  );
}

function CorrelationHeatmap({ analysis }: { analysis: AnalysisResult }) {
  const { codes, values } = analysis.risk.target.correlation;
  if (!codes.length) return <p className="px-5 py-6 text-xs text-ink-400">暂无相关性数据</p>;
  const label = (code: string) => analysis.target.weights.find((item) => item.code === code)?.name?.slice(0, 6) ?? code;
  const color = (value: number) => {
    const v = Math.max(-1, Math.min(1, value));
    if (v >= 0) return `rgba(18,184,134,${0.08 + v * 0.72})`;
    return `rgba(239,68,68,${0.08 + Math.abs(v) * 0.72})`;
  };
  return (
    <div className="overflow-auto px-4 py-3">
      <table className="border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white p-1" />
            {codes.map((code) => <th key={code} className="p-1 font-medium text-ink-400">{label(code)}</th>)}
          </tr>
        </thead>
        <tbody>
          {codes.map((code, i) => (
            <tr key={code}>
              <th className="sticky left-0 bg-white p-1 text-right font-medium text-ink-400">{label(code)}</th>
              {values[i].map((value, j) => (
                <td key={`${code}-${j}`} className="h-6 w-8 rounded text-center text-[9px] text-ink-800" style={{ background: color(value) }} title={`${label(code)} / ${label(codes[j])}: ${value}`}>
                  {Math.abs(value) >= 0.15 ? value.toFixed(1) : ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BacktestTab({ analysis }: { analysis: AnalysisResult }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHead title="集成策略净值曲线" desc="月度再平衡，单边 10bp 交易成本；虚线为沪深300ETF。" />
          <div className="px-3 py-2"><BacktestChart backtest={analysis.backtest} /></div>
        </Card>
        <Card>
          <CardHead title="策略对比" desc="年化收益 / 夏普 / 最大回撤" />
          <div className="px-4 py-2"><StrategyBars analysis={analysis} /></div>
        </Card>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="回撤曲线" desc="从历史高点到低点的跌幅；用于评估持有体验。" />
          <div className="px-3 py-2"><DrawdownChart backtest={analysis.backtest} /></div>
        </Card>
        <Card>
          <CardHead title="回测口径" desc="务必区分样本内与真实未来。" />
          <ul className="space-y-2 px-5 py-4 text-[11px] leading-relaxed text-ink-600">
            <li>• 使用 ETF 复权日行情；月度最后一个交易日再平衡。</li>
            <li>• 每次调仓只使用当日及之前的数据，避免未来函数。</li>
            <li>• 交易成本按单边 10bp 估算，未计冲击成本与税费。</li>
            <li>• 历史长度不足的 ETF 在不同日期进入可选池。</li>
            <li>• 回测结果不代表未来，策略可能在样本外失效。</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function GoalTab({ analysis }: { analysis: AnalysisResult }) {
  const goals = analysis.goals;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "月结余", value: money(goals.cashflow.monthly_surplus) },
          { label: "应急金覆盖", value: `${goals.emergency_fund.months_covered ?? "—"} / ${goals.emergency_fund.target_months} 个月` },
          { label: "目标月供合计", value: money(goals.total_required_monthly) },
          { label: "资金缺口", value: money(goals.funding_gap) },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-ink-200/80 bg-white px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-ink-400">{item.label}</p>
            <p className="tabular mt-1 text-lg font-semibold text-ink-950">{item.value}</p>
          </div>
        ))}
      </div>
      <Card>
        <CardHead title="目标规划明细" desc="未来成本按通胀调整；月供按假设收益率计算；成功概率来自蒙特卡洛。" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="border-b border-ink-100 text-left text-[10px] uppercase tracking-wide text-ink-400">
                <th className="px-4 py-2 font-medium">目标</th>
                <th className="px-3 py-2 text-right font-medium">未来成本</th>
                <th className="px-3 py-2 text-right font-medium">预计积累</th>
                <th className="px-3 py-2 text-right font-medium">缺口</th>
                <th className="px-3 py-2 text-right font-medium">建议月供</th>
                <th className="px-4 py-2 text-right font-medium">成功概率</th>
              </tr>
            </thead>
            <tbody>
              {goals.goals.map((goal) => (
                <tr key={goal.name} className="border-b border-ink-50 last:border-0">
                  <td className="px-4 py-2 text-ink-700">{goal.name}<span className="ml-1 text-[10px] text-ink-400">{goal.years}年</span></td>
                  <td className="tabular px-3 py-2 text-right">{money(goal.future_cost)}</td>
                  <td className="tabular px-3 py-2 text-right">{money(goal.projected_amount)}</td>
                  <td className="tabular px-3 py-2 text-right text-amber-700">{money(goal.gap)}</td>
                  <td className="tabular px-3 py-2 text-right">{money(goal.required_monthly)}</td>
                  <td className="tabular px-4 py-2 text-right">{pct(goal.success_probability)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="负债优化" desc="雪崩法优先高息，雪球法优先小额；两者都按最低还款 + 额外还款模拟。" />
          <div className="space-y-2 px-5 py-4 text-[11px] text-ink-600">
            {Object.entries(goals.debt_payoff).map(([key, value]) => {
              const item = value as { months?: number; total_interest?: number; strategy?: string };
              return (
                <div key={key} className="flex items-center justify-between rounded-lg bg-ink-50/70 px-3 py-2">
                  <span>{item.strategy ?? key}</span>
                  <span className="tabular font-medium text-ink-900">{item.months ?? "—"} 个月 · 利息 {money(item.total_interest)}</span>
                </div>
              );
            })}
            <p className="text-ink-400">{goals.high_interest_debt.note}</p>
          </div>
        </Card>
        <Card>
          <CardHead title="养老测算" desc="25 倍年支出法则 + 4% 实际回报假设，仅作规划起点。" />
          {goals.retirement ? (
            <div className="grid grid-cols-2 gap-px bg-ink-100">
              {[
                { label: "距离退休", value: `${goals.retirement.years_to_retirement} 年` },
                { label: "目标本金", value: money(goals.retirement.target_corpus) },
                { label: "预计积累", value: money(goals.retirement.projected_corpus) },
                { label: "缺口", value: money(goals.retirement.gap) },
                { label: "建议月供", value: money(goals.retirement.required_monthly) },
                { label: "成功概率", value: pct(goals.retirement.success_probability) },
              ].map((item) => (
                <div key={item.label} className="bg-white px-4 py-3">
                  <p className="text-[10px] uppercase tracking-wide text-ink-400">{item.label}</p>
                  <p className="tabular mt-1 text-sm font-semibold text-ink-950">{item.value}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-5 py-6 text-xs text-ink-400">填写当前年龄与退休年龄后可测算。</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function EvidenceTab({ analysis }: { analysis: AnalysisResult }) {
  return (
    <div className="space-y-3">
      <Card>
        <CardHead title="宏观仪表盘" desc={`数据截至 ${analysis.meta.data_end}；每个指标标注实际观测日期。`} right={<FileSearch className="h-4 w-4 text-ink-400" />} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-xs">
            <thead>
              <tr className="border-b border-ink-100 text-left text-[10px] uppercase tracking-wide text-ink-400">
                <th className="px-4 py-2 font-medium">指标</th>
                <th className="px-3 py-2 text-right font-medium">最新值</th>
                <th className="px-3 py-2 font-medium">观测日期</th>
                <th className="px-4 py-2 text-right font-medium">环比变化</th>
              </tr>
            </thead>
            <tbody>
              {analysis.market.macro.indicators.map((item) => (
                <tr key={item.key} className="border-b border-ink-50 last:border-0">
                  <td className="px-4 py-2 text-ink-700">{item.label}</td>
                  <td className="tabular px-3 py-2 text-right">{item.value}{item.unit}</td>
                  <td className="px-3 py-2 text-ink-500">{item.date}</td>
                  <td className="tabular px-4 py-2 text-right">{item.change === null ? "—" : item.change.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHead title="ETF 候选筛选" desc="流动性、规模、费率与同类跟踪误差的综合评分；不是收益预测。" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead>
              <tr className="border-b border-ink-100 text-left text-[10px] uppercase tracking-wide text-ink-400">
                <th className="px-4 py-2 font-medium">代码</th>
                <th className="px-3 py-2 font-medium">名称</th>
                <th className="px-3 py-2 font-medium">类别</th>
                <th className="px-3 py-2 text-right font-medium">评分</th>
                <th className="px-3 py-2 text-right font-medium">成交额</th>
                <th className="px-4 py-2 font-medium">理由</th>
              </tr>
            </thead>
            <tbody>
              {analysis.screening.slice(0, 18).map((item) => (
                <tr key={item.code} className="border-b border-ink-50 last:border-0">
                  <td className="px-4 py-2 font-mono text-[11px]">{item.code}</td>
                  <td className="px-3 py-2 text-ink-700">{item.name}</td>
                  <td className="px-3 py-2">{item.class_label}</td>
                  <td className="tabular px-3 py-2 text-right">{item.score.toFixed(2)}</td>
                  <td className="tabular px-3 py-2 text-right">{money(item.amount)}</td>
                  <td className="px-4 py-2 text-[11px] text-ink-500">{item.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <CardHead title="证据与口径" desc="所有数字都可回溯到行情、宏观或规则/算法。" right={<AlertTriangle className="h-4 w-4 text-amber-500" />} />
        <ul className="space-y-2 px-5 py-4 text-[11px] leading-relaxed text-ink-600">
          {analysis.citations.map((item, index) => (
            <li key={`${item.label}-${index}`} className="flex gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />
              <span><b className="text-ink-800">{item.label}</b>：{item.detail}（{item.as_of}）</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
