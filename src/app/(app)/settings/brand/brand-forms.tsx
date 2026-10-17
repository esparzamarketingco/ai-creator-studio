"use client";
import { useActionState, useEffect, useRef } from "react";
import { addLikenessAction, saveCharacterAction, saveProfileAction, saveWorkspaceSettingsAction } from "@/app/actions/settings";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/ui/form-message";

type FE = Record<string, string[]> | undefined;
const fe = (s: unknown): FE => (s && typeof s === "object" && "fieldErrors" in s ? (s as { fieldErrors: FE }).fieldErrors : undefined);

export function ProfileForm({ values: v, hasPhoto, hasBanner }: { values: Record<string, string>; hasPhoto: boolean; hasBanner: boolean }) {
  const [state, action] = useActionState(saveProfileAction, null);
  const e = fe(state);
  return (
    <form action={action} className="space-y-6" encType="multipart/form-data">
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="displayName" label="Display name" defaultValue={v.displayName} errors={e?.displayName} />
        <Input name="username" label="Username" defaultValue={v.username} errors={e?.username} />
        <Textarea name="bio" label="Biography" defaultValue={v.bio} className="sm:col-span-2" />
        <Textarea name="brandVoice" label="Brand voice" defaultValue={v.brandVoice} placeholder="Confident, warm, playful…" />
        <Textarea name="visualIdentity" label="Preferred visual identity" defaultValue={v.visualIdentity} />
        <div>
          <Input name="profilePhoto" type="file" accept="image/jpeg,image/png,image/webp" label="Profile photo" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {hasPhoto && <img src="/api/brand-image/profile" alt="Current profile photo" className="mt-2 size-16 rounded-full object-cover" />}
        </div>
        <div>
          <Input name="banner" type="file" accept="image/jpeg,image/png,image/webp" label="Banner" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {hasBanner && <img src="/api/brand-image/banner" alt="Current banner" className="mt-2 h-16 w-full rounded-lg object-cover" />}
        </div>
      </div>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Appearance (for prompt continuity)</legend>
        <Input name="hairstyle" label="Hairstyle" defaultValue={v.hairstyle} />
        <Input name="facialHair" label="Facial hair" defaultValue={v.facialHair} />
        <Input name="skinTone" label="Skin tone" defaultValue={v.skinTone} />
        <Input name="distinctiveFeatures" label="Distinctive facial characteristics" defaultValue={v.distinctiveFeatures} />
        <Textarea name="physique" label="Body proportions & physique preferences (synthetic character design)" defaultValue={v.physique} className="sm:col-span-2" />
      </fieldset>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Preferences (comma separated)</legend>
        <Input name="preferredEnvironments" label="Environments" defaultValue={v.preferredEnvironments} />
        <Input name="preferredStyles" label="Visual styles" defaultValue={v.preferredStyles} />
        <Input name="preferredLighting" label="Lighting" defaultValue={v.preferredLighting} />
        <Input name="preferredFraming" label="Camera framing" defaultValue={v.preferredFraming} />
      </fieldset>
      <Textarea name="disclosureText" label="AI content disclosure" hint="(shown in every publishing package)" defaultValue={v.disclosureText} errors={e?.disclosureText} required />
      <div className="flex justify-end"><SubmitButton pendingLabel="Saving…">Save profile</SubmitButton></div>
    </form>
  );
}

