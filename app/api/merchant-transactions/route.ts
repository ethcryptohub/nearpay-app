import { NextResponse } from "next/server";
import { JsonRpcProvider } from "near-api-js";
import {
  formatInvoiceNumber,
  isReceiptItem,
  type PaymentRecord,
} from "../../../lib/payment-history";
import { isValidNearAccountId } from "../../../lib/merchant-settings";
import {
  isTransactionHash,
} from "../../../lib/server-wallet-auth";
import { getMerchantSessionAccountId } from "../../../lib/server-merchant-session";
import {
  getSupabaseAdmin,
  getSupabaseOperationError,
} from "../../../lib/supabase-admin";

export const dynamic = "force-dynamic";

const testnetProvider = new JsonRpcProvider({
  url: "https://rpc.testnet.near.org",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSuccessfulStatus(status: unknown): boolean {
  return (
    isRecord(status) &&
    "SuccessValue" in status &&
    typeof status.SuccessValue === "string"
  );
}

function nearToYocto(amount: string): string | null {
  if (!/^\d+(?:\.\d{1,24})?$/.test(amount)) {
    return null;
  }
  const [whole, fraction = ""] = amount.split(".");
  return (
    BigInt(whole) * BigInt(10) ** BigInt(24) +
    BigInt(fraction.padEnd(24, "0"))
  ).toString();
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (
      !isRecord(body) ||
      typeof body.accountId !== "string" ||
      !isValidNearAccountId(body.accountId) ||
      !isTransactionHash(body.transactionHash) ||
      typeof body.customerAddress !== "string" ||
      !isValidNearAccountId(body.customerAddress) ||
      typeof body.amount !== "string" ||
      !nearToYocto(body.amount) ||
      typeof body.fiatAmount !== "string" ||
      !Number.isFinite(Number(body.fiatAmount)) ||
      Number(body.fiatAmount) <= 0 ||
      (body.fiatCurrency !== "INR" && body.fiatCurrency !== "USD") ||
      typeof body.usdcAmount !== "string" ||
      !Number.isFinite(Number(body.usdcAmount)) ||
      Number(body.usdcAmount) <= 0 ||
      typeof body.storeName !== "string" ||
      body.storeName.trim().length > 80 ||
      !Array.isArray(body.items) ||
      !body.items.every(isReceiptItem)
    ) {
      return NextResponse.json(
        { error: "The verified transaction details are invalid." },
        { status: 400 },
      );
    }

    if (getMerchantSessionAccountId(request) !== body.accountId) {
      return NextResponse.json(
        { error: "Authorize this merchant wallet to save verified transactions." },
        { status: 401 },
      );
    }

    const outcome = await testnetProvider.viewTransactionStatus({
      txHash: body.transactionHash,
      accountId: body.customerAddress,
      waitUntil: "FINAL",
    });
    const transfer = outcome.transaction.actions.find(
      (action) =>
        typeof action === "object" &&
        action !== null &&
        "Transfer" in action,
    );
    const transferAmount =
      transfer && typeof transfer === "object" && "Transfer" in transfer
        ? String(transfer.Transfer.deposit)
        : null;
    if (
      !isSuccessfulStatus(outcome.status) ||
      outcome.transaction.signer_id !== body.customerAddress ||
      outcome.transaction.receiver_id !== body.accountId ||
      outcome.transaction.actions.length !== 1 ||
      transferAmount !== nearToYocto(body.amount)
    ) {
      return NextResponse.json(
        { error: "The transaction is not a successful payment matching this invoice." },
        { status: 422 },
      );
    }

    const record = {
      merchant_id: body.accountId,
      customer_address: body.customerAddress,
      amount: body.amount,
      token_type: "NEAR",
      tx_hash: body.transactionHash,
      status: "Success",
      fiat_amount: body.fiatAmount,
      fiat_currency: body.fiatCurrency,
      usdc_amount: body.usdcAmount,
      items: body.items,
      store_name: body.storeName.trim(),
    };
    const { data: savedTransaction, error } = await getSupabaseAdmin()
      .from("transactions")
      .upsert(record, {
        onConflict: "tx_hash",
        ignoreDuplicates: true,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      throw getSupabaseOperationError(
        "Unable to save verified payment",
        error,
      );
    }

    let transactionId = savedTransaction?.id;
    if (!transactionId) {
      const { data: existingTransaction, error: existingTransactionError } =
        await getSupabaseAdmin()
          .from("transactions")
          .select("id")
          .eq("tx_hash", body.transactionHash)
          .single();
      if (existingTransactionError) {
        throw getSupabaseOperationError(
          "Unable to load the saved invoice number",
          existingTransactionError,
        );
      }
      transactionId = existingTransaction.id;
    }

    const payment: PaymentRecord = {
      invoiceNumber: formatInvoiceNumber(transactionId),
      date: new Date().toISOString(),
      fiatAmount: body.fiatAmount,
      fiatCurrency: body.fiatCurrency,
      usdcAmount: body.usdcAmount,
      token: "NEAR",
      tokenAmount: body.amount,
      items: body.items,
      storeName: body.storeName.trim(),
      merchantAccountId: body.accountId,
      senderAccountId: body.customerAddress,
      transactionHash: body.transactionHash,
      status: "Success",
    };
    return NextResponse.json({ record: payment });
  } catch (error) {
    console.error("Unable to persist the merchant-verified payment.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save the verified transaction.",
      },
      { status: 500 },
    );
  }
}
