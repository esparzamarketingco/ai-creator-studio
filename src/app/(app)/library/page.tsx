import type { Metadata } from "next";
import Link from "next/link";
import type { AssetKind } from "@prisma/client";
import { requireActor } from "@/server/auth/context";
import { currentWorkspace } from "@/server/current-workspace";
import { getAssetForActor, listAssets, approvalState } from "@/server/services/assets";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Badge, SimulatedBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-button";
import { MediaPreview } from "@/components/media-preview";
import { archiveAssetAction, deleteAssetAction } from "@/app/actions/content";
import { fmtBytes, fmtDateTime, shortHash } from "@/lib/format";
import { AssetMetaForm, DownloadButton, LibraryUpload } from "./library-client";
import { NoWorkspace } from "../no-workspace";

export const metadata: Metadata = { title: "Media Library" };

const tone = (s: string) => (s === "APPROVED" ? "green" : s === "PENDING" ? "gold" : s === "INVALIDATED" ? "neutral" : "red") as "green" | "gold" | "neutral" | "red";

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ q?: string; kind?: string; status?: string; tag?: string; archived?: string; asset?: string; upload?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const { current } = await currentWorkspace(actor);
  if (!current) return <NoWorkspace />;
  const kind = ["VIDEO", "IMAGE", "THUMBNAIL"].includes(sp.kind ?? "") ? (sp.kind as AssetKind) : undefined;
  const status = ["approved", "awaiting", "rejected"].includes(sp.status ?? "") ? (sp.status as "approved") : undefined;
  const assets = await listAssets(actor, current.id, { q: sp.q, kind, status, tag: sp.tag, archived: sp.archived === "1" });
  const selected = sp.asset ? await getAssetForActor(actor, sp.asset).catch(() => null) : null;
  const allTags = [...new Set(assets.flatMap((a) => a.tags))].slice(0, 30);

  return (
    <>
      <PageHeader eyebrow={current.name} title="Media library" description="Private storage. Files are only served through short-lived signed links to signed-in members of this workspace."
        actions={<Link href="/library?upload=1" className={buttonClass("primary")}>Upload</Link>} />
      {sp.upload && <Card className="mb-6"><CardHeader title="Upload media" actions={<Link href="/library" className="text-xs text-ink-400 hover:text-white">Close</Link>} /><CardBody><LibraryUpload workspaceId={current.id} categories={current.categories} /></CardBody></Card>}

      <form className="mb-4 flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={sp.q} placeholder="Search title, tag or category" aria-label="Search" className="h-9 min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-850 px-3 text-sm placeholder:text-ink-400 sm:max-w-xs" />
        <select name="kind" defaultValue={sp.kind ?? ""} aria-label="Type" className="h-9 rounded-lg border border-ink-600 bg-ink-850 px-2 text-sm"><option value="">All types</option><option value="VIDEO">Videos</option><option value="THUMBNAIL">Thumbnails</option><option value="IMAGE">Images</option></select>
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Approval" className="h-9 rounded-lg border border-ink-600 bg-ink-850 px-2 text-sm"><option value="">Any approval</option><option value="approved">Approved</option><option value="awaiting">Awaiting</option><option value="rejected">Rejected / revisions</option></select>
        <select name="tag" defaultValue={sp.tag ?? ""} aria-label="Tag" className="h-9 rounded-lg border border-ink-600 bg-ink-850 px-2 text-sm"><option value="">Any tag</option>{allTags.map((t) => <option key={t}>{t}</option>)}</select>
        <select name="archived" defaultValue={sp.archived ?? ""} aria-label="Archive" className="h-9 rounded-lg border border-ink-600 bg-ink-850 px-2 text-sm"><option value="">Active</option><option value="1">Archived</option></select>
        <button className={buttonClass("secondary", "sm", "h-9")}>Filter</button>
      </form>

      <div className={selected ? "grid gap-6 xl:grid-cols-[1fr_26rem]" : ""}>
        {assets.length === 0 ? (
          <EmptyState title="No media here" description={sp.q || kind || status || sp.tag ? "Nothing matches these filters." : "Generated and uploaded media will appear here with full version history."} action={{ href: "/library?upload=1", label: "Upload media" }} />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {assets.map((a) => (
              <li key={a.id}>
                <Link href={`/library?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.archived ? { archived: sp.archived } : {}), asset: a.id })}`} className={`block overflow-hidden rounded-xl border bg-ink-900 hover:border-ink-500 ${a.id === selected?.id ? "border-gold-500/60" : "border-ink-700"}`}>
                  {a.currentVersion ? <MediaPreview versionId={a.currentVersion.id} mimeType={a.currentVersion.mimeType} isSimulated={a.currentVersion.isSimulated} controls={false} className="aspect-[4/5] rounded-none" /> : <div className="aspect-[4/5] bg-ink-850" />}
                  <div className="space-y-1 p-2.5">
                    <div className="truncate text-sm text-white">{a.title}</div>
                    <div className="flex flex-wrap items-center gap-1 text-[11px] text-ink-400">
                      <Badge>{a.kind.toLowerCase()}</Badge><Badge tone={tone(a.approvalState)}>{a.approvalState.toLowerCase().replace("_", " ")}</Badge><span>{a._count.versions} ver.</span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <Card className="h-fit xl:sticky xl:top-20">
            <CardHeader title={selected.title} description={`${selected.kind.toLowerCase()} · ${selected.versions.length} version(s)${selected.concept ? ` · ${selected.concept.title}` : ""}`} actions={<Link href="/library" className="text-xs text-ink-400 hover:text-white" aria-label="Close details">✕</Link>} />
            <CardBody className="space-y-5">
              <AssetMetaForm assetId={selected.id} title={selected.title} tags={selected.tags.join(", ")} category={selected.category} />
              <div>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">Version history</h3>
                <ol className="space-y-3">
                  {selected.versions.map((v) => {
                    const st = approvalState(v.approvals[0]);
                    return (
                      <li key={v.id} className="rounded-xl border border-ink-700 p-3">
                        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="font-semibold text-white">v{v.versionNumber}</span>
                          {v.id === selected.currentVersionId && <Badge tone="gold">current</Badge>}
                          <Badge tone={tone(st)}>{st.toLowerCase().replace("_", " ")}</Badge>
                          {v.isSimulated && <SimulatedBadge />}
                        </div>
                        <MediaPreview versionId={v.id} mimeType={v.mimeType} isSimulated={v.isSimulated} className="aspect-video" />
                        <div className="mt-2 space-y-0.5 text-[11px] text-ink-400">
                          <div>{v.source.toLowerCase()} · {v.mimeType} · {fmtBytes(v.sizeBytes)} · {fmtDateTime(v.createdAt)}</div>
                          <div className="font-mono">{shortHash(v.sha256)}</div>
                        </div>
                        <div className="mt-2"><DownloadButton versionId={v.id} /></div>
                      </li>
                    );
                  })}
                </ol>
              </div>
              <div className="flex flex-wrap gap-2 border-t border-ink-800 pt-4">
                <ActionButton action={archiveAssetAction.bind(null, selected.id, !selected.archivedAt)} confirm={selected.archivedAt ? undefined : "Archive this asset? Its approval is invalidated and any scheduled post is canceled."}>{selected.archivedAt ? "Unarchive" : "Archive"}</ActionButton>
                <ActionButton variant="danger" action={deleteAssetAction.bind(null, selected.id)} confirm="Permanently delete every version of this file? This cannot be undone.">Delete permanently</ActionButton>
              </div>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