export function LikenessForm() {
  const [state, action] = useActionState(addLikenessAction, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  const e = fe(state);
  return (
    <form ref={ref} action={action} className="grid gap-4 rounded-xl border border-dashed border-ink-600 p-4 sm:grid-cols-2" encType="multipart/form-data">
      <div className="sm:col-span-2"><FormMessage state={state} /></div>
      <Input name="label" label="Label" placeholder="Front, neutral light" required errors={e?.label} />
      <Input name="file" type="file" accept="image/jpeg,image/png,image/webp" label="Reference photo" required />
      <Input name="subjectName" label="Person depicted" required errors={e?.subjectName} />
      <Select name="relationship" label="Relationship"><option value="SELF">This is me</option><option value="AUTHORIZED_OTHER">Another adult who authorized me in writing</option></Select>
      <Textarea name="consentStatement" label="Authorization statement" className="sm:col-span-2" required errors={e?.consentStatement} placeholder="This is my own face. I authorize its use in AI-assisted content for my brand." />
      <Checkbox name="confirmRights" label="I hold the legal right to use this likeness for commercial AI-assisted content." errors={e?.confirmRights} className="sm:col-span-2" />
      <Checkbox name="confirmAdult" label="The person depicted is an adult (18+)." errors={e?.confirmAdult} className="sm:col-span-2" />
      <div className="sm:col-span-2"><SubmitButton variant="secondary" pendingLabel="Uploading…">Add reference</SubmitButton></div>
    </form>
  );
}

export function CharacterForm({ refs, values: v }: { refs: { id: string; label: string }[]; values: Partial<{ id: string; name: string; description: string; apparentAge: number; likenessRefId: string; physique: string; styleNotes: string; continuityRules: string }> }) {
  const [state, action] = useActionState(saveCharacterAction, null);
  const e = fe(state);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><FormMessage state={state} /></div>
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <Input name="name" label="Character name" defaultValue={v.name} required errors={e?.name} />
      <Input name="apparentAge" type="number" min={21} max={80} label="Apparent age" hint="(21 or older)" defaultValue={v.apparentAge ?? 28} required errors={e?.apparentAge} />
      <Select name="likenessRefId" label="Face" defaultValue={v.likenessRefId ?? ""} className="sm:col-span-2">
        <option value="">Fully fictional face</option>
        {refs.map((r) => <option key={r.id} value={r.id}>My authorized reference: {r.label}</option>)}
      </Select>
      <Textarea name="description" label="Description" defaultValue={v.description} className="sm:col-span-2" />
      <Textarea name="physique" label="Fictional body / physique" defaultValue={v.physique} />
      <Textarea name="styleNotes" label="Style notes" defaultValue={v.styleNotes} />
      <Textarea name="continuityRules" label="Continuity rules" defaultValue={v.continuityRules} className="sm:col-span-2" />
      <Checkbox name="adultConfirmed" defaultChecked={Boolean(v.id)} label="This character is an adult and must never be depicted as, or appear to be, under 18." errors={e?.adultConfirmed} className="sm:col-span-2" />
      <div className="sm:col-span-2"><SubmitButton variant="secondary" pendingLabel="Saving…">{v.id ? "Save character" : "Create character"}</SubmitButton></div>
    </form>
  );
}

export function WorkspaceSettingsForm({ values: v, timezones }: { values: Record<string, string | boolean>; timezones: string[] }) {
  const [state, action] = useActionState(saveWorkspaceSettingsAction, null);
  const e = fe(state);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><FormMessage state={state} /></div>
      <input type="hidden" name="workspaceId" value={String(v.workspaceId)} />
      <Textarea name="disclosureText" label="Workspace disclosure label" defaultValue={String(v.disclosureText)} className="sm:col-span-2" errors={e?.disclosureText} />
      <Input name="categories" label="Content categories" hint="(comma separated)" defaultValue={String(v.categories)} errors={e?.categories} />
      <Input name="intensityLevels" label="Intensity levels" hint="(comma separated)" defaultValue={String(v.intensityLevels)} errors={e?.intensityLevels} />
      <Select name="defaultTimezone" label="Default time zone" defaultValue={String(v.defaultTimezone)}>{timezones.map((t) => <option key={t}>{t}</option>)}</Select>
      <Select name="defaultAspectRatio" label="Export aspect ratio" defaultValue={String(v.defaultAspectRatio ?? "9:16")}>{["9:16", "16:9", "1:1", "4:5"].map((a) => <option key={a}>{a}</option>)}</Select>
      <Input name="defaultResolution" label="Export resolution" defaultValue={String(v.defaultResolution ?? "1080x1920")} errors={e?.["exportSettings.defaultResolution"]} />
      <div className="sm:col-span-2"><SubmitButton variant="secondary" pendingLabel="Saving…">Save workspace settings</SubmitButton></div>
    </form>
  );
}
