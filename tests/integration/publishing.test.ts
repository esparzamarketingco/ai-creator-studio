import { describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import { decide } from "../../src/server/services/approvals";
import { uploadAsset } from "../../src/server/services/assets";
import { cancelSchedule, confirmManualPublication, executePublication, publishNow, retryPublication, schedulePublication, schedulerTick } from "../../src/server/services/publishing";
import { disconnectIntegration } from "../../src/server/services/integrations";
import { moveConcept } from "../../src/server/services/concepts";
import { attestAdultAccess } from "../../src/server/services/security";
import { drainQueue } from "../../src/server/jobs/worker";
import { storage } from "../../src/server/media/storage";
import { createAssetVersion } from "../../src/server/services/assets";
import { PASSWORD, conceptWithVideo, futureSlot, integration, makeOwner, tinyMp4 } from "../helpers";

async function scheduled(opts: { dest?: string; caption?: string } = {}) {
  const o = await makeOwner();
  const c = await conceptWithVideo(o.actor, o.lifestyle.id, { approve: true });
  const dest = await integration(o.lifestyle.id, opts.dest ?? "mock-destination");
  const schedule = await schedulePublication(o.actor, { conceptId: c.concept.id, assetId: c.asset.id, integrationId: dest.id, ...futureSlot(), caption: opts.caption ?? "Morning energy", confirmFirstPublication: true });
  return { ...o, ...c, dest, schedule };
}

const makeDue = (id: string) => db.publishingSchedule.update({ where: { id }, data: { scheduledFor: new Date(Date.now() - 1000), nextAttemptAt: new Date(Date.now() - 1000) } });

describe("server-side publication gate", () => {
  it("blocks scheduling a video that was never approved", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { concept, asset } = await conceptWithVideo(actor, lifestyle.id);
    const dest = await integration(lifestyle.id, "mock-destination");
    await expect(schedulePublication(actor, { conceptId: concept.id, assetId: asset.id, integrationId: dest.id, ...futureSlot(), confirmFirstPublication: true })).rejects.toThrow(/Approve the current version/);
    expect(await db.auditLog.count({ where: { action: "publish.schedule", outcome: "BLOCKED" } })).toBe(1);
  });

  it("requires an explicit confirmation before the first publication to a destination", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { concept, asset } = await conceptWithVideo(actor, lifestyle.id, { approve: true });
    const dest = await integration(lifestyle.id, "mock-destination");
    await expect(schedulePublication(actor, { conceptId: concept.id, assetId: asset.id, integrationId: dest.id, ...futureSlot() })).rejects.toThrow(/first publication/);
    await expect(schedulePublication(actor, { conceptId: concept.id, assetId: asset.id, integrationId: dest.id, ...futureSlot(), confirmFirstPublication: true })).resolves.toBeTruthy();
  });

  it("rejects publication times in the past and non-U.S. time zones", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { concept, asset } = await conceptWithVideo(actor, lifestyle.id, { approve: true });
    const dest = await integration(lifestyle.id, "manual");
    await expect(schedulePublication(actor, { conceptId: concept.id, assetId: asset.id, integrationId: dest.id, date: "2020-01-01", time: "09:00", timezone: "America/Chicago", confirmFirstPublication: true })).rejects.toThrow(/future/);
    await expect(schedulePublication(actor, { conceptId: concept.id, assetId: asset.id, integrationId: dest.id, ...futureSlot(), timezone: "Europe/Paris", confirmFirstPublication: true })).rejects.toThrow(/U.S. time zone/);
  });

  it("publishes an approved video and records the destination's confirmation", async () => {
    const { schedule, concept } = await scheduled();
    const r = await executePublication(schedule.id, { now: true });
    expect(r).toMatchObject({ outcome: "published", simulated: true });
    const s = await db.publishingSchedule.findUniqueOrThrow({ where: { id: schedule.id }, include: { post: true } });
    expect(s.status).toBe("PUBLISHED");
    expect(s.post?.confirmationSource).toBe("SIMULATED_DESTINATION");
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("PUBLISHED");
    expect(await db.publishAttempt.count({ where: { scheduleId: schedule.id, outcome: "SUCCEEDED" } })).toBe(1);
  });

  it("blocks publication when the approval was invalidated by an edit after scheduling (race window)", async () => {
    const { schedule, asset, actor, lifestyle } = await scheduled();
    // Simulate a schedule row that escaped cancellation, then a new version lands:
    await uploadAsset(actor, { workspaceId: lifestyle.id, assetId: asset.id, kind: "VIDEO", title: "x" }, tinyMp4(5));
    await db.publishingSchedule.update({ where: { id: schedule.id }, data: { status: "QUEUED" } }); // force back into queue
    const r = await executePublication(schedule.id, { now: true });
    expect(r.outcome).toBe("blocked");
    expect(r).toMatchObject({ code: "ASSET_CHANGED" });
    expect(await db.publishedPost.count()).toBe(0);
  });

  it("blocks publication when the stored file is modified after approval, and invalidates the approval", async () => {
    const { schedule, version } = await scheduled();
    await storage().put(version.storageKey, tinyMp4(9), "video/mp4");
    const r = await executePublication(schedule.id, { now: true });
    expect(r).toMatchObject({ outcome: "blocked", code: "ASSET_CHANGED" });
    expect((await db.approvalRecord.findFirstOrThrow({ where: { assetVersionId: version.id } })).invalidatedAt).not.toBeNull();
    expect(await db.publishedPost.count()).toBe(0);
    expect(await db.publishAttempt.count({ where: { outcome: "BLOCKED" } })).toBe(1);
  });

  it("blocks publication if the approval record is tampered with directly in the database", async () => {
    const { schedule, approval } = await scheduled();
    await db.approvalRecord.update({ where: { id: approval!.id }, data: { approvedSha256: "0".repeat(64) } });
    expect(await executePublication(schedule.id, { now: true })).toMatchObject({ outcome: "blocked", code: "ASSET_CHANGED" });
  });

  it("allows exactly one of many simultaneous publish requests", async () => {
    const { schedule } = await scheduled();
    const results = await Promise.all(Array.from({ length: 8 }, () => executePublication(schedule.id, { now: true })));
    expect(results.filter((r) => r.outcome === "published")).toHaveLength(1);
    expect(await db.publishedPost.count({ where: { scheduleId: schedule.id } })).toBe(1);
  });

  it("never publishes simulated media to a real destination", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { concept } = await conceptWithVideo(actor, lifestyle.id);
    const sim = await createAssetVersion({ workspaceId: lifestyle.id, conceptId: concept.id, kind: "VIDEO", title: "sim", data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>SIMULATED</text></svg>'), source: "SIMULATED", isSimulated: true });
    await decide(actor, { assetVersionId: sim.version.id, decision: "APPROVED", previewCompleted: true });
    const manual = await integration(lifestyle.id, "manual");
    await expect(schedulePublication(actor, { conceptId: concept.id, assetId: sim.asset.id, integrationId: manual.id, ...futureSlot(), confirmFirstPublication: true })).rejects.toThrow(/Simulated media/);
  });

  it("the restricted workspace can only use destinations that permit adult content", async () => {
    const { actor, adult } = await makeOwner();
    await attestAdultAccess(actor, PASSWORD, true);
    const { concept, asset } = await conceptWithVideo(actor, adult.id, { approve: true });
    const mock = await integration(adult.id, "mock-destination");
    await expect(schedulePublication(actor, { conceptId: concept.id, assetId: asset.id, integrationId: mock.id, ...futureSlot(), confirmFirstPublication: true })).rejects.toThrow(/does not permit/);
  });

  it("blocks publication to a disconnected destination", async () => {
    const { schedule, dest, actor } = await scheduled();
    await disconnectIntegration(actor, dest.id);
    expect((await db.publishingSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe("CANCELED");
    await db.publishingSchedule.update({ where: { id: schedule.id }, data: { status: "QUEUED" } });
    expect(await executePublication(schedule.id, { now: true })).toMatchObject({ outcome: "blocked", code: "INTEGRATION_UNAVAILABLE" });
  });

  it("blocks publication if the scheduling user lost publish permission", async () => {
    const { schedule, actor, lifestyle } = await scheduled();
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: lifestyle.id, userId: actor.userId } }, data: { role: "CONTRIBUTOR" } });
    expect(await executePublication(schedule.id, { now: true })).toMatchObject({ outcome: "blocked", code: "FORBIDDEN" });
  });

  it("does not publish before the scheduled time unless asked", async () => {
    const { schedule } = await scheduled();
    expect(await executePublication(schedule.id)).toMatchObject({ outcome: "blocked", code: "NOT_DUE" });
    expect((await db.publishingSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe("QUEUED");
  });

  it("the worker publishes due posts through the queue", async () => {
    const { schedule } = await scheduled();
    await makeDue(schedule.id);
    await schedulerTick();
    await drainQueue("test-worker");
    expect((await db.publishingSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe("PUBLISHED");
  });
});

describe("retries and failures", () => {
  it("retries technical failures with backoff, then marks the post failed — never published", async () => {
    const { schedule, concept } = await scheduled({ caption: "[mock-fail] caption" });
    const first = await executePublication(schedule.id, { now: true });
    expect(first).toMatchObject({ outcome: "failed", willRetry: true });
    let s = await db.publishingSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(s.status).toBe("QUEUED");
    expect(s.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    await executePublication(schedule.id, { now: true });
    const last = await executePublication(schedule.id, { now: true });
    expect(last).toMatchObject({ outcome: "failed", willRetry: false });
    s = await db.publishingSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(s.status).toBe("FAILED");
    expect(s.attempts).toBe(3);
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("PUBLICATION_FAILED");
    expect(await db.publishedPost.count()).toBe(0);
    expect(await db.publishAttempt.count({ where: { scheduleId: schedule.id, outcome: "FAILED" } })).toBe(3);
  });

  it("a manual retry re-runs the full approval gate", async () => {
    const { schedule, version, actor } = await scheduled({ caption: "[mock-fail]" });
    for (let i = 0; i < 3; i++) await executePublication(schedule.id, { now: true });
    await storage().put(version.storageKey, tinyMp4(11), "video/mp4");
    expect(await retryPublication(actor, schedule.id)).toMatchObject({ outcome: "blocked", code: "ASSET_CHANGED" });
  });

  it("recovers posts stuck mid-publication as FAILED (never assumed published)", async () => {
    const { schedule } = await scheduled();
    await db.$executeRaw`UPDATE "PublishingSchedule" SET "status" = 'PUBLISHING', "updatedAt" = now() - interval '1 hour' WHERE "id" = ${schedule.id}`;
    await schedulerTick();
    const s = await db.publishingSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
    expect(s.status).toBe("FAILED");
    expect(s.lastError).toMatch(/may or may not have been posted/);
  });
});

describe("manual publishing workflow", () => {
  it("prepares a package and only marks published after the creator confirms with the post link", async () => {
    const { schedule, actor, concept } = await scheduled({ dest: "manual" });
    expect(await publishNow(actor, schedule.id)).toMatchObject({ outcome: "awaiting_manual" });
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("SCHEDULED");
    await expect(confirmManualPublication(actor, { scheduleId: schedule.id, postUrl: "not a url" })).rejects.toThrow();
    await confirmManualPublication(actor, { scheduleId: schedule.id, postUrl: "https://onlyfans.com/123/post" });
    const s = await db.publishingSchedule.findUniqueOrThrow({ where: { id: schedule.id }, include: { post: true } });
    expect(s.status).toBe("PUBLISHED");
    expect(s.post?.confirmationSource).toBe("CREATOR_MANUAL_CONFIRMATION");
  });
});

describe("calendar rescheduling", () => {
  it("dragging a scheduled video to another day cancels the schedule so it must be re-validated", async () => {
    const { schedule, actor, concept } = await scheduled();
    await moveConcept(actor, concept.id, "2030-01-02");
    expect((await db.publishingSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).status).toBe("CANCELED");
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("APPROVED");
  });

  it("canceling returns the concept to approved", async () => {
    const { schedule, actor, concept } = await scheduled({ dest: "manual" });
    await cancelSchedule(actor, schedule.id);
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("APPROVED");
  });
});
