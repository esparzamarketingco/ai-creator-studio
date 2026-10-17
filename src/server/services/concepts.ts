import { z } from "zod";
import type { ContentStatus, Prisma } from "@prisma/client";
import { db } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { requireWorkspace } from "../permissions";
import { assertSafe } from "../workflow/safety";
import { assertTransition } from "../workflow/states";
import { isUsTimezone } from "../time";
import type { Actor } from "../auth/actor";

const tags = z.array(z.string().trim().min(1).max(60)).max(30).default([]);

export const conceptSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().trim().min(1, "Required").max(140),
  description: z.string().trim().max(2000).default(""),
  audience: z.string().trim().max(200).default("Adults 18+ (U.S.)"),
  category: z.string().trim().max(80).default(""),
  intensityLevel: z.string().trim().max(80).default(""),
  characterId: z.string().optional().nullable(),
  scene: z.string().trim().max(1000).default(""),
  location: z.string().trim().max(300).default(""),
  wardrobe: z.string().trim().max(300).default(""),
  lighting: z.string().trim().max(300).default(""),
  camera: z.string().trim().max(300).default(""),
  visualStyle: z.string().trim().max(300).default(""),
  durationSec: z.coerce.number().int().min(3).max(600).default(15),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16"),
  resolution: z.enum(["720x1280", "1080x1920", "1280x720", "1920x1080", "1080x1080", "1080x1350", "2160x3840", "3840x2160"]).default("1080x1920"),
  continuityRules: z.string().trim().max(1000).default(""),
  caption: z.string().trim().max(2200).default(""),
  hashtags: tags,
  callToAction: z.string().trim().max(300).default(""),
  tags,
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  plannedTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().nullable(),
  timezone: z.string().refine(isUsTimezone, "Choose a U.S. time zone").default("America/New_York"),
});
export type ConceptInput = z.input<typeof conceptSchema>;

const SAFETY_FIELDS = ["title", "description", "scene", "location", "wardrobe", "lighting", "camera", "visualStyle", "continuityRules", "caption", "callToAction"] as const;

async function validateRefs(workspaceId: string, data: z.infer<typeof conceptSchema>) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  if (data.category && ws.categories.length && !ws.categories.includes(data.category)) throw new AppError("VALIDATION", "Choose a category configured for this workspace.");
  if (data.intensityLevel && ws.intensityLevels.length && !ws.intensityLevels.includes(data.intensityLevel)) throw new AppError("VALIDATION", "Choose an intensity level configured for this workspace.");
  if (data.characterId) {
    const c = await db.characterProfile.findFirst({
      where: { id: data.characterId, archivedAt: null, creatorProfile: { user: { memberships: { some: { workspaceId } } } } },
    });
    if (!c) throw new AppError("VALIDATION", "Choose an existing character profile.");
  }
}

export async function createConcept(actor: Actor, input: ConceptInput) {
  const data = conceptSchema.parse(input);
  await requireWorkspace(actor, data.workspaceId, "edit");
  assertSafe(Object.fromEntries(SAFETY_FIELDS.map((f) => [f, data[f]])));
  await validateRefs(data.workspaceId, data);
  const concept = await db.contentConcept.create({ data: { ...data, characterId: data.characterId || null, createdById: actor.userId } });
  await audit({ userId: actor.userId, workspaceId: data.workspaceId, action: "concept.created", entityType: "ContentConcept", entityId: concept.id, ip: actor.ip });
  return concept;
}

/** Edits never touch approval state of media; changing creative direction after approval moves back to review. */
export async function updateConcept(actor: Actor, id: string, input: Partial<ConceptInput>) {
  const existing = await getConceptForActor(actor, id, "edit");
  const data = conceptSchema.partial().parse({ ...input, workspaceId: existing.workspaceId });
  assertSafe(Object.fromEntries(SAFETY_FIELDS.map((f) => [f, data[f] ?? null])));
  await validateRefs(existing.workspaceId, { ...existing, ...data } as z.infer<typeof conceptSchema>);
  const updated = await db.contentConcept.update({ where: { id }, data: { ...data, workspaceId: undefined, characterId: data.characterId === undefined ? undefined : data.characterId || null } });
  await audit({ userId: actor.userId, workspaceId: existing.workspaceId, action: "concept.updated", entityType: "ContentConcept", entityId: id, ip: actor.ip, metadata: { fields: Object.keys(input) } });
  return updated;
}

