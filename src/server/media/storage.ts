import { mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../env";
import { db } from "../db";
import { hmacHex, randomToken, safeEqualHex } from "../crypto";

/** Provider-independent private object storage. Objects are never publicly readable. */
export interface MediaStorage {
  readonly name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Short-lived URL for the browser. Local and database drivers return an app route; S3 returns a presigned URL. */
  signedUrl(key: string, opts: { ttlSec: number; versionId: string; userId: string; download?: boolean }): Promise<string>;
}

export const newStorageKey = (prefix: string, ext: string) =>
  `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomToken(16)}${ext ? `.${ext.replace(/^\./, "")}` : ""}`;

class LocalStorage implements MediaStorage {
  readonly name = "local";
  constructor(private root: string) {}
  private resolve(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.resolve(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data, { mode: 0o600 });
  }
  async get(key: string) {
    return readFile(this.resolve(key));
  }
  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
  async exists(key: string) {
    return stat(this.resolve(key)).then(() => true, () => false);
  }
  async signedUrl(_key: string, opts: { ttlSec: number; versionId: string; userId: string; download?: boolean }) {
    return appRouteUrl(opts);
  }
}

/** Signed app-route URL shared by the drivers that serve bytes through /api/media. */
function appRouteUrl(opts: { ttlSec: number; versionId: string; userId: string; download?: boolean }) {
  const exp = Math.floor(Date.now() / 1000) + opts.ttlSec;
  const sig = signMediaToken(opts.versionId, opts.userId, exp);
  return `/api/media/${opts.versionId}?exp=${exp}&sig=${sig}${opts.download ? "&dl=1" : ""}`;
}

/** Stores bytes in Postgres, for hosts with no persistent disk and no object storage (free tiers). */
export class DatabaseStorage implements MediaStorage {
  readonly name = "database";
  async put(key: string, data: Buffer, contentType: string) {
    const bytes = new Uint8Array(data);
    await db.storedObject.upsert({
      where: { key },
      create: { key, contentType, size: data.length, data: bytes },
      update: { contentType, size: data.length, data: bytes },
    });
  }
  async get(key: string) {
    const row = await db.storedObject.findUnique({ where: { key }, select: { data: true } });
    if (!row) throw new Error("Stored object not found");
    return Buffer.from(row.data);
  }
  async delete(key: string) {
    await db.storedObject.deleteMany({ where: { key } });
  }
  async signedUrl(_key: string, opts: { ttlSec: number; versionId: string; userId: string; download?: boolean }) {
    return appRouteUrl(opts);
  }
}

class S3Storage implements MediaStorage {
  readonly name = "s3";
  private client: S3Client;
  constructor(private bucket: string) {
    const e = env();
    this.client = new S3Client({
      region: e.S3_REGION || "us-east-1",
      endpoint: e.S3_ENDPOINT || undefined,
      forcePathStyle: e.S3_FORCE_PATH_STYLE === "true",
      credentials: e.S3_ACCESS_KEY_ID ? { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? "" } : undefined,
    });
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType, ServerSideEncryption: "AES256" }));
  }
  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  signedUrl(key: string, opts: { ttlSec: number; download?: boolean }) {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ...(opts.download ? { ResponseContentDisposition: "attachment" } : {}) }),
      { expiresIn: opts.ttlSec },
    );
  }
}

let instance: MediaStorage | null = null;
export function storage(): MediaStorage {
  if (instance) return instance;
  const e = env();
  if (e.STORAGE_DRIVER === "s3") {
    if (!e.S3_BUCKET) throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET");
    instance = new S3Storage(e.S3_BUCKET);
  } else if (e.STORAGE_DRIVER === "database") {
    instance = new DatabaseStorage();
  } else {
    // Runtime-only path: keep the bundler from tracing the whole project for it.
    instance = new LocalStorage(path.resolve(/* turbopackIgnore: true */ process.cwd(), e.STORAGE_DIR));
  }
  return instance;
}

/** HMAC over version + user + expiry. The media route also requires the same user's live session. */
export function signMediaToken(versionId: string, userId: string, exp: number) {
  return hmacHex(`media:${versionId}:${userId}:${exp}`);
}

export function verifyMediaToken(versionId: string, userId: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  return safeEqualHex(signMediaToken(versionId, userId, exp), sig);
}

export const SIGNED_URL_TTL_SEC = 300;
