import { NextResponse }       from "next/server";
import { cookies }            from "next/headers";
import { Connection, PublicKey } from "@solana/web3.js";
import { supabaseAdmin }      from "@/lib/supabaseAdmin";
import { verifySessionValue } from "@/lib/auth";

export const dynamic = "force-dynamic";

// ─── POST /api/batches/[batchId]/payouts ──────────────────────────────────────
// Called after you confirm a payout transaction in your wallet.
// Body: { payoutId: string, txSignature: string }
//
// What it does:
// 1. Verifies the batch exists and is in 'closed' status
// 2. Verifies the payout row exists, belongs to this batch, and is unpaid
// 3. Verifies the tx on-chain — confirms the right amount went to the right wallet
// 4. Marks the payout row as paid with the tx signature
// 5. If all payouts for this batch are now paid, advances status to 'affiliates_paid'

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
    const payoutId    = (body?.payoutId    ?? "").trim();
    const txSignature = (body?.txSignature ?? "").trim();

    if (!payoutId || !txSignature) {
      return NextResponse.json(
        { error: "Missing payoutId or txSignature" },
        { status: 400 }
      );
    }

    const sb = supabaseAdmin();

    // ── 1. Load the batch ────────────────────────────────────────────────────
    const { data: batch, error: batchErr } = await sb
      .from("batches")
      .select("id, status, period_start, period_end")
      .eq("id", batchId)
      .maybeSingle();

    if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });
    if (!batch)   return NextResponse.json({ error: "Batch not found" },  { status: 404 });

    if (batch.status !== "closed" && batch.status !== "affiliates_paid") {
      return NextResponse.json(
        { error: `Batch status is '${batch.status}' — must be 'closed' to record payouts` },
        { status: 400 }
      );
    }

    // ── 2. Load the payout row ───────────────────────────────────────────────
    const { data: payout, error: payoutErr } = await sb
      .from("batch_affiliate_payouts")
      .select("*")
      .eq("id", payoutId)
      .eq("batch_id", batchId)
      .maybeSingle();

    if (payoutErr) return NextResponse.json({ error: payoutErr.message }, { status: 500 });
    if (!payout)   return NextResponse.json({ error: "Payout row not found" }, { status: 404 });

    if (payout.paid) {
      return NextResponse.json(
        { error: "This affiliate has already been paid for this batch" },
        { status: 409 }
      );
    }

    // ── 3. Verify the transaction on-chain ───────────────────────────────────
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) return NextResponse.json({ error: "Missing SOLANA_RPC_URL" }, { status: 500 });

    const connection = new Connection(rpcUrl, "confirmed");
    const tx = await connection.getTransaction(txSignature, {
      commitment:                  "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx || !tx.meta) {
      return NextResponse.json(
        { error: "Transaction not found or not confirmed yet. Try again." },
        { status: 400 }
      );
    }

    // Verify the recipient wallet received the right amount
    const staticKeys     = tx.transaction.message.getAccountKeys().staticAccountKeys;
    const recipientKey   = new PublicKey(payout.referrer_wallet);
    const recipientIndex = staticKeys.findIndex((k) => k.equals(recipientKey));

    if (recipientIndex === -1) {
      return NextResponse.json(
        { error: "Recipient wallet not found in transaction" },
        { status: 400 }
      );
    }

    const preLamports   = tx.meta.preBalances[recipientIndex]  ?? 0;
    const postLamports  = tx.meta.postBalances[recipientIndex] ?? 0;
    const receivedSol   = (postLamports - preLamports) / 1_000_000_000;
    const expectedSol   = Number(payout.amount_sol);

    // Allow 0.001 SOL tolerance for tx fees
    if (receivedSol + 0.001 < expectedSol) {
      return NextResponse.json(
        {
          error: `Payment amount mismatch. Expected ~${expectedSol} SOL, recipient received ~${receivedSol.toFixed(4)} SOL`,
        },
        { status: 400 }
      );
    }

    // ── 4. Check this tx hasn't already been used ────────────────────────────
    const { data: existingPayout } = await sb
      .from("batch_affiliate_payouts")
      .select("id")
      .eq("tx_signature", txSignature)
      .maybeSingle();

    if (existingPayout) {
      return NextResponse.json(
        { error: "This transaction signature has already been used" },
        { status: 409 }
      );
    }

    // ── 5. Mark payout as paid ───────────────────────────────────────────────
    const { error: updateErr } = await sb
      .from("batch_affiliate_payouts")
      .update({
        paid:         true,
        tx_signature: txSignature,
        paid_at:      new Date().toISOString(),
      })
      .eq("id", payoutId);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // Also mark the matching affiliate_earnings rows as paid_out
    await Promise.resolve(
      sb
        .from("affiliate_earnings")
        .update({ paid_out: true })
        .eq("referrer_wallet", payout.referrer_wallet)
        .gte("created_at", batch.period_start)
        .lt("created_at",  batch.period_end)
    ).catch(() => null);

    // ── 6. Check if all payouts for this batch are now paid ──────────────────
    const { data: remainingUnpaid } = await sb
      .from("batch_affiliate_payouts")
      .select("id")
      .eq("batch_id", batchId)
      .eq("paid", false);

    const allPaid = (remainingUnpaid ?? []).length === 0;

    if (allPaid) {
      await sb
        .from("batches")
        .update({ status: "affiliates_paid" })
        .eq("id", batchId);
    }

    return NextResponse.json({
      ok:      true,
      allPaid,
      payoutId,
      txSignature,
      receivedSol: Math.round(receivedSol * 1e9) / 1e9,
    });

  } catch (e: any) {
    console.error("payout error:", e);
    return NextResponse.json(
      { error: "Payout failed", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
