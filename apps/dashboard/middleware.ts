import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Gerbang auth lapis-1 (edge): redirect ke /login bila tak ada cookie sesi.
 * Sesi DATABASE tak bisa divalidasi di edge, jadi ini cek keberadaan cookie saja;
 * validasi otoritatif (sesi DB + membership + scope) di getAuthContext (server,
 * Node) yang dipakai layout/route. Default-deny tetap di sisi server.
 */
const PUBLIC_PREFIXES = ["/login", "/no-access", "/api/auth"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const hasSession =
    req.cookies.has("authjs.session-token") ||
    req.cookies.has("__Secure-authjs.session-token");
  if (!hasSession) {
    const url = new URL("/login", req.nextUrl);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|solagroup-logo.png).*)"],
};
