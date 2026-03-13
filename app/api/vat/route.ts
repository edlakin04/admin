import { NextResponse }       from "next/server";
import { cookies }            from "next/headers";
import { supabaseAdmin }      from "@/lib/supabaseAdmin";
import { getSolGbpPrice, solToGbp, fmtGbp } from "@/lib/solPrice";
import { verifySessionValue } from "@/lib/auth";
import {
  getJurisdictionName,
  THRESHOLD_JURISDICTIONS,
  IMMEDIATE_JURISDICTIONS,
  JURISDICTION_THRESHOLDS,
  EU_COUNTRY_NAMES,
  EU_VAT_RATES,
  getCountryRule,
} from "@/lib/vatRules";

export const dynamic = "force-dynamic";

// ─── GET /api/vat ─────────────────────────────────────────────────────────────
// Master VAT stats endpoint for the admin site.
// Returns everything the VAT dashboard page and batch export need:
//
//   - Per jurisdiction: cumulative revenue, threshold %, warning level
//   - Per jurisdiction: VAT owed all-time (approximated from total revenue)
//   - Per jurisdiction: registration number if set
//   - Per-country payment breakdown (from payments table)
//   - IP mismatches list
//   - Threshold warnings
//   - Immediate VAT jurisdictions with revenue
//   - SOL/GBP price for conversions

