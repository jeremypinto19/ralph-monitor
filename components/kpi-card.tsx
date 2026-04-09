"use client";

import type { LucideIcon } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
}

export function KpiCard({ title, value, subtitle, icon: Icon }: KpiCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent/30">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted-foreground">{title}</span>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground/50" />}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </div>
      {subtitle && (
        <p className="mt-1 text-[12px] text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
