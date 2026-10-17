import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { SESSION_COOKIE, validateSessionToken } from "./sessions";
import type { Actor } from "./actor";

export const getSession = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return validateSessionToken(token);
});

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/** For pages/actions: require a fully authenticated (MFA-complete) session or redirect to /login. */
export async function requireActor(): Promise<Actor & { user: NonNullable<Awaited<ReturnType<typeof getSession>>>["user"] }> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.mfaPending) redirect("/login/mfa");
  return { userId: session.userId, role: session.user.role, sessionId: session.id, ip: await clientIp(), user: session.user };
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}
