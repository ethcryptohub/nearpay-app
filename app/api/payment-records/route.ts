import { NextResponse } from "next/server";
import { JsonRpcProvider } from "near-api-js";
import type { SignedMessage } from "@near-wallet-selector/core";
import { isReceiptItem, type PaymentRecord } from "../../../lib/payment-history";
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
      transaction_hash: transactionHash,
      date: new Date().toISOString(),
      fiat_amount: fiatAmount,
      fiat_currency: normalizedFiatCurrency,
      usdc_amount: usdcAmount,
      token: "NEAR",
      token_amount: paymentAmount,
      items,
      store_name: storeName,
      merchant_account_id: merchantAccountId,
      sender_account_id: accountId,
      customer_name: customer.name,
      customer_email: customer.email,
      customer_mobile: customer.mobile,
      status: "Success",
    };

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from("payment_records")
      .upsert(record, { onConflict: "transaction_hash" });
    if (error) {
      throw getSupabaseOperationError(
        "Unable to save verified payment",
        error,
      );
    }

    const responseRecord: PaymentRecord = {
      date: record.date,
      fiatAmount: record.fiat_amount,
      fiatCurrency: normalizedFiatCurrency,
      usdcAmount: record.usdc_amount,
      token: "NEAR",
      tokenAmount: paymentAmount,
      items: record.items,
      storeName: record.store_name,
      merchantAccountId: record.merchant_account_id,
      senderAccountId: record.sender_account_id,
      customerName: record.customer_name,
      customerEmail: record.customer_email,
      customerMobile: record.customer_mobile,
      transactionHash: record.transaction_hash,
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
