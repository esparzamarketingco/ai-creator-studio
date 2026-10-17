import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../src/server/db";
import { register } from "../src/server/services/auth";
import { createConcept } from "../src/server/services/concepts";
import { uploadAsset } from "../src/server/services/assets";
import { decide } from "../src/server/services/approvals";
import { ensureBuiltinIntegrations } from "../src/server/services/integrations";
import type { Actor } from "../src/server/auth/actor";

export const PASSWORD = "Correct-Horse-42";

let videoCache: Buffer | null = null;
/** A real, tiny MP4 made with ffmpeg so validation runs on genuine video. */
export function tinyMp4(variant = 0): Buffer {
  if (!videoCache) {
    const dir = mkdtempSync(path.join(tmpdir(), "acs-vid-"));
    const out = path.join(dir, "v.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x112:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", out]);
    videoCache = readFileSync(out);
    rmSync(dir, { recursive: true, force: true });
  }
  // Appending bytes after the moov/mdat keeps the file playable but changes its hash.
  return variant ? Buffer.concat([videoCache, Buffer.from(`free-variant-${variant}`)]) : videoCache;
}

export const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

export async function makeOwner(email = "owner@example.com") {
  const user = await register({ name: "Owner", email, password: PASSWORD, confirmAdult: true });
  const actor: Actor = { userId: user.id, role: user.role };
  const lifestyle = await db.workspace.findUniqueOrThrow({ where: { slug: "lifestyle" } });
  const adult = await db.workspace.findUniqueOrThrow({ where: { slug: "adult" } });
  await ensureBuiltinIntegrations(lifestyle.id);
  await ensureBuiltinIntegrations(adult.id);
  return { user, actor, lifestyle, adult };
}

export async function integration(workspaceId: string, providerKey: string) {
  return db.platformIntegration.findUniqueOrThrow({ where: { workspaceId_providerKey: { workspaceId, providerKey } } });
}

/** Concept + uploaded video version (+ optional approval). */
export async function conceptWithVideo(actor: Actor, workspaceId: string, opts: { approve?: boolean; title?: string } = {}) {
  const concept = await createConcept(actor, { workspaceId, title: opts.title ?? "Sunrise rooftop workout" });
  const { asset, version } = await uploadAsset(actor, { workspaceId, conceptId: concept.id, kind: "VIDEO", title: concept.title }, tinyMp4());
  let approval = null;
  if (opts.approve) approval = await decide(actor, { assetVersionId: version.id, decision: "APPROVED", previewCompleted: true });
  return { concept, asset, version, approval };
}

export function futureSlot(hoursAhead = 48, tz = "America/New_York") {
  const d = new Date(Date.now() + hoursAhead * 3600_000);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}`, timezone: tz };
}
