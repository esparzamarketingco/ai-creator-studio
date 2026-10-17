import type { Metadata } from "next";
import { ForgotForm } from "../auth-forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold text-white">Reset your password</h1>
      <p className="mb-6 text-sm text-ink-300">We will email you a link that works for one hour.</p>
      <ForgotForm />
    </>
  );
}
