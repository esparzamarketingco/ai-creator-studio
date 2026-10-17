import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email", "/api/health"];

/**
 * Fast redirect for signed-out visitors. This only checks that a session cookie exists;
 * every page, action and API route validates the session against the database.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.get("acs_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
