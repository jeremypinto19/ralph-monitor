import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export default function ConversationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 px-4 py-6 sm:px-6">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <Skeleton className="h-32 w-full rounded-md" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}
