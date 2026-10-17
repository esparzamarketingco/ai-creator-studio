"use client";
import { useActionState, useEffect, useRef } from "react";
import { addIdeaAction, createExperimentAction, importCsvAction } from "@/app/actions/analytics";
import { Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/ui/form-message";

function useResetOnSuccess(ok: boolean | undefined) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (ok) ref.current?.reset(); }, [ok]);
  return ref;
}

export function CsvImport({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(importCsvAction, null);
  const ref = useResetOnSuccess(state?.ok);
  return (
    <form ref={ref} action={action} className="space-y-3" encType="multipart/form-data">
      <FormMessage state={state && state.ok ? { ok: true, message: `Imported ${(state.data as { rows: number })?.rows ?? 0} day(s) from ${(state.data as { source: string })?.source ?? "file"}.` } : state} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Input name="file" type="file" accept=".csv,text/csv" label="Import statistics CSV" required />
      <p className="text-[11px] leading-relaxed text-ink-400">Needs a <code>date</code> column (YYYY-MM-DD) plus any of: profile_visits, clicks, impressions, new_subscribers, active_subscribers, churned_subscribers, free_to_paid, revenue (USD), engagements, ad_spend (USD).</p>
      <SubmitButton size="sm" pendingLabel="Importing…">Import</SubmitButton>
    </form>
  );
}

export function ExperimentForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(createExperimentAction, null);
  const ref = useResetOnSuccess(state?.ok);
  return (
    <details className="rounded-xl border border-dashed border-ink-600 p-3">
      <summary className="cursor-pointer text-sm text-ink-200">New experiment</summary>
      <form ref={ref} action={action} className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><FormMessage state={state} /></div>
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <Input name="name" label="Name" required />
        <Select name="variable" label="Variable"><option value="CAPTION">Caption</option><option value="THUMBNAIL">Thumbnail</option><option value="POSTING_TIME">Posting time</option></Select>
        <Input name="variantA" label="Variant A" required />
        <Input name="variantB" label="Variant B" required />
        <Input name="metric" label="Success metric" defaultValue="Conversion rate" required />
        <Textarea name="hypothesis" label="Hypothesis" required className="sm:col-span-2" />
        <div className="sm:col-span-2"><SubmitButton size="sm" pendingLabel="Saving…">Create</SubmitButton></div>
      </form>
    </details>
  );
}

export function IdeaForm({ workspaceId }: { workspaceId: string }) {
  const [state, action] = useActionState(addIdeaAction, null);
  const ref = useResetOnSuccess(state?.ok);
  return (
    <form ref={ref} action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Input name="title" label="New idea" required className="min-w-0 flex-1" />
      <Input name="notes" label="Notes" className="min-w-0 flex-1" />
      <SubmitButton size="md" variant="secondary" pendingLabel="Adding…">Add</SubmitButton>
      {state && !state.ok && <p role="alert" className="w-full text-xs text-red-300">{state.error}</p>}
    </form>
  );
}
