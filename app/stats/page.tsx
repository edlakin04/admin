"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

type Headline = {
  totalUsers:       number;
  activeUsers:      number;
  activeDevs:       number;
  trialUsers:       number;
  activeTrials:     number;
  expiredTrials:    number;
  totalSubPayments: number;
  totalDevSignups:  number;
};

type TimeData = Record<string, number>;

type StatsData = {
  headline: Headline;
  daily: {
    signups:     TimeData;
    subPayments: TimeData;
    devSignups:  TimeData;
    trials:      TimeData;
  };
  monthly: {
    signups:     TimeData;
    subPayments: TimeData;
    devSignups:  TimeData;
    trials:      TimeData;
  };
};

type Range = "7d" | "30d" | "90d" | "monthly";

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  card: {
    background:   "#111111",
    border:       "1px solid #27272a",
    borderRadius: "14px",
    padding:      "20px",
    marginBottom: "16px",
  } as React.CSSProperties,
  label: {
    fontSize:      "11px",
    color:         "#71717a",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    fontWeight:    600,
  },
  sub: { fontSize: "12px", color: "#71717a", marginTop: "3px" },
  val: { fontSize: "28px", fontWeight: 700, marginTop: "4px" },
  btn: (active: boolean) => ({
    padding:      "6px 14px",
    borderRadius: "8px",
    fontWeight:   600,
    fontSize:     "12px",
    cursor:       "pointer",
    border:       "none",
    background:   active ? "#ffffff" : "#27272a",
    color:        active ? "#000000" : "#a1a1aa",
    transition:   "all 0.15s",
  } as React.CSSProperties),
  navBtn: {
    padding:        "7px 14px",
    borderRadius:   "8px",
    fontWeight:     600,
    fontSize:       "13px",
    cursor:         "pointer",
    border:         "none",
    background:     "#27272a",
    color:          "#e4e4e7",
    textDecoration: "none",
    display:        "inline-block",
  } as React.CSSProperties,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLast7Days(): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
}

function getLast30Days(): string[] {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return d.toISOString().slice(0, 10);
  });
}

function getLast90Days(): string[] {
  return Array.from({ length: 90 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (89 - i));
    return d.toISOString().slice(0, 10);
  });
}

function getAllMonths(data: TimeData): string[] {
  const keys = Object.keys(data).sort();
  if (keys.length === 0) return [];
  const start  = new Date(keys[0] + "-01");
  const now    = new Date();
  const months: string[] = [];
  const cur = new Date(start);
  while (cur <= now) {
    months.push(cur.toISOString().slice(0, 7));
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: "Europe/London", day: "numeric", month: "short",
  });
}

function fmtMonth(ym: string) {
  return new Date(ym + "-01").toLocaleDateString("en-GB", {
    timeZone: "Europe/London", month: "short", year: "numeric",
  });
}

// ─── Bar chart component ──────────────────────────────────────────────────────

