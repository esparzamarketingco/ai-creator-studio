import { z } from "zod";
import { db } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { sha256Hex } from "../crypto";
import { storage, newStorageKey } from "../media/storage";
import { ALLOWED_TYPES, validateMedia } from "../media/validation";
import { assertSafe, MIN_CHARACTER_AGE } from "../workflow/safety";
import type { Actor } from "../auth/actor";

const list = z.array(z.string().trim().min(1).max(80)).max(30).default([]);

export const profileSchema = z.object({
  displayName: z.string().trim().max(80).default(""),
  username: z.string().trim().max(40).regex(/^[a-z0-9_.-]*$/i, "Letters, numbers, dot, dash and underscore only").default(""),
  bio: z.string().trim().max(1000).default(""),
  brandVoice: z.string().trim().max(1000).default(""),
  visualIdentity: z.string().trim().max(1000).default(""),
  appearance: z
    .object({
      hairstyle: z.string().trim().max(120).default(""),
      facialHair: z.string().trim().max(120).default(""),
      skinTone: z.string().trim().max(120).default(""),
      distinctiveFeatures: z.string().trim().max(300).default(""),
    })
    .default({}),
  physique: z.string().trim().max(500).default(""),
  preferredEnvironments: list,
  preferredStyles: list,
  preferredLighting: list,
  preferredFraming: list,
  disclosureText: z.string().trim().min(10, "Keep a clear AI disclosure (at least 10 characters)").max(500),
});

export async function getProfile(actor: Actor) {
  return db.creatorProfile.upsert({
    where: { userId: actor.userId },
    create: { userId: actor.userId },
    update: {},
    include: {
      likenessRefs: { orderBy: { createdAt: "desc" } },
      characters: { where: { archivedAt: null }, orderBy: { createdAt: "asc" }, include: { likenessRef: { select: { id: true, label: true, revokedAt: true } } } },
    },
  });
}

export async function updateProfile(actor: Actor, input: z.input<typeof profileSchema>) {
  const data = profileSchema.parse(input);
  assertSafe({ bio: data.bio, brandVoice: data.brandVoice, visualIdentity: data.visualIdentity, physique: data.physique });
  const profile = await db.creatorProfile.update({ where: { userId: actor.userId }, data });
  await audit({ userId: actor.userId, action: "brand.profile_updated", entityType: "CreatorProfile", entityId: profile.id, ip: actor.ip });
  return profile;
}

/** Profile photo / banner: stored privately; served only through signed URLs. */
export async function setProfileImage(actor: Actor, which: "profilePhoto" | "banner", file: Buffer) {
  const { mime } = await validateMedia(file);
  if (ALLOWED_TYPES[mime].kind !== "IMAGE") throw new AppError("VALIDATION", "Upload a JPEG, PNG or WebP image.");
  const key = newStorageKey(`brand/${actor.userId}`, ALLOWED_TYPES[mime].ext);
  await storage().put(key, file, mime);
  await db.creatorProfile.update({ where: { userId: actor.userId }, data: which === "profilePhoto" ? { profilePhotoKey: key } : { bannerKey: key } });
  await audit({ userId: actor.userId, action: `brand.${which}_updated`, entityType: "CreatorProfile", ip: actor.ip });
}

export const likenessSchema = z.object({
  label: z.string().trim().min(1, "Required").max(80),
  subjectName: z.string().trim().min(1, "Required").max(120),
  relationship: z.enum(["SELF", "AUTHORIZED_OTHER"]),
  consentStatement: z.string().trim().min(20, "Describe the authorization (at least 20 characters)").max(2000),
  confirmRights: z.literal(true, { errorMap: () => ({ message: "You must confirm you hold the rights to this likeness" }) }),
  confirmAdult: z.literal(true, { errorMap: () => ({ message: "You must confirm the person is an adult" }) }),
});

