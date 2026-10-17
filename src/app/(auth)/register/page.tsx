import type { Metadata } from "next";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { Notice } from "@/components/ui/misc";
import { RegisterForm } from "../auth-forms";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const first = (await db.user.count()) === 0;
  const open = first || env().ALLOW_REGISTRATION === "true";
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-white">Create account</h1>
      <p className="mb-6 text-sm text-ink-300">{first ? "The first account becomes the owner of both workspaces." : "New accounts get access only after the owner adds them to a workspace."}</p>
      {open ? <RegisterForm /> : <Notice tone="warn" title="Registration is closed">Ask the owner for access.</Notice>}
    </>
  );
}
