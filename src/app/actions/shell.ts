"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/auth/context";
import { WORKSPACE_COOKIE } from "@/server/current-workspace";
import { requireWorkspace } from "@/server/permissions";
import { markNotificationsRead } from "@/server/services/notifications";
import { toActionError, type ActionResult } from "@/server/errors";

export async function switchWorkspaceAction(workspaceId: string): Promise<ActionResult> {
  const actor = await requireActor();
  try {
    await requireWorkspace(actor, workspaceId, "view");
    (await cookies()).set(WORKSPACE_COOKIE, workspaceId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function markReadAction(ids?: string[]) {
  const actor = await requireActor();
  await markNotificationsRead(actor, ids);
  revalidatePath("/", "layout");
}
