import type { Metadata } from "next";
import Link from "next/link";
import type { ContentStatus } from "@prisma/client";
import { requireActor } from "@/server/auth/context";
import { currentWorkspace } from "@/server/current-workspace";
import { listConcepts, getConceptForActor } from "@/server/services/concepts";
import { getProfile } from "@/server/services/brand";
import { listIntegrations } from "@/server/services/integrations";
import { generationProviders } from "@/server/providers/registry";
import { buildPrompt } from "@/server/services/prompts";
import { db } from "@/server/db";
import { STATUS_LABEL } from "@/server/workflow/states";
import { US_TIMEZONES } from "@/server/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Notice, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { SimulatedBadge, Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { ActionButton } from "@/components/ui/action-button";
import { setConceptStatusAction, retryGenerationAction, processQueueNowAction } from "@/app/actions/content";
import { mockProvidersEnabled } from "@/server/env";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ConceptForm, GeneratePanel, PromptBuilder, UploadPanel } from "./studio-forms";
import { NoWorkspace } from "../no-workspace";

export const metadata: Metadata = { title: "Content Studio" };

export default async function StudioPage({ searchParams }: { searchParams: Promise<{ concept?: string; new?: string; date?: string; q?: string; status?: string }> }) {
  const sp = await searchParams;
  const actor = await requireActor();
  const { current } = await currentWorkspace(actor);
  if (!current) return <NoWorkspace />;
  const statusFilter = sp.status && sp.status in STATUS_LABEL ? [sp.status as ContentStatus] : undefined;
  const [concepts, profile, { integrations }] = await Promise.all([
    listConcepts(actor, current.id, { q: sp.q, status: statusFilter }),
    getProfile(actor),
    listIntegrations(actor, current.id),
  ]);
  const selected = sp.concept ? await getConceptForActor(actor, sp.concept) : null;
  if (selected && selected.workspaceId !== current.id) {
    return <Notice tone="warn" title="This concept belongs to another workspace">Switch workspace with the selector at the top.</Notice>;
  }
  const detail = selected
    ? await db.contentConcept.findUniqueOrThrow({
        where: { id: selected.id },
        include: {
          prompts: { orderBy: { version: "desc" } },
          jobs: { orderBy: { createdAt: "desc" }, take: 10 },
          assets: { where: { deletedAt: null }, include: { currentVersion: { include: { approvals: { orderBy: { decidedAt: "desc" }, take: 1 } } } } },
          character: { include: { likenessRef: true } },
        },
      })
    : null;
  const built = detail ? await buildPrompt(detail.id) : null;
  const installed = generationProviders();
  const providers = integrations
    .filter((i) => i.kind === "VIDEO_GENERATION" || i.kind === "IMAGE_GENERATION")
    .map((i) => {
      const p = installed.find((x) => x.key === i.providerKey);
      const blockedReason = !p ? "Adapter not installed"
        : !["OPERATIONAL", "CONFIGURED"].includes(i.status) ? `Status: ${i.status.toLowerCase()}`
        : !p.isSimulated && !i.policyVerifiedAt ? "Terms not verified"
        : current.kind === "ADULT" && !(p.capabilities.allowsAdultContent && i.allowsAdultContent) ? "Not permitted for the restricted workspace"
        : null;
      return { key: i.providerKey, name: i.displayName, kinds: p?.kinds ?? [], simulated: i.isSimulated, blockedReason };
    });
  const usable = providers.filter((p) => !p.blockedReason);
  const characters = profile.characters.map((c) => ({ id: c.id, name: c.name, usesLikeness: Boolean(c.likenessRef && !c.likenessRef.revokedAt) }));
  const showForm = Boolean(sp.new) || Boolean(detail);

  return (
    <>
      <PageHeader eyebrow={current.name} title="Content Studio" description="Plan a concept, build a structured prompt, generate with a compatible provider or upload manually."
        actions={<Link href="/studio?new=1" className={buttonClass("primary")}>New concept</Link>} />
      {current.kind === "ADULT" && usable.length === 0 && (
        <Notice tone="warn" className="mb-4" title="No generation provider is permitted in this workspace yet">
          Only providers whose terms explicitly allow adult content, verified by you in Settings → Integrations, can generate here. Planning, prompts, manual uploads, review and scheduling all work now.
        </Notice>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] [&>*]:min-w-0">
        <aside aria-label="Concepts">
          <form className="mb-3 flex gap-2" role="search">
            {sp.concept && <input type="hidden" name="concept" value={sp.concept} />}
            <input name="q" defaultValue={sp.q} placeholder="Search" aria-label="Search concepts" className="h-9 min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-850 px-3 text-sm placeholder:text-ink-400 focus:border-gold-400 focus:outline-none" />
            <select name="status" defaultValue={sp.status ?? ""} aria-label="Filter by status" className="h-9 w-28 rounded-lg border border-ink-600 bg-ink-850 px-1 text-xs">
              <option value="">All</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <button className={buttonClass("secondary", "sm", "h-9")}>Go</button>
          </form>
          {concepts.length === 0 ? (
            <p className="rounded-xl border border-dashed border-ink-600 p-4 text-sm text-ink-400">No concepts{sp.q || sp.status ? " match" : " yet"}.</p>
          ) : (
            <ul className="max-h-[70vh] space-y-1 overflow-y-auto pr-1">
              {concepts.map((c) => (
                <li key={c.id}>
                  <Link href={`/studio?concept=${c.id}`} className={cn("block rounded-lg border px-3 py-2", c.id === sp.concept ? "border-gold-500/50 bg-ink-850" : "border-transparent hover:bg-ink-850")}>
                    <div className="truncate text-sm text-white">{c.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-400"><StatusBadge status={c.status} />{c.plannedDate && <span>{c.plannedDate}</span>}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="min-w-0 space-y-6">
          {!showForm && <EmptyState title="Select or create a concept" description="Each concept becomes one planned video: creative direction, prompt, generation or upload, then your approval." action={{ href: "/studio?new=1", label: "New concept" }} />}
          {showForm && (
            <Card>
              <CardHeader title={detail ? "Concept" : "New concept"} description={detail ? <span className="inline-flex items-center gap-2">Status <StatusBadge status={detail.status} /> · updated {fmtDateTime(detail.updatedAt)}</span> : "Workspace: " + current.name}
                actions={detail && (
                  <>
                    {detail.status !== "ARCHIVED" && <ActionButton action={setConceptStatusAction.bind(null, detail.id, "ARCHIVED")} confirm="Archive this concept? Any scheduled publication is canceled.">Archive</ActionButton>}
                    {detail.status === "ARCHIVED" && <ActionButton action={setConceptStatusAction.bind(null, detail.id, "IDEA")}>Restore</ActionButton>}
                  </>
                )} />
              <CardBody>
                <ConceptForm
                  key={detail?.id ?? "new"}
                  workspace={{ id: current.id, categories: current.categories, intensityLevels: current.intensityLevels, timezone: current.defaultTimezone, kind: current.kind }}
                  characters={characters}
                  timezones={[...US_TIMEZONES]}
                  concept={detail ? {
                    id: detail.id, title: detail.title, description: detail.description, audience: detail.audience, category: detail.category, intensityLevel: detail.intensityLevel,
                    characterId: detail.characterId, scene: detail.scene, location: detail.location, wardrobe: detail.wardrobe, lighting: detail.lighting, camera: detail.camera,
                    visualStyle: detail.visualStyle, durationSec: detail.durationSec, aspectRatio: detail.aspectRatio, resolution: detail.resolution, continuityRules: detail.continuityRules,
                    caption: detail.caption, hashtags: detail.hashtags.join(", "), callToAction: detail.callToAction, tags: detail.tags.join(", "),
                    plannedDate: detail.plannedDate, plannedTime: detail.plannedTime, timezone: detail.timezone,
                  } : { plannedDate: sp.date ?? null }}
                />
              </CardBody>
            </Card>
          )}

          {detail && built && (
            <>
              <Card>
                <CardHeader title="AI prompt builder" description="Structured prompt from the concept, character and brand profile. Edits are saved as new versions." />
                <CardBody>
                  {detail.character?.likenessRef && !detail.character.likenessRef.revokedAt && (
                    <Notice tone="info" className="mb-4">This character uses your authorized facial reference “{detail.character.likenessRef.label}”. Only providers that support likeness workflows can be used.</Notice>
                  )}
                  <PromptBuilder conceptId={detail.id} built={built} providers={providers.map((p) => ({ key: p.key, name: p.name }))}
                    versions={detail.prompts.map((p) => ({ id: p.id, version: p.version, positivePrompt: p.positivePrompt, negativePrompt: p.negativePrompt, providerKey: p.providerKey, createdAt: p.createdAt.toISOString() }))} />
                </CardBody>
              </Card>

              <Card id="generate">
                <CardHeader title="Generate" description="Submit to a connected provider. Re-submitting the same prompt never duplicates finished work."
                  actions={mockProvidersEnabled() && process.env.NODE_ENV !== "production" && <ActionButton action={processQueueNowAction} pendingLabel="Processing…">Process queue now (dev)</ActionButton>} />
                <CardBody className="space-y-4">
                  {detail.prompts.length === 0 ? <p className="text-sm text-ink-400">Save a prompt first.</p> : (
                    <GeneratePanel conceptId={detail.id} prompts={detail.prompts.map((p) => ({ id: p.id, version: p.version }))} providers={providers} />
                  )}
                  {detail.jobs.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[36rem] text-left text-sm">
                        <thead className="text-[11px] uppercase tracking-wider text-ink-400"><tr><th className="py-2 font-medium">Job</th><th className="font-medium">Provider</th><th className="font-medium">Status</th><th className="font-medium">Attempts</th><th /></tr></thead>
                        <tbody className="divide-y divide-ink-800">
                          {detail.jobs.map((j) => (
                            <tr key={j.id}>
                              <td className="py-2 text-xs text-ink-300">{j.kind.toLowerCase()} · {fmtDateTime(j.createdAt)}</td>
                              <td className="text-xs">{j.providerKey} {j.isSimulated && <SimulatedBadge />}</td>
                              <td><Badge tone={j.status === "SUCCEEDED" ? "green" : j.status === "FAILED" ? "red" : "violet"}>{j.status.toLowerCase()}</Badge>{j.lastError && <div className="mt-1 max-w-xs text-[11px] text-red-300">{j.lastError}</div>}</td>
                              <td className="text-xs tabular-nums">{j.attempts}/{j.maxAttempts}</td>
                              <td className="text-right">{(j.status === "FAILED" || j.status === "CANCELED") && <ActionButton action={retryGenerationAction.bind(null, j.id)}>Retry</ActionButton>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card id="upload">
                <CardHeader title="Media for this concept" description="Upload a finished video or thumbnail manually. Each upload is a new immutable version." actions={<Link href="/approval" className="text-xs text-gold-300 hover:underline">Approval inbox →</Link>} />
                <CardBody className="space-y-4">
                  {detail.assets.length > 0 && (
                    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 [&>*]:min-w-0">
                      {detail.assets.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-ink-700 px-3 py-2 text-sm">
                          <span className="min-w-0 truncate">{a.kind.toLowerCase()} · {a.title}</span>
                          <span className="flex shrink-0 items-center gap-1">{a.currentVersion?.isSimulated && <SimulatedBadge />}<Badge>v{a.currentVersion?.versionNumber ?? "–"}</Badge></span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <UploadPanel workspaceId={current.id} conceptId={detail.id} title={detail.title} assets={detail.assets.map((a) => ({ id: a.id, kind: a.kind, title: a.title }))} />
                </CardBody>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
