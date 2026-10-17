import "server-only";
import { cookies } from "next/headers";
import { listAccessibleWorkspaces } from "./permissions";
import type { Actor } from "./auth/actor";

export const WORKSPACE_COOKIE = "acs_ws";

/** The workspace selected in the switcher (falls back to the first unlocked one). */
export async function currentWorkspace(actor: Actor) {
  const all = await listAccessibleWorkspaces(actor);
  const wanted = (await cookies()).get(WORKSPACE_COOKIE)?.value;
  const usable = all.filter((w) => !w.locked);
  const current = usable.find((w) => w.id === wanted) ?? usable[0] ?? null;
  return { current, all };
}
