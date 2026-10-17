"use client";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ContentStatus } from "@prisma/client";
import { cancelScheduleAction, confirmManualAction, moveConceptAction, publishNowAction, retryPublicationAction, scheduleAction, signedUrlAction } from "@/app/actions/content";
import { StatusBadge, ScheduleBadge } from "@/components/ui/status-badge";
import { SimulatedBadge, Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { FormMessage } from "@/components/ui/form-message";
import { Notice } from "@/components/ui/misc";
import { MediaPreview } from "@/components/media-preview";
import { cn } from "@/lib/cn";
import { fmtDateTime, weekdayLabel } from "@/lib/format";

type Sched = { id: string; status: string; scheduledFor: string; timezone: string; destination: string; simulated: boolean; lastError: string | null; attempts: number; maxAttempts: number; isPromo: boolean; postUrl: string | null; confirmation: string | null };
type Concept = {
  id: string; title: string; status: ContentStatus; plannedDate: string; plannedTime: string | null; timezone: string; category: string; caption: string; hashtags: string[];
  video: { assetId: string; versionNumber: number; isSimulated: boolean; approval: string } | null; schedules: Sched[];
};
type Dest = { id: string; name: string; simulated: boolean; operational: boolean; allowsAdult: boolean; confirmed: boolean };

export function CalendarBoard({ week, today, concepts, destinations, timezones, defaultTimezone, workspaceKind }: {
  week: string[]; today: string; concepts: Concept[]; destinations: Dest[]; timezones: string[]; defaultTimezone: string; workspaceKind: string;
}) {
  const [over, setOver] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<Concept | null>(null);
  const router = useRouter();
  const drop = (day: string, id: string) => {
    const c = concepts.find((x) => x.id === id);
    if (!c || c.plannedDate === day) return;
    if (c.status === "SCHEDULED" && !window.confirm("This video is scheduled. Moving it cancels the schedule; you will need to schedule it again. Continue?")) return;
    start(async () => {
      const r = await moveConceptAction(id, day);
      setError(r.ok ? null : r.error);
      router.refresh();
    });
  };
  return (
    <>
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}
      <div className={cn("grid gap-3 md:grid-cols-7", pending && "opacity-70")} aria-busy={pending}>
        {week.map((day) => {
          const items = concepts.filter((c) => c.plannedDate === day);
          return (
            <section key={day} aria-label={weekdayLabel(day)}
              onDragOver={(e) => { e.preventDefault(); setOver(day); }} onDragLeave={() => setOver(null)}
              onDrop={(e) => { e.preventDefault(); setOver(null); drop(day, e.dataTransfer.getData("text/concept")); }}
              className={cn("flex min-h-40 flex-col rounded-2xl border bg-ink-900/70 p-2 transition-colors", over === day ? "border-gold-400" : day === today ? "border-gold-500/40" : "border-ink-700")}>
              <header className="mb-2 flex items-center justify-between px-1">
                <span className={cn("text-xs font-semibold", day === today ? "text-gold-300" : "text-ink-200")}>{weekdayLabel(day)}</span>
                {items.length === 0 && day >= today && <span className="size-1.5 rounded-full bg-amber-400" title="No video planned" />}
              </header>
              <div className="flex flex-1 flex-col gap-2">
                {items.map((c) => <ConceptCard key={c.id} c={c} onSchedule={() => setScheduling(c)} />)}
                <Link href={`/studio?new=1&date=${day}`} className="mt-auto rounded-lg border border-dashed border-ink-700 px-2 py-1.5 text-center text-xs text-ink-400 hover:border-ink-500 hover:text-ink-200">+ Plan</Link>
              </div>
            </section>
          );
        })}
      </div>
      {scheduling && <ScheduleDialog concept={scheduling} destinations={destinations} timezones={timezones} defaultTimezone={defaultTimezone} workspaceKind={workspaceKind} onClose={() => setScheduling(null)} />}
    </>
  );
}

