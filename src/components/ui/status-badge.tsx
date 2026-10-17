import type { ContentStatus } from "@prisma/client";
import { STATUS_LABEL } from "@/server/workflow/states";
import { Badge, type Tone } from "./badge";

const TONE: Record<ContentStatus, Tone> = {
  IDEA: "neutral", PROMPT_READY: "blue", GENERATING: "violet", PROCESSING: "violet", AWAITING_APPROVAL: "gold",
  APPROVED: "green", SCHEDULED: "blue", PUBLISHED: "green", REJECTED: "red", NEEDS_REVISIONS: "amber",
  GENERATION_FAILED: "red", PUBLICATION_FAILED: "red", ARCHIVED: "neutral",
};

export function StatusBadge({ status }: { status: ContentStatus }) {
  return <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export function ScheduleBadge({ status, simulated }: { status: string; simulated?: boolean }) {
  const tone: Tone = status === "PUBLISHED" ? "green" : status === "FAILED" ? "red" : status === "CANCELED" ? "neutral" : status === "AWAITING_MANUAL" ? "gold" : "blue";
  const label = { QUEUED: "Queued", PUBLISHING: "Publishing…", AWAITING_MANUAL: "Ready to post manually", PUBLISHED: simulated ? "Simulated publish" : "Published (confirmed)", FAILED: "Failed", CANCELED: "Canceled" }[status] ?? status;
  return <Badge tone={tone}>{label}</Badge>;
}
