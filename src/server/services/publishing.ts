import { z } from "zod";
import type { PublishingSchedule } from "@prisma/client";
import { db, type Tx } from "../db";
import { AppError, type ErrorCode } from "../errors";
import { audit } from "../audit";
import { requireWorkspace } from "../permissions";
import { getDestination } from "../providers/registry";
import { isUsTimezone, zonedToUtc } from "../time";
import { enqueue, backoffMs } from "../jobs/queue";
import { verifyStoredHash } from "./assets";
import { readCredentials } from "./integrations";
import { notifyWorkspaceManagers } from "./notifications";
import type { Actor } from "../auth/actor";

export const scheduleSchema = z.object({
  conceptId: z.string().min(1),
  assetId: z.string().min(1),
  integrationId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time"),
  timezone: z.string().refine(isUsTimezone, "Choose a U.S. time zone"),
  caption: z.string().trim().max(2200).default(""),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  isPromo: z.boolean().default(false),
  /** Required the first time a given destination is used. */
  confirmFirstPublication: z.boolean().default(false),
});

const MIN_LEAD_MS = 60_000;
const MAX_AHEAD_MS = 366 * 24 * 3600_000;

type Check = { ok: true } | { ok: false; code: ErrorCode; message: string };

/**
 * THE publication gate. Every rule from the spec, evaluated against current database state:
 *  1. the user may publish in this workspace;
 *  2. the exact asset version has an explicit, non-invalidated APPROVED record;
 *  3. the version is still the asset's current version and its hash matches the approval;
 *  4. schedule time and destination are valid;
 *  5. the destination integration is connected, operational and confirmed for first use;
 *  plus: simulated media can only go to a simulated destination, and the restricted workspace
 *  only to destinations that permit adult content.
 */
async function evaluateGate(
  client: Tx,
  s: Pick<PublishingSchedule, "workspaceId" | "assetId" | "assetVersionId" | "approvalId" | "integrationId" | "scheduledFor">,
  opts: { requireFuture: boolean; publisherUserId: string },
): Promise<Check> {
  const member = await client.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: s.workspaceId, userId: opts.publisherUserId } },
    include: { user: true, workspace: true },
  });
  if (!member || member.role !== "MANAGER" || member.user.role === "VIEWER") return { ok: false, code: "FORBIDDEN", message: "The scheduling user no longer has permission to publish in this workspace." };
  if (member.workspace.kind === "ADULT" && !member.user.adultAccessAttestedAt) return { ok: false, code: "FORBIDDEN", message: "Restricted workspace access is not confirmed for this user." };

  const asset = await client.mediaAsset.findUnique({ where: { id: s.assetId } });
  if (!asset || asset.deletedAt || asset.archivedAt) return { ok: false, code: "NOT_FOUND", message: "The asset was deleted or archived." };
  if (asset.workspaceId !== s.workspaceId) return { ok: false, code: "FORBIDDEN", message: "The asset belongs to another workspace." };
  if (asset.currentVersionId !== s.assetVersionId) return { ok: false, code: "ASSET_CHANGED", message: "The asset has a newer version than the one approved. Approve the new version first." };

  const version = await client.assetVersion.findUnique({ where: { id: s.assetVersionId } });
  const approval = await client.approvalRecord.findUnique({ where: { id: s.approvalId } });
  if (!version) return { ok: false, code: "NOT_FOUND", message: "Asset version not found." };
  if (!approval || approval.assetVersionId !== version.id || approval.decision !== "APPROVED") return { ok: false, code: "APPROVAL_REQUIRED", message: "This exact asset version has no approval record." };
  if (approval.invalidatedAt) return { ok: false, code: "APPROVAL_INVALID", message: `The approval was invalidated: ${approval.invalidatedReason ?? "asset changed"}.` };
  if (approval.approvedSha256 !== version.sha256) return { ok: false, code: "ASSET_CHANGED", message: "The asset's fingerprint differs from the approved fingerprint." };
  const newer = await client.approvalRecord.findFirst({ where: { assetVersionId: version.id, decidedAt: { gt: approval.decidedAt } }, orderBy: { decidedAt: "desc" } });
  if (newer && newer.decision !== "APPROVED") return { ok: false, code: "APPROVAL_INVALID", message: "A later decision rejected this version." };

  const integration = await client.platformIntegration.findUnique({ where: { id: s.integrationId } });
  const destination = integration ? getDestination(integration.providerKey) : null;
  if (!integration || !destination) return { ok: false, code: "INTEGRATION_UNAVAILABLE", message: "The destination is not installed." };
  if (integration.workspaceId !== s.workspaceId) return { ok: false, code: "FORBIDDEN", message: "The destination belongs to another workspace." };
  if (integration.status !== "OPERATIONAL" || integration.lastHealthOk === false) return { ok: false, code: "INTEGRATION_UNAVAILABLE", message: `${integration.displayName} is not operational (status: ${integration.status.toLowerCase()}). Run its health check in Settings → Integrations.` };
  if (!integration.firstPublishConfirmedAt) return { ok: false, code: "CONFIRMATION_REQUIRED", message: `Confirm the first publication to ${integration.displayName}.` };
  if (version.isSimulated && !destination.isSimulated) return { ok: false, code: "POLICY_BLOCKED", message: "Simulated media can never be published to a real destination." };
  if (member.workspace.kind === "ADULT" && !(destination.allowsAdultContent && integration.allowsAdultContent)) return { ok: false, code: "POLICY_BLOCKED", message: `${integration.displayName} does not permit content from the restricted workspace.` };

  const t = s.scheduledFor.getTime();
  if (opts.requireFuture && t < Date.now() + MIN_LEAD_MS) return { ok: false, code: "INVALID_SCHEDULE", message: "Pick a publication time at least one minute in the future." };
  if (t > Date.now() + MAX_AHEAD_MS) return { ok: false, code: "INVALID_SCHEDULE", message: "Pick a publication time within the next year." };
  return { ok: true };
}

