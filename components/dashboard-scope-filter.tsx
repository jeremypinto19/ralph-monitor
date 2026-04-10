"use client";

import { useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { Check, ChevronRight, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import type { Shop } from "@/lib/types";
import {
  DASHBOARD_PERIOD_PRESETS,
  matchesPeriodPreset,
  periodSummaryLabel,
} from "@/lib/dashboard-scope-presets";

const BUILTIN_SHOP = "shop";
const BUILTIN_PERIOD = "period";

export function ScopeFilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-1">
      <p className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

export function ScopeFilterRow({
  selected,
  onSelect,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        selected
          ? "bg-accent font-medium text-accent-foreground"
          : "hover:bg-accent/50",
      )}
      onClick={onSelect}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && (
        <Check
          className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
    </button>
  );
}

export interface DashboardFilterCategory {
  id: string;
  label: string;
  /** Current value shown on the left nav row. */
  summary: string;
  /** Options for this category (right column). */
  panel: React.ReactNode;
}

interface DashboardScopeFilterProps {
  shop: string;
  onShopChange: (shop: string) => void;
  dateFrom: Date;
  dateTo: Date;
  onDateRangeChange: (from: Date, to: Date) => void;
  /** Renders above the category navigator (e.g. search). */
  aboveScope?: React.ReactNode;
  /** Extra filter dimensions (device, attribution, …). */
  extraCategories?: DashboardFilterCategory[];
}

function CategoryNavButton({
  label,
  summary,
  active,
  onClick,
}: {
  label: string;
  summary: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center gap-2 border-b border-border/60 px-2.5 py-2.5 text-left transition-colors last:border-b-0 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
        active ? "bg-accent/70" : "hover:bg-accent/40",
      )}
      onClick={onClick}
      aria-current={active ? "true" : undefined}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className="truncate text-[13px] text-foreground">{summary}</div>
      </div>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground/70"
        aria-hidden
      />
    </button>
  );
}

