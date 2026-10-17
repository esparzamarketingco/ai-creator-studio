import type { Metadata } from "next";
import { requireActor } from "@/server/auth/context";
import { listAuditLog, listSessions } from "@/server/services/security";
import { listAccessibleWorkspaces } from "@/server/permissions";
import { db } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/action-button";
import { buttonClass } from "@/components/ui/button";
import { revokeOthersAction, revokeSessionAction, securityNotificationsAction, withdrawAdultAction } from "@/app/actions/settings";
import { fmtDateTime } from "@/lib/format";
import { AdultAccessForm, DeleteAccountForm, PasswordForm, TotpSection } from "./security-forms";

export const metadata: Metadata = { title: "Security & Audit" };

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const [sessions, audit, workspaces, integrations] = await Promise.all([
    listSessions(actor),
    listAuditLog(actor, { take: 150, action: sp.action }),
    listAccessibleWorkspaces(actor),
    db.platformIntegration.findMany({ where: { workspace: { members: { some: { userId: actor.userId } } }, status: { not: "DISCONNECTED" } }, include: { workspace: { select: { name: true } } } }),
  ]);
  const u = actor.user;
  return (
    <>
      <PageHeader title="Security & audit" description="Sessions, two-factor authentication, restricted-workspace access, data export and the full audit history." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Account" />
          <CardBody className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2"><span className="text-ink-300">{u.email}</span>{u.emailVerifiedAt ? <Badge tone="green">verified</Badge> : <Badge tone="amber">unverified</Badge>}<Badge>{u.role.toLowerCase()}</Badge></div>
            <div className="flex items-center justify-between gap-3 pt-2">
              <span className="text-ink-200">Security event notifications</span>
              <ActionButton action={securityNotificationsAction.bind(null, !u.securityNotifications)}>{u.securityNotifications ? "On — turn off" : "Off — turn on"}</ActionButton>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Two-factor authentication" description="Time-based codes from an authenticator app." />
          <CardBody><TotpSection enabled={u.totpEnabled} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Change password" />
          <CardBody><PasswordForm /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Restricted workspace access" description="Workspace B is hidden until you re-enter your password and confirm." />
          <CardBody>
            {u.adultAccessAttestedAt ? (
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <span className="text-ink-200">Confirmed {fmtDateTime(u.adultAccessAttestedAt)}</span>
                <ActionButton action={withdrawAdultAction} confirm="Lock the restricted workspace?">Lock again</ActionButton>
              </div>
            ) : <AdultAccessForm />}
            <ul className="mt-3 space-y-1 text-xs text-ink-400">{workspaces.map((w) => <li key={w.id}>{w.name}: {w.locked ? "locked" : `access as ${w.role.toLowerCase()}`}</li>)}</ul>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Active sessions" actions={sessions.length > 1 && <ActionButton action={revokeOthersAction} confirm="Sign out every other session?">Sign out all others</ActionButton>} />
          <CardBody className="overflow-x-auto p-0">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-ink-400"><tr><th className="px-5 py-2 font-medium">Device</th><th className="font-medium">IP</th><th className="font-medium">Signed in</th><th className="font-medium">Last active</th><th /></tr></thead>
              <tbody className="divide-y divide-ink-800">
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="max-w-xs truncate px-5 py-2 text-ink-200" title={s.userAgent ?? ""}>{s.userAgent?.slice(0, 60) ?? "Unknown"} {s.id === actor.sessionId && <Badge tone="gold">this session</Badge>}</td>
                    <td className="text-ink-300">{s.ip ?? "—"}</td><td className="text-ink-300">{fmtDateTime(s.createdAt)}</td><td className="text-ink-300">{fmtDateTime(s.lastSeenAt)}</td>
                    <td className="pr-5 text-right">{s.id !== actor.sessionId && <ActionButton variant="ghost" action={revokeSessionAction.bind(null, s.id)}>Sign out</ActionButton>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Integration permissions" description="Connected services across your workspaces. Manage them in Integrations." />
          <CardBody className="p-0">
            {integrations.length === 0 ? <p className="px-5 py-4 text-sm text-ink-400">None.</p> : (
              <ul className="divide-y divide-ink-800">{integrations.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 px-5 py-2 text-sm"><span className="text-white">{i.displayName}</span><span className="text-ink-400">· {i.workspace?.name}</span>
                  <Badge>{i.status.toLowerCase()}</Badge>{i.isSimulated && <Badge tone="amber">simulated</Badge>}{i.allowsAdultContent && <Badge tone="violet">adult permitted</Badge>}{i.allowsLikeness && <Badge tone="gold">likeness permitted</Badge>}{i.credentialHint && <Badge>key {i.credentialHint}</Badge>}</li>
              ))}</ul>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Audit history" description="Approvals, edits, publication attempts, sign-ins and settings changes."
            actions={<form className="flex gap-2"><select name="action" defaultValue={sp.action ?? ""} aria-label="Filter audit log" className="h-8 rounded-lg border border-ink-600 bg-ink-850 px-2 text-xs">
              <option value="">All events</option><option value="approval">Approvals</option><option value="publish">Publishing</option><option value="auth">Sign-ins</option><option value="security">Security</option><option value="asset">Media</option><option value="generation">Generation</option><option value="integration">Integrations</option><option value="likeness">Likeness</option>
            </select><button className={buttonClass("secondary", "sm")}>Filter</button></form>} />
          <CardBody className="max-h-[32rem] overflow-auto p-0">
            <table className="w-full min-w-[44rem] text-xs">
              <thead className="sticky top-0 bg-ink-900 text-left text-[11px] uppercase tracking-wider text-ink-400"><tr><th className="px-5 py-2 font-medium">When</th><th className="font-medium">Event</th><th className="font-medium">Outcome</th><th className="font-medium">Who</th><th className="pr-5 font-medium">Details</th></tr></thead>
              <tbody className="divide-y divide-ink-800">
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap px-5 py-1.5 text-ink-300">{fmtDateTime(a.createdAt)}</td>
                    <td className="font-mono text-ink-100">{a.action}</td>
                    <td><Badge tone={a.outcome === "OK" ? "green" : a.outcome === "BLOCKED" ? "amber" : "red"}>{a.outcome.toLowerCase()}</Badge></td>
                    <td className="text-ink-300">{a.user?.name ?? "system"}</td>
                    <td className="max-w-md truncate pr-5 font-mono text-[10px] text-ink-400" title={JSON.stringify(a.metadata)}>{JSON.stringify(a.metadata)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Export my data" description="JSON export of your account, concepts, assets metadata, approvals, schedules and audit log. Secrets are excluded." />
          <CardBody><a href="/api/export" className={buttonClass("secondary")}>Download export</a></CardBody>
        </Card>
        <Card className="border-red-500/30">
          <CardHeader title="Delete account" description="Permanently deletes your account, workspaces you solely manage, and their private media files." />
          <CardBody><DeleteAccountForm /></CardBody>
        </Card>
      </div>
    </>
  );
}
