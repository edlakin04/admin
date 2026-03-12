"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type AffiliatePayout = {
  id:              string;
  referrer_wallet: string;
  amount_sol:      number;
  payment_count:   number;
  paid:            boolean;
  tx_signature:    string | null;
  paid_at:         string | null;
};

type Batch = {
  id:                   string;
  period_start:         string;
  period_end:           string;
  status:               "open" | "closed" | "affiliates_paid" | "complete";
  closed_at:            string | null;
  completed_at:         string | null;
  total_revenue_sol:    number;
  total_revenue_gbp:    number | null;
  user_sub_count:       number;
  dev_sub_count:        number;
  total_affiliate_sol:  number;
  total_affiliate_gbp:  number | null;
  your_cut_sol:         number;
  your_cut_gbp:         number | null;
  cashout_sol:          number | null;
  cashout_gbp:          number | null;
  cashout_tx_signature: string | null;
  cashout_wallet:       string | null;
  cashout_at:           string | null;
  affiliate_payouts:    AffiliatePayout[];
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

function fmtDateShort(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/London",
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtSol(n: number | null) {
  if (n == null) return "—";
  const v = Number.isInteger(n) ? n.toString()
    : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return `${v} SOL`;
}

function fmtGbp(n: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 2 });
}

function shortWallet(w: string) {
  if (!w) return "—";
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

function shortTx(tx: string | null) {
  if (!tx) return "—";
  return `${tx.slice(0, 8)}…${tx.slice(-8)}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  card: {
    background:   "#111111",
    border:       "1px solid #27272a",
    borderRadius: "14px",
    marginBottom: "10px",
    overflow:     "hidden",
  } as React.CSSProperties,
  cardHeader: {
    display:        "flex",
    alignItems:     "center",
    justifyContent: "space-between",
    gap:            "12px",
    padding:        "18px 20px",
    cursor:         "pointer",
    userSelect:     "none" as const,
  },
  cardBody: {
    padding:    "0 20px 20px",
    borderTop:  "1px solid #1c1c1e",
  },
  label: {
    fontSize:      "11px",
    color:         "#71717a",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    fontWeight:    600,
  },
  sub: { fontSize: "12px", color: "#71717a", marginTop: "2px" },
  btn: (variant: "primary" | "secondary" | "ghost") => ({
    padding:      "7px 14px",
    borderRadius: "8px",
    fontWeight:   600,
    fontSize:     "13px",
    cursor:       "pointer",
    border:       variant === "ghost" ? "1px solid #3f3f46" : "none",
    background:   variant === "primary" ? "#ffffff"
      : variant === "ghost"             ? "transparent"
      : "#27272a",
    color:        variant === "primary" ? "#000000" : "#e4e4e7",
    textDecoration: "none",
    display:      "inline-block",
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
  statGrid: {
    display:             "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap:                 "10px",
    marginTop:           "16px",
  },
  statBox: {
    background:   "#18181b",
    border:       "1px solid #27272a",
    borderRadius: "10px",
    padding:      "12px 14px",
  } as React.CSSProperties,
  val: { fontSize: "18px", fontWeight: 700, marginTop: "4px" },
  table: { width: "100%", borderCollapse: "collapse" as const },
  th: {
    textAlign:     "left" as const,
    fontSize:      "11px",
    color:         "#71717a",
    fontWeight:    600,
    textTransform: "uppercase" as const,
    padding:       "8px 10px",
    borderBottom:  "1px solid #27272a",
  },
  td: {
    padding:       "10px",
    borderBottom:  "1px solid #18181b",
    fontSize:      "13px",
    verticalAlign: "middle" as const,
  },
};

// ─── Batch detail row ─────────────────────────────────────────────────────────

function BatchRow({ batch, solGbpPrice }: { batch: Batch; solGbpPrice: number | null }) {
  const [open, setOpen] = useState(false);

  const isComplete  = batch.status === "complete";
  const statusColor = isComplete ? "#22c55e" : "#f59e0b";
  const statusLabel = isComplete ? "Complete" : batch.status.replace("_", " ");

  return (
    <div style={S.card}>
      {/* Collapsed header */}
      <div style={S.cardHeader} onClick={() => setOpen((o) => !o)}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ color: "#52525b", fontSize: "13px" }}>
            {open ? "▾" : "▸"}
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "15px" }}>
              {fmtDateShort(batch.period_start)}
            </div>
            <div style={S.sub}>
              {fmtSol(batch.total_revenue_sol)} revenue ·{" "}
              {fmtSol(batch.cashout_sol ?? batch.your_cut_sol)} cashed out ·{" "}
              {batch.user_sub_count + batch.dev_sub_count} payments
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={S.tag(statusColor)}>{statusLabel}</span>
          <button
            style={S.btn("ghost")}
            onClick={(e) => {
              e.stopPropagation();
              window.open(`/api/batches/${batch.id}/export`, "_blank");
            }}
          >
            Download
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={S.cardBody}>

          {/* Stat grid */}
          <div style={S.statGrid}>
            <div style={S.statBox}>
              <div style={S.label}>Revenue</div>
              <div style={S.val}>{fmtSol(batch.total_revenue_sol)}</div>
              <div style={S.sub}>{fmtGbp(batch.total_revenue_gbp)}</div>
            </div>
            <div style={S.statBox}>
              <div style={S.label}>Payments</div>
              <div style={S.val}>{batch.user_sub_count + batch.dev_sub_count}</div>
              <div style={S.sub}>{batch.user_sub_count} user · {batch.dev_sub_count} dev</div>
            </div>
            <div style={S.statBox}>
              <div style={S.label}>Affiliate payouts</div>
              <div style={S.val}>{fmtSol(batch.total_affiliate_sol)}</div>
              <div style={S.sub}>{fmtGbp(batch.total_affiliate_gbp)}</div>
            </div>
            <div style={S.statBox}>
              <div style={S.label}>Your cashout</div>
              <div style={{ ...S.val, color: "#22c55e" }}>
                {fmtSol(batch.cashout_sol ?? batch.your_cut_sol)}
              </div>
              <div style={S.sub}>
                {fmtGbp(batch.cashout_gbp ?? batch.your_cut_gbp)}
              </div>
            </div>
          </div>

          {/* Cashout details */}
          <div style={{ marginTop: "20px" }}>
            <div style={{ ...S.label, marginBottom: "10px" }}>Cashout details</div>
            <div style={{
              background:   "#18181b",
              border:       "1px solid #27272a",
              borderRadius: "10px",
              padding:      "14px 16px",
              fontSize:     "13px",
              lineHeight:   "2",
            }}>
              <div>
                <span style={{ color: "#71717a" }}>Sent to: </span>
                <span style={{ fontFamily: "monospace" }}>
                  {batch.cashout_wallet ? batch.cashout_wallet : "—"}
                </span>
              </div>
              <div>
                <span style={{ color: "#71717a" }}>Amount: </span>
                {fmtSol(batch.cashout_sol)} ({fmtGbp(batch.cashout_gbp)})
              </div>
              <div>
                <span style={{ color: "#71717a" }}>Tx signature: </span>
                <span style={{ fontFamily: "monospace" }}>
                  {shortTx(batch.cashout_tx_signature)}
                </span>
              </div>
              <div>
                <span style={{ color: "#71717a" }}>Completed: </span>
                {fmtDate(batch.cashout_at ?? batch.completed_at)}
              </div>
            </div>
          </div>

          {/* Affiliate payouts table */}
          {batch.affiliate_payouts.length > 0 && (
            <div style={{ marginTop: "20px" }}>
              <div style={{ ...S.label, marginBottom: "10px" }}>
                Affiliate payouts — {batch.affiliate_payouts.length}
              </div>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Wallet</th>
                    <th style={S.th}>Amount SOL</th>
                    <th style={S.th}>Amount GBP</th>
                    <th style={S.th}>Payments</th>
                    <th style={S.th}>Paid at</th>
                    <th style={S.th}>Tx signature</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.affiliate_payouts.map((p) => (
                    <tr key={p.id}>
                      <td style={S.td}>
                        <span style={{ fontFamily: "monospace", fontSize: "12px" }}>
                          {shortWallet(p.referrer_wallet)}
                        </span>
                      </td>
                      <td style={S.td}>{fmtSol(p.amount_sol)}</td>
                      <td style={S.td}>
                        {fmtGbp(
                          solGbpPrice
                            ? Math.round(p.amount_sol * solGbpPrice * 100) / 100
                            : null
                        )}
                      </td>
                      <td style={{ ...S.td, color: "#71717a" }}>{p.payment_count}</td>
                      <td style={{ ...S.td, color: "#71717a" }}>
                        {fmtDate(p.paid_at)}
                      </td>
                      <td style={{ ...S.td, fontFamily: "monospace", fontSize: "11px", color: "#52525b" }}>
                        {shortTx(p.tx_signature)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {batch.affiliate_payouts.length === 0 && (
            <div style={{ marginTop: "16px", color: "#52525b", fontSize: "13px" }}>
              No affiliate payouts for this batch.
            </div>
          )}

          {/* Period info */}
          <div style={{ marginTop: "20px", fontSize: "12px", color: "#52525b" }}>
            Period: {fmtDate(batch.period_start)} — {fmtDate(batch.period_end)}
            {" · "}Batch ID: <span style={{ fontFamily: "monospace" }}>{batch.id}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const router = useRouter();

  const [loading,     setLoading]     = useState(true);
  const [err,         setErr]         = useState<string | null>(null);
  const [batches,     setBatches]     = useState<Batch[]>([]);
  const [solGbpPrice, setSolGbpPrice] = useState<number | null>(null);

  // Totals
  const [totalRevSol,  setTotalRevSol]  = useState(0);
  const [totalRevGbp,  setTotalRevGbp]  = useState<number | null>(null);
  const [totalAffSol,  setTotalAffSol]  = useState(0);
  const [totalCashSol, setTotalCashSol] = useState(0);

  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/batches", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 401) { router.replace("/login"); return; }
        throw new Error(json?.error ?? "Failed to load");
      }

      const all: Batch[] = json.batches ?? [];
      // History shows only complete batches, newest first
      const complete = all.filter((b) => b.status === "complete");
      setBatches(complete);
      setSolGbpPrice(json.solGbpPrice ?? null);

      // Compute all-time totals
      const revSol  = complete.reduce((s, b) => s + b.total_revenue_sol,           0);
      const affSol  = complete.reduce((s, b) => s + b.total_affiliate_sol,         0);
      const cashSol = complete.reduce((s, b) => s + (b.cashout_sol ?? b.your_cut_sol), 0);
      setTotalRevSol(Math.round(revSol  * 1e9) / 1e9);
      setTotalAffSol(Math.round(affSol  * 1e9) / 1e9);
      setTotalCashSol(Math.round(cashSol * 1e9) / 1e9);
      setTotalRevGbp(json.solGbpPrice ? Math.round(revSol * json.solGbpPrice * 100) / 100 : null);

    } catch (e: any) {
      setErr(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  return (
    <main style={{
      minHeight:  "100vh",
      background: "#0a0a0a",
      color:      "#e4e4e7",
      padding:    "24px",
    }}>
      <div style={{ maxWidth: "860px", margin: "0 auto" }}>

        {/* Top bar */}
        <div style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "space-between",
          marginBottom:   "28px",
        }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 700 }}>History</h1>
            <div style={{ ...S.sub, marginTop: "4px" }}>
              {batches.length} completed batch{batches.length !== 1 ? "es" : ""}
            </div>
          </div>
          <a href="/" style={S.btn("secondary")}>← Dashboard</a>
        </div>

        {/* All-time totals */}
        {batches.length > 0 && (
          <div style={{
            ...S.card,
            padding:      "18px 20px",
            marginBottom: "24px",
          }}>
            <div style={{ ...S.label, marginBottom: "14px" }}>All-time totals</div>
            <div style={{
              display:             "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap:                 "10px",
            }}>
              <div style={S.statBox}>
                <div style={S.label}>Total revenue</div>
                <div style={S.val}>{fmtSol(totalRevSol)}</div>
                <div style={S.sub}>{fmtGbp(totalRevGbp)}</div>
              </div>
              <div style={S.statBox}>
                <div style={S.label}>Affiliate payouts</div>
                <div style={S.val}>{fmtSol(totalAffSol)}</div>
              </div>
              <div style={S.statBox}>
                <div style={S.label}>Your cashouts</div>
                <div style={{ ...S.val, color: "#22c55e" }}>{fmtSol(totalCashSol)}</div>
              </div>
              <div style={S.statBox}>
                <div style={S.label}>Batches</div>
                <div style={S.val}>{batches.length}</div>
              </div>
            </div>
          </div>
        )}

        {loading && (
          <div style={{ color: "#71717a", fontSize: "14px" }}>Loading…</div>
        )}

        {err && (
          <div style={{
            padding:    "12px 16px",
            borderRadius: "10px",
            background: "rgba(239,68,68,0.1)",
            border:     "1px solid rgba(239,68,68,0.25)",
            color:      "#f87171",
            fontSize:   "13px",
            marginBottom: "16px",
          }}>
            {err}
          </div>
        )}

        {/* Batch list */}
        {batches.map((b) => (
          <BatchRow key={b.id} batch={b} solGbpPrice={solGbpPrice} />
        ))}

        {!loading && batches.length === 0 && (
          <div style={{
            textAlign: "center",
            padding:   "48px 24px",
            color:     "#52525b",
            fontSize:  "14px",
          }}>
            No completed batches yet. Completed batches will appear here.
          </div>
        )}
      </div>
    </main>
  );
}
