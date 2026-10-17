import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, validateSessionToken } from "@/server/auth/sessions";
import { exportAccountData } from "@/server/services/security";

export async function GET() {
  const session = await validateSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session || session.mfaPending) return new NextResponse("Unauthorized", { status: 401 });
  const data = await exportAccountData({ userId: session.userId, role: session.user.role, sessionId: session.id });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="ai-creator-studio-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" },
  });
}
