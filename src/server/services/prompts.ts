import { db } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { assertSafe, MIN_CHARACTER_AGE } from "../workflow/safety";
import { assertTransition } from "../workflow/states";
import { getConceptForActor } from "./concepts";
import type { Actor } from "../auth/actor";

/** Always appended so every provider receives an explicit adult-only constraint. */
export const BASE_NEGATIVE =
  "minors, child, teenager, youthful or underage appearance, school setting, real celebrity likeness, watermark, text artifacts, extra limbs, distorted face, inconsistent facial identity, plastic skin";

/**
 * Build a structured, provider-neutral prompt from the concept, character and brand profile.
 * Output is plain text sections most video/image APIs accept; adapters may re-map fields.
 */
export async function buildPrompt(conceptId: string) {
  const concept = await db.contentConcept.findUniqueOrThrow({
    where: { id: conceptId },
    include: { character: { include: { likenessRef: true, creatorProfile: true } }, workspace: true },
  });
  const profile = concept.character?.creatorProfile ?? (await db.creatorProfile.findFirst({ where: { userId: concept.createdById } }));
  const ch = concept.character;
  const appearance = (profile?.appearance ?? {}) as Record<string, string>;
  const lines: [string, string | undefined | null][] = [
    ["Subject", ch ? `${ch.name}, a ${Math.max(ch.apparentAge, MIN_CHARACTER_AGE)}-year-old adult man${ch.isFictional ? " (fictional character)" : ""}. ${ch.description}` : "An adult man (21+)."],
    ["Physique", ch?.physique || profile?.physique],
    ["Face & identity", ch?.likenessRef && !ch.likenessRef.revokedAt
      ? `Preserve the facial identity from the attached authorized reference images. ${[appearance.hairstyle, appearance.facialHair, appearance.skinTone, appearance.distinctiveFeatures].filter(Boolean).join(", ")}`
      : undefined],
    ["Scene", concept.scene || concept.description],
    ["Location", concept.location],
    ["Wardrobe", concept.wardrobe],
    ["Lighting", concept.lighting || profile?.preferredLighting?.join(", ")],
    ["Camera", concept.camera || profile?.preferredFraming?.join(", ")],
    ["Visual style", concept.visualStyle || profile?.preferredStyles?.join(", ")],
    ["Continuity", [concept.continuityRules, ch?.continuityRules].filter(Boolean).join(" ")],
    ["Quality", "photorealistic, natural skin texture, realistic lighting, consistent facial identity across shots, cinematic composition"],
    ["Format", `${concept.durationSec}s, ${concept.aspectRatio}, ${concept.resolution}`],
  ];
  const positivePrompt = lines.filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${k}: ${String(v).trim()}`).join("\n");
  return {
    positivePrompt,
    negativePrompt: BASE_NEGATIVE,
    params: {
      durationSec: concept.durationSec,
      aspectRatio: concept.aspectRatio,
      resolution: concept.resolution,
      category: concept.category,
      intensityLevel: concept.intensityLevel,
      workspaceKind: concept.workspace.kind,
      usesLikeness: Boolean(ch?.likenessRef && !ch.likenessRef.revokedAt),
    },
  };
}

/** Save a prompt version (generated or hand-edited). Moves IDEA → PROMPT_READY. */
export async function savePrompt(actor: Actor, conceptId: string, input: { providerKey: string; positivePrompt?: string; negativePrompt?: string }) {
  const concept = await getConceptForActor(actor, conceptId, "edit");
  const built = await buildPrompt(conceptId);
  const positivePrompt = (input.positivePrompt ?? built.positivePrompt).trim();
  if (!positivePrompt) throw new AppError("VALIDATION", "The prompt is empty.");
  if (positivePrompt.length > 6000) throw new AppError("VALIDATION", "The prompt is too long (6,000 characters max).");
  // The base negative prompt is mandatory; users can add to it but not remove it.
  const extraNegative = (input.negativePrompt ?? "").replace(BASE_NEGATIVE, "").trim();
  const negativePrompt = [BASE_NEGATIVE, extraNegative].filter(Boolean).join(", ");
  assertSafe({ prompt: positivePrompt });
  const last = await db.generationPrompt.findFirst({ where: { conceptId }, orderBy: { version: "desc" } });
  const prompt = await db.generationPrompt.create({
    data: { conceptId, version: (last?.version ?? 0) + 1, providerKey: input.providerKey, positivePrompt, negativePrompt, params: built.params },
  });
  if (concept.status === "IDEA") {
    assertTransition(concept.status, "PROMPT_READY");
    await db.contentConcept.update({ where: { id: conceptId }, data: { status: "PROMPT_READY" } });
  }
  await audit({ userId: actor.userId, workspaceId: concept.workspaceId, action: "prompt.saved", entityType: "GenerationPrompt", entityId: prompt.id, ip: actor.ip, metadata: { version: prompt.version, edited: input.positivePrompt !== undefined } });
  return prompt;
}
