import { format, isSameDay, subDays } from "date-fns";

export const DASHBOARD_PERIOD_PRESETS = [
  { id: "7", label: "Past 7 days", days: 7 },
  { id: "30", label: "Past 30 days", days: 30 },
  { id: "90", label: "Past 90 days", days: 90 },
] as const;

export function matchesPeriodPreset(
  from: Date,
  to: Date,
  days: number,
): boolean {
  const now = new Date();
  if (!isSameDay(to, now)) return false;
  return isSameDay(from, subDays(now, days));
}

/** Short label for the filter trigger when the range matches a preset ending today. */
export function periodSummaryLabel(from: Date, to: Date): string {
  const now = new Date();
  if (!isSameDay(to, now)) {
    return `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;
  }
  for (const { label, days } of DASHBOARD_PERIOD_PRESETS) {
    if (matchesPeriodPreset(from, to, days)) return label;
  }
  return `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;
}
