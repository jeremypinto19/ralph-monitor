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

export interface SidebarNavProps {
  /** Called after a nav link is activated (e.g. close mobile sheet). */
  onNavigate?: () => void;
  className?: string;
}

export function SidebarNav({ onNavigate, className }: SidebarNavProps) {
  const pathname = usePathname();

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col bg-sidebar",
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground">
          <Bot className="h-3.5 w-3.5 text-background" />
        </div>
        <span className="truncate text-sm font-semibold text-foreground">
          Ralph Monitor
        </span>
      </div>

      <nav className="flex-1 px-2 py-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => onNavigate?.()}
              className={cn(
                "group flex items-center gap-2.5 rounded-md px-2.5 py-[6px] text-[13px] transition-colors",
                active
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/60 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0 opacity-70" />
              <span className="flex-1 truncate">{label}</span>
              {active && (
                <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <p className="text-[11px] text-muted-foreground">ABCA Explorer</p>
        <p className="text-[11px] text-muted-foreground/60">Internal tool</p>
      </div>
    </div>
  );
}

/** Fixed left rail on `md` and up; hidden on small screens (use `DashboardShell` sheet). */
export function Sidebar() {
  return (
    <aside className="hidden h-full w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <SidebarNav />
    </aside>
  );
}
