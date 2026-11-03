"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { AnalysisResult, AdviceAllocation, BacktestResult, RiskSnapshot } from "@/lib/types/investment";

const AXIS = { fontSize: 10, fill: "#5d6f8a" } as const;
const TOOLTIP = {
  borderRadius: 10,
  border: "1px solid #dbe3ee",
  fontSize: 11,
  boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
} as const;

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

export function AllocationCompareChart({ allocation }: { allocation: AdviceAllocation[] }) {
  if (!allocation.length) return <Empty />;
  const data = allocation.map((item) => ({
    label: item.label,
    current: Math.round(item.current * 1000) / 10,
    target: Math.round(item.target * 1000) / 10,
  }));
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
          <Tooltip contentStyle={TOOLTIP} formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name === "current" ? "当前" : "目标"]} />
          <Legend iconType="circle" iconSize={7} formatter={(v) => <span className="text-[11px] text-ink-600">{v === "current" ? "当前" : "目标"}</span>} />
          <Bar dataKey="current" fill="#cbd5e1" radius={[4, 4, 0, 0]} barSize={16} />
          <Bar dataKey="target" fill="#12b886" radius={[4, 4, 0, 0]} barSize={16} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BacktestChart({ backtest }: { backtest: Record<string, BacktestResult> }) {
  const combined = backtest.combined;
  if (!combined?.ok || !combined.series?.length) return <Empty text="回测数据不足" />;
  const data = combined.series.map((item) => ({
    date: item.date.slice(2, 7),
    portfolio: item.portfolio,
    benchmark: item.benchmark,
  }));
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} minTickGap={30} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} domain={["auto", "auto"]} />
          <Tooltip contentStyle={TOOLTIP} />
          <Legend iconType="circle" iconSize={7} formatter={(v) => <span className="text-[11px] text-ink-600">{v === "portfolio" ? "集成策略" : "沪深300"}</span>} />
          <Line type="monotone" dataKey="portfolio" stroke="#12b886" strokeWidth={2} dot={false} name="portfolio" />
          <Line type="monotone" dataKey="benchmark" stroke="#94a3b8" strokeWidth={1.2} strokeDasharray="4 3" dot={false} name="benchmark" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DrawdownChart({ backtest }: { backtest: Record<string, BacktestResult> }) {
  const data = backtest.combined?.drawdown ?? [];
  if (!data.length) return <Empty text="回撤数据不足" />;
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer>
        <AreaChart data={data.map((item) => ({ date: item.date.slice(2, 7), value: item.value * 100 }))} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="date" tick={AXIS} axisLine={false} tickLine={false} minTickGap={30} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
          <Tooltip contentStyle={TOOLTIP} formatter={(value) => [`${Number(value).toFixed(1)}%`, "回撤"]} />
          <Area type="monotone" dataKey="value" stroke="#ef4444" fill="#fee2e2" strokeWidth={1.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StressChart({ risk }: { risk: RiskSnapshot }) {
  const data = (risk.stress ?? []).map((item) => ({
    name: item.name,
    value: Math.round(item.portfolio_return * 1000) / 10,
    type: item.type,
  }));
  if (!data.length) return <Empty text="压力测试数据不足" />;
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 24, top: 4, bottom: 0 }}>
          <CartesianGrid stroke="#eef2f7" horizontal={false} />
          <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
          <YAxis type="category" dataKey="name" width={124} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TOOLTIP} formatter={(value) => [`${Number(value).toFixed(1)}%`, "组合估算收益"]} />
          <ReferenceLine x={0} stroke="#334155" />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={13}>
            {data.map((item, index) => (
              <Cell key={index} fill={item.value < -8 ? "#ef4444" : item.value < 0 ? "#f59e0b" : "#12b886"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RiskBudgetChart({ risk, names }: { risk: RiskSnapshot; names: Record<string, string> }) {
  const data = (risk.risk_budget ?? []).slice(0, 10).map((item) => ({
    name: names[item.code] ?? item.code,
    value: Math.round(item.risk_contribution * 1000) / 10,
    weight: Math.round(item.weight * 1000) / 10,
  }));
  if (!data.length) return <Empty />;
  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 10, right: 24, top: 4, bottom: 0 }}>
          <CartesianGrid stroke="#eef2f7" horizontal={false} />
          <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
          <YAxis type="category" dataKey="name" width={100} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={TOOLTIP} formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name === "value" ? "风险贡献" : "资金权重"]} />
          <Legend iconType="circle" iconSize={7} formatter={(v) => <span className="text-[11px] text-ink-600">{v === "value" ? "风险贡献" : "资金权重"}</span>} />
          <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={10} name="value" />
          <Bar dataKey="weight" fill="#cbd5e1" radius={[0, 4, 4, 0]} barSize={10} name="weight" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FrontierChart({ analysis }: { analysis: AnalysisResult }) {
  const chart = analysis.charts.find((item) => item.id === "efficient-frontier");
  const raw = (chart?.data as { return: number; volatility: number; kind?: string; label?: string }[] | undefined) ?? [];
  if (!raw.length) return <Empty text="有效前沿数据不足" />;
  const points = raw.filter((item) => !item.kind).map((item) => ({ x: item.volatility * 100, y: item.return * 100 }));
  const target = raw.find((item) => item.kind === "target");
  const current = raw.find((item) => item.kind === "current");
  const markers = [
    target ? { x: target.volatility * 100, y: target.return * 100, label: "目标" } : null,
    current ? { x: current.volatility * 100, y: current.return * 100, label: "当前" } : null,
  ].filter(Boolean) as { x: number; y: number; label: string }[];
  return (
    <div className="h-[320px] w-full">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 12, right: 16, left: -12, bottom: 0 }}>
          <CartesianGrid stroke="#eef2f7" />
          <XAxis type="number" dataKey="x" name="波动率" unit="%" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis type="number" dataKey="y" name="预期收益" unit="%" tick={AXIS} axisLine={false} tickLine={false} />
          <ZAxis range={[30, 30]} />
          <Tooltip contentStyle={TOOLTIP} formatter={(value, name) => [`${Number(value).toFixed(2)}%`, name === "x" ? "年化波动" : "年化收益"]} />
          <Scatter data={points} fill="#38bdf8" name="有效前沿" />
          <Scatter data={markers} fill="#12b886" shape="star" name="组合">
            {markers.map((item, index) => (
              <Cell key={index} fill={item.label === "目标" ? "#12b886" : "#ef4444"} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

export function StrategyBars({ analysis }: { analysis: AnalysisResult }) {
  const rows = Object.entries(analysis.backtest ?? {})
    .filter(([, value]) => value.ok && value.metrics)
    .map(([key, value]) => ({
      key,
      label: STRATEGY_LABEL[key] ?? key,
      cagr: Math.round((value.metrics?.cagr ?? 0) * 1000) / 10,
      sharpe: value.metrics?.sharpe ?? 0,
      mdd: Math.round((value.metrics?.max_drawdown ?? 0) * 1000) / 10,
    }));
  if (!rows.length) return <Empty text="回测数据不足" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-ink-100 text-left text-[10px] uppercase tracking-wide text-ink-400">
            <th className="py-2 pr-3 font-medium">策略</th>
            <th className="py-2 pr-3 text-right font-medium">年化收益</th>
            <th className="py-2 pr-3 text-right font-medium">夏普</th>
            <th className="py-2 text-right font-medium">最大回撤</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-ink-50 last:border-0">
              <td className="py-2 pr-3 text-ink-700">{row.label}</td>
              <td className={`tabular py-2 pr-3 text-right ${row.cagr >= 0 ? "text-brand-700" : "text-red-600"}`}>{row.cagr.toFixed(1)}%</td>
              <td className="tabular py-2 pr-3 text-right text-ink-700">{row.sharpe.toFixed(2)}</td>
              <td className="tabular py-2 text-right text-red-600">{row.mdd.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STRATEGY_LABEL: Record<string, string> = {
  equal: "等权",
  sixty_forty: "60/40",
  risk_parity: "风险平价",
  mvo: "均值方差",
  black_litterman: "Black-Litterman",
  combined: "集成策略",
};

function Empty({ text = "暂无可展示的数据" }: { text?: string }) {
  return <p className="flex h-[200px] items-center justify-center text-xs text-ink-400">{text}</p>;
}
