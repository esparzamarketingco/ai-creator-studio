import { describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import { createConcept } from "../../src/server/services/concepts";
import { savePrompt, BASE_NEGATIVE } from "../../src/server/services/prompts";
import { retryGeneration, submitGeneration } from "../../src/server/services/generation";
import { addLikenessReference, revokeLikenessReference, saveCharacter } from "../../src/server/services/brand";
import { attestAdultAccess } from "../../src/server/services/security";
import { drainQueue } from "../../src/server/jobs/worker";
import { PASSWORD, PNG_1PX, makeOwner } from "../helpers";

async function setup(workspace: "lifestyle" | "adult" = "lifestyle", title = "Beach fitness clip") {
  const o = await makeOwner();
  if (workspace === "adult") await attestAdultAccess(o.actor, PASSWORD, true);
  const ws = workspace === "adult" ? o.adult : o.lifestyle;
  const concept = await createConcept(o.actor, { workspaceId: ws.id, title, scene: "Golden hour beach run", location: "Malibu" });
  const prompt = await savePrompt(o.actor, concept.id, { providerKey: "mock-video" });
  return { ...o, ws, concept, prompt };
}

describe("generation pipeline (simulated provider)", () => {
  it("builds a structured prompt with the mandatory adult-only negative prompt", async () => {
    const { prompt, concept } = await setup();
    expect(prompt.positivePrompt).toContain("Scene: Golden hour beach run");
    expect(prompt.positivePrompt).toContain("adult man");
    expect(prompt.negativePrompt.startsWith(BASE_NEGATIVE)).toBe(true);
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("PROMPT_READY");
  });

  it("users cannot remove the mandatory negative prompt", async () => {
    const { actor, concept } = await setup();
    const p = await savePrompt(actor, concept.id, { providerKey: "mock-video", negativePrompt: "blurry" });
    expect(p.negativePrompt).toContain("minors");
    expect(p.negativePrompt).toContain("blurry");
  });

  it("runs a job end-to-end and labels the output as simulated", async () => {
    const { actor, concept, prompt } = await setup();
    const { job } = await submitGeneration(actor, { conceptId: concept.id, promptId: prompt.id, providerKey: "mock-video" });
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("GENERATING");
    await drainQueue("test");
    const done = await db.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("SUCCEEDED");
    const asset = await db.mediaAsset.findUniqueOrThrow({ where: { id: done.resultAssetId! }, include: { currentVersion: true } });
    expect(asset.currentVersion?.isSimulated).toBe(true);
    expect(asset.currentVersion?.source).toBe("SIMULATED");
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("AWAITING_APPROVAL");
  });

  it("re-submitting the same prompt does not duplicate completed work", async () => {
    const { actor, concept, prompt } = await setup();
    const a = await submitGeneration(actor, { conceptId: concept.id, promptId: prompt.id, providerKey: "mock-video" });
    await drainQueue("test");
    const b = await submitGeneration(actor, { conceptId: concept.id, promptId: prompt.id, providerKey: "mock-video" });
    expect(b.reused).toBe(true);
    expect(b.job.id).toBe(a.job.id);
    expect(await db.generationJob.count()).toBe(1);
    expect(await db.assetVersion.count()).toBe(1);
    const c = await submitGeneration(actor, { conceptId: concept.id, promptId: prompt.id, providerKey: "mock-video", regenerate: true });
    expect(c.job.id).not.toBe(a.job.id);
  });

  it("failed jobs retry in place, and a final failure marks the concept", async () => {
    const { actor, concept } = await setup();
    const prompt = await savePrompt(actor, concept.id, { providerKey: "mock-video", positivePrompt: "Adult man jogging [mock-fail]" });
    const { job } = await submitGeneration(actor, { conceptId: concept.id, promptId: prompt.id, providerKey: "mock-video" });
    for (let i = 0; i < 3; i++) {
      await db.backgroundJob.updateMany({ where: { status: "QUEUED" }, data: { runAt: new Date(Date.now() - 1000) } });
      await drainQueue("test");
    }
    const failed = await db.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(failed.status).toBe("FAILED");
    expect(failed.attempts).toBe(3);
    expect((await db.contentConcept.findUniqueOrThrow({ where: { id: concept.id } })).status).toBe("GENERATION_FAILED");
    const retried = await retryGeneration(actor, job.id);
    expect(retried.job.id).toBe(job.id);
    expect(retried.job.status).toBe("QUEUED");
    expect(await db.generationJob.count()).toBe(1);
  });

  it("blocks the simulated provider in the restricted workspace (no explicit adult permission)", async () => {
    const { actor, concept, prompt } = await setup("adult", "Artistic study");
    await expect(submitGeneration(actor, { conceptId: concept.id, promptId: prompt.id, providerKey: "mock-video" })).rejects.toThrow(/not permitted in the restricted workspace/);
  });

  it("blocks generation that uses a revoked likeness reference", async () => {
    const { actor, lifestyle } = await makeOwner();
    const ref = await addLikenessReference(actor, { label: "Front", subjectName: "Me", relationship: "SELF", consentStatement: "My own face, authorized for my brand.", confirmRights: true, confirmAdult: true }, PNG_1PX);
    const ch = await saveCharacter(actor, { name: "Alex", apparentAge: 30, adultConfirmed: true, likenessRefId: ref.id });
    const concept = await createConcept(actor, { workspaceId: lifestyle.id, title: "Gym", characterId: ch.id });
    const prompt = await savePrompt(actor, concept.id, { providerKey: "mock-video" });
    expect(prompt.positivePrompt).toContain("authorized reference");
    await revokeLikenessReference(actor, ref.id);
    await expect(submitGeneration(actor, { conceptId: concept.id, promptId: prompt.id, providerKey: "mock-video" })).rejects.toThrow(/revoked/);
  });

  it("refuses characters under 21 and prompts that reference minors", async () => {
    const { actor, concept } = await setup();
    await expect(saveCharacter(actor, { name: "X", apparentAge: 19, adultConfirmed: true })).rejects.toThrow(/21 or older/);
    await expect(savePrompt(actor, concept.id, { providerKey: "mock-video", positivePrompt: "a teenage boy at school" })).rejects.toThrow(/content safety/);
    await expect(createConcept(actor, { workspaceId: concept.workspaceId, title: "schoolboy look" })).rejects.toThrow(/content safety/);
  });
});
