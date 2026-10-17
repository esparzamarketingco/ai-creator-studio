"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { toActionError, type ActionResult } from "@/server/errors";
import { completeMfa, login, logout, register, requestPasswordReset, resetPassword, verifyEmail } from "@/server/services/auth";
import { clearSessionCookie, clientIp, getSession, setSessionCookie } from "@/server/auth/context";

async function meta() {
  return { ip: await clientIp(), userAgent: (await headers()).get("user-agent") };
}

export async function loginAction(_: unknown, fd: FormData): Promise<ActionResult> {
  let mfa = false;
  try {
    const r = await login({ email: String(fd.get("email") ?? ""), password: String(fd.get("password") ?? "") }, await meta());
    await setSessionCookie(r.token);
    mfa = r.mfaRequired;
  } catch (err) {
    return toActionError(err);
  }
  redirect(mfa ? "/login/mfa" : "/dashboard");
}

export async function mfaAction(_: unknown, fd: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!session) redirect("/login");
  try {
    await completeMfa(session.id, String(fd.get("code") ?? ""), await meta());
  } catch (err) {
    return toActionError(err);
  }
  redirect("/dashboard");
}

export async function registerAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    await register(
      { name: String(fd.get("name") ?? ""), email: String(fd.get("email") ?? ""), password: String(fd.get("password") ?? ""), confirmAdult: fd.get("confirmAdult") === "on" ? true : (false as unknown as true) },
      await meta(),
    );
    const r = await login({ email: String(fd.get("email")), password: String(fd.get("password")) }, await meta());
    await setSessionCookie(r.token);
  } catch (err) {
    return toActionError(err);
  }
  redirect("/dashboard");
}

export async function forgotPasswordAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    await requestPasswordReset(String(fd.get("email") ?? ""), await meta());
    return { ok: true, message: "If an account exists for that email, a reset link has been sent. (Without SMTP configured, the link is written to the server log.)" };
  } catch (err) {
    return toActionError(err);
  }
}

export async function resetPasswordAction(_: unknown, fd: FormData): Promise<ActionResult> {
  try {
    if (fd.get("password") !== fd.get("confirm")) return { ok: false, error: "The passwords do not match." };
    await resetPassword(String(fd.get("token") ?? ""), String(fd.get("password") ?? ""), await meta());
  } catch (err) {
    return toActionError(err);
  }
  redirect("/login?reset=1");
}

export async function verifyEmailAction(token: string): Promise<ActionResult> {
  try {
    await verifyEmail(token);
    return { ok: true, message: "Email verified." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function logoutAction() {
  const s = await getSession();
  if (s) await logout(s.id);
  await clearSessionCookie();
  redirect("/login");
}
