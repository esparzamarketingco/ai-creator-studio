import type { AssetKind } from "@prisma/client";
import { db } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { randomToken, sha256Hex } from "../crypto";
import { rateLimit } from "../rate-limit";
import { storage } from "../media/storage";
import { getGenerator } from "../providers/registry";
import { assertSafe } from "../workflow/safety";
import { enqueue } from "../jobs/queue";
import { getConceptForActor } from "./concepts";
import { createAssetVersion } from "./assets";
import { readCredentials } from "./integrations";
import { notifyWorkspaceManagers } from "./notifications";
import type { Actor } from "../auth/actor";

/**
 * Every rule a provider must satisfy before a job is sent. Enforced at submit time AND again
 * when the worker runs the job (settings may change in between).
 */
export async function assertProviderAllowed(conceptId: string, providerKey: string, kind: AssetKind) {
  const concept = await db.contentConcept.findUniqueOrThrow({ where: { id: conceptId }, include: { workspace: true, character: { include: { likenessRef: true } } } });
  const provider = getGenerator(providerKey);
  if (!provider) throw new AppError("INTEGRATION_UNAVAILABLE", "This generation provider is not installed.");
  if (!provider.kinds.includes(kind)) throw new AppError("VALIDATION", `${provider.displayName} cannot generate ${kind.toLowerCase()}s.`);
  const integration = await db.platformIntegration.findUnique({ where: { workspaceId_providerKey: { workspaceId: concept.workspaceId, providerKey } } });
  if (!integration || !["OPERATIONAL", "CONFIGURED"].includes(integration.status)) {
    throw new AppError("INTEGRATION_UNAVAILABLE", `${provider.displayName} is not connected for this workspace. Connect it in Settings → Integrations.`);
  }
  if (!provider.isSimulated && !integration.policyVerifiedAt) {
    throw new AppError("POLICY_BLOCKED", "Verify this provider's API, content policy, likeness rules, commercial rights and pricing in Settings → Integrations before using it.");
  }
  if (concept.workspace.kind === "ADULT" && !(provider.capabilities.allowsAdultContent && integration.allowsAdultContent)) {
    throw new AppError("POLICY_BLOCKED", `${provider.displayName} is not permitted in the restricted workspace: its terms must explicitly allow adult content and you must verify that in Settings → Integrations. You can still plan, write prompts, upload media manually, review and schedule.`);
  }
  const ref = concept.character?.likenessRef;
  if (ref) {
    if (ref.revokedAt) throw new AppError("POLICY_BLOCKED", "The character's likeness reference was revoked. Choose another character or reference.");
    if (!(provider.capabilities.allowsLikeness && (provider.isSimulated || integration.allowsLikeness))) {
      throw new AppError("POLICY_BLOCKED", `${provider.displayName} does not support authorized-likeness workflows. Use a fictional character or a provider that permits likeness references.`);
    }
  }
  return { concept, provider, integration };
}

/**
 * Submit a generation job. Idempotent: submitting the same prompt/provider/kind again returns the
 * existing job (a completed job is never re-run; a failed one is retried in place). Use
 * `regenerate` to deliberately request a fresh output.
 */
export async function submitGeneration(actor: Actor, input: { conceptId: string; promptId: string; providerKey: string; kind?: AssetKind; regenerate?: boolean }) {
  const kind = input.kind ?? "VIDEO";
  const concept = await getConceptForActor(actor, input.conceptId, "edit");
  await rateLimit(`gen:${actor.userId}`, 30, 3600);
  const prompt = await db.generationPrompt.findFirst({ where: { id: input.promptId, conceptId: concept.id } });
  if (!prompt) throw new AppError("NOT_FOUND", "Prompt not found.");
  assertSafe({ prompt: prompt.positivePrompt });
  const { provider } = await assertProviderAllowed(concept.id, input.providerKey, kind);

  const baseKey = sha256Hex(`${prompt.id}:${input.providerKey}:${kind}`);
  const idempotencyKey = input.regenerate ? `${baseKey}:${randomToken(6)}` : baseKey;
  const existing = await db.generationJob.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.status === "FAILED" || existing.status === "CANCELED") return retryGeneration(actor, existing.id);
    return { job: existing, reused: true };
  }
  const job = await db.$transaction(async (tx) => {
    const j = await tx.generationJob.create({
      data: { conceptId: concept.id, promptId: prompt.id, providerKey: input.providerKey, kind, isSimulated: provider.isSimulated, idempotencyKey },
    });
    if (kind === "VIDEO") await tx.contentConcept.update({ where: { id: concept.id }, data: { status: "GENERATING" } });
    await enqueue("generation.run", { generationJobId: j.id }, { idempotencyKey: `gen:${j.id}:0` }, tx);
    await audit({ userId: actor.userId, workspaceId: concept.workspaceId, action: "generation.submitted", entityType: "GenerationJob", entityId: j.id, ip: actor.ip, metadata: { providerKey: input.providerKey, kind, simulated: provider.isSimulated } }, tx);
    return j;
  });
  return { job, reused: false };
}

