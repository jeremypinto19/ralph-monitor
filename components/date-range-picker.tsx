"use client";

import { useState } from "react";
import { format, subDays } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

interface DateRangePickerProps {
  from: Date;
  to: Date;
  onChange: (from: Date, to: Date) => void;
}

const PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

export function DateRangePicker({ from, to, onChange }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex items-center gap-1.5">
      {PRESETS.map(({ label, days }) => (
        <button
          key={days}
          onClick={() => onChange(subDays(new Date(), days), new Date())}
          className="rounded-md px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {label}
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-7 w-[200px] justify-start border-border bg-transparent text-left text-[12px] font-normal",
                !from && "text-muted-foreground"
              )}
            />
          }
        >
          <CalendarIcon className="mr-1.5 h-3.5 w-3.5 opacity-50" />
          {from ? (
            <>
              {format(from, "MMM d")} – {format(to, "MMM d, yyyy")}
            </>
          ) : (
            "Pick dates"
          )}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={{ from, to }}
            onSelect={(range) => {
              if (range?.from && range?.to) {
                onChange(range.from, range.to);
                setOpen(false);
              }
            }}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
