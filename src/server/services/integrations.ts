import { z } from "zod";
import type { PlatformIntegration } from "@prisma/client";
import { db } from "../db";
import { env } from "../env";
import { AppError } from "../errors";
import { audit } from "../audit";
import { decryptSecret, encryptSecret, secretHint } from "../crypto";
import { requireWorkspace } from "../permissions";
import { generationProviders, getDestination, getGenerator, INTEGRATION_CATALOG, publishingDestinations } from "../providers/registry";
import type { Actor } from "../auth/actor";

/** Public shape — credentials are never included. */
export type IntegrationView = Omit<PlatformIntegration, "credentialsEnc"> & { hasCredentials: boolean };
const view = ({ credentialsEnc, ...rest }: PlatformIntegration): IntegrationView => ({ ...rest, hasCredentials: Boolean(credentialsEnc) });

/** Built-ins (manual package; simulated providers in development) exist for every workspace. */
export async function ensureBuiltinIntegrations(workspaceId: string) {
  const builtins = [
    ...publishingDestinations().filter((d) => !d.requiresCredentials).map((d) => ({
      kind: "PUBLISHING" as const, providerKey: d.key, displayName: d.displayName, isSimulated: d.isSimulated,
      allowsAdultContent: d.allowsAdultContent, supportsDirectPublish: d.supportsDirectPublish, policyNotes: d.notes,
    })),
    ...generationProviders().filter((g) => g.isSimulated).map((g) => ({
      kind: g.kinds.includes("VIDEO") ? ("VIDEO_GENERATION" as const) : ("IMAGE_GENERATION" as const), providerKey: g.key, displayName: g.displayName,
      isSimulated: true, allowsAdultContent: g.capabilities.allowsAdultContent, allowsLikeness: g.capabilities.allowsLikeness, supportsDirectPublish: false, policyNotes: "Simulated provider.",
    })),
  ];
  for (const b of builtins) {
    await db.platformIntegration.upsert({
      where: { workspaceId_providerKey: { workspaceId, providerKey: b.providerKey } },
      create: { ...b, workspaceId, status: "OPERATIONAL", lastHealthOk: true, lastHealthCheckAt: new Date() },
      update: {},
    });
  }
}

export async function listIntegrations(actor: Actor, workspaceId: string) {
  await requireWorkspace(actor, workspaceId, "view");
  await ensureBuiltinIntegrations(workspaceId);
  const rows = await db.platformIntegration.findMany({ where: { workspaceId }, orderBy: [{ kind: "asc" }, { displayName: "asc" }] });
  const registered = new Set([...generationProviders().map((g) => g.key), ...publishingDestinations().map((d) => d.key)]);
  const e = env();
  const catalog = INTEGRATION_CATALOG.filter((c) => c.availability !== "simulated" || registered.has(c.providerKey)).map((c) => {
    const row = rows.find((r) => r.providerKey === c.providerKey);
    let status: string = row?.status ?? "DISCONNECTED";
    if (c.availability === "no_official_api") status = "UNAVAILABLE";
    if (c.availability === "adapter_not_built") status = "DISCONNECTED";
    if (c.providerKey === "storage") status = e.STORAGE_DRIVER === "s3" ? (e.S3_BUCKET ? "CONFIGURED" : "DISCONNECTED") : "OPERATIONAL";
    if (c.providerKey === "email") status = e.SMTP_URL ? "CONFIGURED" : "DISCONNECTED";
    if (c.providerKey === "csv-import") status = "OPERATIONAL";
    return { ...c, status, integration: row ? view(row) : null, storageDriver: c.providerKey === "storage" ? e.STORAGE_DRIVER : undefined };
  });
  return { catalog, integrations: rows.map(view) };
}

async function getIntegrationForActor(actor: Actor, integrationId: string, action: "view" | "manage") {
  const row = await db.platformIntegration.findUnique({ where: { id: integrationId } });
  if (!row || !row.workspaceId) throw new AppError("NOT_FOUND", "Integration not found.");
  await requireWorkspace(actor, row.workspaceId, action);
  return row;
}

/** Store API credentials encrypted at rest (AES-256-GCM). They are never sent back to the browser. */
export async function saveCredentials(actor: Actor, input: { workspaceId: string; providerKey: string; credentials: Record<string, string> }) {
  await requireWorkspace(actor, input.workspaceId, "manage");
  const gen = getGenerator(input.providerKey);
  const dest = getDestination(input.providerKey);
  if (!gen && !dest) throw new AppError("VALIDATION", "No adapter is installed for this provider yet, so it cannot be connected. See README → Connecting a real provider.");
  if ((gen?.isSimulated ?? dest?.isSimulated)) throw new AppError("VALIDATION", "Simulated providers do not take credentials.");
  const creds = z.record(z.string().trim().min(1).max(4000)).parse(input.credentials);
  const firstSecret = Object.values(creds)[0] ?? "";
  const row = await db.platformIntegration.upsert({
    where: { workspaceId_providerKey: { workspaceId: input.workspaceId, providerKey: input.providerKey } },
    create: {
      workspaceId: input.workspaceId, providerKey: input.providerKey,
      kind: gen ? (gen.kinds.includes("VIDEO") ? "VIDEO_GENERATION" : "IMAGE_GENERATION") : "PUBLISHING",
      displayName: gen?.displayName ?? dest!.displayName, credentialsEnc: encryptSecret(JSON.stringify(creds)), credentialHint: secretHint(firstSecret),
      status: "CONFIGURED", supportsDirectPublish: dest?.supportsDirectPublish ?? false,
    },
    update: { credentialsEnc: encryptSecret(JSON.stringify(creds)), credentialHint: secretHint(firstSecret), status: "CONFIGURED", lastHealthOk: null },
  });
  await audit({ userId: actor.userId, workspaceId: input.workspaceId, action: "integration.credentials_saved", entityType: "PlatformIntegration", entityId: row.id, ip: actor.ip, metadata: { providerKey: input.providerKey } });
  return view(row);
}

