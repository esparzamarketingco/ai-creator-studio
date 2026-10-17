"use server";
import type { AssetKind, ContentStatus } from "@prisma/client";
import { bool, fileBuffer, list, optStr, run, str } from "./run";
import { createConcept, moveConcept, setConceptStatus, updateConcept, type ConceptInput } from "@/server/services/concepts";
import { savePrompt } from "@/server/services/prompts";
import { retryGeneration, submitGeneration } from "@/server/services/generation";
import { archiveAsset, deleteAsset, signedVersionUrl, updateAssetMeta, uploadAsset } from "@/server/services/assets";
import { decide, revokeApproval } from "@/server/services/approvals";
import { cancelSchedule, confirmManualPublication, publishNow, retryPublication, schedulePublication } from "@/server/services/publishing";
import { AppError } from "@/server/errors";
import { drainQueue } from "@/server/jobs/worker";
import { mockProvidersEnabled } from "@/server/env";

function conceptFields(fd: FormData): Omit<ConceptInput, "workspaceId"> {
  return {
    title: str(fd, "title"), description: str(fd, "description"), audience: str(fd, "audience") || undefined,
    category: str(fd, "category"), intensityLevel: str(fd, "intensityLevel"), characterId: optStr(fd, "characterId") ?? null,
    scene: str(fd, "scene"), location: str(fd, "location"), wardrobe: str(fd, "wardrobe"), lighting: str(fd, "lighting"),
    camera: str(fd, "camera"), visualStyle: str(fd, "visualStyle"), durationSec: Number(str(fd, "durationSec") || 15),
    aspectRatio: (str(fd, "aspectRatio") || "9:16") as ConceptInput["aspectRatio"], resolution: (str(fd, "resolution") || "1080x1920") as ConceptInput["resolution"],
    continuityRules: str(fd, "continuityRules"), caption: str(fd, "caption"), hashtags: list(fd, "hashtags"), callToAction: str(fd, "callToAction"),
    tags: list(fd, "tags"), plannedDate: optStr(fd, "plannedDate") ?? null, plannedTime: optStr(fd, "plannedTime") ?? null,
    timezone: str(fd, "timezone") || "America/New_York",
  };
}

export async function saveConceptAction(_: unknown, fd: FormData) {
  const id = optStr(fd, "id");
  return run(async (actor) => {
    const c = id ? await updateConcept(actor, id, conceptFields(fd)) : await createConcept(actor, { ...conceptFields(fd), workspaceId: str(fd, "workspaceId") });
    return { id: c.id };
  }, { message: id ? "Concept saved." : "Concept created." });
}

export async function setConceptStatusAction(id: string, status: ContentStatus) {
  return run((a) => setConceptStatus(a, id, status), { message: "Status updated." });
}

export async function savePromptAction(_: unknown, fd: FormData) {
  return run((a) => savePrompt(a, str(fd, "conceptId"), {
    providerKey: str(fd, "providerKey") || "manual",
    positivePrompt: fd.get("regenerate") ? undefined : optStr(fd, "positivePrompt"),
    negativePrompt: optStr(fd, "negativePrompt"),
  }).then((p) => ({ id: p.id, version: p.version })), { message: "Prompt saved as a new version." });
}

export async function submitGenerationAction(_: unknown, fd: FormData) {
  return run(async (a) => {
    const r = await submitGeneration(a, { conceptId: str(fd, "conceptId"), promptId: str(fd, "promptId"), providerKey: str(fd, "providerKey"), kind: (str(fd, "kind") || "VIDEO") as AssetKind, regenerate: bool(fd, "regenerate") });
    return { jobId: r.job.id, reused: r.reused };
  }, { message: "Generation job queued. The background worker will process it." });
}

export async function retryGenerationAction(jobId: string) {
  return run((a) => retryGeneration(a, jobId).then(() => undefined), { message: "Job re-queued." });
}

/** Development convenience: run queued jobs in-process when no worker is running. */
export async function processQueueNowAction() {
  return run(async () => {
    if (!mockProvidersEnabled() || process.env.NODE_ENV === "production") throw new AppError("FORBIDDEN", "Run `npm run worker` to process jobs.");
    return { ran: await drainQueue("inline-dev", 20) };
  }, { message: "Queue processed." });
}

