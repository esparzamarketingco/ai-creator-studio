import { describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import { decide, revokeApproval, approvalInbox } from "../../src/server/services/approvals";
import { uploadAsset } from "../../src/server/services/assets";
import { schedulePublication } from "../../src/server/services/publishing";
import { storage } from "../../src/server/media/storage";
import { conceptWithVideo, futureSlot, integration, makeOwner, tinyMp4 } from "../helpers";

describe("approval workflow", () => {
  it("new uploads land in the approval inbox as AWAITING_APPROVAL", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { concept, asset } = await conceptWithVideo(actor, lifestyle.id);
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("AWAITING_APPROVAL");
    const inbox = await approvalInbox(actor, lifestyle.id);
    expect(inbox.pending.map((a) => a.id)).toEqual([asset.id]);
  });

  it("requires the full preview to be viewed before approving", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { version } = await conceptWithVideo(actor, lifestyle.id);
    await expect(decide(actor, { assetVersionId: version.id, decision: "APPROVED" })).rejects.toThrow(/complete preview/);
  });

  it("records the exact version, its fingerprint and the timestamp", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { version, concept } = await conceptWithVideo(actor, lifestyle.id);
    const rec = await decide(actor, { assetVersionId: version.id, decision: "APPROVED", previewCompleted: true });
    expect(rec.assetVersionId).toBe(version.id);
    expect(rec.approvedSha256).toBe(version.sha256);
    expect(rec.decidedAt).toBeInstanceOf(Date);
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("APPROVED");
    expect(await db.auditLog.count({ where: { action: "approval.approved", entityId: version.id } })).toBe(1);
  });

  it("invalidates approval and cancels the queued post when the video is replaced", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { concept, asset, version } = await conceptWithVideo(actor, lifestyle.id, { approve: true });
    const manual = await integration(lifestyle.id, "manual");
    const schedule = await schedulePublication(actor, { conceptId: concept.id, assetId: asset.id, integrationId: manual.id, ...futureSlot(), confirmFirstPublication: true });
    const v2 = await uploadAsset(actor, { workspaceId: lifestyle.id, assetId: asset.id, kind: "VIDEO", title: "x" }, tinyMp4(1));
    expect(v2.version.versionNumber).toBe(2);
    const old = await db.approvalRecord.findFirstOrThrow({ where: { assetVersionId: version.id } });
    expect(old.invalidatedAt).not.toBeNull();
    expect(old.invalidatedReason).toMatch(/Superseded by version 2/);
    expect((await db.publishingSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe("CANCELED");
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("AWAITING_APPROVAL");
  });

  it("cannot approve an outdated version", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { asset, version } = await conceptWithVideo(actor, lifestyle.id);
    await uploadAsset(actor, { workspaceId: lifestyle.id, assetId: asset.id, kind: "VIDEO", title: "x" }, tinyMp4(2));
    await expect(decide(actor, { assetVersionId: version.id, decision: "APPROVED", previewCompleted: true })).rejects.toThrow(/newer version/);
  });

  it("refuses to approve a version whose stored file changed", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { version } = await conceptWithVideo(actor, lifestyle.id);
    await storage().put(version.storageKey, tinyMp4(3), "video/mp4"); // out-of-band modification
    await expect(decide(actor, { assetVersionId: version.id, decision: "APPROVED", previewCompleted: true })).rejects.toThrow(/no longer matches/);
  });

  it("rejected and revision-requested videos cannot be scheduled", async () => {
    const { actor, lifestyle } = await makeOwner();
    const manual = await integration(lifestyle.id, "manual");
    for (const decision of ["REJECTED", "REVISIONS_REQUESTED"] as const) {
      const { concept, asset, version } = await conceptWithVideo(actor, lifestyle.id, { title: decision });
      await decide(actor, { assetVersionId: version.id, decision, notes: "no" });
      await expect(schedulePublication(actor, { conceptId: concept.id, assetId: asset.id, integrationId: manual.id, ...futureSlot(), confirmFirstPublication: true })).rejects.toThrow(/Approve the current version/);
    }
  });

  it("rejecting after approval withdraws the approval and the scheduled post", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { concept, asset, version } = await conceptWithVideo(actor, lifestyle.id, { approve: true });
    const manual = await integration(lifestyle.id, "manual");
    const s = await schedulePublication(actor, { conceptId: concept.id, assetId: asset.id, integrationId: manual.id, ...futureSlot(), confirmFirstPublication: true });
    await decide(actor, { assetVersionId: version.id, decision: "REJECTED", notes: "changed my mind" });
    expect((await db.publishingSchedule.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("CANCELED");
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("REJECTED");
  });

  it("withdrawing an approval returns the concept to review", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { concept, approval } = await conceptWithVideo(actor, lifestyle.id, { approve: true });
    await revokeApproval(actor, approval!.id);
    expect((await db.approvalRecord.findUniqueOrThrow({ where: { id: approval!.id } })).invalidatedAt).not.toBeNull();
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("AWAITING_APPROVAL");
  });
});
