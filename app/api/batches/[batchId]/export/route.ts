import { NextResponse }              from "next/server";
import { cookies }                   from "next/headers";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { verifySessionValue }        from "@/lib/auth";
import { getSolGbpPrice, solToGbp, fmtSol, fmtGbp } from "@/lib/solPrice";
import {
  getCountryRule,
  getJurisdictionName,
  THRESHOLD_JURISDICTIONS,
  IMMEDIATE_JURISDICTIONS,
  JURISDICTION_THRESHOLDS,
} from "@/lib/vatRules";

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
      .select("wallet, kind, amount_sol, referrer_wallet, created_at, declared_country, ip_country, country_mismatch, vat_rate, vat_amount_sol, vat_amount_gbp, vat_jurisdiction, sol_gbp_rate_at_payment")
      .gte("created_at", batch.period_start)
      .lt("created_at",  batch.period_end)
      .order("created_at", { ascending: true });

    // ── Load VAT cumulative data ──────────────────────────────────────────
    const { data: vatCumulative } = await sb
      .from("vat_cumulative")
      .select("jurisdiction, revenue_gbp, revenue_native, native_currency, threshold_amount, threshold_currency, threshold_crossed, threshold_crossed_at, vat_rate, payment_count")
      .order("jurisdiction");

    const { data: vatRegistrations } = await sb
      .from("vat_registrations")
      .select("jurisdiction, registration_no");

    const vatRegMap: Record<string, string | null> = {};
    for (const r of vatRegistrations ?? []) {
      vatRegMap[r.jurisdiction] = r.registration_no ?? null;
    }

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
        const kind     = p.kind === "subscription" ? "User sub" : "Dev sub ";
        const ref      = p.referrer_wallet ? `  [ref: ${p.referrer_wallet.slice(0,4)}…${p.referrer_wallet.slice(-4)}]` : "";
        const wallet   = `${p.wallet.slice(0,4)}…${p.wallet.slice(-4)}`;
        const country  = p.declared_country ? `  ${p.declared_country}` : "";
        const mismatch = p.country_mismatch  ? "  ⚠ IP mismatch" : "";
        lines.push(`  ${fmtDate(p.created_at)}  ${kind}  ${wallet}  ${fmtSol(Number(p.amount_sol))}${country}${mismatch}${ref}`);
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

    // ── VAT / Tax Summary ─────────────────────────────────────────────────────
    lines.push(divider());
    lines.push("  VAT / TAX SUMMARY");
    lines.push(divider());
    lines.push("");
    lines.push("  NOTE: VAT is absorbed from revenue — customers are not charged extra.");
    lines.push(`  SOL/GBP rate used: ${solGbpPrice ? `£${solGbpPrice.toFixed(2)}` : "unavailable"}`);
    lines.push("");

    // Compute per-jurisdiction VAT for this batch from payment data
    const batchVatByJurisdiction: Record<string, {
      jurisdictionName: string;
      paymentCount:     number;
      revenueGbp:       number;
      vatOwedGbp:       number;
      vatRate:          number;
      countries:        Set<string>;
      mismatches:       number;
    }> = {};

    for (const p of paymentList) {
      const jurisdiction = (p.vat_jurisdiction as string | null) ?? "NONE";
      if (jurisdiction === "NONE" || jurisdiction === "BLOCKED") continue;

      if (!batchVatByJurisdiction[jurisdiction]) {
        batchVatByJurisdiction[jurisdiction] = {
          jurisdictionName: getJurisdictionName(jurisdiction),
          paymentCount:     0,
          revenueGbp:       0,
          vatOwedGbp:       0,
          vatRate:          Number(p.vat_rate ?? 0),
          countries:        new Set(),
          mismatches:       0,
        };
      }

      const gbp = solGbpPrice
        ? Math.round(Number(p.amount_sol ?? 0) * solGbpPrice * 100) / 100
        : 0;

      batchVatByJurisdiction[jurisdiction].paymentCount++;
      batchVatByJurisdiction[jurisdiction].revenueGbp  += gbp;
      batchVatByJurisdiction[jurisdiction].vatOwedGbp  += Number(p.vat_amount_gbp ?? 0);
      if (p.declared_country) batchVatByJurisdiction[jurisdiction].countries.add(p.declared_country);
      if (p.country_mismatch) batchVatByJurisdiction[jurisdiction].mismatches++;
    }

    // Also show payments with no jurisdiction (no country recorded)
    const noCountryPayments = paymentList.filter((p) => !p.declared_country).length;

    // ── Threshold status table ────────────────────────────────────────────
    lines.push("  THRESHOLD STATUS (cumulative all-time revenue)");
    lines.push("");
    lines.push(`  ${"Jurisdiction".padEnd(16)} ${"Threshold".padEnd(12)} ${"Cumulative".padEnd(14)} ${"Used".padEnd(8)} Status`);
    lines.push(`  ${"-".repeat(62)}`);

    for (const row of vatCumulative ?? []) {
      const j        = row.jurisdiction as string;
      const isThresh = (THRESHOLD_JURISDICTIONS as readonly string[]).includes(j);
      if (!isThresh) continue;

      const threshInfo  = JURISDICTION_THRESHOLDS[j];
      const revenueNat  = Number(row.revenue_native ?? 0);
      const threshold   = row.threshold_amount ? Number(row.threshold_amount) : null;
      const pct         = threshold && revenueNat > 0
        ? Math.min(100, Math.round((revenueNat / threshold) * 1000) / 10)
        : 0;
      const crossed     = row.threshold_crossed ?? false;
      const statusLabel = crossed ? "CROSSED — REGISTER" :
        pct >= 95 ? "CRITICAL >95%" :
        pct >= 80 ? "WARNING >80%"  : "Below threshold";

      const name = getJurisdictionName(j).padEnd(16);
      const thr  = (threshInfo?.label ?? "—").padEnd(12);
      const cum  = `${revenueNat.toFixed(2)} ${row.native_currency ?? ""}`.padEnd(14);
      const used = `${pct.toFixed(1)}%`.padEnd(8);
      lines.push(`  ${name} ${thr} ${cum} ${used} ${statusLabel}`);
    }
    lines.push("");

    // ── VAT registration numbers ──────────────────────────────────────────
    lines.push("  VAT REGISTRATION NUMBERS");
    const regKeys = ["UK", "EU_OSS", "AU", "CA", "NO", "NZ", "CH"];
    for (const k of regKeys) {
      const regNo = vatRegMap[k];
      const name  = getJurisdictionName(k);
      lines.push(`  ${name.padEnd(30)} ${regNo ?? "Not yet registered"}`);
    }
    lines.push("");

    // ── Batch VAT breakdown by country ────────────────────────────────────
    lines.push("  BATCH VAT BREAKDOWN");
    lines.push("");

    if (Object.keys(batchVatByJurisdiction).length === 0) {
      lines.push("  No payments with country data recorded in this batch.");
    } else {
      for (const [jurisdiction, data] of Object.entries(batchVatByJurisdiction)) {
        const cumRow    = (vatCumulative ?? []).find((r) => r.jurisdiction === jurisdiction);
        const crossed   = cumRow?.threshold_crossed ?? false;
        const isIm      = (IMMEDIATE_JURISDICTIONS as readonly string[]).includes(jurisdiction);
        const vatActive = crossed || isIm;
        const threshInfo = JURISDICTION_THRESHOLDS[jurisdiction];
        const regNo     = vatRegMap[jurisdiction];
        const countriesStr = Array.from(data.countries).sort().join(", ") || "—";

        lines.push(`  ${data.jurisdictionName} — ${data.paymentCount} payment${data.paymentCount !== 1 ? "s" : ""} — ${fmtGbp(Math.round(data.revenueGbp * 100) / 100)} revenue`);
        if (data.countries.size > 1) {
          lines.push(`     Countries:         ${countriesStr}`);
        }
        lines.push(`     VAT rate:          ${vatActive && data.vatRate > 0 ? `${(data.vatRate * 100).toFixed(1)}% (${isIm ? "IMMEDIATE — no threshold" : "REGISTERED — above threshold"})` : `0% (${threshInfo ? `below ${threshInfo.label} threshold` : "no obligation"})`}`);
        if (regNo) {
          lines.push(`     Registration:      ${regNo}`);
        }
        lines.push(`     VAT owed:          ${fmtGbp(Math.round(data.vatOwedGbp * 100) / 100)}`);
        if (data.mismatches > 0) {
          lines.push(`     ⚠ IP mismatches:   ${data.mismatches} payment${data.mismatches !== 1 ? "s" : ""} — verify manually`);
        }
        lines.push("");
      }

      // Payments without country
      if (noCountryPayments > 0) {
        lines.push(`  Unknown country — ${noCountryPayments} payment${noCountryPayments !== 1 ? "s" : ""} (no country data recorded)`);
        lines.push("");
      }
    }

    // ── Batch VAT total ───────────────────────────────────────────────────
    const batchVatTotal = Math.round(
      Object.values(batchVatByJurisdiction)
        .reduce((sum, d) => sum + d.vatOwedGbp, 0) * 100
    ) / 100;

    lines.push(`  ${"─".repeat(40)}`);
    lines.push(line("  Total VAT owed this batch:", fmtGbp(batchVatTotal)));
    lines.push("");

    if (batchVatTotal === 0) {
      lines.push("  All jurisdictions currently below registration thresholds.");
      lines.push("  No VAT registration or payment required at this time.");
    } else {
      lines.push("  ⚠ VAT IS OWED — include in your tax returns.");
    }
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