export function readCredentials(row: Pick<PlatformIntegration, "credentialsEnc">): Record<string, string> {
  return row.credentialsEnc ? JSON.parse(decryptSecret(row.credentialsEnc)) : {};
}

export const policySchema = z.object({
  integrationId: z.string(),
  reviewedApiDocs: z.literal(true, { errorMap: () => ({ message: "Confirm you reviewed the API documentation" }) }),
  reviewedContentPolicy: z.literal(true, { errorMap: () => ({ message: "Confirm you reviewed the content policy" }) }),
  commercialUseAllowed: z.literal(true, { errorMap: () => ({ message: "Confirm commercial use is permitted" }) }),
  reviewedPricing: z.literal(true, { errorMap: () => ({ message: "Confirm you reviewed pricing" }) }),
  permitsAdultContent: z.boolean(),
  permitsLikeness: z.boolean(),
  notes: z.string().trim().min(10, "Record what you checked and where (links, dates)").max(4000),
});

/**
 * Record the creator's verification of a provider's terms. Adult/likeness flags can only be
 * enabled when the adapter itself declares the capability AND the creator confirms the terms.
 */
export async function recordPolicyVerification(actor: Actor, input: z.input<typeof policySchema>) {
  const data = policySchema.parse(input);
  const row = await getIntegrationForActor(actor, data.integrationId, "manage");
  const caps = getGenerator(row.providerKey)?.capabilities ?? { allowsAdultContent: getDestination(row.providerKey)?.allowsAdultContent ?? false, allowsLikeness: false };
  if (data.permitsAdultContent && !caps.allowsAdultContent) throw new AppError("POLICY_BLOCKED", "This adapter does not declare adult-content support, so it cannot be enabled for the restricted workspace.");
  if (data.permitsLikeness && !caps.allowsLikeness) throw new AppError("POLICY_BLOCKED", "This adapter does not support authorized-likeness workflows.");
  const updated = await db.platformIntegration.update({
    where: { id: row.id },
    data: { policyVerifiedAt: new Date(), policyNotes: data.notes, allowsAdultContent: data.permitsAdultContent, allowsLikeness: data.permitsLikeness },
  });
  await audit({ userId: actor.userId, workspaceId: row.workspaceId, action: "integration.policy_verified", entityType: "PlatformIntegration", entityId: row.id, ip: actor.ip, metadata: { permitsAdultContent: data.permitsAdultContent, permitsLikeness: data.permitsLikeness } });
  return view(updated);
}

export async function runHealthCheck(actor: Actor, integrationId: string) {
  const row = await getIntegrationForActor(actor, integrationId, "manage");
  const dest = getDestination(row.providerKey);
  const gen = getGenerator(row.providerKey);
  let result = { ok: false, message: "No adapter installed for this provider." };
  try {
    if (dest) result = await dest.healthCheck(readCredentials(row));
    else if (gen) result = gen.isSimulated ? { ok: true, message: "Simulated provider is available." } : row.credentialsEnc ? { ok: true, message: "Credentials stored. The first job will confirm access." } : { ok: false, message: "No credentials saved." };
  } catch (err) {
    result = { ok: false, message: `Health check failed: ${(err as Error).message}`.slice(0, 300) };
  }
  const updated = await db.platformIntegration.update({
    where: { id: row.id },
    data: { lastHealthCheckAt: new Date(), lastHealthOk: result.ok, status: result.ok ? "OPERATIONAL" : "UNAVAILABLE" },
  });
  await audit({ userId: actor.userId, workspaceId: row.workspaceId, action: "integration.health_check", entityType: "PlatformIntegration", entityId: row.id, outcome: result.ok ? "OK" : "FAILED", ip: actor.ip, metadata: { message: result.message } });
  return { ...result, integration: view(updated) };
}

export async function disconnectIntegration(actor: Actor, integrationId: string) {
  const row = await getIntegrationForActor(actor, integrationId, "manage");
  const updated = await db.platformIntegration.update({
    where: { id: row.id },
    data: { credentialsEnc: null, credentialHint: null, status: "DISCONNECTED", lastHealthOk: null, policyVerifiedAt: null, allowsAdultContent: false, allowsLikeness: false, firstPublishConfirmedAt: null },
  });
  await db.publishingSchedule.updateMany({ where: { integrationId: row.id, status: "QUEUED" }, data: { status: "CANCELED", lastError: "Destination disconnected" } });
  await audit({ userId: actor.userId, workspaceId: row.workspaceId, action: "integration.disconnected", entityType: "PlatformIntegration", entityId: row.id, ip: actor.ip });
  return view(updated);
}

export async function reconnectBuiltin(actor: Actor, integrationId: string) {
  const row = await getIntegrationForActor(actor, integrationId, "manage");
  if (row.credentialsEnc || !(row.isSimulated || row.providerKey === "manual")) throw new AppError("VALIDATION", "Use “Save credentials” for this provider.");
  return runHealthCheck(actor, integrationId);
}