export async function getConceptForActor(actor: Actor, id: string, action: "view" | "edit" | "approve" | "publish" = "view") {
  const concept = await db.contentConcept.findUnique({ where: { id } });
  if (!concept) throw new AppError("NOT_FOUND", "Concept not found.");
  await requireWorkspace(actor, concept.workspaceId, action);
  return concept;
}

/** Manual status moves allowed from the UI. Approval-related states go through the approval service. */
const MANUAL_TARGETS: ContentStatus[] = ["IDEA", "PROMPT_READY", "ARCHIVED"];

export async function setConceptStatus(actor: Actor, id: string, to: ContentStatus) {
  if (!MANUAL_TARGETS.includes(to)) throw new AppError("FORBIDDEN", "That status can only be set by the approval or publishing workflow.");
  const concept = await getConceptForActor(actor, id, "edit");
  if (concept.status === to) return concept;
  assertTransition(concept.status, to);
  if (to === "ARCHIVED") await cancelActiveSchedules(db, id, "Concept archived");
  const updated = await db.contentConcept.update({ where: { id }, data: { status: to } });
  await audit({ userId: actor.userId, workspaceId: concept.workspaceId, action: "concept.status_changed", entityType: "ContentConcept", entityId: id, ip: actor.ip, metadata: { from: concept.status, to } });
  return updated;
}

export async function cancelActiveSchedules(client: Prisma.TransactionClient | typeof db, conceptId: string, reason: string) {
  await client.publishingSchedule.updateMany({ where: { conceptId, status: { in: ["QUEUED", "AWAITING_MANUAL"] } }, data: { status: "CANCELED", lastError: reason } });
}

export async function listConcepts(actor: Actor, workspaceId: string, filter: { status?: ContentStatus[]; q?: string; from?: string; to?: string } = {}) {
  await requireWorkspace(actor, workspaceId, "view");
  return db.contentConcept.findMany({
    where: {
      workspaceId,
      ...(filter.status?.length ? { status: { in: filter.status } } : {}),
      ...(filter.q ? { OR: [{ title: { contains: filter.q, mode: "insensitive" } }, { tags: { has: filter.q } }] } : {}),
      ...(filter.from || filter.to ? { plannedDate: { gte: filter.from, lte: filter.to } } : {}),
    },
    orderBy: [{ plannedDate: "asc" }, { updatedAt: "desc" }],
    include: { character: { select: { id: true, name: true } }, prompts: { orderBy: { version: "desc" }, take: 1 } },
    take: 200,
  });
}

/**
 * Calendar: move a concept to another day/time. If it is already scheduled, the schedule is
 * canceled and the concept returns to APPROVED — it must be re-scheduled, which re-runs every
 * approval and destination check. Drag-and-drop therefore can never bypass approval.
 */
export async function moveConcept(actor: Actor, id: string, plannedDate: string, plannedTime?: string | null) {
  const concept = await getConceptForActor(actor, id, "edit");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)) throw new AppError("VALIDATION", "Invalid date.");
  if (concept.status === "PUBLISHED") throw new AppError("CONFLICT", "Published content cannot be moved.");
  return db.$transaction(async (tx) => {
    let status = concept.status;
    if (concept.status === "SCHEDULED") {
      await cancelActiveSchedules(tx, id, "Rescheduled from the calendar");
      status = "APPROVED";
    }
    const updated = await tx.contentConcept.update({ where: { id }, data: { plannedDate, plannedTime: plannedTime ?? concept.plannedTime, status } });
    await audit({ userId: actor.userId, workspaceId: concept.workspaceId, action: "concept.moved", entityType: "ContentConcept", entityId: id, ip: actor.ip, metadata: { from: concept.plannedDate, to: plannedDate, unscheduled: concept.status === "SCHEDULED" } }, tx);
    return updated;
  });
}
