"use client";
import { useActionState, useEffect, useRef } from "react";
import { policyAction, saveCredentialsAction } from "@/app/actions/settings";
import { Checkbox, Input, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/ui/form-message";

export function CredentialsForm({ workspaceId, providerKey }: { workspaceId: string; providerKey: string }) {
  const [state, action] = useActionState(saveCredentialsAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="providerKey" value={providerKey} />
      <Input name="apiKey" type="password" label="API key" autoComplete="off" required className="min-w-0 flex-1" />
      <SubmitButton variant="secondary" pendingLabel="Encrypting…">Save credentials</SubmitButton>
      <div className="w-full"><FormMessage state={state} /></div>
    </form>
  );
}

export function PolicyForm({ integrationId }: { integrationId: string }) {
  const [state, action] = useActionState(policyAction, null);
  const e = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <input type="hidden" name="integrationId" value={integrationId} />
      <Checkbox name="reviewedApiDocs" label="I reviewed the provider’s current API documentation." errors={e?.reviewedApiDocs} />
      <Checkbox name="reviewedContentPolicy" label="I reviewed its content / acceptable-use policy." errors={e?.reviewedContentPolicy} />
      <Checkbox name="commercialUseAllowed" label="Its terms permit commercial use of outputs." errors={e?.commercialUseAllowed} />
      <Checkbox name="reviewedPricing" label="I reviewed its pricing." errors={e?.reviewedPricing} />
      <Checkbox name="permitsLikeness" label="Its terms permit authorized-likeness (reference face) workflows." />
      <Checkbox name="permitsAdultContent" label="Its terms explicitly permit adult content (enables the restricted workspace)." />
      <Textarea name="notes" label="What you checked" placeholder="Links to the terms pages and the dates you read them" errors={e?.notes} required />
      <SubmitButton variant="secondary" pendingLabel="Saving…">Record verification</SubmitButton>
    </form>
  );
}
