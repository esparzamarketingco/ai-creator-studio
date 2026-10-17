import type { Metadata } from "next";
import { requireActor } from "@/server/auth/context";
import { currentWorkspace } from "@/server/current-workspace";
import { listIntegrations } from "@/server/services/integrations";
import { getDestination, getGenerator } from "@/server/providers/registry";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice, PageHeader } from "@/components/ui/misc";
import { Badge, SimulatedBadge, type Tone } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/action-button";
import { disconnectAction, healthCheckAction, reconnectAction } from "@/app/actions/settings";
import { fmtDateTime } from "@/lib/format";
import { CredentialsForm, PolicyForm } from "./integration-forms";
import { NoWorkspace } from "../../no-workspace";

export const metadata: Metadata = { title: "Integrations" };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  OPERATIONAL: { label: "Operational", tone: "green" },
  CONFIGURED: { label: "Configured", tone: "blue" },
  DISCONNECTED: { label: "Disconnected", tone: "neutral" },
  UNAVAILABLE: { label: "Unavailable", tone: "red" },
  AWAITING_AUTHORIZATION: { label: "Awaiting authorization", tone: "amber" },
};

const GROUPS = [
  ["VIDEO_GENERATION", "AI video generation"], ["IMAGE_GENERATION", "AI image & thumbnail generation"], ["STORAGE", "Private media storage"],
  ["PUBLISHING", "Publishing destinations"], ["ANALYTICS", "Analytics sources"], ["NOTIFICATIONS", "Notifications"],
] as const;

export default async function IntegrationsPage() {
  const actor = await requireActor();
  const { current } = await currentWorkspace(actor);
  if (!current) return <NoWorkspace />;
  const { catalog } = await listIntegrations(actor, current.id);
  return (
    <>
      <PageHeader eyebrow={current.name} title="Integrations" description="Connection status for this workspace. API secrets are encrypted on the server and never sent to the browser. A provider is only used after you verify its API, content policy, likeness rules, commercial rights and pricing." />
      {current.kind === "ADULT" && <Notice tone="warn" className="mb-6" title="Restricted workspace rules">Generation and publishing here require providers whose documented terms explicitly permit adult content. The simulated providers are blocked; the manual package is allowed because you post it yourself.</Notice>}
      <div className="space-y-6">
        {GROUPS.map(([kind, title]) => {
          const items = catalog.filter((c) => c.kind === kind);
          if (!items.length) return null;
          return (
            <Card key={kind}>
              <CardHeader title={title} />
              <CardBody className="divide-y divide-ink-800 p-0">
                {items.map((c) => {
                  const i = c.integration;
                  const st = STATUS[c.status] ?? STATUS.DISCONNECTED;
                  const adapter = getGenerator(c.providerKey) ?? getDestination(c.providerKey);
                  const takesCreds = adapter && !adapter.isSimulated && (("requiresCredentials" in adapter && adapter.requiresCredentials) || "kinds" in adapter);
                  return (
                    <div key={c.providerKey} className="space-y-3 px-5 py-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-white">{c.displayName}</span>
                          <Badge tone={st.tone}>{st.label}</Badge>
                          {c.availability === "simulated" && <SimulatedBadge />}
                          {c.availability === "no_official_api" && <Badge tone="red">No official API</Badge>}
                          {c.availability === "adapter_not_built" && <Badge>Adapter not installed</Badge>}
                          {i?.policyVerifiedAt && <Badge tone="green">Terms verified {fmtDateTime(i.policyVerifiedAt)}</Badge>}
                          {i?.allowsAdultContent && <Badge tone="violet">Adult content permitted</Badge>}
                          {i?.firstPublishConfirmedAt && <Badge tone="blue">First publication confirmed</Badge>}
                          {c.storageDriver && <Badge>driver: {c.storageDriver}</Badge>}
                        </div>
                        {i && (
                          <div className="flex flex-wrap gap-2">
                            {i.status !== "DISCONNECTED" && <ActionButton action={healthCheckAction.bind(null, i.id)} pendingLabel="Checking…">Health check</ActionButton>}
                            {i.status === "DISCONNECTED" && !i.hasCredentials && (i.isSimulated || c.providerKey === "manual") && <ActionButton action={reconnectAction.bind(null, i.id)}>Reconnect</ActionButton>}
                            {i.status !== "DISCONNECTED" && <ActionButton variant="ghost" action={disconnectAction.bind(null, i.id)} confirm="Disconnect? Queued publications to it will be canceled.">Disconnect</ActionButton>}
                          </div>
                        )}
                      </div>
                      <p className="text-xs leading-relaxed text-ink-300">{c.notes}{c.docsUrl && <> · <a href={c.docsUrl} target="_blank" rel="noreferrer noopener" className="text-gold-300 hover:underline">Terms</a></>}</p>
                      {i?.lastHealthCheckAt && <p className="text-[11px] text-ink-400">Last health check {fmtDateTime(i.lastHealthCheckAt)}: {i.lastHealthOk ? "passed" : "failed"}</p>}
                      {i?.credentialHint && <p className="text-[11px] text-ink-400">Stored credential: <code>{i.credentialHint}</code></p>}
                      {takesCreds && <CredentialsForm workspaceId={current.id} providerKey={c.providerKey} />}
                      {i && takesCreds && i.hasCredentials && (
                        <details className="rounded-xl border border-ink-700 p-3"><summary className="cursor-pointer text-sm text-ink-200">{i.policyVerifiedAt ? "Re-verify provider terms" : "Verify provider terms (required before use)"}</summary>
                          <div className="mt-3"><PolicyForm integrationId={i.id} /></div></details>
                      )}
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          );
        })}
        <Card>
          <CardHeader title="Connecting a real provider" />
          <CardBody className="space-y-2 text-sm text-ink-300">
            <p>1. Choose a provider and read its current API documentation, acceptable-use / content policy, likeness and consent rules, commercial-use terms and pricing.</p>
            <p>2. Implement its adapter against <code className="text-ink-100">GenerationProvider</code> or <code className="text-ink-100">PublishingDestination</code> in <code className="text-ink-100">src/server/providers/</code> and register it (see README).</p>
            <p>3. Save its API key here (encrypted at rest), run the health check, and record your terms verification. Adult-content permission can only be enabled if the adapter declares it and you confirm the provider’s terms allow it.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