/** Schedule an approved asset. Every gate rule is checked now and again at publish time. */
export async function schedulePublication(actor: Actor, input: z.input<typeof scheduleSchema>) {
  const data = scheduleSchema.parse(input);
  const concept = await db.contentConcept.findUnique({ where: { id: data.conceptId } });
  if (!concept) throw new AppError("NOT_FOUND", "Concept not found.");
  await requireWorkspace(actor, concept.workspaceId, "publish");
  const asset = await db.mediaAsset.findUnique({ where: { id: data.assetId }, include: { currentVersion: { include: { approvals: { orderBy: { decidedAt: "desc" }, take: 1 } } } } });
  if (!asset || asset.conceptId !== concept.id) throw new AppError("VALIDATION", "Choose this concept's video.");
  if (asset.kind !== "VIDEO") throw new AppError("VALIDATION", "Only the final video can be scheduled.");
  const latest = asset.currentVersion?.approvals[0];
  if (!asset.currentVersion || !latest || latest.decision !== "APPROVED" || latest.invalidatedAt) {
    await audit({ userId: actor.userId, workspaceId: concept.workspaceId, action: "publish.schedule", entityType: "MediaAsset", entityId: asset.id, outcome: "BLOCKED", ip: actor.ip, metadata: { reason: "APPROVAL_REQUIRED" } });
    throw new AppError("APPROVAL_REQUIRED", "Approve the current version of this video before scheduling it.");
  }
  let scheduledFor: Date;
  try {
    scheduledFor = zonedToUtc(data.date, data.time, data.timezone);
  } catch {
    throw new AppError("INVALID_SCHEDULE", "Invalid date or time.");
  }

  return db.$transaction(async (tx) => {
    const integration = await tx.platformIntegration.findUnique({ where: { id: data.integrationId } });
    if (!integration || integration.workspaceId !== concept.workspaceId) throw new AppError("NOT_FOUND", "Destination not found.");
    if (!integration.firstPublishConfirmedAt) {
      if (!data.confirmFirstPublication) throw new AppError("CONFIRMATION_REQUIRED", `This is the first publication to ${integration.displayName}. Tick the confirmation box to continue.`);
      await tx.platformIntegration.update({ where: { id: integration.id }, data: { firstPublishConfirmedAt: new Date() } });
      await audit({ userId: actor.userId, workspaceId: concept.workspaceId, action: "integration.first_publish_confirmed", entityType: "PlatformIntegration", entityId: integration.id, ip: actor.ip }, tx);
    }
    const dup = await tx.publishingSchedule.findFirst({ where: { assetId: asset.id, integrationId: integration.id, status: { in: ["QUEUED", "PUBLISHING", "AWAITING_MANUAL"] } } });
    if (dup) throw new AppError("CONFLICT", "This video is already scheduled for that destination.");
    const draft = { workspaceId: concept.workspaceId, assetId: asset.id, assetVersionId: asset.currentVersion!.id, approvalId: latest.id, integrationId: integration.id, scheduledFor };
    const gate = await evaluateGate(tx, draft, { requireFuture: true, publisherUserId: actor.userId });
    if (!gate.ok) {
      await audit({ userId: actor.userId, workspaceId: concept.workspaceId, action: "publish.schedule", entityType: "MediaAsset", entityId: asset.id, outcome: "BLOCKED", ip: actor.ip, metadata: { reason: gate.code, message: gate.message } }, tx);
      throw new AppError(gate.code, gate.message);
    }
    const schedule = await tx.publishingSchedule.create({
      data: { ...draft, conceptId: concept.id, timezone: data.timezone, caption: data.caption || concept.caption, hashtags: data.hashtags.length ? data.hashtags : concept.hashtags, isPromo: data.isPromo, createdById: actor.userId, nextAttemptAt: scheduledFor },
    });
    if (!data.isPromo) await tx.contentConcept.update({ where: { id: concept.id }, data: { status: "SCHEDULED", plannedDate: data.date, plannedTime: data.time, timezone: data.timezone } });
    await enqueue("publish.run", { scheduleId: schedule.id }, { runAt: scheduledFor, idempotencyKey: `publish:${schedule.id}:1` }, tx);
    await audit({ userId: actor.userId, workspaceId: concept.workspaceId, action: "publish.scheduled", entityType: "PublishingSchedule", entityId: schedule.id, ip: actor.ip, metadata: { assetVersionId: draft.assetVersionId, approvalId: latest.id, scheduledFor: scheduledFor.toISOString(), destination: integration.providerKey } }, tx);
    return schedule;
  });
}

