import { NextResponse } from "next/server";
import { cookies }      from "next/headers";
import { verifySessionValue } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── POST /api/rpc ────────────────────────────────────────────────────────────
// Server-side proxy for Solana RPC calls.
// The browser posts a standard JSON-RPC body here instead of calling
// Helius directly — keeps the RPC URL and API key server-side only.
//
// Only authenticated admin sessions can use this endpoint.
// Only safe read methods are allowed (no writes via this proxy).

const ALLOWED_METHODS = new Set([
  "getLatestBlockhash",
  "getBlockhash",
  "getFeeForMessage",
  "getBalance",
  "getTransaction",
  "getAccountInfo",
  "getMinimumBalanceForRentExemption",
  "getRecentBlockhash",
]);

export async function POST(req: Request) {
  try {
    // ── Auth — must be a logged-in admin session ─────────────────────────
    const cookieStore   = await cookies();
    const sessionValue  = cookieStore.get("admin_session")?.value ?? "";
    const adminPassword = process.env.ADMIN_PASSWORD ?? "";

    if (!verifySessionValue(sessionValue, adminPassword)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Parse the JSON-RPC body ───────────────────────────────────────────
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // ── Safety check — only allow read methods ───────────────────────────
    const method = body?.method as string | undefined;
    if (!method || !ALLOWED_METHODS.has(method)) {
      return NextResponse.json(
        { error: `Method '${method}' not allowed via proxy` },
        { status: 403 }
      );
    }

    // ── Forward to Helius RPC ─────────────────────────────────────────────
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      return NextResponse.json({ error: "Missing SOLANA_RPC_URL" }, { status: 500 });
    }

    const rpcRes = await fetch(rpcUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(10_000),
    });

    const rpcJson = await rpcRes.json();
    return NextResponse.json(rpcJson, { status: rpcRes.status });

  } catch (e: any) {
    return NextResponse.json(
      { error: "RPC proxy failed", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
