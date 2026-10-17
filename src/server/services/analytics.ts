import { z } from "zod";
import { db } from "../db";
import { AppError } from "../errors";
import { audit } from "../audit";
import { requireWorkspace } from "../permissions";
import type { Actor } from "../auth/actor";

export const METRIC_KEYS = [
  "profileVisits", "clicks", "impressions", "newSubscribers", "activeSubscribers", "churnedSubscribers",
  "freeToPaidConversions", "freeFollowers", "revenueCents", "engagements", "adSpendCents",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export type Metrics = Partial<Record<MetricKey, number>>;

const CSV_ALIASES: Record<string, MetricKey> = {
  profile_visits: "profileVisits", visits: "profileVisits", clicks: "clicks", impressions: "impressions",
  new_subscribers: "newSubscribers", new_subs: "newSubscribers", active_subscribers: "activeSubscribers", subscribers: "activeSubscribers",
  churned_subscribers: "churnedSubscribers", churned: "churnedSubscribers", expired: "churnedSubscribers",
  free_to_paid: "freeToPaidConversions", free_followers: "freeFollowers",
  revenue: "revenueCents", net_revenue: "revenueCents", earnings: "revenueCents",
  engagements: "engagements", likes: "engagements", ad_spend: "adSpendCents", spend: "adSpendCents",
};

/**
 * Import real statistics exported from a platform as CSV. Requires a `date` column (YYYY-MM-DD).
 * Money columns are in dollars. Each row becomes a daily snapshot labeled with the file and import date.
 */
export async function importCsv(actor: Actor, workspaceId: string, sourceName: string, csv: string) {
  await requireWorkspace(actor, workspaceId, "edit");
  const lines = csv.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (lines.length < 2) throw new AppError("VALIDATION", "The CSV needs a header row and at least one data row.");
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z_]/g, "_"));
  const dateIdx = header.indexOf("date");
  if (dateIdx < 0) throw new AppError("VALIDATION", "The CSV must have a 'date' column (YYYY-MM-DD).");
  const mapped = header.map((h) => CSV_ALIASES[h] ?? null);
  if (!mapped.some(Boolean)) throw new AppError("VALIDATION", `No recognized metric columns. Supported: ${Object.keys(CSV_ALIASES).join(", ")}.`);
  const source = `CSV import: ${sourceName.slice(0, 80) || "upload.csv"}`;
  const rows = lines.slice(1).map((line, i) => {
    const cells = line.split(",").map((c) => c.trim());
    const date = cells[dateIdx];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError("VALIDATION", `Row ${i + 2}: date must be YYYY-MM-DD.`);
    const metrics: Metrics = {};
    mapped.forEach((key, j) => {
      if (!key || cells[j] === undefined || cells[j] === "") return;
      const n = Number(cells[j].replace(/[$\s]/g, ""));
      if (!Number.isFinite(n) || n < 0) throw new AppError("VALIDATION", `Row ${i + 2}: '${header[j]}' must be a non-negative number.`);
      metrics[key] = key.endsWith("Cents") ? Math.round(n * 100) : Math.round(n);
    });
    const start = new Date(`${date}T00:00:00Z`);
    return { workspaceId, source, isDemo: false, periodStart: start, periodEnd: new Date(start.getTime() + 86400000 - 1), metrics };
  });
  if (rows.length > 3660) throw new AppError("VALIDATION", "Import at most 10 years of daily rows at a time.");
  await db.analyticsSnapshot.createMany({ data: rows });
  await audit({ userId: actor.userId, workspaceId, action: "analytics.csv_imported", entityType: "AnalyticsSnapshot", ip: actor.ip, metadata: { source, rows: rows.length } });
  return { rows: rows.length, source };
}

/** Clearly labeled DEMO data so the dashboards can be explored before any source is connected. */
export async function generateDemoData(actor: Actor, workspaceId: string) {
  await requireWorkspace(actor, workspaceId, "edit");
  await db.analyticsSnapshot.deleteMany({ where: { workspaceId, isDemo: true } });
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  let active = 120;
  const rows = Array.from({ length: 56 }, (_, i) => {
    const start = new Date(today.getTime() - (55 - i) * 86400000);
    const visits = Math.round(300 + rnd() * 250 + i * 4);
    const subs = Math.round(visits * (0.03 + rnd() * 0.02));
    const churned = Math.round(active * (0.008 + rnd() * 0.01));
    active += subs - churned;
    return {
      workspaceId, source: "DEMO", isDemo: true, periodStart: start, periodEnd: new Date(start.getTime() + 86400000 - 1),
      metrics: { profileVisits: visits, clicks: Math.round(visits * 0.4), impressions: visits * 9, newSubscribers: subs, activeSubscribers: active, churnedSubscribers: churned, revenueCents: active * 33 + Math.round(rnd() * 4000), engagements: Math.round(visits * 0.6), adSpendCents: i % 7 === 0 ? 2500 : 0 },
    };
  });
  await db.analyticsSnapshot.createMany({ data: rows });
  await audit({ userId: actor.userId, workspaceId, action: "analytics.demo_generated", entityType: "AnalyticsSnapshot", ip: actor.ip });
}