export async function GET() {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const cookieStore   = await cookies();
    const sessionValue  = cookieStore.get("admin_session")?.value ?? "";
    const adminPassword = process.env.ADMIN_PASSWORD ?? "";

    if (!verifySessionValue(sessionValue, adminPassword)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sb = supabaseAdmin();

    // ── Fetch all data in parallel ────────────────────────────────────────
    const [
      { data: cumulative,     error: cumErr     },
      { data: registrations,  error: regErr     },
      { data: payments,       error: payErr     },
      solGbpPrice,
    ] = await Promise.all([
      sb.from("vat_cumulative").select("*").order("jurisdiction"),
      sb.from("vat_registrations").select("*").order("jurisdiction"),
      sb.from("payments")
        .select("declared_country, ip_country, country_mismatch, vat_rate, vat_amount_sol, vat_amount_gbp, vat_jurisdiction, amount_sol, kind, created_at, wallet")
        .not("declared_country", "is", null)
        .order("created_at", { ascending: false }),
      getSolGbpPrice(),
    ]);

    if (cumErr)  return NextResponse.json({ error: cumErr.message  }, { status: 500 });
    if (regErr)  return NextResponse.json({ error: regErr.message  }, { status: 500 });

    const paymentList   = payments   ?? [];
    const cumulativeList = cumulative ?? [];

    // ── Build registration map ────────────────────────────────────────────
    const regMap: Record<string, {
      registrationNo: string | null;
      registeredAt:   string | null;
      notes:          string | null;
    }> = {};

    for (const r of registrations ?? []) {
      regMap[r.jurisdiction] = {
        registrationNo: r.registration_no ?? null,
        registeredAt:   r.registered_at   ?? null,
        notes:          r.notes           ?? null,
      };
    }

    // ── Build per-jurisdiction summary ────────────────────────────────────
    const byJurisdiction: Record<string, any> = {};

    for (const row of cumulativeList) {
      const j             = row.jurisdiction as string;
      const revenueGbp    = Number(row.revenue_gbp      ?? 0);
      const revenueNative = Number(row.revenue_native   ?? 0);
      const threshold     = row.threshold_amount ? Number(row.threshold_amount) : null;
      const crossed       = row.threshold_crossed ?? false;
      const vatRate       = Number(row.vat_rate    ?? 0);
      const paymentCount  = Number(row.payment_count ?? 0);
      const isImmediate   = (IMMEDIATE_JURISDICTIONS as readonly string[]).includes(j);
      const isThreshold   = (THRESHOLD_JURISDICTIONS as readonly string[]).includes(j);

      const pctUsed = threshold && revenueNative > 0
        ? Math.min(100, Math.round((revenueNative / threshold) * 1000) / 10)
        : threshold ? 0 : null;

      const warningLevel: "none" | "warning" | "critical" | "crossed" =
        crossed                           ? "crossed"  :
        pctUsed !== null && pctUsed >= 95  ? "critical" :
        pctUsed !== null && pctUsed >= 80  ? "warning"  :
        "none";

      // VAT owed — extracted from gross revenue (VAT-inclusive pricing)
      // For threshold jurisdictions: only applies after threshold crossed
      // For immediate: always applies
      const vatOwedGbp = (crossed || isImmediate) && vatRate > 0
        ? Math.round(revenueGbp * vatRate / (1 + vatRate) * 100) / 100
        : 0;

      const thresholdInfo = JURISDICTION_THRESHOLDS[j] ?? null;
      const reg           = regMap[j] ?? null;

      byJurisdiction[j] = {
        jurisdiction:      j,
        jurisdictionName:  getJurisdictionName(j),
        isImmediate,
        isThreshold,

        revenueGbp,
        revenueGbpFmt:     fmtGbp(revenueGbp),
        revenueNative,
        nativeCurrency:    row.native_currency    ?? "GBP",
        paymentCount,

        thresholdAmount:   threshold,
        thresholdCurrency: row.threshold_currency ?? null,
        thresholdLabel:    thresholdInfo?.label   ?? null,
        crossed,
        crossedAt:         row.threshold_crossed_at ?? null,
        pctUsed,
        warningLevel,

        vatRate,
        vatRatePct:        vatRate > 0 ? `${Math.round(vatRate * 1000) / 10}%` : "0%",
        taxAuthority:      thresholdInfo?.taxAuthority ?? j,
        vatOwedGbp,
        vatOwedGbpFmt:     fmtGbp(vatOwedGbp),
        vatOwedSol:        solGbpPrice && vatOwedGbp > 0
          ? Math.round(vatOwedGbp / solGbpPrice * 1e9) / 1e9
          : null,

        registrationNo:    reg?.registrationNo ?? null,
        registeredAt:      reg?.registeredAt   ?? null,
        registrationNotes: reg?.notes          ?? null,

        lastUpdated:       row.last_updated ?? null,
      };
    }

    // ── Per-country payment breakdown ─────────────────────────────────────
    const byCountry: Record<string, {
      countryCode:  string;
      countryName:  string;
      jurisdiction: string;
      payments:     number;
      revenueGbp:   number;
      vatOwedGbp:   number;
      vatRate:      number;
      mismatches:   number;
    }> = {};

    for (const p of paymentList) {
      const code = p.declared_country as string;
      if (!code) continue;

      const rule = getCountryRule(code);
      if (!byCountry[code]) {
        byCountry[code] = {
          countryCode:  code,
          countryName:  rule.countryName,
          jurisdiction: rule.jurisdiction,
          payments:     0,
          revenueGbp:   0,
          vatOwedGbp:   0,
          vatRate:      Number(p.vat_rate ?? 0),
          mismatches:   0,
        };
      }

      const amountGbp = solGbpPrice
        ? Math.round(Number(p.amount_sol ?? 0) * solGbpPrice * 100) / 100
        : 0;

      byCountry[code].payments++;
      byCountry[code].revenueGbp  += amountGbp;
      byCountry[code].vatOwedGbp  += Number(p.vat_amount_gbp ?? 0);
      if (p.country_mismatch) byCountry[code].mismatches++;
    }

    // Round revenue totals
    for (const c of Object.values(byCountry)) {
      c.revenueGbp = Math.round(c.revenueGbp * 100) / 100;
      c.vatOwedGbp = Math.round(c.vatOwedGbp * 100) / 100;
    }

    // Sort countries by revenue desc
    const countriesList = Object.values(byCountry)
      .sort((a, b) => b.revenueGbp - a.revenueGbp);

    // ── IP mismatches ─────────────────────────────────────────────────────
    const mismatches = paymentList
      .filter((p) => p.country_mismatch)
      .slice(0, 50) // cap at 50 for UI
      .map((p) => ({
        wallet:          p.wallet,
        ipCountry:       p.ip_country,
        declaredCountry: p.declared_country,
        createdAt:       p.created_at,
        amountSol:       p.amount_sol,
        kind:            p.kind,
      }));

    // ── Threshold warnings ────────────────────────────────────────────────
    const warnings = Object.values(byJurisdiction)
      .filter((d: any) => d.warningLevel === "warning" || d.warningLevel === "critical")
      .map((d: any) => ({
        jurisdiction:     d.jurisdiction,
        jurisdictionName: d.jurisdictionName,
        warningLevel:     d.warningLevel,
        pctUsed:          d.pctUsed,
        thresholdLabel:   d.thresholdLabel,
      }));

    // ── Crossed jurisdictions ─────────────────────────────────────────────
    const crossedJurisdictions = Object.values(byJurisdiction)
      .filter((d: any) => d.crossed && d.isThreshold)
      .map((d: any) => d.jurisdiction);

    const immediateWithRevenue = Object.values(byJurisdiction)
      .filter((d: any) => d.isImmediate && d.revenueGbp > 0)
      .map((d: any) => d.jurisdiction);

    // ── All-time totals ───────────────────────────────────────────────────
    const totalVatOwedGbp = Math.round(
      Object.values(byJurisdiction)
        .reduce((sum: number, d: any) => sum + (d.vatOwedGbp ?? 0), 0) * 100
    ) / 100;

    const totalRevenueGbp = Math.round(
      Object.values(byJurisdiction)
        .reduce((sum: number, d: any) => sum + (d.revenueGbp ?? 0), 0) * 100
    ) / 100;

    const totalPaymentsWithCountry = paymentList.length;
    const totalMismatches          = paymentList.filter((p) => p.country_mismatch).length;

    return NextResponse.json({
      ok: true,
      byJurisdiction,
      countriesList,
      mismatches,
      warnings,
      hasWarnings:              warnings.length > 0,
      hasCritical:              warnings.some((w: any) => w.warningLevel === "critical"),
      crossedJurisdictions,
      immediateWithRevenue,
      totalVatOwedGbp,
      totalVatOwedGbpFmt:       fmtGbp(totalVatOwedGbp),
      totalRevenueGbp,
      totalRevenueGbpFmt:       fmtGbp(totalRevenueGbp),
      totalPaymentsWithCountry,
      totalMismatches,
      solGbpPrice,
      generatedAt:              new Date().toISOString(),
    });

  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to load VAT data", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
