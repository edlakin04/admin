import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// ─── GET /api/cron/close-batch ────────────────────────────────────────────────
// Called by Vercel cron at midnight UK time every night (see vercel.json).
// Also callable manually via GET with ?secret=ADMIN_CRON_SECRET for testing.
//
// What it does:
// 1. Finds the current open batch
// 2. Snapshots all payments that came in during that batch period
// 3. Computes total revenue + affiliate totals
// 4. Builds batch_affiliate_payouts rows (one per affiliate)
// 5. Marks the batch as 'closed'
// 6. Opens a new batch for the next 24 hours

export async function GET(req: Request) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret") ?? req.headers.get("x-cron-secret") ?? "";
    const cronSecret = process.env.ADMIN_CRON_SECRET;

    if (!cronSecret || secret !== cronSecret) {
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
      // No open batch — create one for today and return
      // This is a recovery case (e.g. first run after SQL setup)
      await createNextBatch(sb);
      return NextResponse.json({ ok: true, action: "created_first_batch" });
    }

    const periodStart = openBatch.period_start;
    const periodEnd   = openBatch.period_end;

    // ── 2. Snapshot all payments in this batch period ────────────────────────
    // Pull every payment that was made during this batch window
    const { data: payments, error: payErr } = await sb
      .from("payments")
      .select("id, wallet, kind, amount_sol, referrer_wallet, created_at")
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
    const userSubCount = paymentList.filter((p) => p.kind === "subscription").length;
    const devSubCount  = paymentList.filter((p) => p.kind === "dev_fee").length;

    // ── 4. Pull affiliate earnings for this batch period ─────────────────────
    // affiliate_earnings rows that were created during this batch window
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
    const { error: closeErr } = await sb
      .from("batches")
      .update({
        status:             "closed",
        total_revenue_sol:  Math.round(totalRevenueSol  * 1e9) / 1e9,
        total_affiliate_sol: Math.round(totalAffiliateSol * 1e9) / 1e9,
        user_sub_count:     userSubCount,
        dev_sub_count:      devSubCount,
        closed_at:          new Date().toISOString(),
      })
      .eq("id", openBatch.id);

    if (closeErr) {
      return NextResponse.json({ error: closeErr.message }, { status: 500 });
    }

    // ── 7. Insert batch_affiliate_payouts rows ────────────────────────────────
    // One row per affiliate — what they're owed from this batch
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
        // Log but don't fail — batch is already closed
        console.error("Failed to insert affiliate payout rows:", insertErr.message);
      }
    }

    // ── 8. Open the next batch ───────────────────────────────────────────────
    await createNextBatch(sb);

    return NextResponse.json({
      ok:                  true,
      action:              "batch_closed",
      batchId:             openBatch.id,
      periodStart,
      periodEnd,
      totalRevenueSol:     Math.round(totalRevenueSol    * 1e9) / 1e9,
      totalAffiliateSol:   Math.round(totalAffiliateSol  * 1e9) / 1e9,
      userSubCount,
      devSubCount,
      affiliateCount:      affiliateMap.size,
      paymentCount:        paymentList.length,
    });

  } catch (e: any) {
    console.error("close-batch cron error:", e);
    return NextResponse.json(
      { error: "Cron failed", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

// ─── Helper: create the next open batch ──────────────────────────────────────
// Computes the next midnight-to-midnight UK window and inserts it.

async function createNextBatch(sb: ReturnType<typeof supabaseAdmin>) {
  // Get current UK time
  // We compute this by calling Supabase with a timezone cast
  // to avoid any server timezone issues on Vercel's edge
  const now = new Date();

  // Convert to UK midnight
  // UK is UTC+0 (GMT) or UTC+1 (BST) — we use a simple offset approach:
  // Get today's date string in London time, then compute midnight UTC for it
  const londonDateStr = now.toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    year:     "numeric",
    month:    "2-digit",
    day:      "2-digit",
  });

  // londonDateStr is "DD/MM/YYYY" — parse it
  const [day, month, year] = londonDateStr.split("/").map(Number);

  // Next midnight in London = start of tomorrow in London
  const tomorrowLondon = new Date(
    Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0)
  );

  // Adjust for BST (last Sunday in March to last Sunday in October)
  // Simple check: if London is UTC+1, subtract 1 hour from our UTC midnight
  const bstOffset = getLondonUtcOffset(tomorrowLondon);
  const periodStart = new Date(tomorrowLondon.getTime() - bstOffset * 3600_000);
  const periodEnd   = new Date(periodStart.getTime() + 24 * 3600_000);

  await sb.from("batches").insert({
    period_start: periodStart.toISOString(),
    period_end:   periodEnd.toISOString(),
    status:       "open",
  });
}

// Returns the UTC offset for London time on a given date (0 or 1)
function getLondonUtcOffset(date: Date): number {
  // BST starts last Sunday in March, ends last Sunday in October
  const year  = date.getUTCFullYear();
  const bstStart = lastSundayOf(year, 2); // March = month index 2
  const bstEnd   = lastSundayOf(year, 9); // October = month index 9
  return date >= bstStart && date < bstEnd ? 1 : 0;
}

function lastSundayOf(year: number, month: number): Date {
  // Find last Sunday of the given month (UTC)
  const lastDay = new Date(Date.UTC(year, month + 1, 0)); // last day of month
  const dayOfWeek = lastDay.getUTCDay(); // 0 = Sunday
  const offset = dayOfWeek === 0 ? 0 : dayOfWeek;
  return new Date(lastDay.getTime() - offset * 86_400_000);
}
