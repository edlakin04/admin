"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type WarningLevel = "none" | "warning" | "critical" | "crossed";

type JurisdictionData = {
  jurisdiction:      string;
  jurisdictionName:  string;
  isImmediate:       boolean;
  isThreshold:       boolean;
  revenueGbp:        number;
  revenueGbpFmt:     string;
  revenueNative:     number;
  nativeCurrency:    string;
  paymentCount:      number;
  thresholdAmount:   number | null;
  thresholdCurrency: string | null;
  thresholdLabel:    string | null;
  crossed:           boolean;
  crossedAt:         string | null;
  pctUsed:           number | null;
  warningLevel:      WarningLevel;
  vatRate:           number;
  vatRatePct:        string;
  taxAuthority:      string;
  vatOwedGbp:        number;
  vatOwedGbpFmt:     string;
  vatOwedSol:        number | null;
  registrationNo:    string | null;
  registeredAt:      string | null;
  registrationNotes: string | null;
  lastUpdated:       string | null;
};

type CountryData = {
  countryCode:  string;
  countryName:  string;
  jurisdiction: string;
  payments:     number;
  revenueGbp:   number;
  vatOwedGbp:   number;
  vatRate:      number;
  mismatches:   number;
};

type Mismatch = {
  wallet:          string;
  ipCountry:       string | null;
  declaredCountry: string | null;
  createdAt:       string;
  amountSol:       number;
  kind:            string;
};

