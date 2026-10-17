import type { ContentStatus } from "@prisma/client";
import { AppError } from "../errors";

/**
 * Content lifecycle:
 * IDEA → PROMPT_READY → GENERATING → PROCESSING → AWAITING_APPROVAL → APPROVED → SCHEDULED → PUBLISHED
 * Side states: REJECTED, NEEDS_REVISIONS, GENERATION_FAILED, PUBLICATION_FAILED, ARCHIVED.
 * APPROVED/SCHEDULED are only reachable through the approval service (never by direct edit).
 */
export const TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  IDEA: ["PROMPT_READY", "AWAITING_APPROVAL", "ARCHIVED"],
  PROMPT_READY: ["IDEA", "GENERATING", "AWAITING_APPROVAL", "ARCHIVED"],
  GENERATING: ["PROCESSING", "GENERATION_FAILED", "AWAITING_APPROVAL"],
  PROCESSING: ["AWAITING_APPROVAL", "GENERATION_FAILED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED", "NEEDS_REVISIONS", "GENERATING", "AWAITING_APPROVAL", "ARCHIVED"],
  APPROVED: ["SCHEDULED", "AWAITING_APPROVAL", "NEEDS_REVISIONS", "REJECTED", "ARCHIVED"],
  SCHEDULED: ["PUBLISHED", "PUBLICATION_FAILED", "APPROVED", "AWAITING_APPROVAL"],
  PUBLISHED: ["ARCHIVED"],
  REJECTED: ["IDEA", "PROMPT_READY", "GENERATING", "AWAITING_APPROVAL", "APPROVED", "NEEDS_REVISIONS", "ARCHIVED"],
  NEEDS_REVISIONS: ["PROMPT_READY", "GENERATING", "AWAITING_APPROVAL", "APPROVED", "REJECTED", "ARCHIVED"],
  GENERATION_FAILED: ["PROMPT_READY", "GENERATING", "AWAITING_APPROVAL", "ARCHIVED"],
  PUBLICATION_FAILED: ["SCHEDULED", "APPROVED", "AWAITING_APPROVAL", "REJECTED", "NEEDS_REVISIONS", "ARCHIVED"],
  ARCHIVED: ["IDEA"],
};

export function canTransition(from: ContentStatus, to: ContentStatus) {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ContentStatus, to: ContentStatus) {
  if (!canTransition(from, to)) {
    throw new AppError("CONFLICT", `A concept in ${label(from)} cannot move to ${label(to)}.`);
  }
}

export const STATUS_LABEL: Record<ContentStatus, string> = {
  IDEA: "Idea",
  PROMPT_READY: "Prompt ready",
  GENERATING: "Generating",
  PROCESSING: "Processing",
  AWAITING_APPROVAL: "Awaiting my approval",
  APPROVED: "Approved",
  SCHEDULED: "Scheduled",
  PUBLISHED: "Published",
  REJECTED: "Rejected",
  NEEDS_REVISIONS: "Needs revisions",
  GENERATION_FAILED: "Generation failed",
  PUBLICATION_FAILED: "Publication failed",
  ARCHIVED: "Archived",
};

export const label = (s: ContentStatus) => STATUS_LABEL[s];
