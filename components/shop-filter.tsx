"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Shop } from "@/lib/types";

interface ShopFilterProps {
  value: string;
  onChange: (v: string) => void;
}

export function ShopFilter({ value, onChange }: ShopFilterProps) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/shops")
      .then((r) => r.json())
      .then((d) => setShops(d.shops ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? "all")}>
      <SelectTrigger className="h-7 w-[180px] border-border bg-transparent text-[12px]">
        <SelectValue
          placeholder={loading ? "Loading..." : "All shops"}
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" className="text-[12px]">
          All shops
        </SelectItem>
        {shops.map((s) => (
          <SelectItem key={s.id} value={s.name} className="text-[12px]">
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
