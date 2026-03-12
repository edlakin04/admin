"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type AffiliatePayout = {
  id:              string;
  batch_id:        string;
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
  return `${w.slice(0, 4)}…${w.slice(-4)}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  card: {
    background: "#111111",
    border: "1px solid #27272a",
    borderRadius: "14px",
    padding: "20px",
    marginBottom: "12px",
  } as React.CSSProperties,
  cardHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    cursor: "pointer",
    userSelect: "none" as const,
  },
  label: {
    fontSize: "11px",
    color: "#71717a",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    fontWeight: 600,
  },
  val: { fontSize: "20px", fontWeight: 700, marginTop: "4px" },
  sub: { fontSize: "12px", color: "#71717a", marginTop: "2px" },
  btn: (variant: "primary" | "secondary" | "danger" | "ghost") => ({
    padding: "8px 16px",
    borderRadius: "8px",
    border: "none",
    fontWeight: 600,
    fontSize: "13px",
    cursor: "pointer",
    transition: "opacity 0.15s",
    background: variant === "primary" ? "#ffffff"
      : variant === "danger"    ? "#ef4444"
      : variant === "ghost"     ? "transparent"
      : "#27272a",
    color: variant === "primary" ? "#000000"
      : variant === "ghost"     ? "#a1a1aa"
      : "#ffffff",
    border: variant === "ghost" ? "1px solid #3f3f46" : "none",
  } as React.CSSProperties),
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
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

// ─── Solana wallet helper ─────────────────────────────────────────────────────
// Uses window.solana (Phantom / any Solana wallet extension)

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      connect(): Promise<{ publicKey: { toBase58(): string } }>;
      signAndSendTransaction(tx: any): Promise<{ signature: string }>;
    };
  }
}

async function sendSolTransaction(
  toWallet: string,
  amountSol: number
): Promise<string> {
  if (!window.solana) throw new Error("No Solana wallet found. Install Phantom.");

  const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } =
    await import("@solana/web3.js");

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL
    ?? "https://api.mainnet-beta.solana.com";

  const connection  = new Connection(rpcUrl, "confirmed");
  const { publicKey } = await window.solana.connect();
  const fromPubkey  = publicKey;
  const toPubkey    = new PublicKey(toWallet);
  const lamports    = Math.round(amountSol * LAMPORTS_PER_SOL);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");

  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer:        fromPubkey,
  }).add(
    SystemProgram.transfer({ fromPubkey, toPubkey, lamports })
  );

  const { signature } = await window.solana.signAndSendTransaction(tx);
  return signature;
}

// ─── Batch card component ─────────────────────────────────────────────────────

function BatchCard({
  batch,
  defaultOpen,
  solGbpPrice,
  onRefresh,
}: {
  batch:       Batch;
  defaultOpen: boolean;
  solGbpPrice: number | null;
  onRefresh:   () => void;
}) {
  const [open,        setOpen]        = useState(defaultOpen);
  const [payingId,    setPayingId]    = useState<string | null>(null);
  const [payingAll,   setPayingAll]   = useState(false);
  const [cashingOut,  setCashingOut]  = useState(false);
  const [msg,         setMsg]         = useState<{ text: string; ok: boolean } | null>(null);

  const isOpen          = batch.status === "open";
  const isClosed        = batch.status === "closed";
  const isAffsPaid      = batch.status === "affiliates_paid";
  const isComplete      = batch.status === "complete";
  const unpaidPayouts   = batch.affiliate_payouts.filter((p) => !p.paid);
  const allAffsPaid     = unpaidPayouts.length === 0 && batch.affiliate_payouts.length > 0;

  const statusColor = isOpen ? "#22d3ee"
    : isClosed      ? "#f59e0b"
    : isAffsPaid    ? "#a78bfa"
    : "#22c55e";

  const statusLabel = isOpen ? "Live"
    : isClosed      ? "Awaiting payouts"
    : isAffsPaid    ? "Awaiting cashout"
    : "Complete";

  async function payAffiliate(payout: AffiliatePayout) {
    setPayingId(payout.id);
    setMsg(null);
    try {
      const sig = await sendSolTransaction(payout.referrer_wallet, payout.amount_sol);

      // Wait briefly for confirmation
      await new Promise((r) => setTimeout(r, 3000));

      const res = await fetch(`/api/batches/${batch.id}/payouts`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ payoutId: payout.id, txSignature: sig }),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json?.error ?? "Payout failed");
      setMsg({ text: `Paid ${shortWallet(payout.referrer_wallet)} — tx confirmed ✓`, ok: true });
      onRefresh();
    } catch (e: any) {
      setMsg({ text: e?.message ?? "Payout failed", ok: false });
    } finally {
      setPayingId(null);
    }
  }

  async function cashOut() {
    setCashingOut(true);
    setMsg(null);
    try {
      // Get cashout wallet from env (NEXT_PUBLIC_CASHOUT_WALLET not needed —
      // the server reads CASHOUT_WALLET and verifies the tx destination)
      // We get the destination from the API first
      const infoRes = await fetch(`/api/batches/${batch.id}/cashout-info`);
      const info    = await infoRes.json();
      if (!infoRes.ok) throw new Error(info?.error ?? "Failed to get cashout info");

      const sig = await sendSolTransaction(info.cashoutWallet, batch.your_cut_sol);

      await new Promise((r) => setTimeout(r, 3000));

      const res = await fetch(`/api/batches/${batch.id}/cashout`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ txSignature: sig }),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json?.error ?? "Cashout failed");
      setMsg({ text: `Cashed out ${fmtSol(batch.your_cut_sol)} ✓`, ok: true });
      onRefresh();
    } catch (e: any) {
      setMsg({ text: e?.message ?? "Cashout failed", ok: false });
    } finally {
      setCashingOut(false);
    }
  }

  async function downloadExport() {
    window.open(`/api/batches/${batch.id}/export`, "_blank");
  }

  const periodLabel = `${fmtDateShort(batch.period_start)} — ${fmtDateShort(batch.period_end)}`;

  return (
    <div style={S.card}>
      {/* Header row — click to expand/collapse */}
      <div style={S.cardHeader} onClick={() => !isOpen && setOpen((o) => !o)}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {!isOpen && (
            <span style={{ color: "#52525b", fontSize: "13px" }}>
              {open ? "▾" : "▸"}
            </span>
          )}
          <div>
            <div style={{ fontWeight: 700, fontSize: "15px" }}>
              {isOpen ? "Today — live" : periodLabel}
            </div>
            <div style={{ ...S.sub, marginTop: "2px" }}>
              {isOpen
                ? `${fmtDate(batch.period_start)} — midnight`
                : fmtDate(batch.closed_at ?? batch.period_end)}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={S.tag(statusColor)}>{statusLabel}</span>
          {isComplete && (
            <button style={S.btn("ghost")} onClick={(e) => { e.stopPropagation(); downloadExport(); }}>
              Download
            </button>
          )}
        </div>
      </div>

      {/* Body — only shown when expanded */}
      {(open || isOpen) && (
        <div style={{ marginTop: "16px" }}>

          {/* Stat grid */}
          <div style={S.statGrid}>
            <div style={S.statBox()}>
              <div style={S.label}>Revenue</div>
              <div style={S.val}>{fmtSol(batch.total_revenue_sol)}</div>
              <div style={S.sub}>{fmtGbp(batch.total_revenue_gbp)}</div>
            </div>
            <div style={S.statBox()}>
              <div style={S.label}>Payments</div>
              <div style={S.val}>{batch.user_sub_count + batch.dev_sub_count}</div>
              <div style={S.sub}>{batch.user_sub_count} user · {batch.dev_sub_count} dev</div>
            </div>
            <div style={S.statBox()}>
              <div style={S.label}>Affiliates owed</div>
              <div style={S.val}>{fmtSol(batch.total_affiliate_sol)}</div>
              <div style={S.sub}>{fmtGbp(batch.total_affiliate_gbp)}</div>
            </div>
            <div style={S.statBox(!isOpen)}>
              <div style={S.label}>Your cut</div>
              <div style={{ ...S.val, color: isOpen ? "#e4e4e7" : "#22c55e" }}>
                {fmtSol(batch.your_cut_sol)}
              </div>
              <div style={S.sub}>{fmtGbp(batch.your_cut_gbp)}</div>
            </div>
          </div>

          {/* Affiliate payouts table — only for closed batches */}
          {!isOpen && batch.affiliate_payouts.length > 0 && (
            <div style={{ marginTop: "20px" }}>
              <div style={{ ...S.label, marginBottom: "8px" }}>
                Affiliate payouts — {unpaidPayouts.length} unpaid of {batch.affiliate_payouts.length}
              </div>
              <table style={S.table}>
                <thead>
                  <tr>
                    <th style={S.th}>Wallet</th>
                    <th style={S.th}>Amount</th>
                    <th style={S.th}>Payments</th>
                    <th style={S.th}>Status</th>
                    <th style={S.th}>Action</th>
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
                      <td style={S.td}>
                        <div>{fmtSol(p.amount_sol)}</div>
                        <div style={S.sub}>
                          {fmtGbp(solGbpPrice ? Math.round(p.amount_sol * solGbpPrice * 100) / 100 : null)}
                        </div>
                      </td>
                      <td style={{ ...S.td, color: "#71717a" }}>{p.payment_count}</td>
                      <td style={S.td}>
                        {p.paid ? (
                          <span style={S.tag("#22c55e")}>Paid ✓</span>
                        ) : (
                          <span style={S.tag("#f59e0b")}>Unpaid</span>
                        )}
                      </td>
                      <td style={S.td}>
                        {p.paid ? (
                          <span style={{ fontSize: "11px", color: "#52525b", fontFamily: "monospace" }}>
                            {p.tx_signature
                              ? `${p.tx_signature.slice(0,6)}…${p.tx_signature.slice(-6)}`
                              : "—"}
                          </span>
                        ) : (
                          <button
                            style={{
                              ...S.btn("primary"),
                              opacity: payingId === p.id ? 0.6 : 1,
                            }}
                            disabled={!!payingId || cashingOut}
                            onClick={() => payAffiliate(p)}
                          >
                            {payingId === p.id ? "Sending…" : `Pay ${fmtSol(p.amount_sol)}`}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* No affiliates message */}
          {!isOpen && batch.affiliate_payouts.length === 0 && isClosed && (
            <div style={{ marginTop: "16px", color: "#52525b", fontSize: "13px" }}>
              No affiliate payouts for this batch.
            </div>
          )}

          {/* Cashout section — unlocks when affiliates_paid */}
          {!isOpen && (isClosed || isAffsPaid || isComplete) && (
            <div style={{
              marginTop:    "20px",
              padding:      "16px",
              background:   "#18181b",
              borderRadius: "10px",
              border:       "1px solid #27272a",
            }}>
              <div style={{ ...S.label, marginBottom: "10px" }}>Your cashout</div>

              {isComplete ? (
                <div>
                  <div style={{ color: "#22c55e", fontWeight: 600, marginBottom: "6px" }}>
                    Cashed out {fmtSol(batch.cashout_sol)} ({fmtGbp(batch.cashout_gbp)}) ✓
                  </div>
                  <div style={{ fontSize: "12px", color: "#71717a" }}>
                    Sent to {shortWallet(batch.cashout_wallet ?? "")} · {fmtDate(batch.cashout_at)}
                  </div>
                </div>
              ) : isAffsPaid ? (
                <div>
                  <div style={{ marginBottom: "10px" }}>
                    <span style={{ color: "#22c55e", fontWeight: 600, fontSize: "15px" }}>
                      {fmtSol(batch.your_cut_sol)}
                    </span>
                    <span style={{ color: "#71717a", fontSize: "13px", marginLeft: "8px" }}>
                      {fmtGbp(batch.your_cut_gbp)}
                    </span>
                  </div>
                  <button
                    style={{
                      ...S.btn("primary"),
                      opacity: cashingOut ? 0.6 : 1,
                    }}
                    disabled={cashingOut || !!payingId}
                    onClick={cashOut}
                  >
                    {cashingOut ? "Sending…" : `Cash out ${fmtSol(batch.your_cut_sol)}`}
                  </button>
                </div>
              ) : (
                <div style={{ color: "#71717a", fontSize: "13px" }}>
                  🔒 Complete all affiliate payouts first to unlock cashout.
                </div>
              )}
            </div>
          )}

          {/* Message */}
          {msg && (
            <div style={{
              marginTop:    "12px",
              padding:      "10px 14px",
              borderRadius: "8px",
              background:   msg.ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
              border:       `1px solid ${msg.ok ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
              color:        msg.ok ? "#22c55e" : "#f87171",
              fontSize:     "13px",
            }}>
              {msg.text}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const router = useRouter();

  const [loading,     setLoading]     = useState(true);
  const [err,         setErr]         = useState<string | null>(null);
  const [batches,     setBatches]     = useState<Batch[]>([]);
  const [solGbpPrice, setSolGbpPrice] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/batches", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 401) { router.replace("/login"); return; }
        throw new Error(json?.error ?? "Failed to load");
      }
      setBatches(json.batches ?? []);
      setSolGbpPrice(json.solGbpPrice ?? null);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s for live batch
  useEffect(() => {
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  async function logout() {
    await fetch("/api/auth/login", { method: "DELETE" });
    router.replace("/login");
  }

  const activeBatches   = batches.filter((b) => b.status !== "complete");
  const completeBatches = batches.filter((b) => b.status === "complete");

  return (
    <main style={{
      minHeight:   "100vh",
      background:  "#0a0a0a",
      color:       "#e4e4e7",
      padding:     "24px",
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
            <h1 style={{ fontSize: "20px", fontWeight: 700 }}>Authswap Admin</h1>
            <div style={{ ...S.sub, marginTop: "4px" }}>
              {solGbpPrice
                ? `SOL/GBP: £${solGbpPrice.toFixed(2)}`
                : "SOL/GBP: loading…"}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <a href="/history" style={S.btn("secondary")}>History</a>
            <button style={S.btn("ghost")} onClick={logout}>Log out</button>
          </div>
        </div>

        {loading && (
          <div style={{ color: "#71717a", fontSize: "14px" }}>Loading…</div>
        )}

        {err && (
          <div style={{
            padding: "12px 16px", borderRadius: "10px",
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
            color: "#f87171", fontSize: "13px", marginBottom: "16px",
          }}>
            {err}
          </div>
        )}

        {/* Active batches (open + unpaid closed) */}
        {activeBatches.length > 0 && (
          <div>
            {activeBatches.map((b, i) => (
              <BatchCard
                key={b.id}
                batch={b}
                defaultOpen={i === 0}
                solGbpPrice={solGbpPrice}
                onRefresh={load}
              />
            ))}
          </div>
        )}

        {/* Completed batches summary */}
        {completeBatches.length > 0 && (
          <div style={{ marginTop: "32px" }}>
            <div style={{ ...S.label, marginBottom: "12px" }}>
              Completed — {completeBatches.length} batch{completeBatches.length !== 1 ? "es" : ""}
            </div>
            {completeBatches.slice(0, 5).map((b) => (
              <div key={b.id} style={{
                ...S.card,
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
                padding:        "14px 18px",
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: "14px" }}>
                    {fmtDateShort(b.period_start)}
                  </div>
                  <div style={S.sub}>
                    {fmtSol(b.total_revenue_sol)} revenue · {fmtSol(b.cashout_sol ?? b.your_cut_sol)} cashed out
                  </div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button
                    style={S.btn("ghost")}
                    onClick={() => window.open(`/api/batches/${b.id}/export`, "_blank")}
                  >
                    Download
                  </button>
                  <a href="/history" style={S.btn("secondary")}>
                    All history →
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && batches.length === 0 && (
          <div style={{
            textAlign: "center", padding: "48px 24px",
            color: "#52525b", fontSize: "14px",
          }}>
            No batches yet. Run the SQL seed to create the first open batch.
          </div>
        )}
      </div>
    </main>
  );
}
