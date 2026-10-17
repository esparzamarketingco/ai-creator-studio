import { describe, expect, it } from "vitest";
import { register } from "../../src/server/services/auth";
import { signedVersionUrl, uploadAsset } from "../../src/server/services/assets";
import { signMediaToken, storage, verifyMediaToken } from "../../src/server/media/storage";
import { validateMedia } from "../../src/server/media/validation";
import { addLikenessReference } from "../../src/server/services/brand";
import { PASSWORD, PNG_1PX, conceptWithVideo, makeOwner, tinyMp4 } from "../helpers";

describe("private media access", () => {
  it("issues short-lived signed URLs that are bound to the user and version", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { version } = await conceptWithVideo(actor, lifestyle.id);
    const url = new URL(await signedVersionUrl(actor, version.id), "http://x");
    const exp = Number(url.searchParams.get("exp"));
    const sig = url.searchParams.get("sig")!;
    expect(url.pathname).toBe(`/api/media/${version.id}`);
    expect(exp - Date.now() / 1000).toBeLessThanOrEqual(300);
    expect(verifyMediaToken(version.id, actor.userId, exp, sig)).toBe(true);
    expect(verifyMediaToken(version.id, "someone-else", exp, sig)).toBe(false);
    expect(verifyMediaToken("other-version", actor.userId, exp, sig)).toBe(false);
    expect(verifyMediaToken(version.id, actor.userId, exp + 1, sig)).toBe(false);
    const past = Math.floor(Date.now() / 1000) - 1;
    expect(verifyMediaToken(version.id, actor.userId, past, signMediaToken(version.id, actor.userId, past))).toBe(false);
  });

  it("refuses signed URLs to users outside the workspace", async () => {
    const { actor, lifestyle } = await makeOwner();
    const { version } = await conceptWithVideo(actor, lifestyle.id);
    const other = await register({ name: "O", email: "o@example.com", password: PASSWORD, confirmAdult: true });
    await expect(signedVersionUrl({ userId: other.id, role: other.role }, version.id)).rejects.toThrow(/not found/i);
  });

  it("validates files by content, not by the claimed type", async () => {
    await expect(validateMedia(Buffer.from("<?php echo 1; ?> pretending to be mp4"))).rejects.toThrow(/Unsupported/);
    expect((await validateMedia(PNG_1PX)).mime).toBe("image/png");
    const v = await validateMedia(tinyMp4());
    expect(v.mime).toBe("video/mp4");
    expect(v.probe.probedWith).toBe("ffprobe");
    // SVG is only accepted for app-generated simulated placeholders
    await expect(validateMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).rejects.toThrow(/Unsupported/);
  });

  it("rejects an image uploaded as the final video", async () => {
    const { actor, lifestyle } = await makeOwner();
    await expect(uploadAsset(actor, { workspaceId: lifestyle.id, kind: "VIDEO", title: "x" }, PNG_1PX)).rejects.toThrow(/expects a video/);
  });

  it("blocks storage path traversal", async () => {
    await expect(storage().get("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
  });

  it("requires explicit consent and rights to store a likeness reference", async () => {
    const { actor } = await makeOwner();
    const base = { label: "Front", subjectName: "Me", relationship: "SELF" as const, consentStatement: "This is my own face; I authorize its use for my brand." };
    // @ts-expect-error confirmRights missing on purpose
    await expect(addLikenessReference(actor, { ...base, confirmAdult: true }, PNG_1PX)).rejects.toThrow();
    const ref = await addLikenessReference(actor, { ...base, confirmRights: true, confirmAdult: true }, PNG_1PX);
    expect(ref.storageKey.startsWith("likeness/")).toBe(true);
    expect(ref.consentConfirmedAt).toBeInstanceOf(Date);
  });
});