export function DashboardScopeFilter({
  shop,
  onShopChange,
  dateFrom,
  dateTo,
  onDateRangeChange,
  aboveScope,
  extraCategories = [],
}: DashboardScopeFilterProps) {
  const [open, setOpen] = useState(false);
  const [activeCategoryId, setActiveCategoryId] = useState(BUILTIN_SHOP);
  const [shops, setShops] = useState<Shop[]>([]);
  const [shopsLoading, setShopsLoading] = useState(true);
  const [customCalendarOpen, setCustomCalendarOpen] = useState(false);

  useEffect(() => {
    fetch("/api/shops")
      .then((r) => r.json())
      .then((d) => setShops(d.shops ?? []))
      .catch(() => {})
      .finally(() => setShopsLoading(false));
  }, []);

  const shopLabel = useMemo(() => {
    if (shop === "all") return "All shops";
    const match = shops.find((s) => s.name === shop);
    return match?.name ?? shop;
  }, [shop, shops]);

  const periodLabel = useMemo(
    () => periodSummaryLabel(dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  const triggerSummary = useMemo(() => {
    return `${shopLabel} · ${periodLabel}`;
  }, [shopLabel, periodLabel]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setActiveCategoryId(BUILTIN_SHOP);
      const presetHit = DASHBOARD_PERIOD_PRESETS.some(({ days }) =>
        matchesPeriodPreset(dateFrom, dateTo, days),
      );
      setCustomCalendarOpen(!presetHit);
    }
  };

  const shopPanel = (
    <div className="space-y-0.5">
      <ScopeFilterRow
        selected={shop === "all"}
        onSelect={() => onShopChange("all")}
      >
        {shopsLoading ? "Loading shops…" : "All shops"}
      </ScopeFilterRow>
      {shops.map((s) => (
        <ScopeFilterRow
          key={s.id}
          selected={shop === s.name}
          onSelect={() => onShopChange(s.name)}
        >
          {s.name}
        </ScopeFilterRow>
      ))}
    </div>
  );

  const periodPanel = (
    <div className="space-y-1">
      <div className="space-y-0.5">
        {DASHBOARD_PERIOD_PRESETS.map(({ id, label, days }) => (
          <ScopeFilterRow
            key={id}
            selected={matchesPeriodPreset(dateFrom, dateTo, days)}
            onSelect={() => {
              const to = new Date();
              onDateRangeChange(subDays(to, days), to);
              setCustomCalendarOpen(false);
            }}
          >
            {label}
          </ScopeFilterRow>
        ))}
      </div>
      <div className="px-0.5 pt-1">
        <button
          type="button"
          className={cn(
            "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            customCalendarOpen ? "bg-accent font-medium" : "hover:bg-accent/50",
          )}
          onClick={() => setCustomCalendarOpen((o) => !o)}
          aria-expanded={customCalendarOpen}
        >
          <span>Custom range</span>
        </button>
        {customCalendarOpen ? (
          <div className="mt-2 rounded-md border border-border bg-muted/20 p-1">
            <Calendar
              mode="range"
              selected={{ from: dateFrom, to: dateTo }}
              onSelect={(range) => {
                if (range?.from && range?.to) {
                  onDateRangeChange(range.from, range.to);
                }
              }}
              numberOfMonths={1}
              className="mx-auto w-full max-w-full p-0"
            />
            <p className="px-1 pb-1 text-center text-[11px] text-muted-foreground">
              {format(dateFrom, "MMM d, yyyy")} –{" "}
              {format(dateTo, "MMM d, yyyy")}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );

  const activeExtra = extraCategories.find((c) => c.id === activeCategoryId);

  const rightPanelTitle =
    activeCategoryId === BUILTIN_SHOP
      ? "Shop"
      : activeCategoryId === BUILTIN_PERIOD
        ? "Period"
        : (activeExtra?.label ?? "Filters");

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8 min-w-[220px] max-w-[min(100vw-2rem,340px)] justify-start gap-2 border-border bg-background px-2.5 text-left text-[13px] font-normal shadow-none hover:bg-accent/40",
            )}
            aria-label="Open filters"
          />
        }
      >
        <ListFilter className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-foreground">
          {triggerSummary}
        </span>
      </PopoverTrigger>
      <PopoverContent
        className="flex max-h-[min(100dvh-1rem,640px)] w-[min(100vw-1rem,480px)] flex-col gap-0 overflow-hidden p-0"
        align="start"
      >
        <PopoverHeader className="shrink-0 border-b border-border px-3 py-2">
          <PopoverTitle className="text-[13px] font-semibold">
            Filters
          </PopoverTitle>
        </PopoverHeader>

        {aboveScope ? (
          <div className="max-h-[min(40vh,280px)] shrink-0 overflow-y-auto overscroll-contain border-b border-border p-2">
            {aboveScope}
          </div>
        ) : null}

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <nav
            className="flex w-[min(42%,200px)] min-h-0 shrink-0 flex-col overflow-y-auto overscroll-contain border-r border-border bg-muted/20 py-0.5 [-webkit-overflow-scrolling:touch]"
            aria-label="Filter categories"
          >
            <CategoryNavButton
              label="Shop"
              summary={shopLabel}
              active={activeCategoryId === BUILTIN_SHOP}
              onClick={() => setActiveCategoryId(BUILTIN_SHOP)}
            />
            <CategoryNavButton
              label="Period"
              summary={periodLabel}
              active={activeCategoryId === BUILTIN_PERIOD}
              onClick={() => setActiveCategoryId(BUILTIN_PERIOD)}
            />
            {extraCategories.map((c) => (
              <CategoryNavButton
                key={c.id}
                label={c.label}
                summary={c.summary}
                active={activeCategoryId === c.id}
                onClick={() => setActiveCategoryId(c.id)}
              />
            ))}
          </nav>

          <div
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-2 [-webkit-overflow-scrolling:touch]"
            role="region"
            aria-label={rightPanelTitle}
          >
            <p className="mb-2 px-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {rightPanelTitle}
            </p>
            {activeCategoryId === BUILTIN_SHOP && shopPanel}
            {activeCategoryId === BUILTIN_PERIOD && periodPanel}
            {activeExtra ? activeExtra.panel : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
