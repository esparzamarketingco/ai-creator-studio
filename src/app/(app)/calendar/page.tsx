import type { Metadata } from "next";
import Link from "next/link";
import { requireActor } from "@/server/auth/context";
import { currentWorkspace } from "@/server/current-workspace";
import { calendarData } from "@/server/services/dashboard";
import { listIntegrations } from "@/server/services/integrations";
import { manualPackage } from "@/server/services/publishing";
import { approvalState } from "@/server/services/assets";
import { addDays, dateInTz, US_TIMEZONES } from "@/server/time";
import { PageHeader } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { weekdayLabel } from "@/lib/format";
import { CalendarBoard, ManualPackagePanel } from "./calendar-client";
import { NoWorkspace } from "../no-workspace";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ date?: string; schedule?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const { current } = await currentWorkspace(actor);
  if (!current) return <NoWorkspace />;
  const today = dateInTz(new Date(), current.defaultTimezone);
  const anchor = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const [cal, { integrations }] = await Promise.all([calendarData(actor, current.id, anchor), listIntegrations(actor, current.id)]);
  const pkg = sp.schedule ? await manualPackage(actor, sp.schedule).catch(() => null) : null;
  const destinations = integrations.filter((i) => i.kind === "PUBLISHING").map((i) => ({
    id: i.id, name: i.displayName, simulated: i.isSimulated, operational: i.status === "OPERATIONAL" && i.lastHealthOk !== false,
    allowsAdult: i.allowsAdultContent, confirmed: Boolean(i.firstPublishConfirmedAt),
  }));
  const counts = [
    ["Planned", cal.counts.planned], ["Awaiting generation", cal.counts.awaitingGeneration], ["Generating", cal.counts.generating],
    ["Awaiting approval", cal.counts.awaitingApproval], ["Approved", cal.counts.approved], ["Scheduled", cal.counts.scheduled],
    ["Published", cal.counts.published], ["Failed", cal.counts.failed],
  ] as const;

  return (
    <>
      <PageHeader eyebrow={current.name} title="Weekly calendar" description="Seven planned videos per week. Drag a card to another day to reschedule — a scheduled video goes back to Approved and must be re-scheduled, so every check runs again."
        actions={<>
          <Link href={`/calendar?date=${addDays(cal.week[0], -7)}`} className={buttonClass("secondary", "sm")} aria-label="Previous week">←</Link>
          <Link href="/calendar" className={buttonClass("secondary", "sm")}>This week</Link>
          <Link href={`/calendar?date=${addDays(cal.week[0], 7)}`} className={buttonClass("secondary", "sm")} aria-label="Next week">→</Link>
        </>} />
      <p className="-mt-4 mb-4 text-sm text-ink-300">{weekdayLabel(cal.week[0])} – {weekdayLabel(cal.week[6])}</p>
      <dl className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-8">
        {counts.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-ink-700 bg-ink-900/70 px-3 py-2">
            <dt className="truncate text-[10px] uppercase tracking-wider text-ink-400">{k}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${k === "Failed" && v ? "text-red-300" : "text-white"}`}>{v}</dd>
          </div>
        ))}
      </dl>
      {pkg && (
        <ManualPackagePanel pkg={{
          scheduleId: pkg.schedule.id, status: pkg.schedule.status, title: pkg.schedule.concept.title, versionId: pkg.version.id, mimeType: pkg.version.mimeType,
          sha256: pkg.version.sha256, thumbnailVersionId: pkg.thumbnailVersionId, captionText: pkg.captionText, checklist: pkg.checklist,
          scheduledFor: pkg.schedule.scheduledFor.toISOString(), timezone: pkg.schedule.timezone,
        }} />
      )}
      <CalendarBoard
        week={cal.week}
        today={today}
        workspaceKind={current.kind}
        timezones={[...US_TIMEZONES]}
        defaultTimezone={current.defaultTimezone}
        destinations={destinations}
        concepts={cal.concepts.map((c) => {
          const video = c.assets[0];
          const latest = video?.currentVersion?.approvals[0];
          return {
            id: c.id, title: c.title, status: c.status, plannedDate: c.plannedDate!, plannedTime: c.plannedTime, timezone: c.timezone, category: c.category,
            caption: c.caption, hashtags: c.hashtags,
            video: video?.currentVersion ? { assetId: video.id, versionNumber: video.currentVersion.versionNumber, isSimulated: video.currentVersion.isSimulated, approval: approvalState(latest) } : null,
            schedules: c.schedules.map((s) => ({ id: s.id, status: s.status, scheduledFor: s.scheduledFor.toISOString(), timezone: s.timezone, destination: s.integration.displayName, simulated: s.integration.isSimulated, lastError: s.lastError, attempts: s.attempts, maxAttempts: s.maxAttempts, isPromo: s.isPromo, postUrl: s.post?.externalUrl ?? null, confirmation: s.post?.confirmationSource ?? null })),
          };
        })}
      />
    </>
  );
}
