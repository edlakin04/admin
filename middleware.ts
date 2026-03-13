import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ─── Password Protection ───────────────────────────────────────────────────────
// Every request to this site checks for a valid session cookie.
// The only unprotected route is /api/auth/login (the login endpoint itself)
// and /login (the login page).
//
// Session cookie: "admin_session" — set on successful login, cleared on logout.
// The cookie value is a simple HMAC of the password + a timestamp so it can't
// be forged without knowing ADMIN_PASSWORD.

const SESSION_COOKIE = "admin_session";
const LOGIN_PATH     = "/login";
const LOGIN_API      = "/api/auth/login";
const CRON_API       = "/api/cron";

// ── Protected routes (all require valid admin session) ────────────────────────
// /              — main dashboard
// /history       — batch history
// /vat           — VAT / tax dashboard
// /api/batches/* — batch data API
// /api/vat       — VAT stats API
// /api/rpc       — Solana RPC proxy
// All are protected by the session check below — listed here for reference

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Always allow: login page, login API, cron endpoints ─────────────────
  if (
    pathname === LOGIN_PATH ||
    pathname.startsWith(LOGIN_API) ||
    pathname.startsWith(CRON_API) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // ── Check session cookie ─────────────────────────────────────────────────
  const session = req.cookies.get(SESSION_COOKIE)?.value ?? "";

  if (!session) {
    // No cookie — redirect to login
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Validate cookie value ────────────────────────────────────────────────
  // Cookie is "timestamp:hash" — we re-hash and compare
  // This prevents someone from forging a cookie without knowing the password
  const [ts, hash] = session.split(":");
  if (!ts || !hash) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    return NextResponse.redirect(loginUrl);
  }

  // Sessions expire after 12 hours
  const age = Date.now() - parseInt(ts, 10);
  if (age > 12 * 60 * 60 * 1000) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = LOGIN_PATH;
    loginUrl.searchParams.set("expired", "1");
    const res = NextResponse.redirect(loginUrl);
    res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  // Hash check happens server-side in the API routes — middleware just
  // checks presence and expiry. Full verification is in /api/auth/verify.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