type VatData = {
  ok:                       boolean;
  byJurisdiction:           Record<string, JurisdictionData>;
  countriesList:            CountryData[];
  mismatches:               Mismatch[];
  warnings:                 any[];
  hasWarnings:              boolean;
  hasCritical:              boolean;
  crossedJurisdictions:     string[];
  immediateWithRevenue:     string[];
  totalVatOwedGbp:          number;
  totalVatOwedGbpFmt:       string;
  totalRevenueGbp:          number;
  totalRevenueGbpFmt:       string;
  totalPaymentsWithCountry: number;
  totalMismatches:          number;
  solGbpPrice:              number | null;
  generatedAt:              string;
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  card: {
    background: "#111111",
    border: "1px solid #27272a",
    borderRadius: "14px",
    padding: "20px",
    marginBottom: "12px",
  } as React.CSSProperties,
  label: {
    fontSize: "11px",
    color: "#71717a",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    fontWeight: 600,
  },
  val: { fontSize: "20px", fontWeight: 700, marginTop: "4px" },
  sub: { fontSize: "12px", color: "#71717a", marginTop: "2px" },
  btn: (variant: "primary" | "secondary" | "ghost") => ({
    padding: "8px 16px",
    borderRadius: "8px",
    fontWeight: 600,
    fontSize: "13px",
    cursor: "pointer",
    transition: "opacity 0.15s",
    background: variant === "primary" ? "#ffffff" : variant === "ghost" ? "transparent" : "#27272a",
    color:      variant === "primary" ? "#000000" : variant === "ghost" ? "#a1a1aa" : "#ffffff",
    border:     variant === "ghost" ? "1px solid #3f3f46" : "none",
  } as React.CSSProperties),
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "10px",
    marginTop: "16px",
  },
  statBox: (highlight?: boolean) => ({
    background:   highlight ? "rgba(16,185,129,0.08)" : "#18181b",
    border:       `1px solid ${highlight ? "rgba(16,185,129,0.25)" : "#27272a"}`,
    borderRadius: "10px",
    padding:      "12px 14px",
  } as React.CSSProperties),
  tag: (color: string) => ({
    display:      "inline-block",
    padding:      "2px 8px",
    borderRadius: "999px",
    fontSize:     "11px",
    fontWeight:   600,
    background:   `${color}22`,
    color:        color,
  } as React.CSSProperties),
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    marginTop: "12px",
  },
  th: {
    textAlign: "left" as const,
    fontSize: "11px",
    color: "#71717a",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    padding: "8px 10px",
    borderBottom: "1px solid #27272a",
  },
  td: {
    padding: "10px 10px",
    borderBottom: "1px solid #18181b",
    fontSize: "13px",
    verticalAlign: "middle" as const,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function shortWallet(w: string | null) {
  if (!w) return "—";
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

function warningColor(level: WarningLevel): string {
  if (level === "crossed")  return "#10b981";
  if (level === "critical") return "#ef4444";
  if (level === "warning")  return "#f59e0b";
  return "#52525b";
}

function warningLabel(level: WarningLevel): string {
  if (level === "crossed")  return "Registered / Active";
  if (level === "critical") return "⚠ Critical — >95%";
  if (level === "warning")  return "⚠ Warning — >80%";
  return "Below threshold";
}

// Progress bar component
function ProgressBar({ pct, level }: { pct: number; level: WarningLevel }) {
  const color =
    level === "critical" ? "#ef4444" :
    level === "warning"  ? "#f59e0b" :
    level === "crossed"  ? "#10b981" :
    "#3f3f46";

  return (
    <div style={{ marginTop: "8px" }}>
      <div style={{
        background: "#27272a",
        borderRadius: "999px",
        height: "6px",
        overflow: "hidden",
      }}>
        <div style={{
          background:    color,
          width:         `${Math.min(100, pct)}%`,
          height:        "100%",
          borderRadius:  "999px",
          transition:    "width 0.3s ease",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
        <span style={{ fontSize: "11px", color: "#71717a" }}>0</span>
        <span style={{ fontSize: "11px", color: color, fontWeight: 600 }}>{pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

// ─── VAT Page ─────────────────────────────────────────────────────────────────

type Tab = "thresholds" | "immediate" | "countries" | "mismatches" | "registrations";

export default function VatPage() {
  const router  = useRouter();
  const [data,    setData]    = useState<VatData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState<string | null>(null);
  const [tab,     setTab]     = useState<Tab>("thresholds");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res  = await fetch("/api/vat", { cache: "no-store" });
      const json = await res.json();
      if (res.status === 401) { router.replace("/login"); return; }
      if (!res.ok) { setErr(json?.error ?? "Failed to load VAT data"); return; }
      setData(json);
    } catch (e: any) {
      setErr(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  // ── Sorted threshold jurisdictions ───────────────────────────────────────
  const THRESHOLD_KEYS = ["UK", "EU_OSS", "AU", "CA", "NO", "NZ", "CH"];
  const IMMEDIATE_KEYS = ["JP", "KR", "TW", "SA", "AE", "TR", "MX", "CL", "CO", "AR", "IL"];

  const thresholdJurisdictions = THRESHOLD_KEYS
    .map((k) => data?.byJurisdiction[k])
    .filter(Boolean) as JurisdictionData[];

  const immediateJurisdictions = IMMEDIATE_KEYS
    .map((k) => data?.byJurisdiction[k])
    .filter(Boolean) as JurisdictionData[];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#e4e4e7",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      padding: "24px",
      maxWidth: "1100px",
      margin: "0 auto",
    }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              style={{ ...S.btn("ghost"), padding: "6px 12px", fontSize: "12px" }}
              onClick={() => router.push("/")}
            >
              ← Dashboard
            </button>
            <h1 style={{ fontSize: "22px", fontWeight: 700, margin: 0 }}>VAT / Tax</h1>
          </div>
          <p style={{ ...S.sub, marginTop: "4px" }}>
            Internal tax tracking — customers see nothing about VAT
          </p>
        </div>
        <button style={S.btn("ghost")} onClick={load} disabled={loading}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {err && (
        <div style={{ ...S.card, borderColor: "#ef4444", background: "#1a0000", marginBottom: "16px" }}>
          <p style={{ color: "#ef4444", margin: 0 }}>{err}</p>
        </div>
      )}

      {loading && !data && (
        <div style={{ textAlign: "center", padding: "60px", color: "#71717a" }}>
          Loading VAT data…
        </div>
      )}

      {data && (
        <>
          {/* Summary stats */}
          <div style={S.statGrid}>
            <div style={S.statBox()}>
              <div style={S.label}>Total VAT Owed</div>
              <div style={{ ...S.val, color: data.totalVatOwedGbp > 0 ? "#f59e0b" : "#10b981" }}>
                {data.totalVatOwedGbpFmt}
              </div>
              <div style={S.sub}>All time, all jurisdictions</div>
            </div>
            <div style={S.statBox()}>
              <div style={S.label}>Total Revenue Tracked</div>
              <div style={S.val}>{data.totalRevenueGbpFmt}</div>
              <div style={S.sub}>Payments with country data</div>
            </div>
            <div style={S.statBox()}>
              <div style={S.label}>Payments Tracked</div>
              <div style={S.val}>{data.totalPaymentsWithCountry}</div>
              <div style={S.sub}>With country recorded</div>
            </div>
            <div style={S.statBox(data.totalMismatches > 0)}>
              <div style={S.label}>IP Mismatches</div>
              <div style={{ ...S.val, color: data.totalMismatches > 0 ? "#f59e0b" : "#e4e4e7" }}>
                {data.totalMismatches}
              </div>
              <div style={S.sub}>IP ≠ declared country</div>
            </div>
            <div style={S.statBox()}>
              <div style={S.label}>SOL / GBP</div>
              <div style={S.val}>
                {data.solGbpPrice ? `£${data.solGbpPrice.toFixed(2)}` : "—"}
              </div>
              <div style={S.sub}>Live price</div>
            </div>
            <div style={S.statBox()}>
              <div style={S.label}>Thresholds Crossed</div>
              <div style={{ ...S.val, color: data.crossedJurisdictions.length > 0 ? "#f59e0b" : "#10b981" }}>
                {data.crossedJurisdictions.length}
              </div>
              <div style={S.sub}>
                {data.crossedJurisdictions.length > 0
                  ? data.crossedJurisdictions.join(", ")
                  : "None yet"}
              </div>
            </div>
          </div>

          {/* Warning banner */}
          {data.hasWarnings && (
            <div style={{
              ...S.card,
              borderColor: data.hasCritical ? "#ef4444" : "#f59e0b",
              background:  data.hasCritical ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
              marginTop: "12px",
            }}>
              <div style={{ fontWeight: 700, color: data.hasCritical ? "#ef4444" : "#f59e0b", marginBottom: "8px" }}>
                {data.hasCritical ? "⚠ Critical — Threshold almost reached" : "⚠ Warning — Approaching threshold"}
              </div>
              {data.warnings.map((w: any) => (
                <div key={w.jurisdiction} style={{ fontSize: "13px", color: "#a1a1aa", marginBottom: "4px" }}>
                  {w.jurisdictionName} — {w.pctUsed?.toFixed(1)}% of {w.thresholdLabel} used
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          <div style={{ display: "flex", gap: "4px", marginTop: "20px", marginBottom: "4px", flexWrap: "wrap" }}>
            {(["thresholds", "immediate", "countries", "mismatches", "registrations"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "6px 14px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  border: "1px solid #27272a",
                  background: tab === t ? "#ffffff" : "transparent",
                  color:      tab === t ? "#000000" : "#a1a1aa",
                  textTransform: "capitalize",
                }}
              >
                {t === "thresholds"    ? "Thresholds" :
                 t === "immediate"     ? `Immediate VAT (${IMMEDIATE_KEYS.length})` :
                 t === "countries"     ? `Countries (${data.countriesList.length})` :
                 t === "mismatches"    ? `IP Mismatches (${data.totalMismatches})` :
                 "Registrations"}
              </button>
            ))}
          </div>

          {/* ── Tab: Thresholds ── */}
          {tab === "thresholds" && (
            <div style={{ marginTop: "12px" }}>
              <p style={{ ...S.sub, marginBottom: "12px" }}>
                Threshold-based jurisdictions — VAT only applies once the cumulative revenue threshold is crossed.
              </p>
              {thresholdJurisdictions.map((j) => (
                <div key={j.jurisdiction} style={S.card}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: "200px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
                        <span style={{ fontWeight: 700, fontSize: "15px" }}>{j.jurisdictionName}</span>
                        <span style={S.tag(warningColor(j.warningLevel))}>
                          {warningLabel(j.warningLevel)}
                        </span>
                        {j.registrationNo && (
                          <span style={S.tag("#818cf8")}>Registered</span>
                        )}
                      </div>
                      <div style={S.sub}>
                        {j.taxAuthority} · {j.vatRatePct} {j.crossed ? "(active)" : "(when crossed)"}
                        {j.jurisdiction === "EU_OSS" && " · Rate varies by country"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
                      <div style={{ textAlign: "right" }}>
                        <div style={S.label}>Revenue</div>
                        <div style={{ fontWeight: 700, fontSize: "14px" }}>{j.revenueGbpFmt}</div>
                        <div style={S.sub}>{j.paymentCount} payments</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={S.label}>Threshold</div>
                        <div style={{ fontWeight: 700, fontSize: "14px" }}>{j.thresholdLabel ?? "—"}</div>
                        <div style={S.sub}>{j.thresholdCurrency}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={S.label}>VAT Owed</div>
                        <div style={{ fontWeight: 700, fontSize: "14px", color: j.vatOwedGbp > 0 ? "#f59e0b" : "#71717a" }}>
                          {j.vatOwedGbp > 0 ? j.vatOwedGbpFmt : "£0.00"}
                        </div>
                        <div style={S.sub}>{j.crossed ? "Active" : "Not yet"}</div>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar — only for threshold jurisdictions */}
                  {j.pctUsed !== null && (
                    <div style={{ marginTop: "12px" }}>
                      <ProgressBar pct={j.pctUsed} level={j.warningLevel} />
                      <div style={{ fontSize: "12px", color: "#71717a", marginTop: "6px" }}>
                        {j.revenueNative.toLocaleString("en-GB", { maximumFractionDigits: 2 })} {j.nativeCurrency} of {j.thresholdLabel} used
                        {j.crossed && j.crossedAt && (
                          <span style={{ color: "#10b981", marginLeft: "8px" }}>
                            · Crossed {fmtDate(j.crossedAt)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Registration number if set */}
                  {j.registrationNo && (
                    <div style={{ marginTop: "12px", padding: "10px 12px", background: "#18181b", borderRadius: "8px" }}>
                      <span style={S.label}>Registration No: </span>
                      <span style={{ fontFamily: "monospace", fontSize: "13px", color: "#818cf8" }}>
                        {j.registrationNo}
                      </span>
                      {j.registeredAt && (
                        <span style={{ ...S.sub, marginLeft: "12px" }}>
                          Registered {fmtDate(j.registeredAt)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ── Tab: Immediate VAT ── */}
          {tab === "immediate" && (
            <div style={{ marginTop: "12px" }}>
              <p style={{ ...S.sub, marginBottom: "12px" }}>
                Immediate VAT countries — no threshold, VAT applies from the very first sale.
                Enforcement against small UK businesses varies by country.
              </p>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Country / Authority</th>
                    <th style={S.th}>Tax Name</th>
                    <th style={S.th}>Rate</th>
                    <th style={S.th}>Payments</th>
                    <th style={S.th}>Revenue</th>
                    <th style={S.th}>VAT Owed</th>
                    <th style={S.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {immediateJurisdictions.map((j) => (
                    <tr key={j.jurisdiction}>
                      <td style={S.td}>
                        <div style={{ fontWeight: 600 }}>{j.jurisdictionName}</div>
                      </td>
                      <td style={{ ...S.td, color: "#a1a1aa" }}>{j.vatRatePct}</td>
                      <td style={S.td}>{j.vatRatePct}</td>
                      <td style={S.td}>{j.paymentCount}</td>
                      <td style={S.td}>{j.revenueGbpFmt}</td>
                      <td style={{ ...S.td, color: j.vatOwedGbp > 0 ? "#f59e0b" : "#71717a" }}>
                        {j.vatOwedGbpFmt}
                      </td>
                      <td style={S.td}>
                        {j.paymentCount === 0
                          ? <span style={S.tag("#52525b")}>No revenue yet</span>
                          : <span style={S.tag("#f59e0b")}>VAT owed</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Tab: Countries ── */}
          {tab === "countries" && (
            <div style={{ marginTop: "12px" }}>
              <p style={{ ...S.sub, marginBottom: "12px" }}>
                All countries where payments have been received, sorted by revenue.
              </p>
              {data.countriesList.length === 0 ? (
                <div style={{ ...S.card, textAlign: "center", color: "#71717a" }}>
                  No payments with country data yet
                </div>
              ) : (
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Country</th>
                      <th style={S.th}>Jurisdiction</th>
                      <th style={S.th}>Payments</th>
                      <th style={S.th}>Revenue</th>
                      <th style={S.th}>VAT Rate</th>
                      <th style={S.th}>VAT Owed</th>
                      <th style={S.th}>Mismatches</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.countriesList.map((c) => (
                      <tr key={c.countryCode}>
                        <td style={S.td}>
                          <span style={{ fontWeight: 600 }}>{c.countryName}</span>
                          <span style={{ ...S.sub, marginLeft: "6px" }}>({c.countryCode})</span>
                        </td>
                        <td style={{ ...S.td, color: "#a1a1aa" }}>{c.jurisdiction}</td>
                        <td style={S.td}>{c.payments}</td>
                        <td style={S.td}>£{c.revenueGbp.toFixed(2)}</td>
                        <td style={S.td}>
                          {c.vatRate > 0
                            ? <span style={S.tag("#f59e0b")}>{(c.vatRate * 100).toFixed(1)}%</span>
                            : <span style={{ color: "#52525b" }}>0%</span>
                          }
                        </td>
                        <td style={{ ...S.td, color: c.vatOwedGbp > 0 ? "#f59e0b" : "#71717a" }}>
                          £{c.vatOwedGbp.toFixed(2)}
                        </td>
                        <td style={S.td}>
                          {c.mismatches > 0
                            ? <span style={S.tag("#f59e0b")}>{c.mismatches}</span>
                            : <span style={{ color: "#52525b" }}>0</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Tab: IP Mismatches ── */}
          {tab === "mismatches" && (
            <div style={{ marginTop: "12px" }}>
              <p style={{ ...S.sub, marginBottom: "12px" }}>
                Payments where the IP-detected country didn't match the declared country.
                Shown for audit purposes — the declared country is used for VAT.
              </p>
              {data.mismatches.length === 0 ? (
                <div style={{ ...S.card, textAlign: "center", color: "#71717a" }}>
                  No mismatches recorded
                </div>
              ) : (
                <table style={S.table}>
                  <thead>
                    <tr>
                      <th style={S.th}>Wallet</th>
                      <th style={S.th}>IP Country</th>
                      <th style={S.th}>Declared</th>
                      <th style={S.th}>Amount</th>
                      <th style={S.th}>Kind</th>
                      <th style={S.th}>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.mismatches.map((m, i) => (
                      <tr key={i}>
                        <td style={{ ...S.td, fontFamily: "monospace", fontSize: "12px" }}>
                          {shortWallet(m.wallet)}
                        </td>
                        <td style={{ ...S.td, color: "#f59e0b" }}>
                          {m.ipCountry ?? "—"}
                        </td>
                        <td style={{ ...S.td, color: "#e4e4e7", fontWeight: 600 }}>
                          {m.declaredCountry ?? "—"}
                        </td>
                        <td style={S.td}>{m.amountSol} SOL</td>
                        <td style={S.td}>
                          <span style={S.tag(m.kind === "dev_fee" ? "#818cf8" : "#10b981")}>
                            {m.kind === "dev_fee" ? "Dev sub" : "User sub"}
                          </span>
                        </td>
                        <td style={{ ...S.td, color: "#71717a" }}>{fmtDate(m.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── Tab: Registrations ── */}
          {tab === "registrations" && (
            <div style={{ marginTop: "12px" }}>
              <p style={{ ...S.sub, marginBottom: "12px" }}>
                Your VAT registration numbers. Update these in Supabase under{" "}
                <code style={{ background: "#18181b", padding: "2px 6px", borderRadius: "4px", fontSize: "11px" }}>
                  vat_registrations
                </code>{" "}
                when you register with a tax authority.
              </p>

              {/* Threshold registrations */}
              <div style={{ ...S.label, marginBottom: "8px" }}>Threshold Jurisdictions</div>
              <table style={{ ...S.table, marginTop: "4px" }}>
                <thead>
                  <tr>
                    <th style={S.th}>Jurisdiction</th>
                    <th style={S.th}>Tax Authority</th>
                    <th style={S.th}>Registration No</th>
                    <th style={S.th}>Registered</th>
                    <th style={S.th}>Threshold Status</th>
                  </tr>
                </thead>
                <tbody>
                  {thresholdJurisdictions.map((j) => (
                    <tr key={j.jurisdiction}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{j.jurisdictionName}</td>
                      <td style={{ ...S.td, color: "#a1a1aa" }}>{j.taxAuthority}</td>
                      <td style={{ ...S.td, fontFamily: "monospace", fontSize: "12px" }}>
                        {j.registrationNo
                          ? <span style={{ color: "#818cf8" }}>{j.registrationNo}</span>
                          : <span style={{ color: "#3f3f46" }}>Not registered</span>
                        }
                      </td>
                      <td style={{ ...S.td, color: "#71717a" }}>
                        {j.registeredAt ? fmtDate(j.registeredAt) : "—"}
                      </td>
                      <td style={S.td}>
                        {j.crossed
                          ? <span style={S.tag("#ef4444")}>Threshold crossed — register now</span>
                          : j.pctUsed !== null && j.pctUsed >= 80
                            ? <span style={S.tag("#f59e0b")}>{j.pctUsed?.toFixed(1)}% used</span>
                            : <span style={S.tag("#52525b")}>{j.pctUsed?.toFixed(1) ?? 0}% used</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Immediate VAT registrations */}
              <div style={{ ...S.label, marginTop: "20px", marginBottom: "8px" }}>
                Immediate VAT Jurisdictions
              </div>
              <table style={{ ...S.table, marginTop: "4px" }}>
                <thead>
                  <tr>
                    <th style={S.th}>Jurisdiction</th>
                    <th style={S.th}>Tax Authority</th>
                    <th style={S.th}>Registration No</th>
                    <th style={S.th}>Revenue</th>
                    <th style={S.th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {immediateJurisdictions.map((j) => (
                    <tr key={j.jurisdiction}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{j.jurisdictionName}</td>
                      <td style={{ ...S.td, color: "#a1a1aa" }}>{j.taxAuthority}</td>
                      <td style={{ ...S.td, fontFamily: "monospace", fontSize: "12px" }}>
                        {j.registrationNo
                          ? <span style={{ color: "#818cf8" }}>{j.registrationNo}</span>
                          : <span style={{ color: "#3f3f46" }}>Not registered</span>
                        }
                      </td>
                      <td style={S.td}>{j.revenueGbpFmt}</td>
                      <td style={S.td}>
                        {j.paymentCount > 0
                          ? <span style={S.tag("#f59e0b")}>Has revenue — consult accountant</span>
                          : <span style={{ color: "#52525b", fontSize: "12px" }}>No revenue yet</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{
                marginTop: "16px",
                padding: "12px 16px",
                background: "#18181b",
                borderRadius: "10px",
                fontSize: "12px",
                color: "#71717a",
              }}>
                To add a registration number: go to Supabase → Table Editor → vat_registrations → find the
                jurisdiction row → update <code>registration_no</code> and <code>registered_at</code>.
                It will appear here on next refresh.
              </div>
            </div>
          )}

          {/* Footer */}
          <div style={{ ...S.sub, marginTop: "20px", textAlign: "center" }}>
            Last updated: {fmtDate(data.generatedAt)} ·
            VAT absorbed from revenue — customers are not charged extra
          </div>
        </>
      )}
    </div>
  );
}
