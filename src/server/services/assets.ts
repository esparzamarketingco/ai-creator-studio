import type { AssetKind, AssetSource, Prisma } from "@prisma/client";
import { db, type Tx } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { sha256Hex } from "../crypto";
import { storage, newStorageKey, SIGNED_URL_TTL_SEC } from "../media/storage";
import { ALLOWED_TYPES, validateMedia } from "../media/validation";
import { requireWorkspace } from "../permissions";
import { notifyWorkspaceManagers } from "./notifications";
import type { Actor } from "../auth/actor";

type NewVersionInput = {
  workspaceId: string;
  assetId?: string; // add a version to an existing asset
  conceptId?: string | null;
  kind: AssetKind;
  title: string;
  tags?: string[];
  category?: string;
  data: Buffer;
  source: AssetSource;
  isSimulated: boolean;
  providerKey?: string | null;
  generationJobId?: string | null;
  createdById?: string | null;
};

/**
 * Store a file as a new immutable AssetVersion and make it current.
 * Any approval of an earlier version is INVALIDATED and any queued publication of this asset is
 * CANCELED in the same transaction, so a modified asset can never ride on an old approval.
 */
export async function createAssetVersion(input: NewVersionInput) {
  const { mime, probe } = await validateMedia(input.data, { allowSvg: input.isSimulated });
  const typeKind = ALLOWED_TYPES[mime].kind;
  if (input.kind === "VIDEO" && typeKind !== "VIDEO" && !input.isSimulated) throw new AppError("VALIDATION", "This asset expects a video file (MP4, MOV or WebM).");
  if (input.kind !== "VIDEO" && typeKind !== "IMAGE") throw new AppError("VALIDATION", "This asset expects an image file.");
  const sha256 = sha256Hex(input.data);
  const key = newStorageKey(`media/${input.workspaceId}`, ALLOWED_TYPES[mime].ext);
  await storage().put(key, input.data, mime);

  return db.$transaction(async (tx) => {
    let assetId = input.assetId;
    if (assetId) {
      const existing = await tx.mediaAsset.findUnique({ where: { id: assetId } });
      if (!existing || existing.workspaceId !== input.workspaceId || existing.deletedAt) throw new AppError("NOT_FOUND", "Asset not found.");
      if (existing.kind !== input.kind) throw new AppError("VALIDATION", "A new version must be the same kind of media.");
    } else {
      const a = await tx.mediaAsset.create({
        data: { workspaceId: input.workspaceId, conceptId: input.conceptId ?? null, kind: input.kind, title: input.title, tags: input.tags ?? [], category: input.category ?? "" },
      });
      assetId = a.id;
    }
    const last = await tx.assetVersion.findFirst({ where: { assetId }, orderBy: { versionNumber: "desc" } });
    const version = await tx.assetVersion.create({
      data: {
        assetId,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        storageKey: key,
        sha256,
        sizeBytes: input.data.length,
        mimeType: mime,
        durationSec: probe.durationSec ?? null,
        width: probe.width ?? null,
        height: probe.height ?? null,
        source: input.source,
        isSimulated: input.isSimulated,
        providerKey: input.providerKey ?? null,
        generationJobId: input.generationJobId ?? null,
        validation: probe as unknown as Prisma.InputJsonValue,
        createdById: input.createdById ?? null,
      },
    });
    await tx.mediaAsset.update({ where: { id: assetId }, data: { currentVersionId: version.id, archivedAt: null } });
    if (last) await invalidateAssetApprovals(tx, assetId, `Superseded by version ${version.versionNumber}`, input.createdById ?? null);
    const asset = await tx.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    if (asset.conceptId && asset.kind === "VIDEO") {
      const concept = await tx.contentConcept.findUniqueOrThrow({ where: { id: asset.conceptId } });
      if (!["PUBLISHED", "ARCHIVED"].includes(concept.status)) {
        await tx.contentConcept.update({ where: { id: concept.id }, data: { status: "AWAITING_APPROVAL" } });
        await notifyWorkspaceManagers(input.workspaceId, { type: "approval", title: `Ready for review: ${concept.title}`, body: `Version ${version.versionNumber}${input.isSimulated ? " (simulated)" : ""}`, link: `/approval?asset=${assetId}` }, tx);
      }
    }
    await audit({ userId: input.createdById, workspaceId: input.workspaceId, action: "asset.version_created", entityType: "AssetVersion", entityId: version.id, metadata: { assetId, versionNumber: version.versionNumber, sha256, source: input.source, isSimulated: input.isSimulated } }, tx);
    return { asset, version };
  });
}

