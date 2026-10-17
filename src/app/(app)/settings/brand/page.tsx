import type { Metadata } from "next";
import { requireActor } from "@/server/auth/context";
import { currentWorkspace } from "@/server/current-workspace";
import { getProfile } from "@/server/services/brand";
import { US_TIMEZONES } from "@/server/time";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/ui/action-button";
import { archiveCharacterAction, revokeLikenessAction } from "@/app/actions/settings";
import { fmtDateTime, shortHash } from "@/lib/format";
import { CharacterForm, LikenessForm, ProfileForm, WorkspaceSettingsForm } from "./brand-forms";

export const metadata: Metadata = { title: "Brand & Identity" };

export default async function BrandPage() {
  const actor = await requireActor();
  const [p, { current }] = await Promise.all([getProfile(actor), currentWorkspace(actor)]);
  const appearance = (p.appearance ?? {}) as Record<string, string>;
  const activeRefs = p.likenessRefs.filter((r) => !r.revokedAt);
  return (
    <>
      <PageHeader title="Brand & identity" description="Your creator identity, authorized facial references, fictional adult characters and disclosure language. Reference images are stored privately and never get public URLs." />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Creator profile" />
          <CardBody>
            <ProfileForm hasPhoto={Boolean(p.profilePhotoKey)} hasBanner={Boolean(p.bannerKey)} values={{
              displayName: p.displayName, username: p.username, bio: p.bio, brandVoice: p.brandVoice, visualIdentity: p.visualIdentity,
              hairstyle: appearance.hairstyle ?? "", facialHair: appearance.facialHair ?? "", skinTone: appearance.skinTone ?? "", distinctiveFeatures: appearance.distinctiveFeatures ?? "",
              physique: p.physique, preferredEnvironments: p.preferredEnvironments.join(", "), preferredStyles: p.preferredStyles.join(", "),
              preferredLighting: p.preferredLighting.join(", "), preferredFraming: p.preferredFraming.join(", "), disclosureText: p.disclosureText,
            }} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Authorized facial references" description="Only images you have the legal right to use. Each upload records who is depicted and your consent statement." />
          <CardBody className="space-y-5">
            {p.likenessRefs.length > 0 && (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {p.likenessRefs.map((r) => (
                  <li key={r.id} className="flex gap-3 rounded-xl border border-ink-700 p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/brand-image/likeness?id=${r.id}`} alt={`Reference ${r.label}`} className="size-16 shrink-0 rounded-lg object-cover" />
                    <div className="min-w-0 text-xs">
                      <div className="flex items-center gap-1.5 text-sm text-white">{r.label} {r.revokedAt ? <Badge tone="red">revoked</Badge> : <Badge tone="green">active</Badge>}</div>
                      <div className="text-ink-300">{r.subjectName} · {r.relationship === "SELF" ? "myself" : "authorized other"}</div>
                      <div className="text-ink-400">Consent {fmtDateTime(r.consentConfirmedAt)} · {shortHash(r.sha256)}</div>
                      {!r.revokedAt && <div className="mt-1"><ActionButton variant="ghost" action={revokeLikenessAction.bind(null, r.id)} confirm="Revoke this reference? Characters using it can no longer generate.">Revoke</ActionButton></div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <LikenessForm />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Character profiles" description="Fictional adult characters (21+), optionally using one of your authorized facial references with a fictional body." />
          <CardBody className="space-y-4">
            {p.characters.map((c) => (
              <details key={c.id} className="rounded-xl border border-ink-700 p-3">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-white">{c.name}</span>
                  <Badge>{c.apparentAge}</Badge>
                  {c.likenessRef ? <Badge tone={c.likenessRef.revokedAt ? "red" : "gold"}>face: {c.likenessRef.label}{c.likenessRef.revokedAt ? " (revoked)" : ""}</Badge> : <Badge>fictional</Badge>}
                </summary>
                <div className="mt-3"><CharacterForm refs={activeRefs.map((r) => ({ id: r.id, label: r.label }))} values={{ id: c.id, name: c.name, description: c.description, apparentAge: c.apparentAge, likenessRefId: c.likenessRefId ?? "", physique: c.physique, styleNotes: c.styleNotes, continuityRules: c.continuityRules }} /></div>
                <div className="mt-2"><ActionButton variant="ghost" action={archiveCharacterAction.bind(null, c.id)} confirm="Archive this character?">Archive character</ActionButton></div>
              </details>
            ))}
            <details className="rounded-xl border border-dashed border-ink-600 p-3" open={p.characters.length === 0}>
              <summary className="cursor-pointer text-sm text-ink-200">New character</summary>
              <div className="mt-3"><CharacterForm refs={activeRefs.map((r) => ({ id: r.id, label: r.label }))} values={{}} /></div>
            </details>
          </CardBody>
        </Card>

        {current && (
          <Card>
            <CardHeader title={`Workspace settings · ${current.name}`} description="Categories, intensity levels, disclosure and export defaults for this workspace only." />
            <CardBody>
              <WorkspaceSettingsForm key={current.id} timezones={[...US_TIMEZONES]} values={{
                workspaceId: current.id, disclosureText: current.disclosureText, defaultTimezone: current.defaultTimezone,
                categories: current.categories.join(", "), intensityLevels: current.intensityLevels.join(", "),
                ...(current.exportSettings as { defaultAspectRatio: string; defaultResolution: string }),
              }} />
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
