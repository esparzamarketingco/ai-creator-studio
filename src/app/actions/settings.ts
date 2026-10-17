"use server";
import { bool, fileBuffer, list, optStr, run, str } from "./run";
import { addLikenessReference, archiveCharacter, revokeLikenessReference, saveCharacter, setProfileImage, updateProfile } from "@/server/services/brand";
import { disconnectIntegration, reconnectBuiltin, recordPolicyVerification, runHealthCheck, saveCredentials } from "@/server/services/integrations";
import { attestAdultAccess, beginTotpEnrollment, changePassword, confirmTotpEnrollment, deleteAccount, disableTotp, revokeOtherSessions, revokeOwnSession, setSecurityNotifications, withdrawAdultAccess } from "@/server/services/security";
import { updateWorkspaceSettings } from "@/server/services/workspaces";
import { AppError } from "@/server/errors";
import { clearSessionCookie } from "@/server/auth/context";
import { redirect } from "next/navigation";

export async function saveProfileAction(_: unknown, fd: FormData) {
  return run(async (a) => {
    await updateProfile(a, {
      displayName: str(fd, "displayName"), username: str(fd, "username"), bio: str(fd, "bio"), brandVoice: str(fd, "brandVoice"), visualIdentity: str(fd, "visualIdentity"),
      appearance: { hairstyle: str(fd, "hairstyle"), facialHair: str(fd, "facialHair"), skinTone: str(fd, "skinTone"), distinctiveFeatures: str(fd, "distinctiveFeatures") },
      physique: str(fd, "physique"), preferredEnvironments: list(fd, "preferredEnvironments"), preferredStyles: list(fd, "preferredStyles"),
      preferredLighting: list(fd, "preferredLighting"), preferredFraming: list(fd, "preferredFraming"), disclosureText: str(fd, "disclosureText"),
    });
    for (const which of ["profilePhoto", "banner"] as const) {
      const f = await fileBuffer(fd, which);
      if (f) await setProfileImage(a, which, f);
    }
  }, { message: "Brand profile saved." });
}

export async function addLikenessAction(_: unknown, fd: FormData) {
  return run(async (a) => {
    const f = await fileBuffer(fd, "file");
    if (!f) throw new AppError("VALIDATION", "Choose a reference photo.");
    await addLikenessReference(a, {
      label: str(fd, "label"), subjectName: str(fd, "subjectName"), relationship: (str(fd, "relationship") || "SELF") as "SELF",
      consentStatement: str(fd, "consentStatement"), confirmRights: bool(fd, "confirmRights") as true, confirmAdult: bool(fd, "confirmAdult") as true,
    }, f);
  }, { message: "Reference stored privately with your consent record." });
}

export async function revokeLikenessAction(id: string) {
  return run((a) => revokeLikenessReference(a, id), { message: "Reference revoked. It can no longer be used for generation." });
}

export async function saveCharacterAction(_: unknown, fd: FormData) {
  return run((a) => saveCharacter(a, {
    id: optStr(fd, "id"), name: str(fd, "name"), description: str(fd, "description"), apparentAge: Number(str(fd, "apparentAge")),
    adultConfirmed: bool(fd, "adultConfirmed") as true, isFictional: !optStr(fd, "likenessRefId"), likenessRefId: optStr(fd, "likenessRefId") ?? null,
    physique: str(fd, "physique"), styleNotes: str(fd, "styleNotes"), continuityRules: str(fd, "continuityRules"),
  }).then(() => undefined), { message: "Character saved." });
}

export async function archiveCharacterAction(id: string) {
  return run((a) => archiveCharacter(a, id), { message: "Character archived." });
}

export async function saveWorkspaceSettingsAction(_: unknown, fd: FormData) {
  return run((a) => updateWorkspaceSettings(a, str(fd, "workspaceId"), {
    disclosureText: str(fd, "disclosureText"), defaultTimezone: str(fd, "defaultTimezone"), categories: list(fd, "categories"), intensityLevels: list(fd, "intensityLevels"),
    exportSettings: { defaultAspectRatio: str(fd, "defaultAspectRatio") as "9:16", defaultResolution: str(fd, "defaultResolution") },
  }), { message: "Workspace settings saved." });
}

export async function saveCredentialsAction(_: unknown, fd: FormData) {
  return run((a) => saveCredentials(a, { workspaceId: str(fd, "workspaceId"), providerKey: str(fd, "providerKey"), credentials: { apiKey: str(fd, "apiKey") } }).then(() => undefined), { message: "Credentials encrypted and saved. Run the health check next." });
}

export async function policyAction(_: unknown, fd: FormData) {
  return run((a) => recordPolicyVerification(a, {
    integrationId: str(fd, "integrationId"), reviewedApiDocs: bool(fd, "reviewedApiDocs") as true, reviewedContentPolicy: bool(fd, "reviewedContentPolicy") as true,
    commercialUseAllowed: bool(fd, "commercialUseAllowed") as true, reviewedPricing: bool(fd, "reviewedPricing") as true,
    permitsAdultContent: bool(fd, "permitsAdultContent"), permitsLikeness: bool(fd, "permitsLikeness"), notes: str(fd, "notes"),
  }).then(() => undefined), { message: "Verification recorded." });
}

export async function healthCheckAction(id: string) {
  return run(async (a) => {
    const r = await runHealthCheck(a, id);
    if (!r.ok) throw new AppError("INTEGRATION_UNAVAILABLE", r.message);
    return r.message;
  }, { message: "Health check passed." });
}

export async function disconnectAction(id: string) {
  return run((a) => disconnectIntegration(a, id).then(() => undefined), { message: "Disconnected. Queued posts to it were canceled." });
}

export async function reconnectAction(id: string) {
  return run((a) => reconnectBuiltin(a, id).then(() => undefined), { message: "Reconnected." });
}

export async function changePasswordAction(_: unknown, fd: FormData) {
  return run(async (a) => {
    if (str(fd, "next") !== str(fd, "confirm")) throw new AppError("VALIDATION", "The new passwords do not match.");
    await changePassword(a, str(fd, "current"), str(fd, "next"));
  }, { message: "Password changed. Other sessions were signed out." });
}

export async function beginTotpAction() {
  return run((a) => beginTotpEnrollment(a), { revalidate: [] });
}

export async function confirmTotpAction(_: unknown, fd: FormData) {
  return run((a) => confirmTotpEnrollment(a, str(fd, "code")), { message: "Two-factor authentication is on." });
}

export async function disableTotpAction(_: unknown, fd: FormData) {
  return run((a) => disableTotp(a, str(fd, "password"), str(fd, "code")), { message: "Two-factor authentication is off." });
}

export async function revokeSessionAction(id: string) {
  return run((a) => revokeOwnSession(a, id), { message: "Session signed out." });
}

export async function revokeOthersAction() {
  return run((a) => revokeOtherSessions(a), { message: "All other sessions signed out." });
}

export async function attestAdultAction(_: unknown, fd: FormData) {
  return run((a) => attestAdultAccess(a, str(fd, "password"), bool(fd, "confirm")), { message: "Restricted workspace unlocked." });
}

export async function withdrawAdultAction() {
  return run((a) => withdrawAdultAccess(a), { message: "Restricted workspace locked." });
}

export async function securityNotificationsAction(on: boolean) {
  return run((a) => setSecurityNotifications(a, on), { message: "Saved." });
}

export async function deleteAccountAction(_: unknown, fd: FormData) {
  const r = await run((a) => deleteAccount(a, str(fd, "password"), str(fd, "confirmation")), { revalidate: [] });
  if (!r.ok) return r;
  await clearSessionCookie();
  redirect("/login");
}