/** Invalidate every live approval for an asset and pull it out of the publishing queue. */
export async function invalidateAssetApprovals(tx: Tx, assetId: string, reason: string, userId: string | null) {
  // Lock the asset's schedules so a concurrent publisher sees the cancellation.
  await tx.$queryRaw`SELECT "id" FROM "PublishingSchedule" WHERE "assetId" = ${assetId} FOR UPDATE`;
  const inv = await tx.approvalRecord.updateMany({
    where: { assetVersion: { assetId }, decision: "APPROVED", invalidatedAt: null },
    data: { invalidatedAt: new Date(), invalidatedReason: reason },
  });
  const canceled = await tx.publishingSchedule.updateMany({
    where: { assetId, status: { in: ["QUEUED", "AWAITING_MANUAL"] } },
    data: { status: "CANCELED", lastError: `Approval invalidated: ${reason}` },
  });
  if (inv.count || canceled.count) {
    const asset = await tx.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    await audit({ userId, workspaceId: asset.workspaceId, action: "approval.invalidated", entityType: "MediaAsset", entityId: assetId, metadata: { reason, approvals: inv.count, schedulesCanceled: canceled.count } }, tx);
  }
  return { approvals: inv.count, schedulesCanceled: canceled.count };
}

export async function uploadAsset(
  actor: Actor,
  input: { workspaceId: string; assetId?: string; conceptId?: string | null; kind: AssetKind; title: string; tags?: string[]; category?: string },
  data: Buffer,
) {
  await requireWorkspace(actor, input.workspaceId, "edit");
  if (input.conceptId) {
    const c = await db.contentConcept.findUnique({ where: { id: input.conceptId } });
    if (!c || c.workspaceId !== input.workspaceId) throw new AppError("VALIDATION", "Concept not found in this workspace.");
  }
  const title = input.title.trim().slice(0, 140) || "Untitled";
  return createAssetVersion({ ...input, title, data, source: "UPLOAD", isSimulated: false, createdById: actor.userId });
}

export async function getAssetForActor(actor: Actor, assetId: string, action: "view" | "edit" | "approve" = "view") {
  const asset = await db.mediaAsset.findUnique({
    where: { id: assetId },
    include: {
      currentVersion: { include: { approvals: { orderBy: { decidedAt: "desc" }, include: { decidedBy: { select: { name: true } } } } } },
      versions: { orderBy: { versionNumber: "desc" }, include: { approvals: { orderBy: { decidedAt: "desc" } } } },
      concept: true,
    },
  });
  if (!asset || asset.deletedAt) throw new AppError("NOT_FOUND", "Asset not found.");
  await requireWorkspace(actor, asset.workspaceId, action);
  return asset;
}

/** Signed, expiring URL for one version. Access is re-checked on every request. */
export async function signedVersionUrl(actor: Actor, versionId: string, opts: { download?: boolean } = {}) {
  const version = await db.assetVersion.findUnique({ where: { id: versionId }, include: { asset: true } });
  if (!version || version.asset.deletedAt) throw new AppError("NOT_FOUND", "Media not found.");
  await requireWorkspace(actor, version.asset.workspaceId, "view");
  if (opts.download) {
    await audit({ userId: actor.userId, workspaceId: version.asset.workspaceId, action: "asset.download_link", entityType: "AssetVersion", entityId: versionId, ip: actor.ip });
  }
  return storage().signedUrl(version.storageKey, { ttlSec: SIGNED_URL_TTL_SEC, versionId, userId: actor.userId, download: opts.download });
}