export async function cancelSchedule(actor: Actor, scheduleId: string) {
  const s = await db.publishingSchedule.findUnique({ where: { id: scheduleId } });
  if (!s) throw new AppError("NOT_FOUND", "Schedule not found.");
  await requireWorkspace(actor, s.workspaceId, "publish");
  if (!["QUEUED", "AWAITING_MANUAL", "FAILED"].includes(s.status)) throw new AppError("CONFLICT", `A ${s.status.toLowerCase()} publication cannot be canceled.`);
  await db.$transaction(async (tx) => {
    await tx.publishingSchedule.update({ where: { id: s.id }, data: { status: "CANCELED", lastError: "Canceled by creator" } });
    const concept = await tx.contentConcept.findUniqueOrThrow({ where: { id: s.conceptId } });
    if (!s.isPromo && ["SCHEDULED", "PUBLICATION_FAILED"].includes(concept.status)) await tx.contentConcept.update({ where: { id: s.conceptId }, data: { status: "APPROVED" } });
    await audit({ userId: actor.userId, workspaceId: s.workspaceId, action: "publish.canceled", entityType: "PublishingSchedule", entityId: s.id, ip: actor.ip }, tx);
  });
}

export type PublishOutcome =
  | { outcome: "published"; scheduleId: string; simulated: boolean }
  | { outcome: "awaiting_manual"; scheduleId: string }
  | { outcome: "blocked"; code: ErrorCode | "NOT_DUE" | "NOT_QUEUED"; message: string }
  | { outcome: "failed"; message: string; willRetry: boolean };

async function logAttempt(scheduleId: string, assetVersionId: string, outcome: "BLOCKED" | "SUCCEEDED" | "FAILED", reasonCode: string, message: string, actorUserId?: string | null) {
  await db.publishAttempt.create({ data: { scheduleId, assetVersionId, outcome, reasonCode, message: message.slice(0, 1000), actorUserId: actorUserId ?? null } });
}

/**
 * Execute one publication. Concurrency-safe: the schedule row is locked FOR UPDATE and moved
 * QUEUED → PUBLISHING inside one transaction after the full gate passes, so two simultaneous
 * calls cannot both publish, and an approval invalidation (which locks the same rows) cannot
 * interleave with the check. The stored file is re-hashed before the lock is taken.
 */
