import { NextResponse }       from "next/server";
import { cookies }            from "next/headers";
import { supabaseAdmin }      from "@/lib/supabaseAdmin";
import { verifySessionValue } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── GET /api/batches/[batchId]/payments ──────────────────────────────────────
// Returns every individual payment that occurred during this batch period.
// Used by the history page to show per-wallet activity per day.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    const cookieStore   = await cookies();
    const sessionValue  = cookieStore.get("admin_session")?.value ?? "";
    const adminPassword = process.env.ADMIN_PASSWORD ?? "";

    if (!verifySessionValue(sessionValue, adminPassword)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { batchId } = await params;
    const sb = supabaseAdmin();

    // Load the batch first (to get period bounds)
    const { data: batch, error: batchErr } = await sb
      .from("batches")
      .select("period_start, period_end, status")
      .eq("id", batchId)
      .maybeSingle();

    if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });
    if (!batch)   return NextResponse.json({ error: "Batch not found" },  { status: 404 });

    // Load every payment in this batch window
    const { data: payments, error: payErr } = await sb
      .from("payments")
      .select("wallet, kind, amount_sol, referrer_wallet, signature, created_at")
      .gte("created_at", batch.period_start)
      .lt("created_at",  batch.period_end)
      .order("created_at", { ascending: true });

    if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, payments: payments ?? [] });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load payments", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
