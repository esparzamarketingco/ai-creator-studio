"use client";
import { useActionState, useCallback, useState } from "react";
import { decideAction } from "@/app/actions/content";
import { MediaPreview } from "@/components/media-preview";
import { Checkbox, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { useFormStatus } from "react-dom";

function DecisionButtons({ canApprove, previewCompleted, confirmed }: { canApprove: boolean; previewCompleted: boolean; confirmed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="submit" name="decision" value="APPROVED" variant="success" disabled={!canApprove || !previewCompleted || !confirmed || pending}
        title={!previewCompleted ? "Watch the complete preview first" : !confirmed ? "Tick the confirmation" : undefined}>
        Approve this version
      </Button>
      <Button type="submit" name="decision" value="REVISIONS_REQUESTED" variant="secondary" disabled={!canApprove || pending}>Request revisions</Button>
      <Button type="submit" name="decision" value="REJECTED" variant="danger" disabled={!canApprove || pending}>Reject</Button>
    </div>
  );
}

export function DecisionForm({ versionId, mimeType, isSimulated, canApprove, currentState }: { versionId: string; mimeType: string; isSimulated: boolean; canApprove: boolean; currentState: string | null }) {
  const [state, action] = useActionState(decideAction, null);
  const [complete, setComplete] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const onComplete = useCallback(() => setComplete(true), []);
  return (
    <form action={action} className="space-y-4">
      <MediaPreview versionId={versionId} mimeType={mimeType} isSimulated={isSimulated} onComplete={onComplete} className="aspect-[9/16] max-h-[70vh] w-full sm:aspect-auto sm:h-[60vh]" />
      <p className="text-xs text-ink-400" aria-live="polite">{complete ? "✓ Full preview viewed." : mimeType.startsWith("video/") ? "Play the video to the end to enable approval." : "Review the full image to enable approval."}</p>
      <FormMessage state={state} />
      <input type="hidden" name="assetVersionId" value={versionId} />
      <input type="hidden" name="previewCompleted" value={complete ? "true" : "false"} />
      <Textarea name="notes" label="Notes" hint="(required context for revisions helps regeneration)" placeholder="What should change, or why it is approved" />
      {currentState === "APPROVED" && <p className="text-xs text-emerald-300">This version is currently approved.</p>}
      <Checkbox name="confirm" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)}
        label={<>I personally reviewed this exact version{isSimulated ? " (simulated placeholder)" : ""} and approve it for publication. Any later change to the file will void this approval.</>} />
      {!canApprove && <p className="text-xs text-amber-300">Your role cannot approve in this workspace.</p>}
      <DecisionButtons canApprove={canApprove} previewCompleted={complete} confirmed={confirmed} />
    </form>
  );
}

export function CompareVersions({ versions }: { versions: { id: string; versionNumber: number; mimeType: string; isSimulated: boolean; sha256: string }[] }) {
  const [a, setA] = useState(versions[1]?.id ?? versions[0].id);
  const [b, setB] = useState(versions[0].id);
  const va = versions.find((v) => v.id === a)!;
  const vb = versions.find((v) => v.id === b)!;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[{ v: va, set: setA, val: a, label: "Left" }, { v: vb, set: setB, val: b, label: "Right" }].map(({ v, set, val, label }) => (
        <div key={label} className="space-y-2">
          <Select label={`${label} version`} value={val} onChange={(e) => set(e.target.value)}>
            {versions.map((x) => <option key={x.id} value={x.id}>v{x.versionNumber}{x.isSimulated ? " (simulated)" : ""}</option>)}
          </Select>
          <MediaPreview versionId={v.id} mimeType={v.mimeType} isSimulated={v.isSimulated} className="aspect-video" />
          <code className="block truncate font-mono text-[11px] text-ink-400">{v.sha256}</code>
        </div>
      ))}
    </div>
  );
}
