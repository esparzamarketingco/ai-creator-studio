import type { ActionResult } from "@/server/errors";
import { Notice } from "./misc";

export function FormMessage({ state }: { state: ActionResult<unknown> | null | undefined }) {
  if (!state) return null;
  if (state.ok) return state.message ? <Notice tone="success">{state.message}</Notice> : null;
  return <Notice tone="danger">{state.error}</Notice>;
}
