import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/context";
import { MfaForm } from "../../auth-forms";

export const metadata: Metadata = { title: "Two-factor verification" };

export default async function MfaPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.mfaPending) redirect("/dashboard");
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-white">Two-factor verification</h1>
      <p className="mb-6 text-sm text-ink-300">Enter the code from your authenticator app.</p>
      <MfaForm />
    </>
  );
}