export async function clearAnalytics(actor: Actor, workspaceId: string, which: "demo" | "imported") {
  await requireWorkspace(actor, workspaceId, "manage");
  const r = await db.analyticsSnapshot.deleteMany({ where: { workspaceId, isDemo: which === "demo" } });
  await audit({ userId: actor.userId, workspaceId, action: `analytics.cleared_${which}`, entityType: "AnalyticsSnapshot", ip: actor.ip, metadata: { rows: r.count } });
}

export type Summary = {
  days: number;
  totals: Required<Metrics>;
  conversionRate: number | null; // new subs / profile visits
  clickThroughRate: number | null; // clicks / impressions
  churnRate: number | null; // churned / starting active
  retentionRate: number | null;
  revenuePerSubscriber: number | null; // cents
  monthlyRecurringRevenueCents: number | null; // last 30 days revenue
  acquisitionCostCents: number | null; // ad spend / new subs (only when spend data exists)
  series: { date: string; metrics: Metrics }[];
  sources: { source: string; retrievedAt: Date; isDemo: boolean }[];
};

export function summarize(snaps: { periodStart: Date; metrics: unknown; source: string; retrievedAt: Date; isDemo: boolean }[]): Summary {
  const sorted = [...snaps].sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
  const totals = Object.fromEntries(METRIC_KEYS.map((k) => [k, 0])) as Required<Metrics>;
  const has = new Set<MetricKey>();
  for (const s of sorted) for (const k of METRIC_KEYS) {
    const v = (s.metrics as Metrics)[k];
    if (typeof v === "number" && k !== "activeSubscribers") { totals[k] += v; has.add(k); }
    if (typeof v === "number" && k === "activeSubscribers") has.add(k);
  }
  const actives = sorted.map((s) => (s.metrics as Metrics).activeSubscribers).filter((v): v is number => typeof v === "number");
  totals.activeSubscribers = actives.at(-1) ?? 0;
  const startActive = actives[0];
  const ratio = (a: MetricKey, b: MetricKey) => (has.has(a) && has.has(b) && totals[b] > 0 ? totals[a] / totals[b] : null);
  const last30 = sorted.filter((s) => s.periodStart.getTime() > Date.now() - 30 * 86400000);
  const churnRate = has.has("churnedSubscribers") && startActive ? totals.churnedSubscribers / startActive : null;
  const bySource = new Map<string, { source: string; retrievedAt: Date; isDemo: boolean }>();
  for (const s of sorted) {
    const prev = bySource.get(s.source);
    if (!prev || prev.retrievedAt < s.retrievedAt) bySource.set(s.source, { source: s.source, retrievedAt: s.retrievedAt, isDemo: s.isDemo });
  }
  return {
    days: sorted.length,
    totals,
    conversionRate: ratio("newSubscribers", "profileVisits"),
    clickThroughRate: ratio("clicks", "impressions"),
    churnRate,
    retentionRate: churnRate === null ? null : Math.max(0, 1 - churnRate),
    revenuePerSubscriber: has.has("revenueCents") && totals.activeSubscribers > 0 ? Math.round(totals.revenueCents / totals.activeSubscribers) : null,
    monthlyRecurringRevenueCents: has.has("revenueCents") && last30.length ? last30.reduce((n, s) => n + ((s.metrics as Metrics).revenueCents ?? 0), 0) : null,
    acquisitionCostCents: has.has("adSpendCents") && totals.adSpendCents > 0 && totals.newSubscribers > 0 ? Math.round(totals.adSpendCents / totals.newSubscribers) : null,
    series: sorted.map((s) => ({ date: s.periodStart.toISOString().slice(0, 10), metrics: s.metrics as Metrics })),
    sources: [...bySource.values()],
  };
}

/** Real and demo data are never mixed in one summary. */
export async function getAnalytics(actor: Actor, workspaceId: string, opts: { demo: boolean; days?: number }) {
  await requireWorkspace(actor, workspaceId, "view");
  const since = new Date(Date.now() - (opts.days ?? 30) * 86400000);
  const snaps = await db.analyticsSnapshot.findMany({ where: { workspaceId, isDemo: opts.demo, periodStart: { gte: since } }, orderBy: { periodStart: "asc" } });
  const [realCount, demoCount] = await Promise.all([
    db.analyticsSnapshot.count({ where: { workspaceId, isDemo: false } }),
    db.analyticsSnapshot.count({ where: { workspaceId, isDemo: true } }),
  ]);
  return { summary: summarize(snaps), realCount, demoCount, isDemo: opts.demo };
}