export async function uploadAssetAction(_: unknown, fd: FormData) {
  return run(async (a) => {
    const data = await fileBuffer(fd, "file");
    if (!data) throw new AppError("VALIDATION", "Choose a file to upload.");
    const r = await uploadAsset(a, { workspaceId: str(fd, "workspaceId"), assetId: optStr(fd, "assetId"), conceptId: optStr(fd, "conceptId") ?? null, kind: (str(fd, "kind") || "VIDEO") as AssetKind, title: str(fd, "title"), tags: list(fd, "tags"), category: str(fd, "category") }, data);
    return { assetId: r.asset.id, version: r.version.versionNumber };
  }, { message: "Uploaded. New videos go to the approval inbox; any earlier approval of this asset was invalidated." });
}

export async function moveConceptAction(id: string, date: string) {
  return run((a) => moveConcept(a, id, date).then(() => undefined), { message: "Moved." });
}

export async function signedUrlAction(versionId: string, download = false) {
  return run((a) => signedVersionUrl(a, versionId, { download }), { revalidate: [] });
}

export async function decideAction(_: unknown, fd: FormData) {
  const decision = str(fd, "decision") as "APPROVED" | "REJECTED" | "REVISIONS_REQUESTED";
  return run((a) => decide(a, { assetVersionId: str(fd, "assetVersionId"), decision, notes: str(fd, "notes"), previewCompleted: bool(fd, "previewCompleted") }).then(() => undefined),
    { message: decision === "APPROVED" ? "Approved this exact version." : decision === "REJECTED" ? "Rejected. It is out of the publishing queue." : "Revisions requested." });
}

export async function revokeApprovalAction(approvalId: string) {
  return run((a) => revokeApproval(a, approvalId), { message: "Approval withdrawn." });
}

export async function scheduleAction(_: unknown, fd: FormData) {
  return run((a) => schedulePublication(a, {
    conceptId: str(fd, "conceptId"), assetId: str(fd, "assetId"), integrationId: str(fd, "integrationId"),
    date: str(fd, "date"), time: str(fd, "time"), timezone: str(fd, "timezone"), caption: str(fd, "caption"), hashtags: list(fd, "hashtags"),
    isPromo: bool(fd, "isPromo"), confirmFirstPublication: bool(fd, "confirmFirstPublication"),
  }).then((s) => ({ id: s.id })), { message: "Scheduled. All approval checks will run again at publish time." });
}

export async function cancelScheduleAction(id: string) {
  return run((a) => cancelSchedule(a, id), { message: "Canceled." });
}

export async function publishNowAction(id: string) {
  return run(async (a) => {
    const r = await publishNow(a, id);
    if (r.outcome === "blocked") throw new AppError("FORBIDDEN", `Blocked: ${r.message}`);
    if (r.outcome === "failed") throw new AppError("INTEGRATION_UNAVAILABLE", `Publication failed: ${r.message}${r.willRetry ? " (will retry automatically)" : ""}`);
    return r;
  }, { message: "Done." });
}

export async function retryPublicationAction(id: string) {
  return run(async (a) => {
    const r = await retryPublication(a, id);
    if (r.outcome === "blocked") throw new AppError("FORBIDDEN", `Blocked: ${r.message}`);
    if (r.outcome === "failed") throw new AppError("INTEGRATION_UNAVAILABLE", `Failed again: ${r.message}`);
    return r;
  }, { message: "Retried." });
}

export async function confirmManualAction(_: unknown, fd: FormData) {
  return run((a) => confirmManualPublication(a, { scheduleId: str(fd, "scheduleId"), postUrl: str(fd, "postUrl") }), { message: "Marked as published with your confirmation." });
}

export async function assetMetaAction(_: unknown, fd: FormData) {
  return run((a) => updateAssetMeta(a, str(fd, "assetId"), { title: str(fd, "title"), tags: list(fd, "tags"), category: str(fd, "category") }), { message: "Saved." });
}

export async function archiveAssetAction(id: string, archived: boolean) {
  return run((a) => archiveAsset(a, id, archived), { message: archived ? "Archived. Any approval was invalidated." : "Restored." });
}

export async function deleteAssetAction(id: string) {
  return run((a) => deleteAsset(a, id), { message: "Deleted permanently." });
}
