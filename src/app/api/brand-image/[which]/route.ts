import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import { SESSION_COOKIE, validateSessionToken } from "@/server/auth/sessions";
import { storage } from "@/server/media/storage";
import { sniffMime } from "@/server/media/validation";

/** Private profile photo / banner / likeness reference thumbnails for the signed-in owner only. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ which: string }> }) {
  const { which } = await params;
  const session = await validateSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session || session.mfaPending) return new NextResponse("Unauthorized", { status: 401 });
  const profile = await db.creatorProfile.findUnique({ where: { userId: session.userId }, include: { likenessRefs: true } });
  let key: string | null | undefined = null;
  if (which === "profile") key = profile?.profilePhotoKey;
  else if (which === "banner") key = profile?.bannerKey;
  else if (which === "likeness") key = profile?.likenessRefs.find((r) => r.id === req.nextUrl.searchParams.get("id"))?.storageKey;
  if (!key) return new NextResponse("Not found", { status: 404 });
  const data = await storage().get(key);
  return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": sniffMime(data) ?? "application/octet-stream", "Cache-Control": "private, no-store" } });
}
