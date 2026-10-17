import type { Metadata } from "next";
import Link from "next/link";
import { requireActor } from "@/server/auth/context";
import { currentWorkspace } from "@/server/current-workspace";
import { approvalInbox } from "@/server/services/approvals";
import { getAssetForActor, approvalState } from "@/server/services/assets";
import { db } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, Notice } from "@/components/ui/misc";
import { Badge, SimulatedBadge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-button";
import { MediaPreview } from "@/components/media-preview";
import { revokeApprovalAction } from "@/app/actions/content";
import { fmtBytes, fmtDateTime, shortHash } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CompareVersions, DecisionForm } from "./approval-client";
import { NoWorkspace } from "../no-workspace";

export const metadata: Metadata = { title: "Approval Inbox" };

export default async function ApprovalPage({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const { current } = await currentWorkspace(actor);
  if (!current) return <NoWorkspace />;
  const { pending, decided } = await approvalInbox(actor, current.id);
  const selectedId = sp.asset ?? pending[0]?.id ?? null;
  const asset = selectedId ? await getAssetForActor(actor, selectedId).catch(() => null) : null;
  const v = asset?.currentVersion ?? null;
  const [job, thumbs, canApprove] = asset && v
    ? await Promise.all([
        v.generationJobId ? db.generationJob.findUnique({ where: { id: v.generationJobId }, include: { prompt: true } }) : null,
        asset.conceptId ? db.mediaAsset.findMany({ where: { conceptId: asset.conceptId, kind: { in: ["THUMBNAIL", "IMAGE"] }, deletedAt: null }, include: { currentVersion: true } }) : [],
        db.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: current.id, userId: actor.userId } } }).then((m) => m?.role === "MANAGER" && actor.role !== "VIEWER"),
      ])
    : [null, [], false];
  const state = v ? approvalState(v.approvals[0]) : null;

  return (
    <>
      <PageHeader eyebrow={current.name} title="Approval inbox" description="Watch every final video in full, then approve, reject or request revisions. Approval applies to this exact file version only." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] [&>*]:min-w-0">
        <aside className="space-y-5" aria-label="Review queue">
          <div>
            <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gold-400">Awaiting my approval ({pending.length})</h2>
            {pending.length === 0 ? <p className="rounded-xl border border-dashed border-ink-600 p-4 text-sm text-ink-400">Inbox zero. New generations and uploads appear here.</p> : (
              <ul className="space-y-1">
                {pending.map((a) => (
                  <li key={a.id}><Link href={`/approval?asset=${a.id}`} className={cn("block rounded-lg border px-3 py-2", a.id === selectedId ? "border-gold-500/50 bg-ink-850" : "border-transparent hover:bg-ink-850")}>
                    <div className="truncate text-sm text-white">{a.concept?.title ?? a.title}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-400">v{a.versions[0]?.versionNumber} {a.currentVersion?.isSimulated && <SimulatedBadge />} {a.concept?.plannedDate}</div>
                  </Link></li>
                ))}
              </ul>
            )}
          </div>
          {decided.length > 0 && (
            <div>
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Recently decided</h2>
              <ul className="space-y-1">
                {decided.map((a) => {
                  const st = approvalState(a.currentVersion?.approvals[0]);
                  return (
                    <li key={a.id}><Link href={`/approval?asset=${a.id}`} className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-2", a.id === selectedId ? "border-gold-500/50 bg-ink-850" : "border-transparent hover:bg-ink-850")}>
                      <span className="truncate text-sm text-ink-200">{a.concept?.title ?? a.title}</span>
                      <Badge tone={st === "APPROVED" ? "green" : st === "REJECTED" ? "red" : "amber"}>{st.toLowerCase().replace("_", " ")}</Badge>
                    </Link></li>
                  );
                })}
              </ul>
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          {!asset || !v ? (
            <EmptyState title="Nothing to review" description="When a video is generated or uploaded for a concept, it appears here for your decision." action={{ href: "/studio", label: "Open Content Studio" }} />
          ) : (
            <>
              <Card>
                <CardHeader title={asset.concept?.title ?? asset.title}
                  description={<span className="inline-flex flex-wrap items-center gap-2">Version {v.versionNumber} of {asset.versions.length} {asset.concept && <StatusBadge status={asset.concept.status} />} {v.isSimulated && <SimulatedBadge />}</span>}
                  actions={asset.concept && <>
                    <Link href={`/studio?concept=${asset.concept.id}#generate`} className={buttonClass("secondary", "sm")}>Regenerate</Link>
                    <Link href={`/studio?concept=${asset.concept.id}#upload`} className={buttonClass("secondary", "sm")}>Replace file</Link>
                  </>} />
                <CardBody className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
                  <div className="min-w-0">
                    {v.isSimulated && <Notice tone="warn" className="mb-3" title="Simulated output">This placeholder came from a mock provider. It is not a real video and can never be published to a real destination.</Notice>}
                    <DecisionForm key={v.id} versionId={v.id} mimeType={v.mimeType} isSimulated={v.isSimulated} canApprove={Boolean(canApprove)} currentState={state} />
                  </div>
                  <dl className="space-y-3 text-sm">
                    <Meta k="Approval state" v={<Badge tone={state === "APPROVED" ? "green" : state === "PENDING" ? "gold" : "red"}>{state?.toLowerCase().replace("_", " ")}</Badge>} />
                    <Meta k="Fingerprint (SHA-256)" v={<code className="break-all font-mono text-[11px] text-ink-200" title={v.sha256}>{shortHash(v.sha256)}</code>} />
                    <Meta k="File" v={`${v.mimeType} · ${fmtBytes(v.sizeBytes)}${v.width ? ` · ${v.width}×${v.height}` : ""}${v.durationSec ? ` · ${v.durationSec.toFixed(1)}s` : ""}`} />
                    <Meta k="Source" v={`${v.source.toLowerCase()}${v.providerKey ? ` · ${v.providerKey}` : ""}`} />
                    <Meta k="Created" v={fmtDateTime(v.createdAt)} />
                    {job && <Meta k="Generation job" v={<span className="text-xs">{job.status.toLowerCase()} · {job.attempts} attempt(s) · prompt v{job.prompt.version}</span>} />}
                    {asset.concept && <>
                      <Meta k="Caption" v={<span className="whitespace-pre-wrap text-ink-200">{asset.concept.caption || "—"}</span>} />
                      <Meta k="Hashtags" v={asset.concept.hashtags.join(" ") || "—"} />
                      <Meta k="Call to action" v={asset.concept.callToAction || "—"} />
                    </>}
                  </dl>
                </CardBody>
              </Card>

              {thumbs.length > 0 && (
                <Card>
                  <CardHeader title="Thumbnails" />
                  <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {thumbs.filter((t) => t.currentVersion).map((t) => (
                      <div key={t.id}><MediaPreview versionId={t.currentVersion!.id} mimeType={t.currentVersion!.mimeType} isSimulated={t.currentVersion!.isSimulated} className="aspect-[9/16]" /><div className="mt-1 truncate text-xs text-ink-400">{t.title} · v{t.currentVersion!.versionNumber}</div></div>
                    ))}
                  </CardBody>
                </Card>
              )}

              {job && (
                <Card>
                  <CardHeader title="Provider & generation details" />
                  <CardBody><pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-850 p-3 font-mono text-[11px] text-ink-300">{job.prompt.positivePrompt}{"\n\nNegative: "}{job.prompt.negativePrompt}</pre></CardBody>
                </Card>
              )}

              {asset.versions.length > 1 && (
                <Card>
                  <CardHeader title="Compare versions" />
                  <CardBody><CompareVersions versions={asset.versions.map((x) => ({ id: x.id, versionNumber: x.versionNumber, mimeType: x.mimeType, isSimulated: x.isSimulated, sha256: x.sha256 }))} /></CardBody>
                </Card>
              )}

              <Card>
                <CardHeader title="Decision history" description="Every decision is recorded with the exact version and fingerprint." />
                <CardBody className="p-0">
                  <ul className="divide-y divide-ink-800">
                    {asset.versions.flatMap((ver) => ver.approvals.map((ap) => ({ ver, ap }))).sort((a, b) => +b.ap.decidedAt - +a.ap.decidedAt).map(({ ver, ap }) => (
                      <li key={ap.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
                        <div>
                          <Badge tone={ap.decision === "APPROVED" ? (ap.invalidatedAt ? "neutral" : "green") : ap.decision === "REJECTED" ? "red" : "amber"}>{ap.decision.toLowerCase().replace("_", " ")}{ap.invalidatedAt ? " · invalidated" : ""}</Badge>
                          <span className="ml-2 text-ink-300">v{ver.versionNumber} · {fmtDateTime(ap.decidedAt)} · <code className="font-mono text-[11px]">{shortHash(ap.approvedSha256)}</code></span>
                          {ap.notes && <div className="mt-1 text-xs text-ink-400">“{ap.notes}”</div>}
                          {ap.invalidatedReason && <div className="mt-1 text-xs text-amber-300">Invalidated: {ap.invalidatedReason}</div>}
                        </div>
                        {ap.decision === "APPROVED" && !ap.invalidatedAt && canApprove && <ActionButton variant="danger" action={revokeApprovalAction.bind(null, ap.id)} confirm="Withdraw this approval? Any scheduled publication of this video will be canceled.">Withdraw approval</ActionButton>}
                      </li>
                    ))}
                    {asset.versions.every((ver) => ver.approvals.length === 0) && <li className="px-5 py-4 text-sm text-ink-400">No decisions yet.</li>}
                  </ul>
                </CardBody>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Meta({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-ink-400">{k}</dt>
      <dd className="mt-0.5 text-ink-100">{v}</dd>
    </div>
  );
}