export async function retryGeneration(actor: Actor, jobId: string) {
  const job = await db.generationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new AppError("NOT_FOUND", "Job not found.");
  const concept = await getConceptForActor(actor, job.conceptId, "edit");
  if (job.status === "SUCCEEDED") return { job, reused: true }; // never duplicate completed work
  if (job.status === "QUEUED" || job.status === "RUNNING") return { job, reused: true };
  await assertProviderAllowed(concept.id, job.providerKey, job.kind);
  const updated = await db.$transaction(async (tx) => {
    const j = await tx.generationJob.update({ where: { id: jobId }, data: { status: "QUEUED", lastError: null, attempts: 0, externalJobId: null } });
    if (j.kind === "VIDEO") await tx.contentConcept.update({ where: { id: concept.id }, data: { status: "GENERATING" } });
    await enqueue("generation.run", { generationJobId: j.id }, { idempotencyKey: `gen:${j.id}:${randomToken(6)}` }, tx);
    await audit({ userId: actor.userId, workspaceId: concept.workspaceId, action: "generation.retried", entityType: "GenerationJob", entityId: jobId, ip: actor.ip }, tx);
    return j;
  });
  return { job: updated, reused: false };
}

const POLL_INTERVAL_MS = process.env.NODE_ENV === "test" ? 1 : 3000;
const POLL_LIMIT = 200;

/** Worker handler. Returns normally on success or permanent failure; throws for retryable errors. */
export async function runGenerationJob(generationJobId: string) {
  const job = await db.generationJob.findUnique({ where: { id: generationJobId }, include: { prompt: true, concept: { include: { character: { include: { likenessRef: true } } } } } });
  if (!job || job.status === "SUCCEEDED" || job.status === "CANCELED") return;
  try {
    const { provider, integration } = await assertProviderAllowed(job.conceptId, job.providerKey, job.kind);
    await db.generationJob.update({ where: { id: job.id }, data: { status: "RUNNING", attempts: { increment: 1 } } });
    const credentials = readCredentials(integration);
    const ref = job.concept.character?.likenessRef;
    const referenceImages = ref && !ref.revokedAt ? [{ mime: ref.mimeType, data: await storage().get(ref.storageKey) }] : [];
    const params = job.prompt.params as { durationSec?: number; aspectRatio?: string; resolution?: string };
    let externalJobId = job.externalJobId;
    if (!externalJobId) {
      ({ externalJobId } = await provider.submit(
        { kind: job.kind, positivePrompt: job.prompt.positivePrompt, negativePrompt: job.prompt.negativePrompt, durationSec: params.durationSec ?? 15, aspectRatio: params.aspectRatio ?? "9:16", resolution: params.resolution ?? "1080x1920", referenceImages, idempotencyKey: job.idempotencyKey },
        credentials,
      ));
      await db.generationJob.update({ where: { id: job.id }, data: { externalJobId } });
    }
    for (let i = 0; i < POLL_LIMIT; i++) {
      const r = await provider.poll(externalJobId, credentials);
      if (r.state === "running") {
        if (job.kind === "VIDEO" && i === 0) await db.contentConcept.update({ where: { id: job.conceptId }, data: { status: "GENERATING" } });
        await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
        continue;
      }
      if (r.state === "failed") {
        await db.generationJob.update({ where: { id: job.id }, data: { externalJobId: null } });
        throw Object.assign(new Error(r.error), { retryable: r.retryable });
      }
      if (job.kind === "VIDEO") await db.contentConcept.update({ where: { id: job.conceptId }, data: { status: "PROCESSING" } });
      const existingAsset = await db.mediaAsset.findFirst({ where: { conceptId: job.conceptId, kind: job.kind, deletedAt: null }, orderBy: { createdAt: "asc" } });
      const { asset } = await createAssetVersion({
        workspaceId: job.concept.workspaceId,
        assetId: existingAsset?.id,
        conceptId: job.conceptId,
        kind: job.kind,
        title: `${job.concept.title}${job.kind === "THUMBNAIL" ? " — thumbnail" : ""}`,
        tags: job.concept.tags,
        category: job.concept.category,
        data: r.output.data,
        source: provider.isSimulated ? "SIMULATED" : "GENERATED",
        isSimulated: provider.isSimulated,
        providerKey: provider.key,
        generationJobId: job.id,
      });
      await db.generationJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", resultAssetId: asset.id, lastError: null } });
      await audit({ workspaceId: job.concept.workspaceId, action: "generation.succeeded", entityType: "GenerationJob", entityId: job.id, metadata: { assetId: asset.id, simulated: provider.isSimulated } });
      return;
    }
    throw Object.assign(new Error("Provider did not finish in time."), { retryable: true });
  } catch (err) {
    const retryable = Boolean((err as { retryable?: boolean }).retryable) && !(err instanceof AppError);
    const fresh = await db.generationJob.findUniqueOrThrow({ where: { id: job.id } });
    const final = !retryable || fresh.attempts >= fresh.maxAttempts;
    await db.generationJob.update({ where: { id: job.id }, data: { status: final ? "FAILED" : "QUEUED", lastError: (err as Error).message.slice(0, 1000) } });
    await audit({ workspaceId: job.concept.workspaceId, action: "generation.failed", entityType: "GenerationJob", entityId: job.id, outcome: "FAILED", metadata: { error: (err as Error).message.slice(0, 300), final } });
    if (final) {
      if (job.kind === "VIDEO") await db.contentConcept.update({ where: { id: job.conceptId }, data: { status: "GENERATION_FAILED" } });
      await notifyWorkspaceManagers(job.concept.workspaceId, { type: "failure", title: `Generation failed: ${job.concept.title}`, body: (err as Error).message.slice(0, 200), link: `/studio?concept=${job.conceptId}` });
      return;
    }
    throw err; // let the queue back off and retry
  }
}

export async function listJobs(actor: Actor, conceptId: string) {
  await getConceptForActor(actor, conceptId, "view");
  return db.generationJob.findMany({ where: { conceptId }, orderBy: { createdAt: "desc" }, take: 20 });
}
