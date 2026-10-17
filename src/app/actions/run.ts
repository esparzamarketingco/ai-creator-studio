import "server-only";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/auth/context";
import { toActionError, type ActionResult } from "@/server/errors";
import type { Actor } from "@/server/auth/actor";

/**
 * Wrap a server action: authenticate, run, revalidate, and convert errors into a user-safe
 * result. Unknown errors are logged server-side and never leaked to the browser.
 */
export async function run<T>(fn: (actor: Actor) => Promise<T>, opts: { revalidate?: string[]; message?: string } = {}): Promise<ActionResult<T>> {
  const actor = await requireActor();
  try {
    const data = await fn(actor);
    for (const p of opts.revalidate ?? ["/", "layout"]) {
      if (p === "layout") revalidatePath("/", "layout");
      else revalidatePath(p);
    }
    return { ok: true, data, message: opts.message };
  } catch (err) {
    return toActionError(err);
  }
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
export const optStr = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return v === null || v === "" ? undefined : String(v);
};
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
export const list = (fd: FormData, k: string) =>
  str(fd, k).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
export async function fileBuffer(fd: FormData, k: string): Promise<Buffer | null> {
  const f = fd.get(k);
  if (!f || typeof f === "string" || f.size === 0) return null;
  return Buffer.from(await f.arrayBuffer());
}
