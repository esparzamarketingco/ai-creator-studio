"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { attestAdultAction, beginTotpAction, changePasswordAction, confirmTotpAction, deleteAccountAction, disableTotpAction } from "@/app/actions/settings";
import { Checkbox, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/ui/form-message";
import { Notice } from "@/components/ui/misc";

export function PasswordForm() {
  const [state, action] = useActionState(changePasswordAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <FormMessage state={state} />
      <Input name="current" type="password" label="Current password" autoComplete="current-password" required />
      <Input name="next" type="password" label="New password" autoComplete="new-password" required errors={state && !state.ok ? state.fieldErrors?._ : undefined} />
      <Input name="confirm" type="password" label="Confirm new password" autoComplete="new-password" required />
      <SubmitButton variant="secondary" pendingLabel="Saving…">Change password</SubmitButton>
    </form>
  );
}

export function TotpSection({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [confirmState, confirm] = useActionState(confirmTotpAction, null);
  const [disableState, disable] = useActionState(disableTotpAction, null);
  if (enabled) {
    return (
      <form action={disable} className="space-y-3">
        <Notice tone="success">Two-factor authentication is on.</Notice>
        <FormMessage state={disableState} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input name="password" type="password" label="Password" required />
          <Input name="code" label="Current code" inputMode="numeric" required />
        </div>
        <SubmitButton variant="danger" pendingLabel="Turning off…">Turn off 2FA</SubmitButton>
      </form>
    );
  }
  if (!setup) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink-300">Strongly recommended: your account controls your likeness and publishing.</p>
        {err && <Notice tone="danger">{err}</Notice>}
        <Button variant="secondary" disabled={pending} onClick={() => start(async () => { const r = await beginTotpAction(); if (r.ok && r.data) setSetup(r.data); else if (!r.ok) setErr(r.error); })}>{pending ? "Preparing…" : "Set up 2FA"}</Button>
      </div>
    );
  }
  return (
    <form action={confirm} className="space-y-3">
      <FormMessage state={confirmState} />
      <p className="text-sm text-ink-300">Add this key to your authenticator app (manual entry), then enter the 6-digit code.</p>
      <code className="block break-all rounded-lg border border-ink-700 bg-ink-850 p-3 font-mono text-sm tracking-wider text-gold-300">{setup.secret}</code>
      <details className="text-xs text-ink-400"><summary className="cursor-pointer">otpauth URI</summary><code className="break-all">{setup.uri}</code></details>
      <Input name="code" label="Code" inputMode="numeric" autoComplete="one-time-code" required />
      <SubmitButton pendingLabel="Verifying…">Turn on 2FA</SubmitButton>
    </form>
  );
}

export function AdultAccessForm() {
  const [state, action] = useActionState(attestAdultAction, null);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <Checkbox name="confirm" required label="I am at least 18, I am authorized to manage this restricted workspace, and I will only create lawful content of adults whose likeness I am authorized to use." />
      <Input name="password" type="password" label="Re-enter your password" autoComplete="current-password" required />
      <SubmitButton variant="secondary" pendingLabel="Confirming…">Unlock restricted workspace</SubmitButton>
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action] = useActionState(deleteAccountAction, null);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state ?? null} />
      <Input name="password" type="password" label="Password" required />
      <Input name="confirmation" label='Type "DELETE MY ACCOUNT"' required autoComplete="off" />
      <SubmitButton variant="danger" pendingLabel="Deleting…">Delete my account permanently</SubmitButton>
    </form>
  );
}
