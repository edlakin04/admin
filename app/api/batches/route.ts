import { NextResponse }          from "next/server";
import { cookies }               from "next/headers";
import { supabaseAdmin }         from "@/lib/supabaseAdmin";
import { getSolGbpPrice, solToGbp } from "@/lib/solPrice";
import { verifySessionValue }    from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── GET /api/batches ─────────────────────────────────────────────────────────
// Returns all batches for the dashboard:
//   - The current open batch (live revenue, no affiliate payouts yet)
//   - All closed/in-progress batches that haven't been completed yet
//   - Completed batches for the history tab
//
// Each batch includes its affiliate payout rows so the UI
// can show who's paid and who isn't without extra fetches.

export async function GET(req: Request) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const cookieStore   = await cookies();
    const sessionValue  = cookieStore.get("admin_session")?.value ?? "";
    const adminPassword = process.env.ADMIN_PASSWORD ?? "";

    if (!verifySessionValue(sessionValue, adminPassword)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    // ── Fetch all batches newest first ────────────────────────────────────
    const { data: batches, error: batchErr } = await sb
      .from("batches")
      .select("*")
      .order("period_start", { ascending: false });

    if (batchErr) {
      return NextResponse.json({ error: batchErr.message }, { status: 500 });
    }

    const batchList = batches ?? [];

    if (batchList.length === 0) {
      return NextResponse.json({ ok: true, batches: [], solGbpPrice: null });
    }

    // ── Fetch all affiliate payout rows for non-open batches ──────────────
    const nonOpenIds = batchList
      .filter((b) => b.status !== "open")
      .map((b) => b.id);

    let payoutsByBatch: Record<string, any[]> = {};

    if (nonOpenIds.length > 0) {
      const { data: payouts, error: payoutErr } = await sb
        .from("batch_affiliate_payouts")
        .select("*")
        .in("batch_id", nonOpenIds)
        .order("amount_sol", { ascending: false });

      if (!payoutErr && payouts) {
        for (const p of payouts) {
          if (!payoutsByBatch[p.batch_id]) payoutsByBatch[p.batch_id] = [];
          payoutsByBatch[p.batch_id].push(p);
        }
      }
    }

    // ── For the open batch: compute live revenue from payments table ───────
    const openBatch = batchList.find((b) => b.status === "open");
    let liveRevenue = {
      total_revenue_sol:   0,
      total_affiliate_sol: 0,
      user_sub_count:      0,
      dev_sub_count:       0,
    };

    if (openBatch) {
      // Pull payments in the open batch window
      const { data: livePayments } = await sb
        .from("payments")
        .select("kind, amount_sol")
        .gte("created_at", openBatch.period_start)
        .lt("created_at", openBatch.period_end);

      const { data: liveEarnings } = await sb
        .from("affiliate_earnings")
        .select("amount_sol")
        .gte("created_at", openBatch.period_start)
        .lt("created_at", openBatch.period_end);

      for (const p of livePayments ?? []) {
        liveRevenue.total_revenue_sol += Number(p.amount_sol ?? 0);
        if (p.kind === "subscription") liveRevenue.user_sub_count++;
        if (p.kind === "dev_fee")      liveRevenue.dev_sub_count++;
      }
      for (const e of liveEarnings ?? []) {
        liveRevenue.total_affiliate_sol += Number(e.amount_sol ?? 0);
      }

      // Round
      liveRevenue.total_revenue_sol   = Math.round(liveRevenue.total_revenue_sol   * 1e9) / 1e9;
      liveRevenue.total_affiliate_sol = Math.round(liveRevenue.total_affiliate_sol * 1e9) / 1e9;
    }

    // ── Fetch SOL/GBP price ───────────────────────────────────────────────
    const solGbpPrice = await getSolGbpPrice();

    // ── Build response ────────────────────────────────────────────────────
    const out = batchList.map((b) => {
      const isOpen     = b.status === "open";
      const revSol     = isOpen ? liveRevenue.total_revenue_sol   : Number(b.total_revenue_sol   ?? 0);
      const affSol     = isOpen ? liveRevenue.total_affiliate_sol : Number(b.total_affiliate_sol ?? 0);
      const cashoutSol = Number(b.cashout_sol ?? 0);

      // Your cut = revenue - affiliates (only meaningful once closed)
      const yourCutSol = Math.max(0, Math.round((revSol - affSol) * 1e9) / 1e9);

      return {
        id:                   b.id,
        period_start:         b.period_start,
        period_end:           b.period_end,
        status:               b.status,
        closed_at:            b.closed_at,
        completed_at:         b.completed_at,

        // Revenue
        total_revenue_sol:    revSol,
        total_revenue_gbp:    solToGbp(revSol, solGbpPrice),
        user_sub_count:       isOpen ? liveRevenue.user_sub_count : (b.user_sub_count ?? 0),
        dev_sub_count:        isOpen ? liveRevenue.dev_sub_count  : (b.dev_sub_count  ?? 0),

        // Affiliates
        total_affiliate_sol:  affSol,
        total_affiliate_gbp:  solToGbp(affSol, solGbpPrice),

        // Your cut
        your_cut_sol:         yourCutSol,
        your_cut_gbp:         solToGbp(yourCutSol, solGbpPrice),

        // Cashout (once done)
        cashout_sol:          cashoutSol || null,
        cashout_gbp:          cashoutSol ? solToGbp(cashoutSol, solGbpPrice) : null,
        cashout_tx_signature: b.cashout_tx_signature ?? null,
        cashout_wallet:       b.cashout_wallet ?? null,
        cashout_at:           b.cashout_at ?? null,

        // Affiliate payout rows (empty for open batch)
        affiliate_payouts:    payoutsByBatch[b.id] ?? [],
      };
    });

    return NextResponse.json({ ok: true, batches: out, solGbpPrice });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load batches", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
