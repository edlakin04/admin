import { NextResponse } from "next/server";
import { createHmac }   from "crypto";
import { verifySessionValue } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SESSION_COOKIE  = "admin_session";
const SESSION_MAX_AGE = 12 * 60 * 60; // 12 hours in seconds

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSessionValue(password: string): string {
  // "timestamp:hmac(timestamp, password)"
  // Middleware checks the timestamp for expiry.
  // This endpoint and /api/auth/verify check the full hmac.
  const ts   = Date.now().toString();
  const hmac = createHmac("sha256", password).update(ts).digest("hex");
  return `${ts}:${hmac}`;
}



// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// Body: { password: string }
// Sets admin_session cookie on success.

export async function POST(req: Request) {
  try {
    const body     = await req.json().catch(() => null);
    const password = (body?.password ?? "").trim();

    if (!password) {
      return NextResponse.json({ error: "Missing password" }, { status: 400 });
    }

    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    // Constant-time comparison to prevent timing attacks
    if (password.length !== adminPassword.length) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    let diff = 0;
    for (let i = 0; i < adminPassword.length; i++) {
      diff |= password.charCodeAt(i) ^ adminPassword.charCodeAt(i);
    }

    if (diff !== 0) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    // Password correct — mint session cookie
    const sessionValue = makeSessionValue(adminPassword);

    const res = NextResponse.json({ ok: true });
    res.headers.set(
      "Set-Cookie",
      [
        `${SESSION_COOKIE}=${sessionValue}`,
        `Path=/`,
        `HttpOnly`,
        `Secure`,
        `SameSite=Strict`,
        `Max-Age=${SESSION_MAX_AGE}`,
      ].join("; ")
    );

    return res;

  } catch (e: any) {
    return NextResponse.json(
      { error: "Login failed", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/auth/login ───────────────────────────────────────────────────
// Clears the session cookie (logout)

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.headers.set(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
  );
  return res;
}
