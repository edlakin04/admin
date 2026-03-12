import { NextResponse }              from "next/server";
import { cookies }                   from "next/headers";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { verifySessionValue }        from "@/app/api/auth/login/route";
import { getSolGbpPrice, solToGbp, fmtSol, fmtGbp } from "@/lib/solPrice";

export const dynamic = "force-dynamic";

// ─── GET /api/batches/[batchId]/export ────────────────────────────────────────
// Returns a plain-text file download for a completed batch.
// Contains full audit trail: revenue, affiliate payouts, cashout, GBP values.
// Includes a blank "GBP received to bank" field to fill in manually.

export async function GET(
  req: Request,
  { params }: { params: Promise<{ batchId: string }> }
) {
  try {
    // ── Auth ────────────────────────────────────────────────────────────────
    const cookieStore   = await cookies();
    const sessionValue  = cookieStore.get("admin_session")?.value ?? "";
    const adminPassword = process.env.ADMIN_PASSWORD ?? "";

    if (!verifySessionValue(sessionValue, adminPassword)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { batchId } = await params;
    const sb           = supabaseAdmin();

    // ── Load batch ───────────────────────────────────────────────────────────
    const { data: batch, error: batchErr } = await sb
      .from("batches")
      .select("*")
      .eq("id", batchId)
      .maybeSingle();

    if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });
    if (!batch)   return NextResponse.json({ error: "Batch not found" },  { status: 404 });

    // ── Load affiliate payouts ───────────────────────────────────────────────
    const { data: payouts } = await sb
      .from("batch_affiliate_payouts")
      .select("*")
      .eq("batch_id", batchId)
      .order("amount_sol", { ascending: false });

    const payoutList = payouts ?? [];

    // ── Load individual payments in this batch ───────────────────────────────
    const { data: payments } = await sb
      .from("payments")
      .select("wallet, kind, amount_sol, referrer_wallet, created_at")
      .gte("created_at", batch.period_start)
      .lt("created_at",  batch.period_end)
      .order("created_at", { ascending: true });

    const paymentList = payments ?? [];

    // ── Fetch live SOL/GBP price ─────────────────────────────────────────────
    const solGbpPrice = await getSolGbpPrice();

    // ── Date helpers ─────────────────────────────────────────────────────────
    function fmtDate(iso: string | null) {
      if (!iso) return "—";
      return new Date(iso).toLocaleString("en-GB", {
        timeZone:     "Europe/London",
        day:          "2-digit",
        month:        "2-digit",
        year:         "numeric",
        hour:         "2-digit",
        minute:       "2-digit",
        second:       "2-digit",
      });
    }

    function fmtDateShort(iso: string | null) {
      if (!iso) return "—";
      return new Date(iso).toLocaleDateString("en-GB", {
        timeZone: "Europe/London",
        day:      "2-digit",
        month:    "2-digit",
        year:     "numeric",
      });
    }

    function line(label: string, value: string, width = 32) {
      return `${label.padEnd(width)} ${value}`;
    }

    function divider(char = "─", len = 64) {
      return char.repeat(len);
    }

    // ── Compute values ───────────────────────────────────────────────────────
    const revSol       = Number(batch.total_revenue_sol   ?? 0);
    const affSol       = Number(batch.total_affiliate_sol ?? 0);
    const cashoutSol   = Number(batch.cashout_sol         ?? 0);
    const yourCutSol   = Math.max(0, Math.round((revSol - affSol) * 1e9) / 1e9);

    const revGbp       = solToGbp(revSol,     solGbpPrice);
    const affGbp       = solToGbp(affSol,     solGbpPrice);
    const yourCutGbp   = solToGbp(yourCutSol, solGbpPrice);
    const cashoutGbp   = solToGbp(cashoutSol, solGbpPrice);

    const periodLabel  = `${fmtDateShort(batch.period_start)} — ${fmtDateShort(batch.period_end)}`;
    const exportedAt   = fmtDate(new Date().toISOString());
    const priceLabel   = solGbpPrice
      ? `£${solGbpPrice.toFixed(2)} per SOL (at time of export)`
      : "Price unavailable at time of export";

    // ── Build the file ───────────────────────────────────────────────────────
    const lines: string[] = [];

    lines.push("═".repeat(64));
    lines.push("  AUTHSWAP — BATCH REPORT");
    lines.push("═".repeat(64));
    lines.push("");
    lines.push(line("Period:",        periodLabel));
    lines.push(line("Batch ID:",      batch.id));
    lines.push(line("Status:",        batch.status.toUpperCase()));
    lines.push(line("Opened:",        fmtDate(batch.created_at)));
    lines.push(line("Closed:",        fmtDate(batch.closed_at)));
    lines.push(line("Completed:",     fmtDate(batch.completed_at)));
    lines.push(line("Exported:",      exportedAt));
    lines.push(line("SOL/GBP rate:",  priceLabel));
    lines.push("");

    // ── Revenue ──────────────────────────────────────────────────────────────
    lines.push(divider());
    lines.push("  REVENUE");
    lines.push(divider());
    lines.push("");
    lines.push(line("Total payments:",    `${batch.user_sub_count + batch.dev_sub_count}`));
    lines.push(line("  User subs:",       `${batch.user_sub_count}`));
    lines.push(line("  Dev subs:",        `${batch.dev_sub_count}`));
    lines.push(line("Total revenue SOL:", fmtSol(revSol)));
    lines.push(line("Total revenue GBP:", fmtGbp(revGbp)));
    lines.push("");

    // Individual payments
    if (paymentList.length > 0) {
      lines.push("  Individual payments:");
      lines.push("");
      for (const p of paymentList) {
        const kind   = p.kind === "subscription" ? "User sub" : "Dev sub ";
        const ref    = p.referrer_wallet ? `  [ref: ${p.referrer_wallet.slice(0,4)}…${p.referrer_wallet.slice(-4)}]` : "";
        const wallet = `${p.wallet.slice(0,4)}…${p.wallet.slice(-4)}`;
        lines.push(`  ${fmtDate(p.created_at)}  ${kind}  ${wallet}  ${fmtSol(Number(p.amount_sol))}${ref}`);
      }
      lines.push("");
    }

    // ── Affiliate payouts ─────────────────────────────────────────────────────
    lines.push(divider());
    lines.push("  AFFILIATE PAYOUTS");
    lines.push(divider());
    lines.push("");
    lines.push(line("Total affiliates:", `${payoutList.length}`));
    lines.push(line("Total paid SOL:",   fmtSol(affSol)));
    lines.push(line("Total paid GBP:",   fmtGbp(affGbp)));
    lines.push("");

    if (payoutList.length === 0) {
      lines.push("  No affiliate payouts for this batch.");
    } else {
      for (let i = 0; i < payoutList.length; i++) {
        const p        = payoutList[i];
        const amtSol   = Number(p.amount_sol ?? 0);
        const amtGbp   = solToGbp(amtSol, solGbpPrice);
        const status   = p.paid ? "PAID" : "UNPAID";
        const paidAt   = p.paid_at ? fmtDate(p.paid_at) : "—";
        const txSig    = p.tx_signature
          ? `${p.tx_signature.slice(0,8)}…${p.tx_signature.slice(-8)}`
          : "—";

        lines.push(`  ${String(i + 1).padStart(2)}. ${p.referrer_wallet}`);
        lines.push(`      Amount:    ${fmtSol(amtSol)}  (${fmtGbp(amtGbp)})`);
        lines.push(`      Payments:  ${p.payment_count}`);
        lines.push(`      Status:    ${status}`);
        lines.push(`      Paid at:   ${paidAt}`);
        lines.push(`      Tx sig:    ${txSig}`);
        lines.push("");
      }
    }

    // ── Your cashout ──────────────────────────────────────────────────────────
    lines.push(divider());
    lines.push("  YOUR CASHOUT");
    lines.push(divider());
    lines.push("");
    lines.push(line("Revenue:",          `${fmtSol(revSol)}  (${fmtGbp(revGbp)})`));
    lines.push(line("Affiliate payouts:", `${fmtSol(affSol)}  (${fmtGbp(affGbp)})`));
    lines.push(line("Your cut:",         `${fmtSol(yourCutSol)}  (${fmtGbp(yourCutGbp)})`));
    lines.push("");
    lines.push(line("Cashout SOL:",       fmtSol(cashoutSol || yourCutSol)));
    lines.push(line("Cashout GBP:",       fmtGbp(cashoutGbp ?? yourCutGbp)));
    lines.push(line("Sent to wallet:",    batch.cashout_wallet ?? process.env.CASHOUT_WALLET ?? "—"));
    lines.push(line("Treasury wallet:",   process.env.TREASURY_WALLET ?? "—"));
    lines.push(line("Cashout at:",        fmtDate(batch.cashout_at)));
    lines.push(line("Cashout tx sig:",    batch.cashout_tx_signature
      ? `${batch.cashout_tx_signature.slice(0,8)}…${batch.cashout_tx_signature.slice(-8)}`
      : "—"
    ));
    lines.push("");

    // ── GBP bank field (blank — fill in manually) ─────────────────────────────
    lines.push(divider());
    lines.push("  GBP RECEIVED TO BANK");
    lines.push(divider());
    lines.push("");
    lines.push(line("Amount received (GBP):", "_______________"));
    lines.push(line("Date received:",          "_______________"));
    lines.push(line("Notes:",                  "_______________"));
    lines.push("");

    // ── Summary balance check ─────────────────────────────────────────────────
    lines.push(divider());
    lines.push("  BALANCE CHECK");
    lines.push(divider());
    lines.push("");
    const balanceCheck = Math.round(
      (revSol - affSol - (cashoutSol || yourCutSol)) * 1e9
    ) / 1e9;
    lines.push(line("Revenue in:",         fmtSol(revSol)));
    lines.push(line("Affiliate payouts:",  `- ${fmtSol(affSol)}`));
    lines.push(line("Your cashout:",       `- ${fmtSol(cashoutSol || yourCutSol)}`));
    lines.push(line("Remainder:",          `${fmtSol(balanceCheck)} ${Math.abs(balanceCheck) < 0.0001 ? "✓ BALANCED" : "⚠ CHECK"}`));
    lines.push("");
    lines.push("═".repeat(64));
    lines.push(`  End of report — ${periodLabel}`);
    lines.push("═".repeat(64));

    // ── Return as downloadable text file ─────────────────────────────────────
    const filename = `authswap-batch-${fmtDateShort(batch.period_start).replace(/\//g, "-")}.txt`;
    const content  = lines.join("\n");

    return new NextResponse(content, {
      status:  200,
      headers: {
        "Content-Type":        "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Export failed", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