/** Upload an authorized facial reference. Stored privately; consent is recorded and audited. */
export async function addLikenessReference(actor: Actor, input: z.input<typeof likenessSchema>, file: Buffer) {
  const data = likenessSchema.parse(input);
  const { mime } = await validateMedia(file);
  if (ALLOWED_TYPES[mime].kind !== "IMAGE" || mime === "image/svg+xml") throw new AppError("VALIDATION", "Reference images must be JPEG, PNG or WebP photos.");
  const profile = await getProfile(actor);
  const key = newStorageKey(`likeness/${actor.userId}`, ALLOWED_TYPES[mime].ext);
  await storage().put(key, file, mime);
  const ref = await db.likenessReference.create({
    data: {
      creatorProfileId: profile.id,
      label: data.label,
      subjectName: data.subjectName,
      relationship: data.relationship,
      consentStatement: data.consentStatement,
      consentConfirmedAt: new Date(),
      storageKey: key,
      sha256: sha256Hex(file),
      mimeType: mime,
      sizeBytes: file.length,
    },
  });
  await audit({ userId: actor.userId, action: "likeness.added", entityType: "LikenessReference", entityId: ref.id, ip: actor.ip, metadata: { relationship: data.relationship, subjectName: data.subjectName } });
  return ref;
}

/** Revoking a reference blocks any future generation that uses it. */
export async function revokeLikenessReference(actor: Actor, refId: string) {
  const ref = await db.likenessReference.findFirst({ where: { id: refId, creatorProfile: { userId: actor.userId } } });
  if (!ref) throw new AppError("NOT_FOUND", "Reference not found.");
  await db.likenessReference.update({ where: { id: refId }, data: { revokedAt: new Date() } });
  await audit({ userId: actor.userId, action: "likeness.revoked", entityType: "LikenessReference", entityId: refId, ip: actor.ip });
}

export const characterSchema = z.object({
  name: z.string().trim().min(1, "Required").max(80),
  description: z.string().trim().max(1000).default(""),
  apparentAge: z.coerce.number().int().min(MIN_CHARACTER_AGE, `Characters must appear ${MIN_CHARACTER_AGE} or older`).max(80),
  adultConfirmed: z.literal(true, { errorMap: () => ({ message: "Confirm this character is an adult" }) }),
  isFictional: z.boolean().default(true),
  likenessRefId: z.string().optional().nullable(),
  physique: z.string().trim().max(500).default(""),
  styleNotes: z.string().trim().max(1000).default(""),
  continuityRules: z.string().trim().max(1000).default(""),
});

export async function saveCharacter(actor: Actor, input: z.input<typeof characterSchema> & { id?: string }) {
  const data = characterSchema.parse(input);
  assertSafe({ name: data.name, description: data.description, physique: data.physique, styleNotes: data.styleNotes, continuityRules: data.continuityRules });
  const profile = await getProfile(actor);
  if (data.likenessRefId) {
    const ref = profile.likenessRefs.find((r) => r.id === data.likenessRefId);
    if (!ref || ref.revokedAt) throw new AppError("VALIDATION", "Choose an active, authorized likeness reference.");
  }
  const payload = { ...data, likenessRefId: data.likenessRefId || null, adultConfirmed: true };
  const character = input.id
    ? await db.characterProfile.update({ where: { id: (await ownCharacter(actor, input.id)).id }, data: payload })
    : await db.characterProfile.create({ data: { ...payload, creatorProfileId: profile.id } });
  await audit({ userId: actor.userId, action: input.id ? "character.updated" : "character.created", entityType: "CharacterProfile", entityId: character.id, ip: actor.ip });
  return character;
}

export async function archiveCharacter(actor: Actor, id: string) {
  await ownCharacter(actor, id);
  await db.characterProfile.update({ where: { id }, data: { archivedAt: new Date() } });
  await audit({ userId: actor.userId, action: "character.archived", entityType: "CharacterProfile", entityId: id, ip: actor.ip });
}

async function ownCharacter(actor: Actor, id: string) {
  const c = await db.characterProfile.findFirst({ where: { id, creatorProfile: { userId: actor.userId } } });
  if (!c) throw new AppError("NOT_FOUND", "Character not found.");
  return c;
}