export async function executePublication(scheduleId: string, opts: { actorUserId?: string; now?: boolean } = {}): Promise<PublishOutcome> {
  const pre = await db.publishingSchedule.findUnique({ where: { id: scheduleId }, include: { workspace: true } });
  if (!pre) return { outcome: "blocked", code: "NOT_FOUND", message: "Schedule not found." };
  const version = await db.assetVersion.findUnique({ where: { id: pre.assetVersionId } });
  const integrity = version ? await verifyStoredHash(version).catch(() => ({ ok: false, data: Buffer.alloc(0) })) : { ok: false, data: Buffer.alloc(0) };

  const claim = await db.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<PublishingSchedule[]>`SELECT * FROM "PublishingSchedule" WHERE "id" = ${scheduleId} FOR UPDATE`;
    if (!row || row.status !== "QUEUED") return { ok: false as const, code: "NOT_QUEUED" as const, message: `Not queued (status: ${row?.status ?? "missing"}).`, terminal: false };
    if (!opts.now && row.scheduledFor.getTime() > Date.now() + 5_000) return { ok: false as const, code: "NOT_DUE" as const, message: "Not due yet.", terminal: false };
    if (!integrity.ok) return { ok: false as const, code: "ASSET_CHANGED" as const, message: "The stored file does not match the approved fingerprint.", terminal: true };
    const gate = await evaluateGate(tx, row, { requireFuture: false, publisherUserId: row.createdById });
    if (!gate.ok) return { ok: false as const, code: gate.code, message: gate.message, terminal: true };
    await tx.publishingSchedule.update({ where: { id: row.id }, data: { status: "PUBLISHING", attempts: { increment: 1 } } });
    return { ok: true as const, row };
  });

  if (!claim.ok) {
    if (claim.terminal) {
      await db.$transaction(async (tx) => {
        await tx.publishingSchedule.update({ where: { id: scheduleId }, data: { status: "FAILED", lastError: claim.message } });
        if (!pre.isPromo) await tx.contentConcept.update({ where: { id: pre.conceptId }, data: { status: claim.code === "ASSET_CHANGED" || claim.code.startsWith("APPROVAL") ? "AWAITING_APPROVAL" : "PUBLICATION_FAILED" } });
        if (claim.code === "ASSET_CHANGED") {
          await tx.approvalRecord.updateMany({ where: { id: pre.approvalId, invalidatedAt: null }, data: { invalidatedAt: new Date(), invalidatedReason: "Stored file changed after approval" } });
        }
      });
      await notifyWorkspaceManagers(pre.workspaceId, { type: "failure", title: "Publication blocked", body: claim.message, link: "/calendar" });
    }
    if (claim.code === "NOT_DUE") return { outcome: "blocked", code: claim.code, message: claim.message };
    await logAttempt(scheduleId, pre.assetVersionId, "BLOCKED", claim.code, claim.message, opts.actorUserId);
    await audit({ userId: opts.actorUserId, workspaceId: pre.workspaceId, action: "publish.attempt", entityType: "PublishingSchedule", entityId: scheduleId, outcome: "BLOCKED", metadata: { reason: claim.code, message: claim.message } });
    return { outcome: "blocked", code: claim.code, message: claim.message };
  }

  const row = claim.row;
  const integration = await db.platformIntegration.findUniqueOrThrow({ where: { id: row.integrationId } });
  const destination = getDestination(integration.providerKey)!;
  const disclosure = pre.workspace.disclosureText;
  let result;
  try {
    result = await destination.publish(
      { media: { data: integrity.data, mime: version!.mimeType, filename: `${row.id}` }, caption: row.caption, hashtags: row.hashtags, disclosureText: disclosure, idempotencyKey: `${row.id}:${row.assetVersionId}` },
      readCredentials(integration),
    );
  } catch (err) {
    result = { state: "failed" as const, error: (err as Error).message, retryable: true };
  }

  if (result.state === "confirmed") {
    await db.$transaction(async (tx) => {
      await tx.publishingSchedule.update({ where: { id: row.id }, data: { status: "PUBLISHED", lastError: null } });
      await tx.publishedPost.create({ data: { scheduleId: row.id, externalPostId: result.externalPostId, externalUrl: result.url ?? null, confirmationSource: destination.isSimulated ? "SIMULATED_DESTINATION" : "DESTINATION_API" } });
      if (!row.isPromo) await tx.contentConcept.update({ where: { id: row.conceptId }, data: { status: "PUBLISHED" } });
    });
    await logAttempt(row.id, row.assetVersionId, "SUCCEEDED", destination.isSimulated ? "SIMULATED_CONFIRMED" : "CONFIRMED", result.externalPostId, opts.actorUserId);
    await audit({ userId: opts.actorUserId, workspaceId: row.workspaceId, action: "publish.attempt", entityType: "PublishingSchedule", entityId: row.id, metadata: { result: "confirmed", simulated: destination.isSimulated, externalPostId: result.externalPostId } });
    await notifyWorkspaceManagers(row.workspaceId, { type: "published", title: destination.isSimulated ? "Simulated publish recorded (nothing was posted)" : "Published — confirmed by destination", link: "/calendar" });
    return { outcome: "published", scheduleId: row.id, simulated: destination.isSimulated };
  }

  if (result.state === "manual_required") {
    await db.publishingSchedule.update({ where: { id: row.id }, data: { status: "AWAITING_MANUAL", lastError: null } });
    await logAttempt(row.id, row.assetVersionId, "SUCCEEDED", "MANUAL_PACKAGE_READY", "Package ready; waiting for creator to post and confirm.", opts.actorUserId);
    await audit({ userId: opts.actorUserId, workspaceId: row.workspaceId, action: "publish.attempt", entityType: "PublishingSchedule", entityId: row.id, metadata: { result: "manual_package_ready" } });
    await notifyWorkspaceManagers(row.workspaceId, { type: "manual", title: "Time to post: manual package ready", body: "Download the package, post it yourself, then confirm with the post link.", link: `/calendar?schedule=${row.id}`, dedupeKey: `manual:${row.id}` });
    return { outcome: "awaiting_manual", scheduleId: row.id };
  }

  // Technical failure: retry with backoff (the gate runs again on every attempt).
  const willRetry = result.retryable && row.attempts + 1 < row.maxAttempts;
  const nextAt = new Date(Date.now() + backoffMs(row.attempts + 1));
  await db.$transaction(async (tx) => {
    await tx.publishingSchedule.update({ where: { id: row.id }, data: { status: willRetry ? "QUEUED" : "FAILED", lastError: result.error.slice(0, 1000), nextAttemptAt: willRetry ? nextAt : null } });
    if (!willRetry && !row.isPromo) await tx.contentConcept.update({ where: { id: row.conceptId }, data: { status: "PUBLICATION_FAILED" } });
    if (willRetry) await enqueue("publish.run", { scheduleId: row.id }, { runAt: nextAt, idempotencyKey: `publish:${row.id}:${row.attempts + 2}` }, tx);
  });
  await logAttempt(row.id, row.assetVersionId, "FAILED", willRetry ? "RETRY_SCHEDULED" : "FAILED_FINAL", result.error, opts.actorUserId);
  await audit({ userId: opts.actorUserId, workspaceId: row.workspaceId, action: "publish.attempt", entityType: "PublishingSchedule", entityId: row.id, outcome: "FAILED", metadata: { error: result.error.slice(0, 300), willRetry } });
  if (!willRetry) await notifyWorkspaceManagers(row.workspaceId, { type: "failure", title: "Publication failed", body: result.error.slice(0, 200), link: "/calendar" });
  return { outcome: "failed", message: result.error, willRetry };
}

