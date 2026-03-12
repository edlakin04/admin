// ─── SOL Price Helper ─────────────────────────────────────────────────────────
// Fetches live SOL/GBP price from Binance public API.
// Falls back to Kraken if Binance fails.
// No API key needed for either.

const BINANCE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=SOLGBP";
const KRAKEN_URL  = "https://api.kraken.com/0/public/Ticker?pair=SOLGBP";

// Simple in-memory cache — price is good for 60 seconds
// Prevents hammering the exchange API on every page load
let cachedPrice: number | null = null;
let cacheExpiresAt = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

export async function getSolGbpPrice(): Promise<number | null> {
  // Return cached value if still fresh
  if (cachedPrice !== null && Date.now() < cacheExpiresAt) {
    return cachedPrice;
  }

  // ── Try Binance first ────────────────────────────────────────────────────
  try {
    const res = await fetch(BINANCE_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });

    if (res.ok) {
      const json = await res.json();
      // Binance returns: { symbol: "SOLGBP", price: "123.45000000" }
      const price = parseFloat(json?.price ?? "0");
      if (price > 0) {
        cachedPrice    = price;
        cacheExpiresAt = Date.now() + CACHE_TTL_MS;
        return price;
      }
    }
  } catch {
    // Binance failed — try Kraken
  }

  // ── Fallback: Kraken ─────────────────────────────────────────────────────
  try {
    const res = await fetch(KRAKEN_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });

    if (res.ok) {
      const json = await res.json();
      // Kraken returns: { result: { SOLGBP: { c: ["123.45", "1"] } } }
      const pair  = json?.result?.SOLGBP ?? json?.result?.XSOLGBP ?? null;
      const price = parseFloat(pair?.c?.[0] ?? "0");
      if (price > 0) {
        cachedPrice    = price;
        cacheExpiresAt = Date.now() + CACHE_TTL_MS;
        return price;
      }
    }
  } catch {
    // Both failed
  }

  // Return stale cache rather than null if we have one
  if (cachedPrice !== null) return cachedPrice;

  return null;
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

export function fmtGbp(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", {
    style:                 "currency",
    currency:              "GBP",
    maximumFractionDigits: 2,
  });
}

export function fmtSol(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const formatted = Number.isInteger(n)
    ? n.toString()
    : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  return `${formatted} SOL`;
}

export function solToGbp(sol: number, price: number | null): number | null {
  if (!price || !Number.isFinite(price) || !Number.isFinite(sol)) return null;
  return Math.round(sol * price * 100) / 100;
}