function ConceptCard({ c, onSchedule }: { c: Concept; onSchedule: () => void }) {
  const active = c.schedules.filter((s) => s.status !== "CANCELED");
  return (
    <article draggable={c.status !== "PUBLISHED"} onDragStart={(e) => e.dataTransfer.setData("text/concept", c.id)}
      className="cursor-grab rounded-xl border border-ink-700 bg-ink-850 p-2.5 active:cursor-grabbing">
      <Link href={`/studio?concept=${c.id}`} className="line-clamp-2 text-sm font-medium text-white hover:underline">{c.title}</Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-1"><StatusBadge status={c.status} />{c.video?.isSimulated && <SimulatedBadge />}</div>
      <div className="mt-1 text-[11px] text-ink-400">{c.plannedTime ?? "No time"} · {c.timezone.split("/")[1]?.replace("_", " ")}{c.category ? ` · ${c.category}` : ""}</div>
      {active.map((s) => (
        <div key={s.id} className="mt-2 space-y-1 rounded-lg border border-ink-700 bg-ink-900 p-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-1"><ScheduleBadge status={s.status} simulated={s.simulated} />{s.isPromo && <Badge>promo</Badge>}</div>
          <div className="text-ink-300">{fmtDateTime(s.scheduledFor, s.timezone)}</div>
          <div className="text-ink-400">→ {s.destination}</div>
          {s.lastError && <div className="text-red-300">{s.lastError} {s.status !== "FAILED" && s.attempts > 0 ? `(attempt ${s.attempts}/${s.maxAttempts})` : ""}</div>}
          {s.postUrl && <a href={s.postUrl} target="_blank" rel="noreferrer noopener" className="block truncate text-gold-300 hover:underline">{s.postUrl}</a>}
          <div className="flex flex-wrap gap-1 pt-1">
            {s.status === "QUEUED" && <ActionButton action={publishNowAction.bind(null, s.id)} confirm="Publish now? All approval checks run first.">Publish now</ActionButton>}
            {s.status === "AWAITING_MANUAL" && <Link href={`/calendar?schedule=${s.id}`} className={buttonClass("primary", "sm")}>Open package</Link>}
            {s.status === "FAILED" && <ActionButton action={retryPublicationAction.bind(null, s.id)}>Retry</ActionButton>}
            {["QUEUED", "AWAITING_MANUAL", "FAILED"].includes(s.status) && <ActionButton variant="ghost" action={cancelScheduleAction.bind(null, s.id)} confirm="Cancel this publication?">Cancel</ActionButton>}
          </div>
        </div>
      ))}
      {c.status === "APPROVED" && c.video?.approval === "APPROVED" && <Button size="sm" className="mt-2 w-full" onClick={onSchedule}>Schedule</Button>}
      {c.status === "AWAITING_APPROVAL" && <Link href={`/approval?asset=${c.video?.assetId ?? ""}`} className={buttonClass("secondary", "sm", "mt-2 w-full")}>Review</Link>}
    </article>
  );
}

