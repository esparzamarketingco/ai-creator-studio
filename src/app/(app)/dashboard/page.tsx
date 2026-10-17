import type { Metadata } from "next";
import Link from "next/link";
import { requireActor } from "@/server/auth/context";
import { currentWorkspace } from "@/server/current-workspace";
import { dashboardData } from "@/server/services/dashboard";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Notice, PageHeader, StatTile } from "@/components/ui/misc";
import { Badge, SimulatedBadge } from "@/components/ui/badge";
import { StatusBadge, ScheduleBadge } from "@/components/ui/status-badge";
import { buttonClass } from "@/components/ui/button";
import { fmtDateTime, fmtMoney, fmtNumber, weekdayLabel } from "@/lib/format";
import { NoWorkspace } from "../no-workspace";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const actor = await requireActor();
  const { current } = await currentWorkspace(actor);
  if (!current) return <NoWorkspace />;
  const d = await dashboardData(actor, current.id);
  const hasAnything = d.counts.planned + d.counts.awaitingApproval + d.upcoming.length > 0;
  return (
    <>
      <PageHeader eyebrow={current.name} title="Today’s production" description={`Week of ${weekdayLabel(d.week[0])} – ${weekdayLabel(d.week[6])}. Target: one approved video per day.`}
        actions={<><Link href="/studio?new=1" className={buttonClass("primary")}>New concept</Link><Link href="/approval" className={buttonClass("secondary")}>Review inbox</Link></>} />

      {d.missingDays.length > 0 && (
        <Notice tone="warn" className="mb-4" title={`${d.missingDays.length} day(s) this week have no video planned`}>
          {d.missingDays.map(weekdayLabel).join(", ")} · <Link href="/calendar" className="underline">Open calendar</Link>
        </Notice>
      )}
      {d.needsAttentionTomorrow.length > 0 && (
        <Notice tone="warn" className="mb-4" title="Tomorrow’s video is not approved yet">
          {d.needsAttentionTomorrow.map((c) => c.title).join(", ")}
        </Notice>
      )}

      <section aria-label="Weekly counts" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <StatTile label="Planned this week" value={`${d.counts.planned}/7`} href="/calendar" />
        <StatTile label="Generated" value={d.counts.generated} sub="this week" href="/library" />
        <StatTile label="Awaiting approval" value={d.counts.awaitingApproval} href="/approval" tone={d.counts.awaitingApproval ? "gold" : undefined} />
        <StatTile label="Approved, ready" value={d.counts.approvedReady} sub="to schedule" href="/calendar" />
        <StatTile label="Scheduled" value={d.counts.scheduled} href="/calendar" />
        <StatTile label="Published" value={d.counts.published} sub="confirmed this week" />
        <StatTile label="Failed jobs" value={d.counts.failed} tone={d.counts.failed ? "red" : undefined} sub="generation + publishing" />
      </section>

      {!hasAnything && (
        <div className="mt-6">
          <EmptyState title="Nothing planned yet" description="Set up your brand identity, then create your first concept. Without a connected provider you can still plan, write prompts, upload videos manually, review and schedule." action={{ href: "/settings/brand", label: "Set up brand identity" }} />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="This week" description="One slot per day" actions={<Link href="/calendar" className="text-xs text-gold-300 hover:underline">Calendar →</Link>} />
          <CardBody className="p-0">
            <ul className="divide-y divide-ink-800">
              {d.week.map((day) => {
                const items = d.concepts.filter((c) => c.plannedDate === day && c.status !== "ARCHIVED");
                return (
                  <li key={day} className={day === d.today ? "bg-ink-850/70" : undefined}>
                    <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="w-28 shrink-0 text-xs font-medium text-ink-300">{weekdayLabel(day)}{day === d.today && <span className="ml-1 text-gold-400">· today</span>}</div>
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                        {items.length === 0 ? (
                          <Link href={`/studio?new=1&date=${day}`} className="text-sm text-ink-400 hover:text-gold-300">+ Plan a video</Link>
                        ) : items.map((c) => (
                          <Link key={c.id} href={`/studio?concept=${c.id}`} className="flex min-w-0 items-center gap-2 rounded-lg px-1 hover:bg-ink-800">
                            <span className="truncate text-sm text-white">{c.title}</span>
                            <StatusBadge status={c.status} />
                            {c.plannedTime && <span className="text-xs text-ink-400">{c.plannedTime}</span>}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Upcoming publications" />
            <CardBody className="p-0">
              {d.upcoming.length === 0 ? <p className="px-5 py-6 text-sm text-ink-400">Nothing scheduled. Approved videos can be scheduled from the calendar.</p> : (
                <ul className="divide-y divide-ink-800">
                  {d.upcoming.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm text-white">{s.concept.title}</div>
                        <div className="text-xs text-ink-400">{fmtDateTime(s.scheduledFor, s.timezone)} · {s.integration.displayName}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">{s.integration.isSimulated && <SimulatedBadge />}<ScheduleBadge status={s.status} /></div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Failures" description="Last 14 days" />
            <CardBody className="space-y-2">
              {d.failedJobs.length + d.failedPublishes.length === 0 && <p className="text-sm text-ink-400">No failed jobs.</p>}
              {d.failedJobs.map((j) => (
                <Link key={j.id} href={`/studio?concept=${j.concept.id}`} className="block rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm hover:border-red-500/40">
                  <div className="text-white">Generation: {j.concept.title}</div>
                  <div className="line-clamp-2 text-xs text-red-200/80">{j.lastError}</div>
                </Link>
              ))}
              {d.failedPublishes.map((s) => (
                <Link key={s.id} href="/calendar" className="block rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm hover:border-red-500/40">
                  <div className="text-white">Publishing: {s.concept.title}</div>
                  <div className="line-clamp-2 text-xs text-red-200/80">{s.lastError}</div>
                </Link>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Audience & revenue" description="Last 30 days" actions={<Link href="/analytics" className="text-xs text-gold-300 hover:underline">Analytics →</Link>} />
            <CardBody>
              {d.realMetrics ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><div className="text-xs text-ink-400">New subscribers</div><div className="text-xl font-semibold tabular-nums">{fmtNumber(d.realMetrics.newSubscribers)}</div></div>
                    <div><div className="text-xs text-ink-400">Revenue</div><div className="text-xl font-semibold tabular-nums">{fmtMoney(d.realMetrics.revenueCents)}</div></div>
                  </div>
                  <p className="text-[11px] text-ink-400">Source: {d.realMetrics.sources.join(", ")} · retrieved {fmtDateTime(d.realMetrics.retrievedAt)}</p>
                </div>
              ) : (
                <p className="text-sm text-ink-400">No real metrics connected. Import your platform statistics on the analytics page. <Badge>No data</Badge></p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );

}