/**
 * Evidence-based recommendations. Only generated from REAL data; each states the numbers it is
 * based on. Never promises outcomes.
 */
export function recommendations(s: Summary, publishedByWeekday: Record<string, number>): { title: string; evidence: string; action: string }[] {
  const out: { title: string; evidence: string; action: string }[] = [];
  if (s.days < 14) {
    out.push({ title: "Collect more data first", evidence: `Only ${s.days} day(s) of real data.`, action: "Import at least two weeks of statistics before changing strategy; short windows are mostly noise." });
    return out;
  }
  if (s.conversionRate !== null) out.push({
    title: s.conversionRate < 0.02 ? "Improve profile-to-subscriber conversion" : "Protect your conversion rate",
    evidence: `Conversion ${(s.conversionRate * 100).toFixed(2)}% (${s.totals.newSubscribers} subscribers from ${s.totals.profileVisits} visits).`,
    action: s.conversionRate < 0.02 ? "Run an A/B test on your profile preview or welcome offer for two weeks and compare conversion." : "Keep the current profile and preview; test one change at a time.",
  });
  if (s.churnRate !== null) out.push({
    title: s.churnRate > 0.15 ? "Reduce churn" : "Retention is holding",
    evidence: `Churn ${(s.churnRate * 100).toFixed(1)}% over the period (${s.totals.churnedSubscribers} expired).`,
    action: s.churnRate > 0.15 ? "Check whether expirations follow gaps in your posting calendar; keep one approved video per day queued." : "Maintain posting consistency; consider a renewal message before billing dates.",
  });
  const best = Object.entries(publishedByWeekday).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] >= 3) out.push({ title: "Test posting times", evidence: `${best[1]} of your published posts went out on ${best[0]}.`, action: "Create a posting-time experiment comparing your usual time with an alternative for two weeks." });
  if (s.acquisitionCostCents !== null) out.push({ title: "Track paid acquisition", evidence: `Ad spend per new subscriber ≈ $${(s.acquisitionCostCents / 100).toFixed(2)}.`, action: "Compare this with revenue per subscriber before increasing spend." });
  return out;
}

export const experimentSchema = z.object({
  workspaceId: z.string(),
  name: z.string().trim().min(1).max(120),
  hypothesis: z.string().trim().min(1).max(1000),
  variable: z.enum(["CAPTION", "THUMBNAIL", "POSTING_TIME"]),
  variantA: z.string().trim().min(1).max(500),
  variantB: z.string().trim().min(1).max(500),
  metric: z.string().trim().min(1).max(120),
});

export async function createExperiment(actor: Actor, input: z.input<typeof experimentSchema>) {
  const data = experimentSchema.parse(input);
  await requireWorkspace(actor, data.workspaceId, "edit");
  const e = await db.experiment.create({ data });
  await audit({ userId: actor.userId, workspaceId: data.workspaceId, action: "experiment.created", entityType: "Experiment", entityId: e.id, ip: actor.ip });
  return e;
}

export async function updateExperimentStatus(actor: Actor, id: string, status: "RUNNING" | "CONCLUDED", resultNotes?: string) {
  const e = await db.experiment.findUnique({ where: { id } });
  if (!e) throw new AppError("NOT_FOUND", "Experiment not found.");
  await requireWorkspace(actor, e.workspaceId, "edit");
  await db.experiment.update({ where: { id }, data: { status, ...(status === "RUNNING" ? { startedAt: new Date() } : { endedAt: new Date(), resultNotes: resultNotes ?? e.resultNotes }) } });
}

export async function addIdea(actor: Actor, workspaceId: string, title: string, notes = "", source: "MANUAL" | "PERFORMANCE" = "MANUAL") {
  await requireWorkspace(actor, workspaceId, "edit");
  if (!title.trim()) throw new AppError("VALIDATION", "Give the idea a title.");
  return db.ideaBacklogItem.create({ data: { workspaceId, title: title.trim().slice(0, 140), notes: notes.slice(0, 1000), source } });
}

export async function deleteIdea(actor: Actor, id: string) {
  const i = await db.ideaBacklogItem.findUnique({ where: { id } });
  if (!i) throw new AppError("NOT_FOUND", "Idea not found.");
  await requireWorkspace(actor, i.workspaceId, "edit");
  await db.ideaBacklogItem.delete({ where: { id } });
}
