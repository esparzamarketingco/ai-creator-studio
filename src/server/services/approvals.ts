import { z } from "zod";
import { db } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { requireWorkspace } from "../permissions";
import { assertTransition } from "../workflow/states";
import { invalidateAssetApprovals, verifyStoredHash } from "./assets";
import { cancelActiveSchedules } from "./concepts";
import type { Actor } from "../auth/actor";

export const decisionSchema = z.object({
  assetVersionId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED", "REVISIONS_REQUESTED"]),
  notes: z.string().trim().max(2000).default(""),
  /** The approval UI sets this only after the complete preview has been played/viewed. */
  previewCompleted: z.boolean().default(false),
});

/**
 * Record the creator's decision on ONE exact asset version.
 * Approval is bound to the version id and its SHA-256; the stored file is re-hashed first.
 */
export async function decide(actor: Actor, input: z.input<typeof decisionSchema>) {
  const data = decisionSchema.parse(input);
  const version = await db.assetVersion.findUnique({ where: { id: data.assetVersionId }, include: { asset: { include: { concept: true } } } });
  if (!version || version.asset.deletedAt) throw new AppError("NOT_FOUND", "Asset version not found.");
  const { workspace } = await requireWorkspace(actor, version.asset.workspaceId, "approve");
  if (version.asset.currentVersionId !== version.id) throw new AppError("CONFLICT", "A newer version of this asset exists. Review the current version instead.");
  if (version.asset.archivedAt) throw new AppError("CONFLICT", "Unarchive this asset before reviewing it.");
  if (data.decision === "APPROVED") {
    if (!data.previewCompleted) throw new AppError("VALIDATION", "Watch the complete preview before approving.");
    const integrity = await verifyStoredHash(version);
    if (!integrity.ok) {
      await audit({ userId: actor.userId, workspaceId: workspace.id, action: "approval.blocked", entityType: "AssetVersion", entityId: version.id, outcome: "BLOCKED", ip: actor.ip, metadata: { reason: "hash_mismatch" } });
      throw new AppError("ASSET_CHANGED", "The stored file no longer matches this version. It cannot be approved; upload it again as a new version.");
    }
  }

  return db.$transaction(async (tx) => {
    // Serialize decisions on the same asset.
    await tx.$queryRaw`SELECT "id" FROM "MediaAsset" WHERE "id" = ${version.assetId} FOR UPDATE`;
    if (data.decision !== "APPROVED") {
      await invalidateAssetApprovals(tx, version.assetId, data.decision === "REJECTED" ? "Rejected" : "Revisions requested", actor.userId);
    }
    const record = await tx.approvalRecord.create({
      data: { assetVersionId: version.id, approvedSha256: version.sha256, decision: data.decision, notes: data.notes, decidedById: actor.userId },
    });
    const concept = version.asset.concept;
    if (concept && version.asset.kind === "VIDEO") {
      const to = data.decision === "APPROVED" ? "APPROVED" : data.decision === "REJECTED" ? "REJECTED" : "NEEDS_REVISIONS";
      if (concept.status !== to) {
        if (concept.status === "SCHEDULED" || concept.status === "PUBLICATION_FAILED") await cancelActiveSchedules(tx, concept.id, `Decision changed to ${to}`);
        assertTransition(concept.status === "SCHEDULED" ? "AWAITING_APPROVAL" : concept.status, to);
        await tx.contentConcept.update({ where: { id: concept.id }, data: { status: to } });
      }
    }
    await audit({ userId: actor.userId, workspaceId: workspace.id, action: `approval.${data.decision.toLowerCase()}`, entityType: "AssetVersion", entityId: version.id, ip: actor.ip, metadata: { approvalId: record.id, sha256: version.sha256, versionNumber: version.versionNumber, simulated: version.isSimulated, notes: data.notes.slice(0, 200) } }, tx);
    return record;
  });
}

/** Withdraw an approval (e.g. you changed your mind). Pulls the asset from the queue. */
export async function revokeApproval(actor: Actor, approvalId: string) {
  const rec = await db.approvalRecord.findUnique({ where: { id: approvalId }, include: { assetVersion: { include: { asset: { include: { concept: true } } } } } });
  if (!rec) throw new AppError("NOT_FOUND", "Approval not found.");
  const asset = rec.assetVersion.asset;
  await requireWorkspace(actor, asset.workspaceId, "approve");
  if (rec.decision !== "APPROVED" || rec.invalidatedAt) throw new AppError("CONFLICT", "This approval is not active.");
  await db.$transaction(async (tx) => {
    await invalidateAssetApprovals(tx, asset.id, "Approval withdrawn by creator", actor.userId);
    if (asset.concept && ["APPROVED", "SCHEDULED", "PUBLICATION_FAILED"].includes(asset.concept.status)) {
      await tx.contentConcept.update({ where: { id: asset.concept.id }, data: { status: "AWAITING_APPROVAL" } });
    }
  });
}

/** The daily approval inbox: current versions with no decision yet, oldest first. */
export async function approvalInbox(actor: Actor, workspaceId: string) {
  await requireWorkspace(actor, workspaceId, "view");
  const assets = await db.mediaAsset.findMany({
    where: { workspaceId, deletedAt: null, archivedAt: null, currentVersionId: { not: null }, kind: "VIDEO" },
    include: {
      concept: true,
      currentVersion: { include: { approvals: { orderBy: { decidedAt: "desc" }, include: { decidedBy: { select: { name: true } } } } } },
      versions: { orderBy: { versionNumber: "desc" }, select: { id: true, versionNumber: true, sha256: true, createdAt: true, isSimulated: true, source: true, sizeBytes: true, mimeType: true, providerKey: true } },
    },
    orderBy: { updatedAt: "asc" },
  });
  const pending = assets.filter((a) => a.currentVersion && a.currentVersion.approvals.length === 0);
  const decided = assets.filter((a) => a.currentVersion && a.currentVersion.approvals.length > 0).reverse().slice(0, 30);
  return { pending, decided };
}
