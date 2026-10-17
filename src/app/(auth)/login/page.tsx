import type { Metadata } from "next";
import { Notice } from "@/components/ui/misc";
import { LoginForm } from "../auth-forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-white">Sign in</h1>
      <p className="mb-6 text-sm text-ink-300">Your private production dashboard.</p>
      {sp.reset && <Notice tone="success" className="mb-4">Password updated. Sign in with your new password.</Notice>}
      <LoginForm />
    </>
  );
}
