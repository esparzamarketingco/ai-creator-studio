import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import { SESSION_COOKIE, validateSessionToken } from "@/server/auth/sessions";
import { storage, verifyMediaToken } from "@/server/media/storage";
import { requireWorkspace } from "@/server/permissions";

/**
 * Private media delivery (local storage driver). Requires BOTH a valid, unexpired signature
 * bound to this user + version AND the same user's live session with workspace access.
 * Responses are never cached by shared caches.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const exp = Number(req.nextUrl.searchParams.get("exp"));
  const sig = req.nextUrl.searchParams.get("sig") ?? "";
  const session = await validateSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session || session.mfaPending) return new NextResponse("Unauthorized", { status: 401 });
  if (!verifyMediaToken(versionId, session.userId, exp, sig)) return new NextResponse("Link expired or invalid", { status: 403 });
  const version = await db.assetVersion.findUnique({ where: { id: versionId }, include: { asset: true } });
  if (!version || version.asset.deletedAt) return new NextResponse("Not found", { status: 404 });
  try {
    await requireWorkspace({ userId: session.userId, role: session.user.role }, version.asset.workspaceId, "view");
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  const data = await storage().get(version.storageKey);
  const total = data.length;
  const headers: Record<string, string> = {
    "Content-Type": version.mimeType,
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };
  if (req.nextUrl.searchParams.get("dl")) headers["Content-Disposition"] = `attachment; filename="asset-${version.assetId}-v${version.versionNumber}.${version.mimeType.split("/")[1].replace("svg+xml", "svg").replace("quicktime", "mov")}"`;
  // Range support so video players can seek.
  const range = req.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;
    if (start >= total || start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
    return new NextResponse(new Uint8Array(data.subarray(start, end + 1)), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) } });
  }
  return new NextResponse(new Uint8Array(data), { status: 200, headers: { ...headers, "Content-Length": String(total) } });
}
