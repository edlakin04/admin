import { NextResponse }              from "next/server";
import { cookies }                   from "next/headers";
import { supabaseAdmin }             from "@/lib/supabaseAdmin";
import { verifySessionValue }        from "@/lib/auth";
import { getSolGbpPrice, solToGbp, fmtSol, fmtGbp } from "@/lib/solPrice";
import {
  getJurisdictionName,
  THRESHOLD_JURISDICTIONS,
  IMMEDIATE_JURISDICTIONS,
  JURISDICTION_THRESHOLDS,
} from "@/lib/vatRules";

export const dynamic = "force-dynamic";

// ─── GET /api/batches/export-month?year=2026&month=3 ─────────────────────────
// Generates a monthly summary report for all complete batches in a given month.

// Returns the UTC offset for London time on a given date (0 or 1 for BST)
function getLondonUtcOffset(date: Date): number {
  const year     = date.getUTCFullYear();
  const bstStart = lastSundayOf(year, 2); // March
  const bstEnd   = lastSundayOf(year, 9); // October
  return date >= bstStart && date < bstEnd ? 1 : 0;
}

function lastSundayOf(year: number, month: number): Date {
  const lastDay   = new Date(Date.UTC(year, month + 1, 0));
  const dayOfWeek = lastDay.getUTCDay();
  const offset    = dayOfWeek === 0 ? 0 : dayOfWeek;
  return new Date(lastDay.getTime() - offset * 86_400_000);
}

// Compute UTC boundaries for a London-time calendar month
function londonMonthBounds(year: number, month: number) {
  const startUtc   = new Date(Date.UTC(year, month - 1, 1));
  const endMonth   = month === 12 ? 1   : month + 1;
  const endYear    = month === 12 ? year + 1 : year;
  const endUtc     = new Date(Date.UTC(endYear, endMonth - 1, 1));

  const startOffset = getLondonUtcOffset(startUtc);
  const endOffset   = getLondonUtcOffset(endUtc);

  return {
    start: new Date(startUtc.getTime() - startOffset * 3_600_000),
    end:   new Date(endUtc.getTime()   - endOffset   * 3_600_000),
  };
}

