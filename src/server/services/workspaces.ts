import { z } from "zod";
import { db } from "../db";
import { audit } from "../audit";
import { requireWorkspace } from "../permissions";
import { isUsTimezone } from "../time";
import type { Actor } from "../auth/actor";

export const workspaceSettingsSchema = z.object({
  disclosureText: z.string().trim().min(10, "Keep a clear AI disclosure (at least 10 characters)").max(500),
  defaultTimezone: z.string().refine(isUsTimezone, "Choose a U.S. time zone"),
  categories: z.array(z.string().trim().min(1).max(60)).min(1, "At least one category").max(30),
  intensityLevels: z.array(z.string().trim().min(1).max(60)).min(1, "At least one level").max(10),
  exportSettings: z.object({
    defaultAspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]),
    defaultResolution: z.string().regex(/^\d{3,4}x\d{3,4}$/),
  }),
});

export async function updateWorkspaceSettings(actor: Actor, workspaceId: string, input: z.input<typeof workspaceSettingsSchema>) {
  await requireWorkspace(actor, workspaceId, "manage");
  const data = workspaceSettingsSchema.parse(input);
  await db.workspace.update({ where: { id: workspaceId }, data });
  await audit({ userId: actor.userId, workspaceId, action: "workspace.settings_updated", entityType: "Workspace", entityId: workspaceId, ip: actor.ip });
}
