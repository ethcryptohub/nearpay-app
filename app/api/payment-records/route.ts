import { NextResponse } from "next/server";
import { JsonRpcProvider } from "near-api-js";
import type { SignedMessage } from "@near-wallet-selector/core";
import {
  isPaymentRecord,
  isReceiptItem,
  type PaymentRecord,
} from "../../../lib/payment-history";
import {
  consumeAndVerifyWalletChallenge,
  isReceiptDigest,
  isTransactionHash,
} from "../../../lib/server-wallet-auth";
import {
  getSupabaseAdmin,
  getSupabaseOperationError,
} from "../../../lib/supabase-admin";
import { isValidNearAccountId } from "../../../lib/merchant-settings";
import {
  validateCustomerProfile,
  type CustomerProfile,
} from "../../../lib/customer-profile";
import { createHash } from "node:crypto";
import { serializePaymentReceiptAuthorization } from "../../../lib/payment-receipt";

export const dynamic = "force-dynamic";

const testnetProvider = new JsonRpcProvider({
  url: "https://rpc.testnet.near.org",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCustomerDetails(value: unknown): CustomerProfile | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.email !== "string" ||
    typeof value.mobile !== "string"
  ) {
    return null;
  }
  const profile = {
    name: value.name.trim(),
    email: value.email.trim(),
    mobile: value.mobile.trim(),
  };
  return validateCustomerProfile(profile) ? null : profile;
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

export async function GET(request: Request) {
  try {
    const transactionHash = new URL(request.url).searchParams.get("txHash");
    if (!isTransactionHash(transactionHash)) {
      return NextResponse.json(
        { error: "A valid transaction hash is required." },
        { status: 400 },
      );
    }

    const { data, error } = await getSupabaseAdmin()
      .from("transactions")
      .select(
        "merchant_id, customer_address, amount, token_type, tx_hash, status, created_at, fiat_amount, fiat_currency, usdc_amount, items, store_name",
      )
      .eq("tx_hash", transactionHash)
      .maybeSingle();
    if (error) {
      throw getSupabaseOperationError("Unable to load payment receipt", error);
    }
    if (!data) {
      return NextResponse.json(
        { error: "This receipt was not found in Supabase." },
        { status: 404 },
      );
    }

    const record = {
      date: String(data.created_at),
      fiatAmount: String(data.fiat_amount),
      fiatCurrency: data.fiat_currency,
      usdcAmount: String(data.usdc_amount),
      token: data.token_type,
      tokenAmount: String(data.amount),
      items: data.items,
      storeName: String(data.store_name),
      merchantAccountId: String(data.merchant_id),
      senderAccountId: String(data.customer_address),
      transactionHash: String(data.tx_hash),
      status: data.status,
    };
    if (!isPaymentRecord(record)) {
      throw new Error("The stored receipt has invalid data.");
    }

    return NextResponse.json({ record });
  } catch (error) {
    console.error("Unable to load a payment receipt from Supabase.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load the payment receipt.",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Invalid payment record." }, { status: 400 });
    }

    const {
      challengeId,
      receiptDigest,
      accountId,
      signedMessage,
      transactionHash,
      merchantAccountId,
      amount,
      fiatAmount,
      fiatCurrency,
      usdcAmount,
      storeName,
      items,
    } = body;
    const customer = parseCustomerDetails(body.customer);
    const paymentAmount = typeof amount === "string" ? amount : "";
    const amountYocto = nearToYocto(paymentAmount);
    if (
      typeof challengeId !== "string" ||
      !isReceiptDigest(receiptDigest) ||
      typeof accountId !== "string" ||
      !isRecord(signedMessage) ||
      typeof signedMessage.accountId !== "string" ||
      typeof signedMessage.publicKey !== "string" ||
      typeof signedMessage.signature !== "string" ||
      !isTransactionHash(transactionHash) ||
      typeof merchantAccountId !== "string" ||
      !isValidNearAccountId(merchantAccountId) ||
      !amountYocto ||
      typeof fiatAmount !== "string" ||
      !Number.isFinite(Number(fiatAmount)) ||
      (fiatCurrency !== "INR" && fiatCurrency !== "USD") ||
      typeof usdcAmount !== "string" ||
      !Number.isFinite(Number(usdcAmount)) ||
      typeof storeName !== "string" ||
      storeName.length > 80 ||
      !Array.isArray(items) ||
      !items.every(isReceiptItem) ||
      !customer
    ) {
      return NextResponse.json(
        { error: "The payment record contains invalid or incomplete fields." },
        { status: 400 },
      );
    }

    const normalizedFiatCurrency = fiatCurrency === "USD" ? "USD" : "INR";
    const receiptSerialization = serializePaymentReceiptAuthorization({
      transactionHash,
      accountId,
      merchantAccountId,
      amount: paymentAmount,
      fiatAmount,
      fiatCurrency: normalizedFiatCurrency,
      usdcAmount,
      storeName,
      items,
      customer,
    });
    const calculatedReceiptDigest = createHash("sha256")
      .update(receiptSerialization)
      .digest("hex");
    if (calculatedReceiptDigest !== receiptDigest) {
      return NextResponse.json(
        { error: "The signed customer details do not match this payment record." },
        { status: 422 },
      );
    }

    const signedWalletMessage: SignedMessage = {
      accountId: signedMessage.accountId,
      publicKey: signedMessage.publicKey,
      signature: signedMessage.signature,
    };
    await consumeAndVerifyWalletChallenge({
      challengeId,
      accountId,
      purpose: "payment-record",
      transactionHash,
      receiptDigest,
      signedMessage: signedWalletMessage,
    });

    const outcome = await testnetProvider.viewTransactionStatus({
      txHash: transactionHash,
      accountId,
      waitUntil: "FINAL",
    });
    if (
      !isSuccessfulStatus(outcome.status) ||
      outcome.transaction.signer_id !== accountId ||
      outcome.transaction.receiver_id !== merchantAccountId
    ) {
      return NextResponse.json(
        { error: "The transaction is not a successful payment to this merchant." },
        { status: 422 },
      );
    }

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
      outcome.transaction.actions.length !== 1 ||
      transferAmount !== amountYocto
    ) {
      return NextResponse.json(
        { error: "The verified transaction amount does not match this invoice." },
        { status: 422 },
      );
    }

    const record = {
      tx_hash: transactionHash,
      created_at: new Date().toISOString(),
      fiat_amount: fiatAmount,
      fiat_currency: normalizedFiatCurrency,
      usdc_amount: usdcAmount,
      token_type: "NEAR",
      amount: paymentAmount,
      items,
      store_name: storeName,
      merchant_id: merchantAccountId,
      customer_address: accountId,
      customer_name: customer.name,
      customer_email: customer.email,
      customer_mobile: customer.mobile,
      status: "Success",
    };

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("transactions")
      .upsert(record, { onConflict: "tx_hash" });
    if (error) {
      throw getSupabaseOperationError(
        "Unable to save verified payment",
        error,
      );
    }

    const responseRecord: PaymentRecord = {
      date: record.created_at,
      fiatAmount: record.fiat_amount,
      fiatCurrency: normalizedFiatCurrency,
      usdcAmount: record.usdc_amount,
      token: "NEAR",
      tokenAmount: paymentAmount,
      items: record.items,
      storeName: record.store_name,
      merchantAccountId: record.merchant_id,
      senderAccountId: record.customer_address,
      customerName: record.customer_name,
      customerEmail: record.customer_email,
      customerMobile: record.customer_mobile,
      transactionHash: record.tx_hash,
      status: "Success",
    };
    return NextResponse.json({ record: responseRecord });
  } catch (error) {
    console.error("Unable to persist the verified customer payment.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save the verified payment.",
      },
      { status: 500 },
    );
  }
}
