import { NextResponse }          from "next/server";
import { cookies }               from "next/headers";
import { Connection, PublicKey } from "@solana/web3.js";
import { supabaseAdmin }         from "@/lib/supabaseAdmin";
import { verifySessionValue }    from "@/app/api/auth/login/route";

export const dynamic = "force-dynamic";

// ─── POST /api/batches/[batchId]/cashout ──────────────────────────────────────
// Called after you confirm the cashout transaction in your wallet.
// Body: { txSignature: string }
//
// What it does:
// 1. Verifies batch exists and is in 'affiliates_paid' status
//    (all affiliates must be paid before you can cash out)
// 2. Verifies the tx on-chain — confirms the right amount went to CASHOUT_WALLET
// 3. Records the cashout on the batch
// 4. Advances batch status to 'complete'

export async function POST(
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
    const body        = await req.json().catch(() => null);
    const txSignature = (body?.txSignature ?? "").trim();

    if (!txSignature) {
      return NextResponse.json({ error: "Missing txSignature" }, { status: 400 });
    }

    const sb = supabaseAdmin();

    // ── 1. Load the batch ────────────────────────────────────────────────────
    const { data: batch, error: batchErr } = await sb
      .from("batches")
      .select("*")
      .eq("id", batchId)
      .maybeSingle();

    if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });
    if (!batch)   return NextResponse.json({ error: "Batch not found" },  { status: 404 });

    // Must be affiliates_paid — all affiliates must be done first
    if (batch.status !== "affiliates_paid") {
      return NextResponse.json(
        {
          error: batch.status === "closed"
            ? "All affiliate payouts must be completed before you can cash out"
            : batch.status === "complete"
            ? "This batch has already been cashed out"
            : `Batch status is '${batch.status}' — cannot cashout`,
        },
        { status: 400 }
      );
    }

    // Can't cashout twice
    if (batch.cashout_tx_signature) {
      return NextResponse.json(
        { error: "Cashout already recorded for this batch" },
        { status: 409 }
      );
    }

    // ── 2. Compute expected cashout amount ───────────────────────────────────
    const totalRevenueSol   = Number(batch.total_revenue_sol   ?? 0);
    const totalAffiliateSol = Number(batch.total_affiliate_sol ?? 0);
    const expectedCashoutSol = Math.max(
      0,
      Math.round((totalRevenueSol - totalAffiliateSol) * 1e9) / 1e9
    );

    if (expectedCashoutSol <= 0) {
      return NextResponse.json(
        { error: "No cashout amount available for this batch" },
        { status: 400 }
      );
    }

    // ── 3. Verify the transaction on-chain ───────────────────────────────────
    const rpcUrl       = process.env.SOLANA_RPC_URL;
    const cashoutWallet = process.env.CASHOUT_WALLET;

    if (!rpcUrl)        return NextResponse.json({ error: "Missing SOLANA_RPC_URL" },  { status: 500 });
    if (!cashoutWallet) return NextResponse.json({ error: "Missing CASHOUT_WALLET" }, { status: 500 });

    const connection = new Connection(rpcUrl, "confirmed");
    const tx = await connection.getTransaction(txSignature, {
      commitment:                     "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx || !tx.meta) {
      return NextResponse.json(
        { error: "Transaction not found or not confirmed yet. Try again." },
        { status: 400 }
      );
    }

    // Verify the cashout wallet received the right amount
    const staticKeys      = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const cashoutKey      = new PublicKey(cashoutWallet);
    const cashoutIndex    = staticKeys.findIndex((k) => k.equals(cashoutKey));

    if (cashoutIndex === -1) {
      return NextResponse.json(
        { error: "Cashout wallet not found in transaction" },
        { status: 400 }
      );
    }

    const preLamports  = tx.meta.preBalances[cashoutIndex]  ?? 0;
    const postLamports = tx.meta.postBalances[cashoutIndex] ?? 0;
    const receivedSol  = (postLamports - preLamports) / 1_000_000_000;

    // Allow 0.001 SOL tolerance for tx fees
    if (receivedSol + 0.001 < expectedCashoutSol) {
      return NextResponse.json(
        {
          error: `Cashout amount mismatch. Expected ~${expectedCashoutSol} SOL, wallet received ~${receivedSol.toFixed(4)} SOL`,
        },
        { status: 400 }
      );
    }

    // ── 4. Check tx signature not already used ───────────────────────────────
    const { data: existingBatch } = await sb
      .from("batches")
      .select("id")
      .eq("cashout_tx_signature", txSignature)
      .maybeSingle();

    if (existingBatch) {
      return NextResponse.json(
        { error: "This transaction signature has already been recorded" },
        { status: 409 }
      );
    }

    // ── 5. Record cashout and mark batch complete ────────────────────────────
    const now = new Date().toISOString();

    const { error: updateErr } = await sb
      .from("batches")
      .update({
        status:               "complete",
        cashout_sol:          Math.round(receivedSol * 1e9) / 1e9,
        cashout_tx_signature: txSignature,
        cashout_wallet:       cashoutWallet,
        cashout_at:           now,
        completed_at:         now,
      })
      .eq("id", batchId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok:           true,
      batchId,
      txSignature,
      cashoutSol:   Math.round(receivedSol * 1e9) / 1e9,
      cashoutWallet,
      completedAt:  now,
    });

  } catch (e: any) {
    console.error("cashout error:", e);
    return NextResponse.json(
      { error: "Cashout failed", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
