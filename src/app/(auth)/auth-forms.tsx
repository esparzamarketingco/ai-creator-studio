"use client";
import Link from "next/link";
import { useActionState } from "react";
import { forgotPasswordAction, loginAction, mfaAction, registerAction, resetPasswordAction } from "@/app/actions/auth";
import { Checkbox, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/ui/form-message";

export function LoginForm() {
  const [state, action] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Input name="email" type="email" label="Email" autoComplete="email" required />
      <Input name="password" type="password" label="Password" autoComplete="current-password" required />
      <SubmitButton className="w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
      <div className="flex justify-between text-xs text-ink-300">
        <Link href="/forgot-password" className="hover:text-white">Forgot password?</Link>
        <Link href="/register" className="hover:text-white">Create account</Link>
      </div>
    </form>
  );
}

export function MfaForm() {
  const [state, action] = useActionState(mfaAction, null);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Input name="code" label="6-digit code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus />
      <SubmitButton className="w-full" pendingLabel="Verifying…">Verify</SubmitButton>
    </form>
  );
}

export function RegisterForm() {
  const [state, action] = useActionState(registerAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Input name="name" label="Your name" autoComplete="name" required errors={fe?.name} />
      <Input name="email" type="email" label="Email" autoComplete="email" required errors={fe?.email} />
      <Input name="password" type="password" label="Password" hint="12+ chars, mixed case and a number" autoComplete="new-password" required errors={fe?.password} />
      <Checkbox name="confirmAdult" label="I confirm I am at least 18 years old and will only use likenesses I am authorized to use." errors={fe?.confirmAdult} required />
      <SubmitButton className="w-full" pendingLabel="Creating account…">Create account</SubmitButton>
      <p className="text-center text-xs text-ink-300">
        Already have an account? <Link href="/login" className="text-white hover:underline">Sign in</Link>
      </p>
    </form>
  );
}

export function ForgotForm() {
  const [state, action] = useActionState(forgotPasswordAction, null);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Input name="email" type="email" label="Email" autoComplete="email" required />
      <SubmitButton className="w-full" pendingLabel="Sending…">Send reset link</SubmitButton>
      <p className="text-center text-xs text-ink-300"><Link href="/login" className="hover:text-white">Back to sign in</Link></p>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const [state, action] = useActionState(resetPasswordAction, null);
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="token" value={token} />
      <Input name="password" type="password" label="New password" autoComplete="new-password" required errors={fe?._} />
      <Input name="confirm" type="password" label="Confirm new password" autoComplete="new-password" required />
      <SubmitButton className="w-full" pendingLabel="Saving…">Set new password</SubmitButton>
    </form>
  );
}
