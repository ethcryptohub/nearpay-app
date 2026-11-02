import { NextResponse } from "next/server";
import type { SignedMessage } from "@near-wallet-selector/core";
import {
  formatInvoiceNumber,
  isPaymentRecord,
  type PaymentRecord,
} from "../../../lib/payment-history";
import { isValidNearAccountId } from "../../../lib/merchant-settings";
import { consumeAndVerifyWalletChallenge } from "../../../lib/server-wallet-auth";
import {
  getSupabaseAdmin,
  getSupabaseOperationError,
} from "../../../lib/supabase-admin";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (
      !isRecord(body) ||
      typeof body.accountId !== "string" ||
      !isValidNearAccountId(body.accountId) ||
      typeof body.challengeId !== "string" ||
      !isRecord(body.signedMessage) ||
      typeof body.signedMessage.accountId !== "string" ||
      typeof body.signedMessage.publicKey !== "string" ||
      typeof body.signedMessage.signature !== "string"
    ) {
      return NextResponse.json(
        { error: "A valid customer wallet authorization is required." },
        { status: 400 },
      );
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

    const { data, error } = await getSupabaseAdmin()
      .from("transactions")
      .select(
        "id, created_at, fiat_amount, fiat_currency, usdc_amount, token_type, amount, items, store_name, merchant_id, tx_hash, status",
      )
      .eq("customer_address", body.accountId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      throw getSupabaseOperationError(
        "Unable to load customer transaction history",
        error,
      );
    }

    const records = (data ?? []).flatMap((row): PaymentRecord[] => {
      const record: unknown = {
        invoiceNumber: formatInvoiceNumber(row.id),
        date: String(row.created_at),
        fiatAmount: String(row.fiat_amount),
        fiatCurrency: row.fiat_currency,
        usdcAmount: String(row.usdc_amount),
        token: row.token_type,
        tokenAmount: String(row.amount),
        items: row.items,
        storeName: String(row.store_name ?? ""),
        merchantAccountId: String(row.merchant_id ?? ""),
        transactionHash: String(row.tx_hash ?? ""),
        status: row.status,
      };
      return isPaymentRecord(record) ? [record] : [];
    });

    return NextResponse.json(
      { records },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to load secured customer transaction history.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load customer transaction history.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
