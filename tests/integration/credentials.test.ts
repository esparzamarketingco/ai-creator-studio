import { describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import { listIntegrations, recordPolicyVerification, saveCredentials } from "../../src/server/services/integrations";
import { registerGenerationProvider } from "../../src/server/providers/registry";
import { audit } from "../../src/server/audit";
import { exportAccountData } from "../../src/server/services/security";
import { makeOwner } from "../helpers";

registerGenerationProvider({
  key: "test-real-video", displayName: "Test real provider", kinds: ["VIDEO"], isSimulated: false,
  capabilities: { allowsAdultContent: false, allowsLikeness: false },
  submit: async () => ({ externalJobId: "x" }), poll: async () => ({ state: "running" }),
});

describe("API credential protection", () => {
  it("encrypts credentials at rest and never returns them", async () => {
    const { actor, lifestyle } = await makeOwner();
    const saved = await saveCredentials(actor, { workspaceId: lifestyle.id, providerKey: "test-real-video", credentials: { apiKey: "sk-test-SUPERSECRET-9876" } });
    expect(JSON.stringify(saved)).not.toContain("SUPERSECRET");
    expect(saved.credentialHint).toBe("••••9876");
    const row = await db.platformIntegration.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.credentialsEnc).toBeTruthy();
    expect(row.credentialsEnc).not.toContain("SUPERSECRET");
    const listed = await listIntegrations(actor, lifestyle.id);
    expect(JSON.stringify(listed)).not.toContain("SUPERSECRET");
    expect(JSON.stringify(listed)).not.toContain(row.credentialsEnc!);
    expect(JSON.stringify(await exportAccountData(actor))).not.toContain(row.credentialsEnc!);
  });

  it("refuses to connect providers without an installed adapter", async () => {
    const { actor, lifestyle } = await makeOwner();
    await expect(saveCredentials(actor, { workspaceId: lifestyle.id, providerKey: "onlyfans", credentials: { password: "x" } })).rejects.toThrow(/No adapter/);
  });

  it("only managers can save credentials", async () => {
    const { actor, lifestyle } = await makeOwner();
    await db.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: lifestyle.id, userId: actor.userId } }, data: { role: "CONTRIBUTOR" } });
    await expect(saveCredentials(actor, { workspaceId: lifestyle.id, providerKey: "test-real-video", credentials: { apiKey: "k" } })).rejects.toThrow(/cannot manage/);
  });

  it("cannot enable adult content for a provider whose adapter does not declare it", async () => {
    const { actor, lifestyle } = await makeOwner();
    const saved = await saveCredentials(actor, { workspaceId: lifestyle.id, providerKey: "test-real-video", credentials: { apiKey: "k-12345678" } });
    await expect(recordPolicyVerification(actor, { integrationId: saved.id, reviewedApiDocs: true, reviewedContentPolicy: true, commercialUseAllowed: true, reviewedPricing: true, permitsAdultContent: true, permitsLikeness: false, notes: "Checked terms page on 2026-10-17" })).rejects.toThrow(/does not declare adult-content/);
  });

  it("redacts secret-looking fields from audit metadata", async () => {
    await audit({ action: "test", entityType: "X", metadata: { apiKey: "abc", password: "p", nested: { token: "t" }, ok: 1 } });
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "test" } });
    expect(JSON.stringify(row.metadata)).not.toMatch(/"abc"|"p"|"t"/);
    expect((row.metadata as Record<string, unknown>).ok).toBe(1);
  });
});
