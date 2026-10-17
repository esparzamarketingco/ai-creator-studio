import type { Metadata } from "next";
import Link from "next/link";
import { Notice } from "@/components/ui/misc";
import { ResetForm } from "../auth-forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-white">Choose a new password</h1>
      <p className="mb-6 text-sm text-ink-300">All other sessions will be signed out.</p>
      {token ? <ResetForm token={token} /> : <Notice tone="danger">This link is missing its token. <Link className="underline" href="/forgot-password">Request a new one</Link>.</Notice>}
    </>
  );
}
