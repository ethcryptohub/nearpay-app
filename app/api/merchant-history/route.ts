import { NextResponse } from "next/server";
import type { SignedMessage } from "@near-wallet-selector/core";
import { isPaymentRecord, type PaymentRecord } from "../../../lib/payment-history";
import {
  consumeAndVerifyWalletChallenge,
} from "../../../lib/server-wallet-auth";
import {
  getSupabaseAdmin,
  getSupabaseOperationError,
} from "../../../lib/supabase-admin";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toPaymentRecord(row: Record<string, unknown>): PaymentRecord | null {
  const record: unknown = {
    date: String(row.created_at),
    fiatAmount: String(row.fiat_amount),
    fiatCurrency: row.fiat_currency,
    usdcAmount: String(row.usdc_amount),
    token: row.token_type,
    tokenAmount: String(row.amount),
    items: row.items,
    storeName: String(row.store_name ?? ""),
    merchantAccountId: String(row.merchant_id ?? ""),
    senderAccountId: String(row.customer_address ?? ""),
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerMobile: row.customer_mobile,
    transactionHash: String(row.tx_hash ?? ""),
    status: row.status,
  };
  return isPaymentRecord(record) ? record : null;
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (
      !isRecord(body) ||
      typeof body.challengeId !== "string" ||
      typeof body.accountId !== "string" ||
      !isRecord(body.signedMessage) ||
      typeof body.signedMessage.accountId !== "string" ||
      typeof body.signedMessage.publicKey !== "string" ||
      typeof body.signedMessage.signature !== "string"
    ) {
      return NextResponse.json({ error: "Invalid merchant authorization." }, { status: 400 });
    }

    const signedMessage: SignedMessage = {
      accountId: body.signedMessage.accountId,
      publicKey: body.signedMessage.publicKey,
      signature: body.signedMessage.signature,
    };
    await consumeAndVerifyWalletChallenge({
      challengeId: body.challengeId,
      accountId: body.accountId,
      purpose: "merchant-history",
      transactionHash: null,
      receiptDigest: null,
      signedMessage,
    });

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("merchant_id", body.accountId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      throw getSupabaseOperationError(
        "Unable to load merchant history",
        error,
      );
    }

    const records = (data ?? [])
      .map((row) => toPaymentRecord(row as Record<string, unknown>))
      .filter((record): record is PaymentRecord => record !== null);
    return NextResponse.json({ records });
  } catch (error) {
    console.error("Unable to load secured merchant history.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load shared merchant history.",
      },
      { status: 500 },
    );
  }
}
