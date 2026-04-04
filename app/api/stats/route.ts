import { NextResponse }     from "next/server";
import { cookies }           from "next/headers";
import { supabaseAdmin }     from "@/lib/supabaseAdmin";
import { verifySessionValue } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── GET /api/stats ────────────────────────────────────────────────────────────
// Returns platform-wide user, subscription, trial, and dev stats for the admin.

export async function GET() {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const cookieStore   = await cookies();
    const sessionValue  = cookieStore.get("admin_session")?.value ?? "";
    const adminPassword = process.env.ADMIN_PASSWORD ?? "";

    if (!verifySessionValue(sessionValue, adminPassword)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sb  = supabaseAdmin();
    const now = new Date();

    // ── Users ─────────────────────────────────────────────────────────────────
    const { data: users } = await sb
      .from("users")
      .select("wallet, role, trial_started_at, created_at")
      .order("created_at", { ascending: true });

    const userList = users ?? [];

    // ── Subscriptions ─────────────────────────────────────────────────────────
    const { data: subs } = await sb
      .from("subscriptions")
      .select("wallet, paid_until, updated_at")
      .order("updated_at", { ascending: true });

    const subList = subs ?? [];

    // ── Dev profiles ──────────────────────────────────────────────────────────
    const { data: devs } = await sb
      .from("dev_profiles")
      .select("wallet, created_at")
      .order("created_at", { ascending: true });

    const devList = devs ?? [];

    // ── Payments (for timeline) ───────────────────────────────────────────────
    const { data: payments } = await sb
      .from("payments")
      .select("kind, created_at")
      .order("created_at", { ascending: true });

    const paymentList = payments ?? [];

    // ── Compute headline stats ────────────────────────────────────────────────
    const nowMs = now.getTime();

    const activeUsers = subList.filter((s) => {
      const paidUntilMs = s.paid_until ? new Date(s.paid_until).getTime() : 0;
      return paidUntilMs > nowMs;
    }).length;

    const activeDevs = devList.length;

    const totalUsers = userList.length;

    const trialUsers = userList.filter((u) => u.trial_started_at !== null).length;

    const activeTrials = userList.filter((u) => {
      if (!u.trial_started_at) return false;
      const TRIAL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
      return new Date(u.trial_started_at).getTime() + TRIAL_MS > nowMs;
    }).length;

    const expiredTrials     = trialUsers - activeTrials;
    const totalSubPayments  = paymentList.filter((p) => p.kind === "subscription").length;
    const totalDevSignups   = paymentList.filter((p) => p.kind === "dev_fee").length;

    // ── Build daily timeline (last 90 days) ───────────────────────────────────
    function dayKey(iso: string) {
      return iso.slice(0, 10); // "YYYY-MM-DD"
    }

    const ninetyDaysAgo = new Date(nowMs - 90 * 24 * 60 * 60 * 1000);

    // Sign-ups by day (users created_at)
    const signupsByDay: Record<string, number> = {};
    for (const u of userList) {
      if (!u.created_at) continue;
      if (new Date(u.created_at) < ninetyDaysAgo) continue;
      const k = dayKey(u.created_at);
      signupsByDay[k] = (signupsByDay[k] ?? 0) + 1;
    }

    // Subscription payments by day
    const subPaysByDay: Record<string, number> = {};
    for (const p of paymentList) {
      if (p.kind !== "subscription") continue;
      if (new Date(p.created_at) < ninetyDaysAgo) continue;
      const k = dayKey(p.created_at);
      subPaysByDay[k] = (subPaysByDay[k] ?? 0) + 1;
    }

    // Dev signups by day
    const devSignupsByDay: Record<string, number> = {};
    for (const p of paymentList) {
      if (p.kind !== "dev_fee") continue;
      if (new Date(p.created_at) < ninetyDaysAgo) continue;
      const k = dayKey(p.created_at);
      devSignupsByDay[k] = (devSignupsByDay[k] ?? 0) + 1;
    }

    // Trial activations by day
    const trialsByDay: Record<string, number> = {};
    for (const u of userList) {
      if (!u.trial_started_at) continue;
      if (new Date(u.trial_started_at) < ninetyDaysAgo) continue;
      const k = dayKey(u.trial_started_at);
      trialsByDay[k] = (trialsByDay[k] ?? 0) + 1;
    }

    // ── Build monthly breakdown (all time) ────────────────────────────────────
    function monthKey(iso: string) {
      return iso.slice(0, 7); // "YYYY-MM"
    }

    const signupsByMonth: Record<string, number>    = {};
    const subPaysByMonth: Record<string, number>    = {};
    const devSignupsByMonth: Record<string, number> = {};
    const trialsByMonth: Record<string, number>     = {};

    for (const u of userList) {
      if (!u.created_at) continue;
      const k = monthKey(u.created_at);
      signupsByMonth[k] = (signupsByMonth[k] ?? 0) + 1;
    }

    for (const p of paymentList) {
      if (p.kind === "subscription") {
        const k = monthKey(p.created_at);
        subPaysByMonth[k] = (subPaysByMonth[k] ?? 0) + 1;
      }
      if (p.kind === "dev_fee") {
        const k = monthKey(p.created_at);
        devSignupsByMonth[k] = (devSignupsByMonth[k] ?? 0) + 1;
      }
    }

    for (const u of userList) {
      if (!u.trial_started_at) continue;
      const k = monthKey(u.trial_started_at);
      trialsByMonth[k] = (trialsByMonth[k] ?? 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      headline: {
        totalUsers,
        activeUsers,
        activeDevs,
        trialUsers,
        activeTrials,
        expiredTrials,
        totalSubPayments,
        totalDevSignups,
      },
      daily: {
        signups:    signupsByDay,
        subPayments: subPaysByDay,
        devSignups:  devSignupsByDay,
        trials:      trialsByDay,
      },
      monthly: {
        signups:    signupsByMonth,
        subPayments: subPaysByMonth,
        devSignups:  devSignupsByMonth,
        trials:      trialsByMonth,
      },
    });

  } catch (e: any) {
    console.error("stats error:", e);
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 });
  }
}