export async function GET(req: Request) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const cookieStore   = await cookies();
    const sessionValue  = cookieStore.get("admin_session")?.value ?? "";
    const adminPassword = process.env.ADMIN_PASSWORD ?? "";

    if (!verifySessionValue(sessionValue, adminPassword)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const year  = parseInt(searchParams.get("year")  ?? "", 10);
    const month = parseInt(searchParams.get("month") ?? "", 10);

    if (!year || !month || month < 1 || month > 12) {
      return NextResponse.json({ error: "Invalid year or month" }, { status: 400 });
    }

    const { start, end } = londonMonthBounds(year, month);
    const sb = supabaseAdmin();

    // ── Load all complete batches in this month ───────────────────────────────
    const { data: batches, error: batchErr } = await sb
      .from("batches")
      .select("*")
      .eq("status", "complete")
      .gte("period_start", start.toISOString())
      .lt("period_start", end.toISOString())
      .order("period_start", { ascending: true });

    if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });

    const batchList = batches ?? [];

    if (batchList.length === 0) {
      return NextResponse.json({ error: "No completed batches found for this month" }, { status: 404 });
    }

    // ── Load all payments in this month ───────────────────────────────────────
    const { data: payments } = await sb
      .from("payments")
      .select("wallet, kind, amount_sol, referrer_wallet, created_at, declared_country, ip_country, country_mismatch, vat_rate, vat_amount_sol, vat_amount_gbp, vat_jurisdiction, sol_gbp_rate_at_payment")
      .gte("created_at", start.toISOString())
      .lt("created_at",  end.toISOString())
      .order("created_at", { ascending: true });

    // ── Load affiliate payouts for these batches ──────────────────────────────
    const batchIds = batchList.map((b) => b.id);
    const { data: payouts } = await sb
      .from("batch_affiliate_payouts")
      .select("*")
      .in("batch_id", batchIds);

    // ── Load VAT cumulative data ──────────────────────────────────────────────
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
    const payoutList  = payouts  ?? [];

    // ── Fetch live SOL/GBP price ──────────────────────────────────────────────
    const solGbpPrice = await getSolGbpPrice();

    // ── Date helpers ──────────────────────────────────────────────────────────
    function fmtDate(iso: string | null) {
      if (!iso) return "—";
      return new Date(iso).toLocaleString("en-GB", {
        timeZone: "Europe/London",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      });
    }

    function fmtDateShort(iso: string | null) {
      if (!iso) return "—";
      return new Date(iso).toLocaleDateString("en-GB", {
        timeZone: "Europe/London",
        day: "2-digit", month: "2-digit", year: "numeric",
      });
    }

    function line(label: string, value: string, width = 32) {
      return `${label.padEnd(width)} ${value}`;
    }

    function divider(char = "─", len = 64) {
      return char.repeat(len);
    }

    // ── Aggregate totals across all batches ───────────────────────────────────
    const totalRevSol   = batchList.reduce((s, b) => s + Number(b.total_revenue_sol   ?? 0), 0);
    const totalAffSol   = batchList.reduce((s, b) => s + Number(b.total_affiliate_sol ?? 0), 0);
    const totalCashSol  = batchList.reduce((s, b) => s + Number(b.cashout_sol         ?? 0), 0);
    const userSubCount  = batchList.reduce((s, b) => s + Number(b.user_sub_count      ?? 0), 0);
    const devSubCount   = batchList.reduce((s, b) => s + Number(b.dev_sub_count       ?? 0), 0);
    const bidEntryCount = batchList.reduce((s, b) => s + Number(b.bidding_entry_count ?? 0), 0);
    const bidWinCount   = batchList.reduce((s, b) => s + Number(b.bidding_winner_count ?? 0), 0);
    const totalPayments = userSubCount + devSubCount + bidEntryCount + bidWinCount;

    const totalRevGbp  = solToGbp(totalRevSol,  solGbpPrice);
    const totalAffGbp  = solToGbp(totalAffSol,  solGbpPrice);
    const totalCashGbp = solToGbp(totalCashSol, solGbpPrice);

    // Month label
    const monthLabel = start.toLocaleDateString("en-GB", {
      timeZone: "Europe/London",
      month: "long", year: "numeric",
    });

    const exportedAt = fmtDate(new Date().toISOString());
    const priceLabel = solGbpPrice
      ? `£${solGbpPrice.toFixed(2)} per SOL (at time of export)`
      : "Price unavailable at time of export";

    // ── Build the file ────────────────────────────────────────────────────────
    const lines: string[] = [];

    lines.push("═".repeat(64));
    lines.push("  AUTHSWAP — MONTHLY REPORT");
    lines.push("═".repeat(64));
    lines.push("");
    lines.push(line("Month:",         monthLabel));
    lines.push(line("Period:",        `${fmtDateShort(start.toISOString())} — ${fmtDateShort(new Date(end.getTime() - 1).toISOString())}`));
    lines.push(line("Batches:",       `${batchList.length} days`));
    lines.push(line("Exported:",      exportedAt));
    lines.push(line("SOL/GBP rate:",  priceLabel));
    lines.push("");

    // ── Revenue summary ───────────────────────────────────────────────────────
    lines.push(divider());
    lines.push("  REVENUE SUMMARY");
    lines.push(divider());
    lines.push("");
    lines.push(line("Total payments:",       `${totalPayments}`));
    lines.push(line("  User subs:",          `${userSubCount}`));
    lines.push(line("  Dev subs:",           `${devSubCount}`));
    lines.push(line("  Bidding ad entries:", `${bidEntryCount}`));
    lines.push(line("  Bidding ad winners:", `${bidWinCount}`));
    lines.push("");
    lines.push(line("Total revenue SOL:",    fmtSol(Math.round(totalRevSol  * 1e9) / 1e9)));
    lines.push(line("Total revenue GBP:",    fmtGbp(totalRevGbp)));
    lines.push("");

    // ── Affiliate payouts ─────────────────────────────────────────────────────
    lines.push(divider());
    lines.push("  AFFILIATE PAYOUTS");
    lines.push(divider());
    lines.push("");
    lines.push(line("Total affiliates paid:", `${payoutList.length}`));
    lines.push(line("Total paid SOL:",        fmtSol(Math.round(totalAffSol * 1e9) / 1e9)));
    lines.push(line("Total paid GBP:",        fmtGbp(totalAffGbp)));
    lines.push("");

    // ── Your cashout ──────────────────────────────────────────────────────────
    lines.push(divider());
    lines.push("  YOUR CASHOUT");
    lines.push(divider());
    lines.push("");
    lines.push(line("Revenue:",           `${fmtSol(Math.round(totalRevSol  * 1e9) / 1e9)}  (${fmtGbp(totalRevGbp)})`));
    lines.push(line("Affiliate payouts:", `${fmtSol(Math.round(totalAffSol  * 1e9) / 1e9)}  (${fmtGbp(totalAffGbp)})`));
    lines.push(line("Your cut:",          `${fmtSol(Math.round(totalCashSol * 1e9) / 1e9)}  (${fmtGbp(totalCashGbp)})`));
    lines.push("");

    // ── Daily breakdown ───────────────────────────────────────────────────────
    lines.push(divider());
    lines.push("  DAILY BREAKDOWN");
    lines.push(divider());
    lines.push("");
    lines.push(`  ${"Date".padEnd(14)} ${"Revenue".padEnd(16)} ${"Payments".padEnd(10)} Status`);
    lines.push(`  ${"-".repeat(55)}`);
    for (const b of batchList) {
      const rev    = Number(b.total_revenue_sol ?? 0);
      const pcount = Number(b.user_sub_count ?? 0) + Number(b.dev_sub_count ?? 0)
                   + Number(b.bidding_entry_count ?? 0) + Number(b.bidding_winner_count ?? 0);
      const dateStr = fmtDateShort(b.period_start).padEnd(14);
      const revStr  = fmtSol(rev).padEnd(16);
      const pStr    = String(pcount).padEnd(10);
      const status  = rev === 0 ? "No revenue" : "Complete ✓";
      lines.push(`  ${dateStr} ${revStr} ${pStr} ${status}`);
    }
    lines.push("");

    // ── VAT / Tax Summary ─────────────────────────────────────────────────────
    lines.push(divider());
    lines.push("  VAT / TAX SUMMARY");
    lines.push(divider());
    lines.push("");
    lines.push("  NOTE: VAT is absorbed from revenue — customers are not charged extra.");
    lines.push(`  SOL/GBP rate used: ${solGbpPrice ? `£${solGbpPrice.toFixed(2)}` : "unavailable"}`);
    lines.push("");

    // Per-jurisdiction VAT for this month
    const monthVatByJurisdiction: Record<string, {
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

      if (!monthVatByJurisdiction[jurisdiction]) {
        monthVatByJurisdiction[jurisdiction] = {
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

      monthVatByJurisdiction[jurisdiction].paymentCount++;
      monthVatByJurisdiction[jurisdiction].revenueGbp  += gbp;
      monthVatByJurisdiction[jurisdiction].vatOwedGbp  += Number(p.vat_amount_gbp ?? 0);
      if (p.declared_country) monthVatByJurisdiction[jurisdiction].countries.add(p.declared_country);
      if (p.country_mismatch) monthVatByJurisdiction[jurisdiction].mismatches++;
    }

    const noCountryPayments = paymentList.filter((p) => !p.declared_country).length;

    // Threshold status table
    lines.push("  THRESHOLD STATUS (cumulative all-time revenue)");
    lines.push("");
    lines.push(`  ${"Jurisdiction".padEnd(16)} ${"Threshold".padEnd(12)} ${"Cumulative".padEnd(14)} ${"Used".padEnd(8)} Status`);
    lines.push(`  ${"-".repeat(62)}`);

    for (const row of vatCumulative ?? []) {
      const j       = row.jurisdiction as string;
      const isThresh = (THRESHOLD_JURISDICTIONS as readonly string[]).includes(j);
      if (!isThresh) continue;

      const threshInfo  = JURISDICTION_THRESHOLDS[j];
      const revenueNat  = Number(row.revenue_native ?? 0);
      const threshold   = row.threshold_amount ? Number(row.threshold_amount) : null;
      const pct         = threshold && revenueNat > 0
        ? Math.min(100, Math.round((revenueNat / threshold) * 1000) / 10)
        : 0;
      const crossed     = row.threshold_crossed ?? false;
      const statusLabel = crossed ? "CROSSED — REGISTER"
        : pct >= 95 ? "CRITICAL >95%"
        : pct >= 80 ? "WARNING >80%"
        : "Below threshold";

      const name = getJurisdictionName(j).padEnd(16);
      const thr  = (threshInfo?.label ?? "—").padEnd(12);
      const cum  = `${revenueNat.toFixed(2)} ${row.native_currency ?? ""}`.padEnd(14);
      const used = `${pct.toFixed(1)}%`.padEnd(8);
      lines.push(`  ${name} ${thr} ${cum} ${used} ${statusLabel}`);
    }
    lines.push("");

    // VAT registration numbers
    lines.push("  VAT REGISTRATION NUMBERS");
    const regKeys = ["UK", "EU_OSS", "AU", "CA", "NO", "NZ", "CH"];
    for (const k of regKeys) {
      const regNo = vatRegMap[k];
      const name  = getJurisdictionName(k);
      lines.push(`  ${name.padEnd(30)} ${regNo ?? "Not yet registered"}`);
    }
    lines.push("");

    // Monthly VAT breakdown by jurisdiction
    lines.push("  MONTHLY VAT BREAKDOWN");
    lines.push("");

    if (Object.keys(monthVatByJurisdiction).length === 0) {
      lines.push("  No payments with country data recorded this month.");
    } else {
      for (const [jurisdiction, data] of Object.entries(monthVatByJurisdiction)) {
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
        lines.push(`     VAT rate:          ${vatActive && data.vatRate > 0
          ? `${(data.vatRate * 100).toFixed(1)}% (${isIm ? "IMMEDIATE — no threshold" : "REGISTERED — above threshold"})`
          : `0% (${threshInfo ? `below ${threshInfo.label} threshold` : "no obligation"})`
        }`);
        if (regNo) {
          lines.push(`     Registration:      ${regNo}`);
        }
        lines.push(`     VAT owed:          ${fmtGbp(Math.round(data.vatOwedGbp * 100) / 100)}`);
        if (data.mismatches > 0) {
          lines.push(`     ⚠ IP mismatches:   ${data.mismatches} payment${data.mismatches !== 1 ? "s" : ""} — verify manually`);
        }
        lines.push("");
      }

      if (noCountryPayments > 0) {
        lines.push(`  Unknown country — ${noCountryPayments} payment${noCountryPayments !== 1 ? "s" : ""} (no country data recorded)`);
        lines.push("");
      }
    }

    // Monthly VAT total
    const monthVatTotal = Math.round(
      Object.values(monthVatByJurisdiction)
        .reduce((sum, d) => sum + d.vatOwedGbp, 0) * 100
    ) / 100;

    lines.push(`  ${"─".repeat(40)}`);
    lines.push(line("  Total VAT owed this month:", fmtGbp(monthVatTotal)));
    lines.push("");

    if (monthVatTotal === 0) {
      lines.push("  All jurisdictions currently below registration thresholds.");
      lines.push("  No VAT registration or payment required at this time.");
    } else {
      lines.push("  ⚠ VAT IS OWED — include in your tax returns.");
    }
    lines.push("");

    // ── GBP bank field ────────────────────────────────────────────────────────
    lines.push(divider());
    lines.push("  GBP RECEIVED TO BANK (MONTHLY TOTAL)");
    lines.push(divider());
    lines.push("");
    lines.push(line("Amount received (GBP):", "_______________"));
    lines.push(line("Date(s) received:",       "_______________"));
    lines.push(line("Notes:",                  "_______________"));
    lines.push("");

    // ── Balance check ─────────────────────────────────────────────────────────
    lines.push(divider());
    lines.push("  BALANCE CHECK");
    lines.push(divider());
    lines.push("");
    const balanceCheck = Math.round((totalRevSol - totalAffSol - totalCashSol) * 1e9) / 1e9;
    lines.push(line("Revenue in:",         fmtSol(Math.round(totalRevSol  * 1e9) / 1e9)));
    lines.push(line("Affiliate payouts:",  `- ${fmtSol(Math.round(totalAffSol  * 1e9) / 1e9)}`));
    lines.push(line("Your cashout:",       `- ${fmtSol(Math.round(totalCashSol * 1e9) / 1e9)}`));
    lines.push(line("Remainder:",          `${fmtSol(balanceCheck)} ${Math.abs(balanceCheck) < 0.0001 ? "✓ BALANCED" : "⚠ CHECK"}`));
    lines.push("");
    lines.push("═".repeat(64));
    lines.push(`  End of monthly report — ${monthLabel}`);
    lines.push("═".repeat(64));

    // ── Return as downloadable text file ──────────────────────────────────────
    const filename = `authswap-${monthLabel.toLowerCase().replace(/\s/g, "-")}.txt`;
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
      { error: "Monthly export failed", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
