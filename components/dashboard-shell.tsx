"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { buttonVariants } from "@/components/ui/button";
import { Sidebar, SidebarNav } from "@/components/sidebar";
import { cn } from "@/lib/utils";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col md:flex-row">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-background px-3 md:hidden">
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger
            type="button"
            className={cn(
              buttonVariants({ variant: "outline", size: "icon" }),
              "shrink-0",
            )}
            aria-label="Open navigation menu"
          >
            <Menu className="size-4" />
          </SheetTrigger>
          <SheetContent
            side="left"
            showCloseButton
            className="w-[min(100%,280px)] max-w-[280px] gap-0 border-sidebar-border bg-sidebar p-0 sm:max-w-[280px]"
          >
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
          </SheetContent>
        </Sheet>
        <span className="truncate text-sm font-semibold text-foreground">
          Ralph Monitor
        </span>
      </header>

      <Sidebar />

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-background">
        {children}
      </main>
    </div>
  );
}
