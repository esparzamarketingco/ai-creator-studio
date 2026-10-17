import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { AppError } from "../errors";

const run = promisify(execFile);

export const ALLOWED_TYPES = {
  "video/mp4": { kind: "VIDEO", ext: "mp4" },
  "video/quicktime": { kind: "VIDEO", ext: "mov" },
  "video/webm": { kind: "VIDEO", ext: "webm" },
  "image/jpeg": { kind: "IMAGE", ext: "jpg" },
  "image/png": { kind: "IMAGE", ext: "png" },
  "image/webp": { kind: "IMAGE", ext: "webp" },
  "image/svg+xml": { kind: "IMAGE", ext: "svg" }, // only for simulated placeholders produced by the app
} as const;
export type AllowedMime = keyof typeof ALLOWED_TYPES;

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/** Detect the real type from magic bytes. The client-supplied type is never trusted. */
export function sniffMime(buf: Buffer): AllowedMime | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  if (buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("ascii");
    return brand.startsWith("qt") ? "video/quicktime" : "video/mp4";
  }
  return null;
}

export type MediaProbe = { durationSec?: number; width?: number; height?: number; codec?: string; probedWith: "ffprobe" | "none"; warnings: string[] };

/** Validate an uploaded/generated file. Uses ffprobe for video when available. */
export async function validateMedia(buf: Buffer, opts: { allowSvg?: boolean } = {}): Promise<{ mime: AllowedMime; probe: MediaProbe }> {
  if (buf.length === 0) throw new AppError("VALIDATION", "The file is empty.");
  if (buf.length > MAX_UPLOAD_BYTES) throw new AppError("VALIDATION", "The file is larger than 500 MB.");
  let mime = sniffMime(buf);
  if (!mime && opts.allowSvg && buf.subarray(0, 200).toString("utf8").includes("<svg")) mime = "image/svg+xml";
  if (!mime) throw new AppError("VALIDATION", "Unsupported file type. Upload MP4, MOV, WebM, JPEG, PNG or WebP.");
  const probe: MediaProbe = { probedWith: "none", warnings: [] };
  if (ALLOWED_TYPES[mime].kind === "VIDEO") Object.assign(probe, await ffprobe(buf));
  return { mime, probe };
}

async function ffprobe(buf: Buffer): Promise<Partial<MediaProbe>> {
  const dir = await mkdtemp(path.join(tmpdir(), "acs-probe-"));
  const file = path.join(dir, "in");
  try {
    await writeFile(file, buf);
    const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { timeout: 30_000 });
    const info = JSON.parse(stdout) as { streams?: { codec_type: string; codec_name: string; width?: number; height?: number }[]; format?: { duration?: string } };
    const v = info.streams?.find((s) => s.codec_type === "video");
    if (!v) throw new AppError("VALIDATION", "The video file has no video stream.");
    return { probedWith: "ffprobe", durationSec: info.format?.duration ? Number(info.format.duration) : undefined, width: v.width, height: v.height, codec: v.codec_name };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { probedWith: "none", warnings: ["ffprobe not installed; video metadata not verified"] };
    throw new AppError("VALIDATION", "The video could not be read. It may be corrupt or in an unsupported codec.");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
