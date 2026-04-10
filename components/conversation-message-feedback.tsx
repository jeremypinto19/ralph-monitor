import { format } from "date-fns";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  formatFeedbackReason,
  summarizeConversationFeedback,
} from "@/lib/conversation-feedback";
import type {
  AiConversationEvent,
  AssistantMessageFeedback,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export function ConversationFeedbackTableCell({
  events,
}: {
  events: AiConversationEvent[];
}) {
  const s = summarizeConversationFeedback(events);
  if (!s.hasUp && !s.hasDown) {
    return <span className="text-muted-foreground">—</span>;
  }

  const labels = s.reasonCodes.map(formatFeedbackReason);
  const short =
    labels.length === 0
      ? ""
      : labels.length <= 2
        ? labels.join(", ")
        : `${labels.slice(0, 2).join(", ")}…`;
  const title = labels.length > 0 ? labels.join(" · ") : undefined;

  return (
    <div
      className="flex max-w-[180px] flex-wrap items-center gap-1.5"
      title={title}
    >
      {s.hasDown && (
        <ThumbsDown className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
      )}
      {s.hasUp && (
        <ThumbsUp
          className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
          aria-hidden
        />
      )}
      {short ? (
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {short}
        </span>
      ) : null}
    </div>
  );
}

export function MessageFeedbackDetail({
  feedback,
  className,
}: {
  feedback: AssistantMessageFeedback;
  className?: string;
}) {
  const isDown = feedback.vote === "down";
  let updatedLabel = "";
  try {
    updatedLabel = format(new Date(feedback.updatedAt), "MMM d, HH:mm");
  } catch {
    updatedLabel = feedback.updatedAt;
  }

  return (
    <div
      className={cn("mt-2 space-y-2 border-t border-border/40 pt-2", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        {isDown ? (
          <ThumbsDown
            className="h-3.5 w-3.5 shrink-0 text-destructive"
            aria-hidden
          />
        ) : (
          <ThumbsUp
            className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden
          />
        )}
        <Badge
          variant={isDown ? "destructive" : "secondary"}
          className="text-[10px]"
        >
          {isDown ? "Thumbs down" : "Thumbs up"}
        </Badge>
        {updatedLabel ? (
          <span className="text-[10px] text-muted-foreground">
            {updatedLabel}
          </span>
        ) : null}
      </div>
      {feedback.reasons && feedback.reasons.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {feedback.reasons.map((r) => (
            <Badge
              key={r}
              variant="outline"
              className="text-[10px] font-normal"
            >
              {formatFeedbackReason(r)}
            </Badge>
          ))}
        </div>
      ) : null}
      {feedback.freeformText ? (
        <p className="whitespace-pre-wrap text-xs text-muted-foreground">
          {feedback.freeformText}
        </p>
      ) : null}
    </div>
  );
}
