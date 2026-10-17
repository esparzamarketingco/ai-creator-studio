"use client";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { saveConceptAction, savePromptAction, submitGenerationAction, uploadAssetAction } from "@/app/actions/content";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/ui/form-message";
import { Notice } from "@/components/ui/misc";

type ConceptValues = Partial<{
  id: string; title: string; description: string; audience: string; category: string; intensityLevel: string; characterId: string | null;
  scene: string; location: string; wardrobe: string; lighting: string; camera: string; visualStyle: string; durationSec: number;
  aspectRatio: string; resolution: string; continuityRules: string; caption: string; hashtags: string; callToAction: string; tags: string;
  plannedDate: string | null; plannedTime: string | null; timezone: string;
}>;

const RESOLUTIONS: Record<string, string[]> = {
  "9:16": ["1080x1920", "720x1280", "2160x3840"],
  "16:9": ["1920x1080", "1280x720", "3840x2160"],
  "1:1": ["1080x1080"],
  "4:5": ["1080x1350"],
};

export function ConceptForm({ workspace, characters, timezones, concept }: {
  workspace: { id: string; categories: string[]; intensityLevels: string[]; timezone: string; kind: string };
  characters: { id: string; name: string; usesLikeness: boolean }[];
  timezones: string[];
  concept: ConceptValues;
}) {
  const [state, action] = useActionState(saveConceptAction, null);
  const router = useRouter();
  const [aspect, setAspect] = useState(concept.aspectRatio ?? "9:16");
  const fe = state && !state.ok ? state.fieldErrors : undefined;
  useEffect(() => {
    if (state?.ok && !concept.id && state.data && typeof state.data === "object" && "id" in state.data) router.push(`/studio?concept=${(state.data as { id: string }).id}`);
  }, [state, concept.id, router]);
  return (
    <form action={action} className="space-y-6">
      <FormMessage state={state} />
      <input type="hidden" name="workspaceId" value={workspace.id} />
      {concept.id && <input type="hidden" name="id" value={concept.id} />}
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Concept</legend>
        <Input name="title" label="Title" defaultValue={concept.title} required maxLength={140} errors={fe?.title} className="sm:col-span-2" />
        <Textarea name="description" label="Description" defaultValue={concept.description} className="sm:col-span-2" />
        <Input name="audience" label="Intended audience" defaultValue={concept.audience ?? "Adults 18+ (U.S.)"} />
        <Select name="category" label="Content category" defaultValue={concept.category ?? ""} errors={fe?.category}>
          <option value="">—</option>
          {workspace.categories.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Select name="intensityLevel" label="Intensity level" hint="(set per workspace)" defaultValue={concept.intensityLevel ?? ""}>
          <option value="">—</option>
          {workspace.intensityLevels.map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Select name="characterId" label="Character profile" defaultValue={concept.characterId ?? ""}>
          <option value="">No character (generic adult man, 21+)</option>
          {characters.map((c) => <option key={c.id} value={c.id}>{c.name}{c.usesLikeness ? " · uses my authorized face" : " · fictional"}</option>)}
        </Select>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Creative direction</legend>
        <Textarea name="scene" label="Scene" defaultValue={concept.scene} className="sm:col-span-2" placeholder="What happens, mood, action" />
        <Input name="location" label="Location / setting" defaultValue={concept.location} placeholder="Rooftop gym at sunrise" />
        <Input name="wardrobe" label="Wardrobe" defaultValue={concept.wardrobe} />
        <Input name="lighting" label="Lighting" defaultValue={concept.lighting} placeholder="Warm golden hour, soft rim light" />
        <Input name="camera" label="Camera direction" defaultValue={concept.camera} placeholder="Slow dolly-in, 35mm, eye level" />
        <Input name="visualStyle" label="Visual style" defaultValue={concept.visualStyle} className="sm:col-span-2" />
        <Textarea name="continuityRules" label="Continuity rules" hint="(face, tattoos, hair…)" defaultValue={concept.continuityRules} className="sm:col-span-2" />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Format</legend>
        <Input name="durationSec" type="number" min={3} max={600} label="Duration (seconds)" defaultValue={concept.durationSec ?? 15} />
        <Select name="aspectRatio" label="Aspect ratio" value={aspect} onChange={(e) => setAspect(e.target.value)}>
          {Object.keys(RESOLUTIONS).map((a) => <option key={a}>{a}</option>)}
        </Select>
        <Select name="resolution" label="Resolution" key={aspect} defaultValue={RESOLUTIONS[aspect].includes(concept.resolution ?? "") ? concept.resolution : RESOLUTIONS[aspect][0]}>
          {RESOLUTIONS[aspect].map((r) => <option key={r}>{r}</option>)}
        </Select>
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Post</legend>
        <Textarea name="caption" label="Caption" defaultValue={concept.caption} className="sm:col-span-2" maxLength={2200} />
        <Input name="hashtags" label="Hashtags" hint="(comma separated)" defaultValue={concept.hashtags} />
        <Input name="callToAction" label="Call to action" defaultValue={concept.callToAction} />
        <Input name="tags" label="Library tags" hint="(comma separated)" defaultValue={concept.tags} className="sm:col-span-2" />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Calendar slot</legend>
        <Input name="plannedDate" type="date" label="Planned date" defaultValue={concept.plannedDate ?? ""} />
        <Input name="plannedTime" type="time" label="Publish time" defaultValue={concept.plannedTime ?? ""} />
        <Select name="timezone" label="Time zone" defaultValue={concept.timezone ?? workspace.timezone}>
          {timezones.map((t) => <option key={t}>{t}</option>)}
        </Select>
      </fieldset>
      <div className="flex justify-end"><SubmitButton pendingLabel="Saving…">{concept.id ? "Save concept" : "Create concept"}</SubmitButton></div>
    </form>
  );
}

type PromptVersion = { id: string; version: number; positivePrompt: string; negativePrompt: string; providerKey: string; createdAt: string };

export function PromptBuilder({ conceptId, built, providers, versions }: {
  conceptId: string; built: { positivePrompt: string; negativePrompt: string }; providers: { key: string; name: string }[]; versions: PromptVersion[];
}) {
  const [state, action] = useActionState(savePromptAction, null);
  const latest = versions[0];
  const [positive, setPositive] = useState(latest?.positivePrompt ?? built.positivePrompt);
  const [negative, setNegative] = useState(latest ? latest.negativePrompt.replace(built.negativePrompt, "").replace(/^,\s*/, "") : "");
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="conceptId" value={conceptId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select name="providerKey" label="Target provider" defaultValue={latest?.providerKey ?? providers[0]?.key ?? "manual"}>
          {providers.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          <option value="manual">Generic (copy to any provider)</option>
        </Select>
        <div className="flex items-end gap-2">
          <button type="button" onClick={() => setPositive(built.positivePrompt)} className="h-10 rounded-lg border border-ink-600 px-3 text-sm text-ink-200 hover:bg-ink-800">Rebuild from concept</button>
          <button type="button" onClick={() => navigator.clipboard?.writeText(`${positive}\n\nNegative: ${built.negativePrompt}${negative ? `, ${negative}` : ""}`)} className="h-10 rounded-lg border border-ink-600 px-3 text-sm text-ink-200 hover:bg-ink-800">Copy</button>
        </div>
      </div>
      <Textarea name="positivePrompt" label="Prompt" rows={10} value={positive} onChange={(e) => setPositive(e.target.value)} className="font-mono" />
      <div>
        <div className="mb-1.5 text-xs font-medium text-ink-200">Mandatory negative prompt <span className="font-normal text-ink-400">(always sent; cannot be removed)</span></div>
        <p className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 font-mono text-xs text-ink-300">{built.negativePrompt}</p>
      </div>
      <Input name="negativePrompt" label="Additional negative terms" value={negative} onChange={(e) => setNegative(e.target.value)} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-ink-400">{versions.length ? `Latest: v${latest.version} · ${new Date(latest.createdAt).toLocaleString()}` : "No saved versions yet"}</span>
        <SubmitButton pendingLabel="Saving…">Save prompt version</SubmitButton>
      </div>
      {versions.length > 1 && (
        <details className="rounded-lg border border-ink-700 px-3 py-2 text-sm">
          <summary className="cursor-pointer text-ink-300">Version history ({versions.length})</summary>
          <ul className="mt-2 space-y-2">
            {versions.map((v) => (
              <li key={v.id} className="rounded border border-ink-800 p-2">
                <div className="mb-1 flex items-center justify-between text-xs text-ink-400"><span>v{v.version} · {v.providerKey}</span>
                  <button type="button" className="text-gold-300 hover:underline" onClick={() => setPositive(v.positivePrompt)}>Load</button></div>
                <pre className="max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-ink-300">{v.positivePrompt}</pre>
              </li>
            ))}
          </ul>
        </details>
      )}
    </form>
  );
}

export function GeneratePanel({ conceptId, prompts, providers }: {
  conceptId: string; prompts: { id: string; version: number }[]; providers: { key: string; name: string; kinds: string[]; simulated: boolean; blockedReason: string | null }[];
}) {
  const [state, action] = useActionState(submitGenerationAction, null);
  const usable = providers.filter((p) => !p.blockedReason);
  const [providerKey, setProviderKey] = useState(usable[0]?.key ?? "");
  const provider = providers.find((p) => p.key === providerKey);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <input type="hidden" name="conceptId" value={conceptId} />
      {usable.length === 0 && <Notice tone="warn">No usable generation provider for this workspace. Upload media manually below, or connect a provider in Settings → Integrations.</Notice>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Select name="promptId" label="Prompt version">{prompts.map((p) => <option key={p.id} value={p.id}>v{p.version}</option>)}</Select>
        <Select name="providerKey" label="Provider" value={providerKey} onChange={(e) => setProviderKey(e.target.value)}>
          {providers.map((p) => <option key={p.key} value={p.key} disabled={Boolean(p.blockedReason)}>{p.name}{p.blockedReason ? ` — ${p.blockedReason}` : ""}</option>)}
        </Select>
        <Select name="kind" label="Output" key={providerKey}>
          {(provider?.kinds ?? ["VIDEO"]).map((k) => <option key={k} value={k}>{k === "VIDEO" ? "Final video" : k === "THUMBNAIL" ? "Thumbnail" : "Image"}</option>)}
        </Select>
      </div>
      {provider?.simulated && <Notice tone="warn">This is a mock provider. It produces a labeled SIMULATED placeholder image, not a real video, and simulated media can never be published to a real destination.</Notice>}
      <Checkbox name="regenerate" label="Regenerate (request a fresh output even if this prompt already succeeded)" />
      <div className="flex justify-end"><SubmitButton disabled={!usable.length} pendingLabel="Submitting…">Submit generation job</SubmitButton></div>
    </form>
  );
}

export function UploadPanel({ workspaceId, conceptId, title, assets }: { workspaceId: string; conceptId: string; title: string; assets: { id: string; kind: string; title: string }[] }) {
  const [state, action] = useActionState(uploadAssetAction, null);
  const [kind, setKind] = useState("VIDEO");
  const existing = assets.filter((a) => a.kind === kind);
  return (
    <form action={action} className="space-y-4" encType="multipart/form-data">
      <FormMessage state={state} />
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="conceptId" value={conceptId} />
      <input type="hidden" name="title" value={kind === "THUMBNAIL" ? `${title} — thumbnail` : title} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Select name="kind" label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="VIDEO">Final video (MP4 / MOV / WebM)</option>
          <option value="THUMBNAIL">Thumbnail (JPEG / PNG / WebP)</option>
        </Select>
        <Select name="assetId" label="Add as" key={kind}>
          {existing.map((a) => <option key={a.id} value={a.id}>New version of “{a.title}”</option>)}
          <option value="">New asset</option>
        </Select>
        <Input name="file" type="file" label="File" accept={kind === "VIDEO" ? "video/mp4,video/quicktime,video/webm" : "image/jpeg,image/png,image/webp"} required />
      </div>
      <p className="text-xs text-ink-400">Uploading a new version invalidates any approval of the previous version and removes it from the publishing queue.</p>
      <div className="flex justify-end"><SubmitButton pendingLabel="Uploading…">Upload</SubmitButton></div>
    </form>
  );
}
