import { db } from "../db";
import { requireWorkspace } from "../permissions";
import { addDays, dateInTz, weekDates } from "../time";
import type { Actor } from "../auth/actor";

export async function dashboardData(actor: Actor, workspaceId: string) {
  const { workspace } = await requireWorkspace(actor, workspaceId, "view");
  const today = dateInTz(new Date(), workspace.defaultTimezone);
  const week = weekDates(today);
  const [concepts, failedJobs, failedPublishes, upcoming, publishedThisWeek, generatedThisWeek, realSnapshots, inbox] = await Promise.all([
    db.contentConcept.findMany({ where: { workspaceId, plannedDate: { gte: week[0], lte: week[6] } }, select: { id: true, title: true, status: true, plannedDate: true, plannedTime: true } }),
    db.generationJob.findMany({ where: { concept: { workspaceId }, status: "FAILED", updatedAt: { gte: new Date(Date.now() - 14 * 86400000) } }, include: { concept: { select: { id: true, title: true } } }, orderBy: { updatedAt: "desc" }, take: 5 }),
    db.publishingSchedule.findMany({ where: { workspaceId, status: "FAILED" }, include: { concept: { select: { title: true } } }, orderBy: { updatedAt: "desc" }, take: 5 }),
    db.publishingSchedule.findMany({ where: { workspaceId, status: { in: ["QUEUED", "AWAITING_MANUAL"] } }, include: { concept: { select: { title: true } }, integration: { select: { displayName: true, isSimulated: true } } }, orderBy: { scheduledFor: "asc" }, take: 7 }),
    db.publishingSchedule.count({ where: { workspaceId, status: "PUBLISHED", post: { confirmedAt: { gte: new Date(`${week[0]}T00:00:00Z`) } } } }),
    db.assetVersion.count({ where: { asset: { workspaceId, kind: "VIDEO" }, source: { in: ["GENERATED", "SIMULATED"] }, createdAt: { gte: new Date(`${week[0]}T00:00:00Z`) } } }),
    db.analyticsSnapshot.findMany({ where: { workspaceId, isDemo: false, periodStart: { gte: new Date(Date.now() - 30 * 86400000) } } }),
    db.mediaAsset.count({ where: { workspaceId, kind: "VIDEO", deletedAt: null, archivedAt: null, currentVersion: { approvals: { none: {} } } } }),
  ]);
  const count = (s: string[]) => concepts.filter((c) => s.includes(c.status)).length;
  const missingDays = week.filter((d) => d >= today && !concepts.some((c) => c.plannedDate === d && c.status !== "ARCHIVED"));
  const tomorrow = addDays(today, 1);
  return {
    workspace, today, week,
    counts: {
      planned: concepts.filter((c) => c.status !== "ARCHIVED").length,
      generated: generatedThisWeek,
      awaitingApproval: inbox,
      approvedReady: count(["APPROVED"]),
      scheduled: count(["SCHEDULED"]),
      published: publishedThisWeek,
      failed: failedJobs.length + failedPublishes.length,
    },
    missingDays,
    needsAttentionTomorrow: concepts.filter((c) => c.plannedDate === tomorrow && !["APPROVED", "SCHEDULED", "PUBLISHED"].includes(c.status)),
    failedJobs, failedPublishes, upcoming,
    realMetrics: realSnapshots.length
      ? {
          newSubscribers: realSnapshots.reduce((n, s) => n + (((s.metrics as Record<string, number>).newSubscribers) ?? 0), 0),
          revenueCents: realSnapshots.reduce((n, s) => n + (((s.metrics as Record<string, number>).revenueCents) ?? 0), 0),
          sources: [...new Set(realSnapshots.map((s) => s.source))],
          retrievedAt: realSnapshots.reduce((d, s) => (s.retrievedAt > d ? s.retrievedAt : d), new Date(0)),
        }
      : null,
  };
}

export async function calendarData(actor: Actor, workspaceId: string, anyDate: string) {
  const { workspace } = await requireWorkspace(actor, workspaceId, "view");
  const week = weekDates(anyDate);
  const concepts = await db.contentConcept.findMany({
    where: { workspaceId, plannedDate: { gte: week[0], lte: week[6] }, status: { not: "ARCHIVED" } },
    include: {
      schedules: { where: { status: { not: "CANCELED" } }, include: { integration: { select: { displayName: true, isSimulated: true } }, post: true }, orderBy: { createdAt: "desc" } },
      assets: { where: { kind: "VIDEO", deletedAt: null }, include: { currentVersion: { include: { approvals: { orderBy: { decidedAt: "desc" }, take: 1 } } } } },
    },
    orderBy: [{ plannedDate: "asc" }, { plannedTime: "asc" }],
  });
  const statuses = ["IDEA", "PROMPT_READY", "GENERATING", "PROCESSING", "AWAITING_APPROVAL", "APPROVED", "SCHEDULED", "PUBLISHED", "GENERATION_FAILED", "PUBLICATION_FAILED", "REJECTED", "NEEDS_REVISIONS"] as const;
  const by = (s: readonly string[]) => concepts.filter((c) => s.includes(c.status)).length;
  return {
    workspace, week, concepts,
    counts: {
      planned: concepts.length,
      awaitingGeneration: by(["IDEA", "PROMPT_READY", "NEEDS_REVISIONS", "REJECTED"]),
      generating: by(["GENERATING", "PROCESSING"]),
      awaitingApproval: by(["AWAITING_APPROVAL"]),
      approved: by(["APPROVED"]),
      scheduled: by(["SCHEDULED"]),
      published: by(["PUBLISHED"]),
      failed: by(["GENERATION_FAILED", "PUBLICATION_FAILED"]),
    },
    statuses,
  };
}
