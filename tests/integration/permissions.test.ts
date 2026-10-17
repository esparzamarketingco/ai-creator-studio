import { describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import { register } from "../../src/server/services/auth";
import { createConcept, listConcepts } from "../../src/server/services/concepts";
import { decide } from "../../src/server/services/approvals";
import { attestAdultAccess } from "../../src/server/services/security";
import { listAccessibleWorkspaces } from "../../src/server/permissions";
import { PASSWORD, conceptWithVideo, makeOwner } from "../helpers";

describe("authorization", () => {
  it("non-members cannot see another workspace's content", async () => {
    const { actor, lifestyle } = await makeOwner();
    await createConcept(actor, { workspaceId: lifestyle.id, title: "Private idea" });
    const outsider = await register({ name: "Out", email: "out@example.com", password: PASSWORD, confirmAdult: true });
    await expect(listConcepts({ userId: outsider.id, role: outsider.role }, lifestyle.id)).rejects.toThrow("Workspace not found.");
  });

  it("contributors can plan but cannot approve", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { version } = await conceptWithVideo(actor, lifestyle.id);
    const editor = await register({ name: "Ed", email: "ed@example.com", password: PASSWORD, confirmAdult: true });
    await db.workspaceMember.create({ data: { workspaceId: lifestyle.id, userId: editor.id, role: "CONTRIBUTOR" } });
    const ea = { userId: editor.id, role: editor.role };
    await expect(createConcept(ea, { workspaceId: lifestyle.id, title: "Editor idea" })).resolves.toBeTruthy();
    await expect(decide(ea, { assetVersionId: version.id, decision: "APPROVED", previewCompleted: true })).rejects.toThrow(/cannot approve/);
  });

  it("global viewers cannot approve even with a manager membership", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { version } = await conceptWithVideo(actor, lifestyle.id);
    const viewer = await register({ name: "V", email: "v@example.com", password: PASSWORD, confirmAdult: true });
    await db.user.update({ where: { id: viewer.id }, data: { role: "VIEWER" } });
    await db.workspaceMember.create({ data: { workspaceId: lifestyle.id, userId: viewer.id, role: "MANAGER" } });
    await expect(decide({ userId: viewer.id, role: "VIEWER" }, { assetVersionId: version.id, decision: "APPROVED", previewCompleted: true })).rejects.toThrow(/Viewer accounts/);
  });

  it("the restricted workspace stays locked until the user re-authenticates and attests adult access", async () => {
    const { actor, adult } = await makeOwner();
    await expect(createConcept(actor, { workspaceId: adult.id, title: "Locked" })).rejects.toThrow(/restricted/);
    expect((await listAccessibleWorkspaces(actor)).find((w) => w.id === adult.id)?.locked).toBe(true);
    await expect(attestAdultAccess(actor, "wrong-password", true)).rejects.toThrow(/Password is incorrect/);
    await attestAdultAccess(actor, PASSWORD, true);
    await expect(createConcept(actor, { workspaceId: adult.id, title: "Now allowed" })).resolves.toBeTruthy();
  });

  it("keeps the two workspaces' libraries separate", async () => {
    const { actor, lifestyle, adult } = await makeOwner();
    await attestAdultAccess(actor, PASSWORD, true);
    await createConcept(actor, { workspaceId: lifestyle.id, title: "A only" });
    await createConcept(actor, { workspaceId: adult.id, title: "B only" });
    expect((await listConcepts(actor, lifestyle.id)).map((c) => c.title)).toEqual(["A only"]);
    expect((await listConcepts(actor, adult.id)).map((c) => c.title)).toEqual(["B only"]);
  });

  it("rejects categories not configured for the workspace", async () => {
    const { actor, lifestyle } = await makeOwner();
    await expect(createConcept(actor, { workspaceId: lifestyle.id, title: "x", category: "Explicit" })).rejects.toThrow(/category/);
  });
});