function BarChart({
  labels,
  datasets,
  height = 160,
}: {
  labels:   string[];
  datasets: { label: string; color: string; data: number[] }[];
  height?:  number;
}) {
  const allVals = datasets.flatMap((d) => d.data);
  const maxVal  = Math.max(...allVals, 1);
  const showEvery = labels.length > 30 ? Math.ceil(labels.length / 15) : labels.length > 14 ? 2 : 1;

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <div style={{
        display:       "flex",
        alignItems:    "flex-end",
        gap:           labels.length > 30 ? "2px" : labels.length > 14 ? "3px" : "5px",
        height:        `${height}px`,
        paddingBottom: "24px",
        minWidth:      labels.length > 30 ? `${labels.length * 8}px` : "100%",
      }}>
        {labels.map((lbl, i) => (
          <div
            key={lbl}
            style={{
              flex:           1,
              display:        "flex",
              flexDirection:  "column",
              alignItems:     "center",
              justifyContent: "flex-end",
              gap:            "2px",
              height:         "100%",
              position:       "relative",
            }}
            title={`${lbl}: ${datasets.map((d) => `${d.label}: ${d.data[i]}`).join(", ")}`}
          >
            {/* Stacked bars */}
            <div style={{
              display:       "flex",
              flexDirection: "column",
              alignItems:    "center",
              justifyContent:"flex-end",
              width:         "100%",
              height:        `${height - 24}px`,
              gap:           "1px",
            }}>
              {datasets.map((ds) => {
                const pct = ds.data[i] / maxVal;
                return (
                  <div
                    key={ds.label}
                    style={{
                      width:        "100%",
                      height:       `${Math.max(pct * (height - 24), ds.data[i] > 0 ? 2 : 0)}px`,
                      background:   ds.color,
                      borderRadius: "3px 3px 0 0",
                      transition:   "height 0.3s ease",
                      opacity:      0.85,
                    }}
                  />
                );
              })}
            </div>
            {/* X-axis label */}
            {i % showEvery === 0 && (
              <div style={{
                position:  "absolute",
                bottom:    0,
                fontSize:  "9px",
                color:     "#52525b",
                whiteSpace:"nowrap" as const,
                transform: "rotate(-45deg)",
                transformOrigin: "top left",
              }}>
                {lbl.length === 10 ? fmtDay(lbl) : fmtMonth(lbl)}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", gap: "16px", marginTop: "8px", flexWrap: "wrap" as const }}>
        {datasets.map((ds) => (
          <div key={ds.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{
              width: "10px", height: "10px",
              borderRadius: "2px", background: ds.color,
            }} />
            <span style={{ fontSize: "11px", color: "#71717a" }}>{ds.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stat box ─────────────────────────────────────────────────────────────────

function StatBox({
  label, value, sub, color,
}: {
  label: string; value: number | string; sub?: string; color?: string;
}) {
  return (
    <div style={{
      background: "#18181b", border: "1px solid #27272a",
      borderRadius: "12px", padding: "16px 18px",
    }}>
      <div style={S.label}>{label}</div>
      <div style={{ ...S.val, color: color ?? "#e4e4e7" }}>{value}</div>
      {sub && <div style={S.sub}>{sub}</div>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState<string | null>(null);
  const [stats,   setStats]   = useState<StatsData | null>(null);
  const [range,   setRange]   = useState<Range>("30d");

  const load = useCallback(async () => {
    try {
      const res  = await fetch("/api/stats", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 401) { router.replace("/login"); return; }
        throw new Error(json?.error ?? "Failed to load");
      }
      setStats(json);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  // ── Compute chart data based on range ─────────────────────────────────────
  const chartData = (() => {
    if (!stats) return null;

    if (range === "monthly") {
      // Merge all data sources to find all months
      const allData = {
        ...stats.monthly.signups,
        ...stats.monthly.subPayments,
        ...stats.monthly.devSignups,
        ...stats.monthly.trials,
      };
      const labels = getAllMonths(allData);
      return {
        labels,
        datasets: [
          { label: "Sign-ups",     color: "#38bdf8", data: labels.map((l) => stats.monthly.signups[l]    ?? 0) },
          { label: "Subscriptions", color: "#22c55e", data: labels.map((l) => stats.monthly.subPayments[l] ?? 0) },
          { label: "Dev signups",  color: "#a78bfa", data: labels.map((l) => stats.monthly.devSignups[l]  ?? 0) },
          { label: "Trials",       color: "#fb923c", data: labels.map((l) => stats.monthly.trials[l]      ?? 0) },
        ],
      };
    }

    const labels = range === "7d" ? getLast7Days()
      : range === "30d"           ? getLast30Days()
      :                             getLast90Days();

    return {
      labels,
      datasets: [
        { label: "Sign-ups",      color: "#38bdf8", data: labels.map((l) => stats.daily.signups[l]     ?? 0) },
        { label: "Subscriptions", color: "#22c55e", data: labels.map((l) => stats.daily.subPayments[l] ?? 0) },
        { label: "Dev signups",   color: "#a78bfa", data: labels.map((l) => stats.daily.devSignups[l]  ?? 0) },
        { label: "Trials",        color: "#fb923c", data: labels.map((l) => stats.daily.trials[l]      ?? 0) },
      ],
    };
  })();

  // ── Monthly breakdown table ────────────────────────────────────────────────
  const monthlyTable = (() => {
    if (!stats) return [];
    const allData = {
      ...stats.monthly.signups,
      ...stats.monthly.subPayments,
      ...stats.monthly.devSignups,
      ...stats.monthly.trials,
    };
    return getAllMonths(allData).reverse().map((m) => ({
      month:    m,
      signups:  stats.monthly.signups[m]     ?? 0,
      subs:     stats.monthly.subPayments[m] ?? 0,
      devs:     stats.monthly.devSignups[m]  ?? 0,
      trials:   stats.monthly.trials[m]      ?? 0,
    }));
  })();

  const h = stats?.headline;

  return (
    <main style={{
      minHeight:  "100vh",
      background: "#0a0a0a",
      color:      "#e4e4e7",
      padding:    "24px",
    }}>
      <div style={{ maxWidth: "920px", margin: "0 auto" }}>

        {/* Top bar */}
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: "space-between", marginBottom: "28px",
        }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 700 }}>Platform Stats</h1>
            <div style={{ ...S.sub, marginTop: "4px" }}>Users, signups, trials — no revenue</div>
          </div>
          <a href="/" style={S.navBtn}>← Dashboard</a>
        </div>

        {loading && <div style={{ color: "#71717a", fontSize: "14px" }}>Loading…</div>}

        {err && (
          <div style={{
            padding: "12px 16px", borderRadius: "10px",
            background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
            color: "#f87171", fontSize: "13px", marginBottom: "16px",
          }}>
            {err}
          </div>
        )}

        {h && (
          <>
            {/* Headline stats grid */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "12px", marginBottom: "24px",
            }}>
              <StatBox
                label="Total sign-ups"
                value={h.totalUsers}
                sub="all time"
                color="#e4e4e7"
              />
              <StatBox
                label="Active subscribers"
                value={h.activeUsers}
                sub="paid, not expired"
                color="#22c55e"
              />
              <StatBox
                label="Active devs"
                value={h.activeDevs}
                sub="dev profiles created"
                color="#a78bfa"
              />
              <StatBox
                label="Active trials"
                value={h.activeTrials}
                sub={`${h.expiredTrials} expired`}
                color="#fb923c"
              />
              <StatBox
                label="Trial users ever"
                value={h.trialUsers}
                sub="activated a trial"
              />
              <StatBox
                label="Sub payments"
                value={h.totalSubPayments}
                sub="all time renewals"
                color="#38bdf8"
              />
              <StatBox
                label="Dev signups"
                value={h.totalDevSignups}
                sub="paid dev fee"
                color="#a78bfa"
              />
              <StatBox
                label="Wallets seen"
                value={h.totalUsers}
                sub="ever signed in"
              />
            </div>

            {/* Quick ratios */}
            <div style={{
              ...S.card,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "16px",
            }}>
              <div>
                <div style={S.label}>Trial → Paid conversion</div>
                <div style={{ fontSize: "22px", fontWeight: 700, marginTop: "4px", color: "#22c55e" }}>
                  {h.trialUsers > 0
                    ? `${Math.round((h.activeUsers / h.trialUsers) * 100)}%`
                    : "—"}
                </div>
                <div style={S.sub}>active subs ÷ trial users</div>
              </div>
              <div>
                <div style={S.label}>Dev : User ratio</div>
                <div style={{ fontSize: "22px", fontWeight: 700, marginTop: "4px", color: "#a78bfa" }}>
                  {h.activeUsers > 0
                    ? `1 : ${Math.round(h.activeUsers / Math.max(h.activeDevs, 1))}`
                    : "—"}
                </div>
                <div style={S.sub}>devs to active users</div>
              </div>
              <div>
                <div style={S.label}>Sign-ups still active</div>
                <div style={{ fontSize: "22px", fontWeight: 700, marginTop: "4px", color: "#38bdf8" }}>
                  {h.totalUsers > 0
                    ? `${Math.round((h.activeUsers / h.totalUsers) * 100)}%`
                    : "—"}
                </div>
                <div style={S.sub}>of all sign-ups</div>
              </div>
              <div>
                <div style={S.label}>Trial still active</div>
                <div style={{ fontSize: "22px", fontWeight: 700, marginTop: "4px", color: "#fb923c" }}>
                  {h.trialUsers > 0
                    ? `${Math.round((h.activeTrials / h.trialUsers) * 100)}%`
                    : "—"}
                </div>
                <div style={S.sub}>of all trial users</div>
              </div>
            </div>

            {/* Chart */}
            <div style={S.card}>
              <div style={{
                display: "flex", alignItems: "center",
                justifyContent: "space-between", marginBottom: "20px",
                flexWrap: "wrap" as const, gap: "10px",
              }}>
                <div style={{ fontWeight: 700, fontSize: "15px" }}>Activity over time</div>
                <div style={{ display: "flex", gap: "6px" }}>
                  {(["7d", "30d", "90d", "monthly"] as Range[]).map((r) => (
                    <button key={r} style={S.btn(range === r)} onClick={() => setRange(r)}>
                      {r === "monthly" ? "Monthly" : r}
                    </button>
                  ))}
                </div>
              </div>

              {chartData && (
                <BarChart
                  labels={chartData.labels}
                  datasets={chartData.datasets}
                  height={200}
                />
              )}
            </div>

            {/* Monthly breakdown table */}
            {monthlyTable.length > 0 && (
              <div style={S.card}>
                <div style={{ fontWeight: 700, fontSize: "15px", marginBottom: "16px" }}>
                  Monthly breakdown
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Month", "Sign-ups", "Subscriptions", "Dev signups", "Trials"].map((h) => (
                        <th key={h} style={{
                          textAlign: "left", fontSize: "11px", color: "#71717a",
                          fontWeight: 600, textTransform: "uppercase",
                          padding: "8px 10px", borderBottom: "1px solid #27272a",
                          letterSpacing: "0.05em",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyTable.map((row) => (
                      <tr key={row.month}>
                        <td style={{
                          padding: "10px", borderBottom: "1px solid #18181b",
                          fontSize: "13px", fontWeight: 600,
                        }}>
                          {fmtMonth(row.month)}
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #18181b", fontSize: "13px" }}>
                          <span style={{
                            color: "#38bdf8", fontWeight: row.signups > 0 ? 600 : 400,
                          }}>
                            {row.signups || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #18181b", fontSize: "13px" }}>
                          <span style={{
                            color: "#22c55e", fontWeight: row.subs > 0 ? 600 : 400,
                          }}>
                            {row.subs || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #18181b", fontSize: "13px" }}>
                          <span style={{
                            color: "#a78bfa", fontWeight: row.devs > 0 ? 600 : 400,
                          }}>
                            {row.devs || "—"}
                          </span>
                        </td>
                        <td style={{ padding: "10px", borderBottom: "1px solid #18181b", fontSize: "13px" }}>
                          <span style={{
                            color: "#fb923c", fontWeight: row.trials > 0 ? 600 : 400,
                          }}>
                            {row.trials || "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
