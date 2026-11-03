"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartSpec } from "@/lib/types/domain";
import { cn } from "@/lib/client/api";

/**
 * chart spec 渲染器。
 *
 * 数据由服务端按 spec 注入，这里只负责“按类型画出来”，不做二次计算，
 * 从而保证页面上的每个数字都能追溯到 DB 字段或聚合函数。
 */

const AXIS = { fontSize: 11, fill: "#5d6f8a" } as const;
const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #dbe3ee",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
} as const;
const FALLBACK_COLORS = ["#12b886", "#2563eb", "#7c3aed", "#f59e0b", "#ef4444", "#0891b2", "#84cc16", "#a16207"];

function compact(value: number): string {
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(1)} 万`;
  return `${Math.round(value * 10) / 10}`;
}

function SpecBody({ spec }: { spec: ChartSpec }) {
  const points = spec.points ?? [];

  if (spec.type === "table") {
    if (!spec.table) return <EmptyBody />;
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-xs">
          <thead>
            <tr className="border-b border-ink-100 text-ink-400">
              {spec.table.columns.map((column) => (
                <th
                  key={column.key}
                  className={cn("whitespace-nowrap px-2 py-2 font-medium", column.align === "right" && "text-right")}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.table.rows.map((row, index) => (
              <tr key={index} className="border-b border-ink-50 last:border-0">
                {spec.table!.columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-2 py-2 align-top text-ink-700",
                      column.align === "right" && "tabular text-right",
                      column.key === "title" && "font-medium text-ink-900",
                    )}
                  >
                    {String(row[column.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (spec.type === "timeline") {
    const items = spec.timeline ?? [];
    if (items.length === 0) return <EmptyBody />;
    return (
      <ol className="relative space-y-3 border-l border-ink-100 pl-4">
        {items.map((item, index) => (
          <li key={`${item.at}-${index}`} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-brand-500" />
            <p className="text-[11px] text-ink-400">{item.at.slice(0, 16).replace("T", " ")}</p>
            <p className="text-sm text-ink-800">{item.label}</p>
            {item.detail ? <p className="mt-0.5 text-xs text-ink-500">{item.detail}</p> : null}
          </li>
        ))}
      </ol>
    );
  }

  if (spec.type === "checklist") {
    const items = spec.checklist ?? [];
    if (items.length === 0) return <EmptyBody />;
    return (
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2 text-sm text-ink-800">
            <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border border-ink-200 text-[10px] text-ink-400">
              ✓
            </span>
            <span>
              {item.text}
              {item.hint ? <span className="mt-0.5 block text-xs text-ink-500">{item.hint}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (spec.type === "relation_graph") {
    return <RelationGraph spec={spec} />;
  }

  if (spec.type === "risk_matrix") {
    const matrix = spec.matrix ?? [];
    if (matrix.length === 0) return <EmptyBody />;
    return (
      <div className="h-[220px] w-full">
        <ResponsiveContainer>
          <ScatterChart margin={{ left: -8, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid stroke="#eef2f7" />
            <XAxis
              type="number"
              dataKey="x"
              name={spec.axes?.x ?? "x"}
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              unit="%"
            />
            <YAxis
              type="number"
              dataKey="y"
              name={spec.axes?.y ?? "y"}
              tick={AXIS}
              axisLine={false}
              tickLine={false}
              unit="%"
              width={42}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value) => [`${Number(value)}%`, ""]}
              labelFormatter={() => ""}
              content={({ payload }) => {
                const point = payload?.[0]?.payload as { label?: string; x?: number; y?: number; group?: string } | undefined;
                if (!point) return null;
                return (
                  <div className="rounded-lg border border-ink-100 bg-white px-3 py-2 text-xs shadow-sm">
                    <p className="font-medium text-ink-900">{point.label}</p>
                    <p className="text-ink-500">
                      当前 {point.x}% · 阈值 {point.y}% {point.group ? `· ${point.group}` : ""}
                    </p>
                  </div>
                );
              }}
            />
            <Scatter data={matrix} fill="#12b886">
              {matrix.map((item, index) => (
                <Cell key={item.label} fill={item.group === "高于参考" ? "#ef4444" : FALLBACK_COLORS[index % FALLBACK_COLORS.length]} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (points.length === 0) return <EmptyBody />;

  if (spec.type === "donut") {
    return (
      <div className="h-[220px] w-full">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={points} dataKey="value" nameKey="label" innerRadius="56%" outerRadius="86%" paddingAngle={2} stroke="#fff" strokeWidth={2}>
              {points.map((point, index) => (
                <Cell key={`${point.label}-${index}`} fill={point.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value, name) => [`${compact(Number(value))} ${spec.unit ?? ""}`, String(name)]} />
            <Legend
              verticalAlign="bottom"
              height={30}
              iconType="circle"
              iconSize={7}
              formatter={(value) => <span style={{ fontSize: 11, color: "#44556d" }}>{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.type === "hbar") {
    return (
      <div className="h-[220px] w-full">
        <ResponsiveContainer>
          <BarChart data={points} layout="vertical" margin={{ left: 4, right: 18, top: 4, bottom: 4 }}>
            <CartesianGrid stroke="#eef2f7" horizontal={false} />
            <XAxis type="number" tick={AXIS} tickFormatter={(value) => compact(Number(value))} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="label" width={92} tick={AXIS} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${compact(Number(value))} ${spec.unit ?? ""}`, ""]} />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={14}>
              {points.map((point, index) => (
                <Cell key={`${point.label}-${index}`} fill={point.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.type === "line") {
    return (
      <div className="h-[200px] w-full">
        <ResponsiveContainer>
          <LineChart data={points} margin={{ left: -8, right: 12, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={36} />
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${Number(value)} ${spec.unit ?? ""}`, ""]} />
            <Line type="monotone" dataKey="value" stroke="#12b886" strokeWidth={2} dot={{ r: 3, fill: "#12b886" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (spec.type === "grouped_bar") {
    const series = spec.series ?? [
      { key: "value", label: "数值", color: "#12b886" },
      { key: "value2", label: "参考", color: "#94a3b8" },
    ];
    return (
      <div className="h-[200px] w-full">
        <ResponsiveContainer>
          <BarChart data={points} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
            <CartesianGrid stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} width={36} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend verticalAlign="top" height={26} iconType="circle" iconSize={7} formatter={(value) => <span style={{ fontSize: 11 }}>{value}</span>} />
            {series.map((item, index) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.label}
                fill={item.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]}
                radius={[5, 5, 0, 0]}
                barSize={22}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer>
        <BarChart data={points} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval={0} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={36} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${Number(value)} ${spec.unit ?? ""}`, ""]} />
          <Bar dataKey="value" radius={[5, 5, 0, 0]} barSize={22}>
            {points.map((point, index) => (
              <Cell key={`${point.label}-${index}`} fill={point.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function EmptyBody() {
  return <p className="py-8 text-center text-xs text-ink-400">暂无可展示的数据</p>;
}

function RelationGraph({ spec }: { spec: ChartSpec }) {
  const nodes = spec.nodes ?? [];
  const edges = spec.edges ?? [];
  if (nodes.length === 0) return <EmptyBody />;

  const size = 260;
  const center = size / 2;
  const radius = 92;
  const positions = new Map<string, { x: number; y: number }>();
  nodes.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / nodes.length - Math.PI / 2;
    positions.set(node.id, { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) });
  });

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-[260px] w-full" role="img" aria-label={spec.title}>
      {edges.map((edge, index) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return null;
        return (
          <g key={index}>
            <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#cbd5e1" strokeWidth={1} />
            {edge.label ? (
              <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2} fontSize={8} fill="#94a3b8" textAnchor="middle">
                {edge.label}
              </text>
            ) : null}
          </g>
        );
      })}
      {nodes.map((node, index) => {
        const position = positions.get(node.id);
        if (!position) return null;
        const nodeRadius = Math.min(9 + (node.weight ?? 1) * 1.5, 18);
        return (
          <g key={node.id}>
            <circle cx={position.x} cy={position.y} r={nodeRadius} fill={FALLBACK_COLORS[index % FALLBACK_COLORS.length]} opacity={0.9} />
            <text x={position.x} y={position.y + nodeRadius + 10} fontSize={9} fill="#44556d" textAnchor="middle">
              {node.label.length > 8 ? `${node.label.slice(0, 8)}…` : node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function SpecChart({ spec, className }: { spec: ChartSpec; className?: string }) {
  const hasFooter = Boolean(spec.rationale || spec.source || spec.note || (spec.citations && spec.citations.length > 0));
  return (
    <article className={cn("flex h-full flex-col rounded-2xl border border-ink-100 bg-white p-4 shadow-sm", className)}>
      <header className="mb-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink-900">{spec.title}</h3>
          <span className="shrink-0 rounded-full bg-ink-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-400">
            {spec.type}
          </span>
        </div>
        {spec.subtitle ? <p className="mt-1 text-xs text-ink-500">{spec.subtitle}</p> : null}
      </header>
      <div className="flex-1">
        <SpecBody spec={spec} />
      </div>
      {hasFooter ? (
        <footer className="mt-3 space-y-1 border-t border-ink-50 pt-2 text-[11px] leading-relaxed text-ink-400">
          {spec.rationale ? <p>为什么用这种表达：{spec.rationale}</p> : null}
          {spec.note ? <p>{spec.note}</p> : null}
          {spec.source ? <p>数据来源：{spec.source}</p> : null}
          {spec.citations.length > 0 ? (
            <p>
              引用：
              {spec.citations.slice(0, 4).map((citation, index) => (
                <span key={`${citation.type}-${citation.id}`} className="mr-1">
                  [{index + 1}] {citation.label}
                </span>
              ))}
            </p>
          ) : null}
          {spec.disclaimer ? <p className="text-ink-300">{spec.disclaimer}</p> : null}
        </footer>
      ) : null}
    </article>
  );
}

export function SpecChartGrid({ specs, className }: { specs: ChartSpec[]; className?: string }) {
  if (specs.length === 0) return null;
  return (
    <div className={cn("grid gap-4 md:grid-cols-2", className)}>
      {specs.map((spec) => (
        <SpecChart key={spec.id} spec={spec} />
      ))}
    </div>
  );
}
