"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  ShoppingCart,
  Layers,
  Bot,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/checkout", label: "Checkout", icon: ShoppingCart },
  { href: "/insights", label: "Insights", icon: Layers },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-[240px] flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground">
          <Bot className="h-3.5 w-3.5 text-background" />
        </div>
        <span className="text-sm font-semibold text-foreground">Ralph Monitor</span>
      </div>

      <nav className="flex-1 px-2 py-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group flex items-center gap-2.5 rounded-md px-2.5 py-[6px] text-[13px] transition-colors",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0 opacity-70" />
              <span className="flex-1">{label}</span>
              {active && (
                <ChevronRight className="h-3 w-3 opacity-40" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <p className="text-[11px] text-muted-foreground">ABCA Explorer</p>
        <p className="text-[11px] text-muted-foreground/60">Internal tool</p>
      </div>
    </aside>
  );
}
