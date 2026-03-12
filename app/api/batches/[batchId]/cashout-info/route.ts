import { NextResponse }       from "next/server";
import { cookies }            from "next/headers";
import { verifySessionValue } from "@/app/api/auth/login/route";

export const dynamic = "force-dynamic";

// ─── GET /api/batches/[batchId]/cashout-info ──────────────────────────────────
// Returns the cashout wallet address so the UI knows where to send the tx.
// The wallet itself lives in CASHOUT_WALLET env var — never hardcoded client-side.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const cookieStore   = await cookies();
  const sessionValue  = cookieStore.get("admin_session")?.value ?? "";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";

  if (!verifySessionValue(sessionValue, adminPassword)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await params; // consume params even though we don't need batchId here

  const cashoutWallet = process.env.CASHOUT_WALLET;
  if (!cashoutWallet) {
    return NextResponse.json({ error: "Missing CASHOUT_WALLET env var" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, cashoutWallet });
}
