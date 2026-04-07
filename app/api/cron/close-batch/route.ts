import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// ─── GET /api/cron/close-batch ────────────────────────────────────────────────
// Called by Vercel cron at midnight UTC every night (see vercel.json).
// Also callable manually via GET with ?secret=ADMIN_CRON_SECRET for testing.
//
// What it does:
// 1. Finds the current open batch
// 2. Snapshots all payments that came in during that batch period
// 3. Computes total revenue + affiliate totals
// 4. Builds batch_affiliate_payouts rows (one per affiliate)
// 5. Marks the batch as 'closed' (or 'complete' if zero revenue)
// 6. If missed days exist, fills them with auto-completed empty batches
// 7. Opens a new batch for the current day

export async function GET(req: Request) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const { searchParams } = new URL(req.url);
    const cronSecret = process.env.ADMIN_CRON_SECRET;

    if (!cronSecret) {
      return NextResponse.json({ error: "ADMIN_CRON_SECRET not configured" }, { status: 500 });
    }

    const authHeader   = (req.headers.get("authorization") ?? "").trim();
    const secretParam  = (searchParams.get("secret") ?? "").trim();
    const secretHeader = (req.headers.get("x-cron-secret") ?? "").trim();

    const authorized =
      authHeader === `Bearer ${cronSecret}` ||
      authHeader === cronSecret ||
      secretParam === cronSecret ||
      secretHeader === cronSecret;

    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    // ── 1. Find the open batch ───────────────────────────────────────────────
    const { data: openBatch, error: batchErr } = await sb
      .from("batches")
      .select("*")
      .eq("status", "open")
      .maybeSingle();

    if (batchErr) {
      return NextResponse.json({ error: batchErr.message }, { status: 500 });
    }

    if (!openBatch) {
      // No open batch — create one for the current London day
      await createNextBatch(sb);
      return NextResponse.json({ ok: true, action: "created_first_batch" });
    }

    const periodStart = openBatch.period_start;
    const periodEnd   = openBatch.period_end;

    // ── 2. Snapshot all payments in this batch period ────────────────────────
    const { data: payments, error: payErr } = await sb
      .from("payments")
      .select("wallet, kind, amount_sol, referrer_wallet, created_at")
      .gte("created_at", periodStart)
      .lt("created_at", periodEnd);

    if (payErr) {
      return NextResponse.json({ error: payErr.message }, { status: 500 });
    }

    const paymentList = payments ?? [];

    // ── 3. Compute revenue totals ────────────────────────────────────────────
    const totalRevenueSol = paymentList.reduce(
      (sum, p) => sum + Number(p.amount_sol ?? 0), 0
    );
    const userSubCount       = paymentList.filter((p) => p.kind === "subscription").length;
    const devSubCount        = paymentList.filter((p) => p.kind === "dev_fee").length;
    const biddingEntryCount  = paymentList.filter((p) => p.kind === "bidding_ad_entry").length;
    const biddingWinnerCount = paymentList.filter((p) => p.kind === "bidding_ad_winner").length;

    // ── 4. Pull affiliate earnings for this batch period ─────────────────────
    const { data: earnings, error: earnErr } = await sb
      .from("affiliate_earnings")
      .select("referrer_wallet, amount_sol, payment_signature, kind")
      .gte("created_at", periodStart)
      .lt("created_at", periodEnd);

    if (earnErr) {
      return NextResponse.json({ error: earnErr.message }, { status: 500 });
    }

    const earningsList = earnings ?? [];

    // ── 5. Group affiliate earnings by wallet ─────────────────────────────────
    const affiliateMap = new Map<string, { totalSol: number; count: number }>();
    for (const e of earningsList) {
      const wallet = e.referrer_wallet;
      const existing = affiliateMap.get(wallet) ?? { totalSol: 0, count: 0 };
      affiliateMap.set(wallet, {
        totalSol: existing.totalSol + Number(e.amount_sol ?? 0),
        count:    existing.count + 1,
      });
    }

    const totalAffiliateSol = Array.from(affiliateMap.values())
      .reduce((sum, a) => sum + a.totalSol, 0);

    // ── 6. Close the current batch ───────────────────────────────────────────
    // If zero revenue and no affiliates, skip straight to 'complete' so the
    // day is saved to history automatically without any manual action needed.
    const now = new Date().toISOString();
    const isZeroRevenue = totalRevenueSol === 0 && affiliateMap.size === 0;
    const finalStatus   = isZeroRevenue ? "complete" : "closed";

    const { error: closeErr } = await sb
      .from("batches")
      .update({
        status:              finalStatus,
        total_revenue_sol:   Math.round(totalRevenueSol   * 1e9) / 1e9,
        total_affiliate_sol: Math.round(totalAffiliateSol * 1e9) / 1e9,
        user_sub_count:          userSubCount,
        dev_sub_count:           devSubCount,
        bidding_entry_count:     biddingEntryCount,
        bidding_winner_count:    biddingWinnerCount,
        closed_at:           now,
        ...(isZeroRevenue ? { completed_at: now } : {}),
      })
      .eq("id", openBatch.id);

    if (closeErr) {
      return NextResponse.json({ error: closeErr.message }, { status: 500 });
    }

    // ── 7. Insert batch_affiliate_payouts rows ────────────────────────────────
    if (affiliateMap.size > 0) {
      const payoutRows = Array.from(affiliateMap.entries()).map(
        ([wallet, data]) => ({
          batch_id:        openBatch.id,
          referrer_wallet: wallet,
          amount_sol:      Math.round(data.totalSol * 1e9) / 1e9,
          payment_count:   data.count,
          paid:            false,
        })
      );

      const { error: insertErr } = await sb
        .from("batch_affiliate_payouts")
        .insert(payoutRows);

      if (insertErr) {
        console.error("Failed to insert affiliate payout rows:", insertErr.message);
      }
    }

    // ── 8. Fill any missed days between this batch and today ──────────────────
    // If the cron missed a few days, create auto-completed empty batches for
    // each gap day so history has an unbroken daily record.
    const filledDays: string[] = [];
    const nowMs       = Date.now();
    let nextStart     = new Date(openBatch.period_end); // start right after closed batch

    while (nextStart.getTime() + 24 * 3600_000 <= nowMs) {
      // This day's period has already fully passed — auto-complete it
      const nextEnd = new Date(nextStart.getTime() + 24 * 3600_000);
      const fillNow = new Date().toISOString();

      await sb.from("batches").insert({
        period_start:        nextStart.toISOString(),
        period_end:          nextEnd.toISOString(),
        status:              "complete",
        total_revenue_sol:   0,
        total_affiliate_sol: 0,
        user_sub_count:      0,
        dev_sub_count:       0,
        bidding_entry_count: 0,
        bidding_winner_count:0,
        closed_at:           fillNow,
        completed_at:        fillNow,
      });

      filledDays.push(nextStart.toISOString().slice(0, 10));
      nextStart = nextEnd;
    }

    // ── 9. Create the current open batch ─────────────────────────────────────
    // Starts from where the last closed/filled batch ended
    const currentPeriodEnd = new Date(nextStart.getTime() + 24 * 3600_000);
    await sb.from("batches").insert({
      period_start: nextStart.toISOString(),
      period_end:   currentPeriodEnd.toISOString(),
      status:       "open",
    });

    return NextResponse.json({
      ok:                  true,
      action:              isZeroRevenue ? "batch_auto_completed_zero_revenue" : "batch_closed",
      batchId:             openBatch.id,
      periodStart,
      periodEnd,
      totalRevenueSol:     Math.round(totalRevenueSol    * 1e9) / 1e9,
      totalAffiliateSol:   Math.round(totalAffiliateSol  * 1e9) / 1e9,
      userSubCount,
      devSubCount,
      biddingEntryCount,
      biddingWinnerCount,
      affiliateCount:      affiliateMap.size,
      paymentCount:        paymentList.length,
      filledDays,
    });

  } catch (e: any) {
    console.error("close-batch cron error:", e);
    return NextResponse.json(
      { error: "Cron failed", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

// ─── Helper: create the next open batch (recovery only) ──────────────────────
// Used when there's no open batch at all. Creates one for the current London day.

async function createNextBatch(sb: ReturnType<typeof supabaseAdmin>) {
  const now = new Date();

  const londonDateStr = now.toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    year:     "numeric",
    month:    "2-digit",
    day:      "2-digit",
  });

  // londonDateStr is "DD/MM/YYYY"
  const [day, month, year] = londonDateStr.split("/").map(Number);

  // Today's midnight in London (not tomorrow)
  const todayLondon = new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0, 0)
  );

  const bstOffset   = getLondonUtcOffset(todayLondon);
  const periodStart = new Date(todayLondon.getTime() - bstOffset * 3600_000);
  const periodEnd   = new Date(periodStart.getTime() + 24 * 3600_000);

  await sb.from("batches").insert({
    period_start: periodStart.toISOString(),
    period_end:   periodEnd.toISOString(),
    status:       "open",
  });
}

// Returns the UTC offset for London time on a given date (0 or 1)
function getLondonUtcOffset(date: Date): number {
  const year     = date.getUTCFullYear();
  const bstStart = lastSundayOf(year, 2); // March = month index 2
  const bstEnd   = lastSundayOf(year, 9); // October = month index 9
  return date >= bstStart && date < bstEnd ? 1 : 0;
}

function lastSundayOf(year: number, month: number): Date {
  const lastDay   = new Date(Date.UTC(year, month + 1, 0));
  const dayOfWeek = lastDay.getUTCDay();
  const offset    = dayOfWeek === 0 ? 0 : dayOfWeek;
  return new Date(lastDay.getTime() - offset * 86_400_000);
}
