import { describe, expect, it } from "vitest";
import { DatabaseStorage, newStorageKey, verifyMediaToken } from "../../src/server/media/storage";
import { MAX_DATABASE_UPLOAD_BYTES } from "../../src/server/media/validation";
import { db } from "../../src/server/db";

describe("database media storage", () => {
  const store = new DatabaseStorage();

  it("stores, overwrites and deletes bytes exactly", async () => {
    const key = newStorageKey("test", "bin");
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));
    await store.put(key, bytes, "application/octet-stream");
    expect((await store.get(key)).equals(bytes)).toBe(true);

    await store.put(key, Buffer.from("second"), "text/plain");
    expect((await store.get(key)).toString()).toBe("second");
    expect(await db.storedObject.findUnique({ where: { key }, select: { size: true, contentType: true } })).toEqual({ size: 6, contentType: "text/plain" });

    await store.delete(key);
    await expect(store.get(key)).rejects.toThrow(/not found/);
    await store.delete(key); // deleting twice is harmless
  });

  it("serves through the signed app route, never a public URL", async () => {
    const url = new URL(await store.signedUrl("k", { ttlSec: 300, versionId: "v1", userId: "u1" }), "http://x");
    expect(url.pathname).toBe("/api/media/v1");
    expect(verifyMediaToken("v1", "u1", Number(url.searchParams.get("exp")), url.searchParams.get("sig")!)).toBe(true);
  });

  it("caps uploads lower than the disk and S3 drivers", () => {
    expect(MAX_DATABASE_UPLOAD_BYTES).toBe(50 * 1024 * 1024);
  });
});