/** Creator triggers a queued publication immediately (still fully gated). */
export async function publishNow(actor: Actor, scheduleId: string) {
  const s = await db.publishingSchedule.findUnique({ where: { id: scheduleId } });
  if (!s) throw new AppError("NOT_FOUND", "Schedule not found.");
  await requireWorkspace(actor, s.workspaceId, "publish");
  return executePublication(scheduleId, { actorUserId: actor.userId, now: true });
}

/** Retry a FAILED publication: re-queues it; the full gate runs again. */
export async function retryPublication(actor: Actor, scheduleId: string) {
  const s = await db.publishingSchedule.findUnique({ where: { id: scheduleId } });
  if (!s) throw new AppError("NOT_FOUND", "Schedule not found.");
  await requireWorkspace(actor, s.workspaceId, "publish");
  if (s.status !== "FAILED") throw new AppError("CONFLICT", "Only failed publications can be retried.");
  await db.$transaction(async (tx) => {
    await tx.publishingSchedule.update({ where: { id: s.id }, data: { status: "QUEUED", attempts: 0, lastError: null } });
    if (!s.isPromo) await tx.contentConcept.update({ where: { id: s.conceptId }, data: { status: "SCHEDULED" } });
    await audit({ userId: actor.userId, workspaceId: s.workspaceId, action: "publish.retry_requested", entityType: "PublishingSchedule", entityId: s.id, ip: actor.ip }, tx);
  });
  return executePublication(s.id, { actorUserId: actor.userId, now: true });
}