function ScheduleDialog({ concept, destinations, timezones, defaultTimezone, workspaceKind, onClose }: {
  concept: Concept; destinations: Dest[]; timezones: string[]; defaultTimezone: string; workspaceKind: string; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, action] = useActionState(scheduleAction, null);
  const router = useRouter();
  const eligible = destinations.filter((d) => d.operational && (workspaceKind !== "ADULT" || d.allowsAdult) && (!concept.video?.isSimulated || d.simulated));
  const [destId, setDestId] = useState(eligible[0]?.id ?? "");
  const dest = destinations.find((d) => d.id === destId);
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => { if (state?.ok) { router.refresh(); onClose(); } }, [state, router, onClose]);
  return (
    <dialog ref={ref} onClose={onClose} className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-2xl border border-ink-600 bg-ink-900 p-0 text-ink-100">
      <form action={action} className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div><h2 className="text-base font-semibold text-white">Schedule “{concept.title}”</h2><p className="text-xs text-ink-400">Approved version v{concept.video?.versionNumber}. The approval, file fingerprint and destination are checked again at publish time.</p></div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-400 hover:text-white">✕</button>
        </div>
        <FormMessage state={state} />
        <input type="hidden" name="conceptId" value={concept.id} />
        <input type="hidden" name="assetId" value={concept.video?.assetId ?? ""} />
        {eligible.length === 0 && <Notice tone="warn">No eligible destination. {concept.video?.isSimulated ? "Simulated media can only go to the simulated destination." : workspaceKind === "ADULT" ? "The restricted workspace needs a destination that permits adult content (the manual package does)." : "Check Settings → Integrations."}</Notice>}
        <Select name="integrationId" label="Destination" value={destId} onChange={(e) => setDestId(e.target.value)}>
          {destinations.map((d) => <option key={d.id} value={d.id} disabled={!eligible.includes(d)}>{d.name}{!d.operational ? " — not operational" : ""}{d.simulated ? " (nothing is posted)" : ""}</option>)}
        </Select>
        <div className="grid gap-3 sm:grid-cols-3">
          <Input name="date" type="date" label="Date" defaultValue={concept.plannedDate} required />
          <Input name="time" type="time" label="Time" defaultValue={concept.plannedTime ?? "18:00"} required />
          <Select name="timezone" label="Time zone" defaultValue={concept.timezone || defaultTimezone}>{timezones.map((t) => <option key={t}>{t}</option>)}</Select>
        </div>
        <Textarea name="caption" label="Caption" defaultValue={concept.caption} rows={3} />
        <Input name="hashtags" label="Hashtags" defaultValue={concept.hashtags.join(", ")} />
        <Checkbox name="isPromo" label="This is a promotional post / preview (does not count as the day’s main video)" />
        {dest && !dest.confirmed && (
          <Checkbox name="confirmFirstPublication" required label={<>This is the <strong>first publication to {dest.name}</strong>. I confirm I want content from this workspace sent there.</>} />
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <SubmitButton disabled={!eligible.length} pendingLabel="Scheduling…">Schedule</SubmitButton>
        </div>
      </form>
    </dialog>
  );
}

export function ManualPackagePanel({ pkg }: { pkg: { scheduleId: string; status: string; title: string; versionId: string; mimeType: string; sha256: string; thumbnailVersionId: string | null; captionText: string; checklist: string[]; scheduledFor: string; timezone: string } }) {
  const [state, action] = useActionState(confirmManualAction, null);
  const [copied, setCopied] = useState(false);
  const [dl, setDl] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => { if (state?.ok) router.push("/calendar"); }, [state, router]);
  return (
    <section className="mb-6 rounded-2xl border border-gold-500/40 bg-ink-900 p-5" aria-label="Manual publishing package">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gold-400">Manual publishing package</div>
          <h2 className="text-lg font-semibold text-white">{pkg.title}</h2>
          <p className="text-xs text-ink-400">Planned for {fmtDateTime(pkg.scheduledFor, pkg.timezone)} · status: {pkg.status.toLowerCase().replace("_", " ")}</p>
        </div>
        <Link href="/calendar" className="text-xs text-ink-400 hover:text-white">Close</Link>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <MediaPreview versionId={pkg.versionId} mimeType={pkg.mimeType} className="aspect-video" />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={async () => { const r = await signedUrlAction(pkg.versionId, true); if (r.ok && r.data) { setDl(r.data); window.location.href = r.data; } }}>Download approved file</Button>
            {pkg.thumbnailVersionId && <Button variant="secondary" size="sm" onClick={async () => { const r = await signedUrlAction(pkg.thumbnailVersionId!, true); if (r.ok && r.data) window.location.href = r.data; }}>Download thumbnail</Button>}
          </div>
          {dl && <p className="text-[11px] text-ink-400">Download link expires in 5 minutes.</p>}
          <p className="break-all font-mono text-[11px] text-ink-400">SHA-256 {pkg.sha256}</p>
        </div>
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex items-center justify-between"><span className="text-xs font-medium text-ink-200">Caption, hashtags & AI disclosure</span>
              <button type="button" className="text-xs text-gold-300 hover:underline" onClick={() => { navigator.clipboard?.writeText(pkg.captionText); setCopied(true); }}>{copied ? "Copied" : "Copy"}</button></div>
            <pre className="whitespace-pre-wrap rounded-lg border border-ink-700 bg-ink-850 p-3 text-sm text-ink-100">{pkg.captionText}</pre>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-200">{pkg.checklist.map((c) => <li key={c}>{c}</li>)}</ol>
          {pkg.status === "AWAITING_MANUAL" ? (
            <form action={action} className="space-y-3">
              <FormMessage state={state} />
              <input type="hidden" name="scheduleId" value={pkg.scheduleId} />
              <Input name="postUrl" type="url" label="Link to the live post" placeholder="https://…" required />
              <SubmitButton pendingLabel="Confirming…">I posted it — mark as published</SubmitButton>
              <p className="text-[11px] text-ink-400">It is only marked published after you confirm. The app never posts to this platform for you.</p>
            </form>
          ) : <Notice tone="info">This package becomes confirmable when its publish time arrives (or use “Publish now” on the calendar card).</Notice>}
        </div>
      </div>
    </section>
  );
}
