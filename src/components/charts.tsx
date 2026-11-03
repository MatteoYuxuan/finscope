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
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = { fontSize: 11, fill: "#5d6f8a" } as const;
const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid #dbe3ee",
  fontSize: 12,
  boxShadow: "0 8px 24px rgba(15,23,42,0.08)",
} as const;

export interface Slice {
  label: string;
  valueCny: number;
  share: number;
  color: string;
}

const compact = (value: number) => {
  if (Math.abs(value) >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (Math.abs(value) >= 1e4) return `${(value / 1e4).toFixed(1)} 万`;
  return `${Math.round(value)}`;
};

export function DonutChart({ data, height = 220 }: { data: Slice[]; height?: number }) {
  if (data.length === 0) return <p className="p-6 text-center text-xs text-ink-400">暂无可展示的数据</p>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <PieChart>
          <Pie
            data={data}
            dataKey="valueCny"
            nameKey="label"
            innerRadius="58%"
            outerRadius="86%"
            paddingAngle={2}
            stroke="#fff"
            strokeWidth={2}
          >
            {data.map((item) => (
              <Cell key={item.label} fill={item.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value, name) => [`${compact(Number(value))} 元`, String(name)]}
          />
          <Legend
            verticalAlign="bottom"
            height={34}
            iconType="circle"
            iconSize={7}
            formatter={(value) => <span style={{ fontSize: 11, color: "#44556d" }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function HorizontalBars({
  data,
  height = 220,
  unit = "元",
}: {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  unit?: string;
}) {
  if (data.length === 0) return <p className="p-6 text-center text-xs text-ink-400">暂无可展示的数据</p>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 18, top: 4, bottom: 4 }}>
          <CartesianGrid stroke="#eef2f7" horizontal={false} />
          <XAxis type="number" tick={AXIS} tickFormatter={(value) => compact(Number(value))} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="label" width={92} tick={AXIS} axisLine={false} tickLine={false} />
          <Tooltip
            cursor={{ fill: "rgba(18,184,134,0.06)" }}
            contentStyle={TOOLTIP_STYLE}
            formatter={(value) => [`${compact(Number(value))} ${unit}`, "金额"]}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={14}>
            {data.map((item) => (
              <Cell key={item.label} fill={item.color ?? "#12b886"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendLine({
  data,
  height = 200,
  color = "#12b886",
  unit = "",
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  unit?: string;
}) {
  if (data.length === 0) return <p className="p-6 text-center text-xs text-ink-400">暂无可展示的数据</p>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: -8, right: 12, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={36} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(value) => [`${Number(value)} ${unit}`, ""]} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={{ r: 3, fill: color }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GroupedBars({
  data,
  keys,
  height = 220,
}: {
  data: Record<string, string | number>[];
  keys: { key: string; label: string; color: string }[];
  height?: number;
}) {
  if (data.length === 0) return <p className="p-6 text-center text-xs text-ink-400">暂无可展示的数据</p>;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: -10, right: 8, top: 8, bottom: 0 }}>
          <CartesianGrid stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={36} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend
            verticalAlign="top"
            height={26}
            iconType="circle"
            iconSize={7}
            formatter={(value) => <span style={{ fontSize: 11, color: "#44556d" }}>{value}</span>}
          />
          {keys.map((item) => (
            <Bar key={item.key} dataKey={item.key} name={item.label} fill={item.color} radius={[5, 5, 0, 0]} barSize={16} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
