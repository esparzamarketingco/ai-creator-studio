import type { Metadata } from "next";
import Link from "next/link";
import { verifyEmailAction } from "@/app/actions/auth";
import { Notice } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const result = token ? await verifyEmailAction(token) : { ok: false as const, error: "Missing token." };
  return (
    <>
      <h1 className="mb-4 text-lg font-semibold text-white">Email verification</h1>
      <Notice tone={result.ok ? "success" : "danger"}>{result.ok ? "Your email is verified." : result.error}</Notice>
      <p className="mt-6 text-center text-sm"><Link href="/dashboard" className="text-gold-300 hover:underline">Continue</Link></p>
    </>
  );
}