export async function listAssets(
  actor: Actor,
  workspaceId: string,
  f: { q?: string; kind?: AssetKind; tag?: string; status?: "approved" | "awaiting" | "rejected" | "none"; archived?: boolean } = {},
) {
  await requireWorkspace(actor, workspaceId, "view");
  const assets = await db.mediaAsset.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      archivedAt: f.archived ? { not: null } : null,
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.tag ? { tags: { has: f.tag } } : {}),
      ...(f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { tags: { has: f.q } }, { category: { contains: f.q, mode: "insensitive" } }] } : {}),
    },
    include: { currentVersion: { include: { approvals: { orderBy: { decidedAt: "desc" }, take: 1 } } }, concept: { select: { id: true, title: true, status: true } }, _count: { select: { versions: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return assets
    .map((a) => ({ ...a, approvalState: approvalState(a.currentVersion?.approvals[0]) }))
    .filter((a) => !f.status || (f.status === "approved" ? a.approvalState === "APPROVED" : f.status === "awaiting" ? a.approvalState === "PENDING" : f.status === "rejected" ? a.approvalState === "REJECTED" || a.approvalState === "REVISIONS_REQUESTED" : true));
}

export function approvalState(latest?: { decision: string; invalidatedAt: Date | null } | null) {
  if (!latest) return "PENDING" as const;
  if (latest.decision === "APPROVED") return latest.invalidatedAt ? ("INVALIDATED" as const) : ("APPROVED" as const);
  return latest.decision as "REJECTED" | "REVISIONS_REQUESTED";
}

export async function updateAssetMeta(actor: Actor, assetId: string, input: { title?: string; tags?: string[]; category?: string }) {
  const asset = await getAssetForActor(actor, assetId, "edit");
  await db.mediaAsset.update({
    where: { id: assetId },
    data: {
      title: input.title?.trim().slice(0, 140) || undefined,
      tags: input.tags?.map((t) => t.trim()).filter(Boolean).slice(0, 30),
      category: input.category?.trim().slice(0, 80),
    },
  });
  await audit({ userId: actor.userId, workspaceId: asset.workspaceId, action: "asset.meta_updated", entityType: "MediaAsset", entityId: assetId, ip: actor.ip });
}

export async function archiveAsset(actor: Actor, assetId: string, archived: boolean) {
  const asset = await getAssetForActor(actor, assetId, "edit");
  await db.$transaction(async (tx) => {
    await tx.mediaAsset.update({ where: { id: assetId }, data: { archivedAt: archived ? new Date() : null } });
    if (archived) await invalidateAssetApprovals(tx, assetId, "Asset archived", actor.userId);
    await audit({ userId: actor.userId, workspaceId: asset.workspaceId, action: archived ? "asset.archived" : "asset.unarchived", entityType: "MediaAsset", entityId: assetId, ip: actor.ip }, tx);
  });
}

/** Permanent deletion of every version's file. Published history keeps its record, not the file. */
export async function deleteAsset(actor: Actor, assetId: string) {
  const asset = await getAssetForActor(actor, assetId, "approve");
  await db.$transaction(async (tx) => {
    await invalidateAssetApprovals(tx, assetId, "Asset deleted", actor.userId);
    await tx.mediaAsset.update({ where: { id: assetId }, data: { deletedAt: new Date(), currentVersionId: null } });
    await audit({ userId: actor.userId, workspaceId: asset.workspaceId, action: "asset.deleted", entityType: "MediaAsset", entityId: assetId, ip: actor.ip, metadata: { versions: asset.versions.length } }, tx);
  });
  for (const v of asset.versions) await storage().delete(v.storageKey).catch(() => undefined);
}

/** Re-hash the stored bytes. Detects out-of-band modification of the file in storage. */
export async function verifyStoredHash(version: { storageKey: string; sha256: string }) {
  const data = await storage().get(version.storageKey);
  return { ok: sha256Hex(data) === version.sha256, data };
}