/** Manual destinations: the creator confirms they posted it. Only then is it marked PUBLISHED. */
export async function confirmManualPublication(actor: Actor, input: { scheduleId: string; postUrl: string }) {
  const s = await db.publishingSchedule.findUnique({ where: { id: input.scheduleId } });
  if (!s) throw new AppError("NOT_FOUND", "Schedule not found.");
  await requireWorkspace(actor, s.workspaceId, "publish");
  if (s.status !== "AWAITING_MANUAL") throw new AppError("CONFLICT", "This publication is not waiting for manual confirmation.");
  const url = z.string().trim().url("Paste the link to the live post").refine((u) => u.startsWith("https://"), "Use the https:// link").parse(input.postUrl);
  await db.$transaction(async (tx) => {
    await tx.publishingSchedule.update({ where: { id: s.id }, data: { status: "PUBLISHED" } });
    await tx.publishedPost.create({ data: { scheduleId: s.id, externalUrl: url, confirmationSource: "CREATOR_MANUAL_CONFIRMATION" } });
    if (!s.isPromo) await tx.contentConcept.update({ where: { id: s.conceptId }, data: { status: "PUBLISHED" } });
    await audit({ userId: actor.userId, workspaceId: s.workspaceId, action: "publish.manual_confirmed", entityType: "PublishingSchedule", entityId: s.id, ip: actor.ip, metadata: { url } }, tx);
  });
}

/** Called by the worker on every tick: enqueue due publications and recover stuck ones. */
export async function schedulerTick() {
  const due = await db.publishingSchedule.findMany({ where: { status: "QUEUED", OR: [{ nextAttemptAt: { lte: new Date() } }, { nextAttemptAt: null, scheduledFor: { lte: new Date() } }] }, select: { id: true, attempts: true }, take: 50 });
  for (const s of due) {
    const key = `publish:${s.id}:${s.attempts + 1}`;
    await enqueue("publish.run", { scheduleId: s.id }, { idempotencyKey: key });
    // If the job already existed with a later run time, pull it forward.
    await db.backgroundJob.updateMany({ where: { idempotencyKey: key, status: "QUEUED", runAt: { gt: new Date() } }, data: { runAt: new Date() } });
  }
  // A PUBLISHING row older than 15 minutes means the worker died mid-call. We do NOT assume it
  // was published: mark it failed so the creator checks the destination and retries.
  const stuck = await db.publishingSchedule.updateMany({
    where: { status: "PUBLISHING", updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    data: { status: "FAILED", lastError: "Interrupted during publication. Check the destination before retrying — it may or may not have been posted." },
  });
  return { enqueued: due.length, recovered: stuck.count };
}

export async function listSchedules(actor: Actor, workspaceId: string, range?: { from: Date; to: Date }) {
  await requireWorkspace(actor, workspaceId, "view");
  return db.publishingSchedule.findMany({
    where: { workspaceId, ...(range ? { scheduledFor: { gte: range.from, lte: range.to } } : {}) },
    include: { integration: { select: { displayName: true, providerKey: true, isSimulated: true } }, post: true, concept: { select: { title: true } }, attempts_log: { orderBy: { createdAt: "desc" }, take: 5 } },
    orderBy: { scheduledFor: "asc" },
  });
}

/** Everything needed to post manually. Download links are signed and expire. */
export async function manualPackage(actor: Actor, scheduleId: string) {
  const s = await db.publishingSchedule.findUnique({ where: { id: scheduleId }, include: { workspace: true, concept: true } });
  if (!s) throw new AppError("NOT_FOUND", "Schedule not found.");
  await requireWorkspace(actor, s.workspaceId, "publish");
  const version = await db.assetVersion.findUniqueOrThrow({ where: { id: s.assetVersionId } });
  const thumb = await db.mediaAsset.findFirst({ where: { conceptId: s.conceptId, kind: "THUMBNAIL", deletedAt: null }, include: { currentVersion: true } });
  return {
    schedule: s,
    version,
    thumbnailVersionId: thumb?.currentVersion?.id ?? null,
    captionText: [s.caption, s.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "), s.workspace.disclosureText].filter(Boolean).join("\n\n"),
    checklist: [
      "Download the approved file below (it is the exact version you approved; fingerprint shown).",
      "Open the platform in your own browser and sign in yourself. Do not share your password with any tool.",
      "Upload the file and paste the caption, hashtags and AI disclosure.",
      "Apply the platform's required content labels and audience settings for this post.",
      "Set price, preview and visibility according to the platform's rules.",
      "Publish, copy the link to the live post and confirm it here.",
    ],
  };
}
