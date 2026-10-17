import type { Metadata } from "next";
import Link from "next/link";
import { requireActor } from "@/server/auth/context";
import { currentWorkspace } from "@/server/current-workspace";
import { getAnalytics, recommendations, type Metrics } from "@/server/services/analytics";
import { db } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Notice, PageHeader, StatTile } from "@/components/ui/misc";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/action-button";
import { LineChart } from "@/components/line-chart";
import { clearAnalyticsAction, deleteIdeaAction, demoDataAction, experimentStatusAction } from "@/app/actions/analytics";
import { fmtDateTime, fmtMoney, fmtNumber, fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CsvImport, ExperimentForm, IdeaForm } from "./analytics-client";
import { NoWorkspace } from "../no-workspace";

export const metadata: Metadata = { title: "Growth Analytics" };

function isoWeek(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((+d - +firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function rollup(series: { date: string; metrics: Metrics }[], key: (d: string) => string) {
  const map = new Map<string, { visits: number; subs: number; churned: number; revenue: number; engagements: number }>();
  for (const s of series) {
    const k = key(s.date);
    const r = map.get(k) ?? { visits: 0, subs: 0, churned: 0, revenue: 0, engagements: 0 };
    r.visits += s.metrics.profileVisits ?? 0; r.subs += s.metrics.newSubscribers ?? 0; r.churned += s.metrics.churnedSubscribers ?? 0;
    r.revenue += s.metrics.revenueCents ?? 0; r.engagements += s.metrics.engagements ?? 0;
    map.set(k, r);
  }
  return [...map.entries()].reverse();
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ demo?: string; days?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const { current } = await currentWorkspace(actor);
  if (!current) return <NoWorkspace />;
  const days = [7, 30, 90, 365].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const demo = sp.demo === "1";
  const [{ summary: s, realCount, demoCount }, experiments, ideas, published] = await Promise.all([
    getAnalytics(actor, current.id, { demo, days }),
    db.experiment.findMany({ where: { workspaceId: current.id }, orderBy: { createdAt: "desc" } }),
    db.ideaBacklogItem.findMany({ where: { workspaceId: current.id }, orderBy: [{ priority: "asc" }, { createdAt: "desc" }] }),
    db.publishingSchedule.findMany({ where: { workspaceId: current.id, status: "PUBLISHED", integration: { isSimulated: false } }, select: { scheduledFor: true, timezone: true } }),
  ]);
  const byWeekday: Record<string, number> = {};
  for (const p of published) {
    const wd = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: p.timezone }).format(p.scheduledFor);
    byWeekday[wd] = (byWeekday[wd] ?? 0) + 1;
  }
  const recs = demo ? [] : recommendations(s, byWeekday);
  const q = (o: Record<string, string>) => `/analytics?${new URLSearchParams({ ...(demo ? { demo: "1" } : {}), days: String(days), ...o })}`;
  const hasData = s.days > 0;

  return (
    <>
      <PageHeader eyebrow={current.name} title="Growth analytics" description="Real metrics from sources you connect or import, labeled with their source and retrieval date. Demo data is always labeled and never mixed with real data." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-ink-600 p-0.5" role="tablist" aria-label="Data set">
          <Link role="tab" aria-selected={!demo} href={`/analytics?days=${days}`} className={cn("rounded-md px-3 py-1.5 text-sm", !demo ? "bg-ink-700 text-white" : "text-ink-300")}>Real data ({realCount})</Link>
          <Link role="tab" aria-selected={demo} href={`/analytics?demo=1&days=${days}`} className={cn("rounded-md px-3 py-1.5 text-sm", demo ? "bg-amber-500/20 text-amber-200" : "text-ink-300")}>Demo ({demoCount})</Link>
        </div>
        <div className="inline-flex rounded-lg border border-ink-600 p-0.5" aria-label="Range">
          {[7, 30, 90, 365].map((d) => <Link key={d} href={q({ days: String(d) })} className={cn("rounded-md px-3 py-1.5 text-sm", d === days ? "bg-ink-700 text-white" : "text-ink-300")}>{d === 365 ? "1y" : `${d}d`}</Link>)}
        </div>
        {demo && <DemoBadge />}
      </div>

      {demo && <Notice tone="warn" className="mb-4" title="DEMO DATA — not real performance">These numbers are generated to preview the dashboards. They are not your subscribers or revenue.</Notice>}
      {!demo && s.sources.length > 0 && (
        <p className="mb-4 text-xs text-ink-400">Sources: {s.sources.map((x) => `${x.source} (retrieved ${fmtDateTime(x.retrievedAt)})`).join(" · ")}</p>
      )}

      {!hasData ? (
        <EmptyState title={demo ? "No demo data" : "No real analytics yet"}
          description={demo ? "Generate a labeled demo data set to explore the dashboards." : "No analytics source is connected. Import a CSV exported from your platform's statistics page below. Nothing here is estimated or invented."}
          action={demo ? <ActionButton variant="primary" size="md" action={demoDataAction.bind(null, current.id)}>Generate demo data</ActionButton> : undefined} />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-label="Key metrics">
            <StatTile label="Profile visits" value={fmtNumber(s.totals.profileVisits)} />
            <StatTile label="New subscribers" value={fmtNumber(s.totals.newSubscribers)} />
            <StatTile label="Conversion rate" value={fmtPct(s.conversionRate, 2)} sub="subs ÷ visits" />
            <StatTile label="Click-through rate" value={fmtPct(s.clickThroughRate, 2)} sub="clicks ÷ impressions" />
            <StatTile label="Active subscribers" value={fmtNumber(s.totals.activeSubscribers)} sub="latest" />
            <StatTile label="Churn" value={fmtPct(s.churnRate)} sub={`${fmtNumber(s.totals.churnedSubscribers)} expired`} />
            <StatTile label="Retention" value={fmtPct(s.retentionRate)} />
            <StatTile label="Recurring revenue" value={fmtMoney(s.monthlyRecurringRevenueCents)} sub="last 30 days" />
            <StatTile label="Revenue / subscriber" value={fmtMoney(s.revenuePerSubscriber)} />
            <StatTile label="Acquisition cost" value={fmtMoney(s.acquisitionCostCents)} sub={s.acquisitionCostCents === null ? "needs ad-spend data" : "per new subscriber"} />
          </section>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card><CardHeader title="New subscribers per day" description={demo ? "DEMO" : undefined} /><CardBody><LineChart label="New subscribers per day" points={s.series.map((p) => ({ x: p.date, y: p.metrics.newSubscribers ?? 0 }))} format={(n) => fmtNumber(Math.round(n))} /></CardBody></Card>
            <Card><CardHeader title="Revenue per day" description={demo ? "DEMO" : undefined} /><CardBody><LineChart label="Revenue per day" points={s.series.map((p) => ({ x: p.date, y: p.metrics.revenueCents ?? 0 }))} format={(n) => fmtMoney(Math.round(n))} /></CardBody></Card>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {([["Weekly report", (d: string) => isoWeek(d)], ["Monthly report", (d: string) => d.slice(0, 7)]] as const).map(([title, key]) => (
              <Card key={title}>
                <CardHeader title={title} description={demo ? "DEMO" : undefined} />
                <CardBody className="overflow-x-auto p-0">
                  <table className="w-full min-w-[30rem] text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-wider text-ink-400"><tr><th className="px-5 py-2 font-medium">Period</th><th className="font-medium">Visits</th><th className="font-medium">New subs</th><th className="font-medium">Conv.</th><th className="font-medium">Churned</th><th className="pr-5 font-medium">Revenue</th></tr></thead>
                    <tbody className="divide-y divide-ink-800 tabular-nums">
                      {rollup(s.series, key).map(([k, r]) => (
                        <tr key={k}><td className="px-5 py-2 text-ink-200">{k}</td><td>{fmtNumber(r.visits)}</td><td>{fmtNumber(r.subs)}</td><td>{r.visits ? fmtPct(r.subs / r.visits, 2) : "—"}</td><td>{fmtNumber(r.churned)}</td><td className="pr-5">{fmtMoney(r.revenue)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Recommendations" description="Derived only from real data; each shows the numbers behind it. No outcome is guaranteed." />
          <CardBody className="space-y-3">
            {demo && <p className="text-sm text-ink-400">Recommendations are not generated from demo data.</p>}
            {!demo && recs.length === 0 && <p className="text-sm text-ink-400">Import real statistics to get recommendations.</p>}
            {recs.map((r) => (
              <div key={r.title} className="rounded-xl border border-ink-700 p-3">
                <div className="text-sm font-medium text-white">{r.title}</div>
                <div className="mt-1 text-xs text-ink-300">Evidence: {r.evidence}</div>
                <div className="mt-1 text-sm text-ink-200">{r.action}</div>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Data sources" />
          <CardBody className="space-y-4">
            <CsvImport workspaceId={current.id} />
            <div className="flex flex-wrap gap-2 border-t border-ink-800 pt-4">
              <ActionButton action={demoDataAction.bind(null, current.id)}>{demoCount ? "Regenerate demo data" : "Generate demo data"}</ActionButton>
              {demoCount > 0 && <ActionButton variant="ghost" action={clearAnalyticsAction.bind(null, current.id, "demo")} confirm="Delete all demo data?">Clear demo data</ActionButton>}
              {realCount > 0 && <ActionButton variant="danger" action={clearAnalyticsAction.bind(null, current.id, "imported")} confirm="Delete all imported real data for this workspace?">Delete imported data</ActionButton>}
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Experiments" description="A/B tests for captions, thumbnails and posting times." />
          <CardBody className="space-y-4">
            {experiments.map((e) => (
              <div key={e.id} className="rounded-xl border border-ink-700 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium text-white">{e.name}</span><Badge tone={e.status === "RUNNING" ? "blue" : e.status === "CONCLUDED" ? "green" : "neutral"}>{e.status.toLowerCase()}</Badge></div>
                <div className="mt-1 text-xs text-ink-300">{e.variable.toLowerCase().replace("_", " ")} · A: {e.variantA} · B: {e.variantB} · metric: {e.metric}</div>
                <div className="mt-1 text-xs text-ink-400">{e.hypothesis}</div>
                <div className="mt-2 flex gap-2">
                  {e.status === "DRAFT" && <ActionButton action={experimentStatusAction.bind(null, e.id, "RUNNING")}>Start</ActionButton>}
                  {e.status === "RUNNING" && <ActionButton action={experimentStatusAction.bind(null, e.id, "CONCLUDED")}>Conclude</ActionButton>}
                </div>
              </div>
            ))}
            <ExperimentForm workspaceId={current.id} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Idea backlog" description="Capture ideas; prioritize them using what your real top posts show." />
          <CardBody className="space-y-3">
            {ideas.length === 0 && <p className="text-sm text-ink-400">No ideas yet.</p>}
            <ul className="divide-y divide-ink-800">
              {ideas.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-3 py-2">
                  <div><div className="text-sm text-white">{i.title}</div>{i.notes && <div className="text-xs text-ink-400">{i.notes}</div>}</div>
                  <div className="flex shrink-0 gap-1"><Link href={`/studio?new=1`} className="text-xs text-gold-300 hover:underline">Plan</Link><ActionButton variant="ghost" action={deleteIdeaAction.bind(null, i.id)} showSuccess={false}>Remove</ActionButton></div>
                </li>
              ))}
            </ul>
            <IdeaForm workspaceId={current.id} />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
