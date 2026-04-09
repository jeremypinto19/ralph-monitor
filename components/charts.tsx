"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const COLORS = [
  "#37352f",
  "#9b9a97",
  "#787774",
  "#c4c4c0",
  "#505048",
  "#a8a8a3",
  "#646460",
  "#d4d4d0",
];

interface ChartCardProps {
  title: string;
  children: React.ReactNode;
}

export function ChartCard({ title, children }: ChartCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <h3 className="mb-4 text-[13px] font-medium text-muted-foreground">
        {title}
      </h3>
      <div className="h-[280px]">{children}</div>
    </div>
  );
}

interface TimeSeriesProps {
  data: { date: string; count: number }[];
  color?: string;
}

export function TimeSeriesChart({
  data,
  color = COLORS[0],
}: TimeSeriesProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          vertical={false}
        />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid var(--border)",
            boxShadow: "0 1px 4px rgba(0,0,0,.06)",
            background: "var(--card)",
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke={color}
          fill={color}
          fillOpacity={0.08}
          strokeWidth={1.5}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

interface BarChartProps {
  data: { name: string; value: number }[];
}

export function HorizontalBarChart({ data }: BarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 60 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--border)"
          horizontal={false}
        />
        <XAxis
          type="number"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          dataKey="name"
          type="category"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          width={80}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid var(--border)",
            boxShadow: "0 1px 4px rgba(0,0,0,.06)",
            background: "var(--card)",
          }}
        />
        <Bar dataKey="value" fill={COLORS[0]} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface PieChartProps {
  data: { name: string; value: number }[];
}

export function DonutChart({ data }: PieChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={95}
          paddingAngle={2}
          stroke="var(--card)"
          strokeWidth={2}
          label={({ name, percent }) =>
            `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
          }
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            fontSize: 12,
            borderRadius: 6,
            border: "1px solid var(--border)",
            boxShadow: "0 1px 4px rgba(0,0,0,.06)",
            background: "var(--card)",
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
