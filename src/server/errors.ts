export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "POLICY_BLOCKED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_INVALID"
  | "ASSET_CHANGED"
  | "INTEGRATION_UNAVAILABLE"
  | "INVALID_SCHEDULE"
  | "CONFIRMATION_REQUIRED";

/** An error whose message is safe to show to the signed-in user. */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; code?: ErrorCode; fieldErrors?: Record<string, string[]> };

/** Convert any thrown error into a user-safe result. Unknown errors are logged, not leaked. */
export function toActionError(err: unknown): { ok: false; error: string; code?: ErrorCode; fieldErrors?: Record<string, string[]> } {
  if (err instanceof AppError) return { ok: false, error: err.message, code: err.code };
  if (err && typeof err === "object" && "issues" in err && Array.isArray((err as { issues: unknown[] }).issues)) {
    const issues = (err as { issues: { path: (string | number)[]; message: string }[] }).issues;
    const fieldErrors: Record<string, string[]> = {};
    for (const i of issues) (fieldErrors[i.path.join(".") || "_"] ??= []).push(i.message);
    return { ok: false, error: "Please fix the highlighted fields.", code: "VALIDATION", fieldErrors };
  }
  // Next.js redirect/notFound errors must propagate.
  if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
  console.error("[unexpected error]", err);
  return { ok: false, error: "Something went wrong. The error was logged; please try again." };
}
