import { NextResponse } from "next/server";
import {
  createWalletChallenge,
  isReceiptDigest,
  isTransactionHash,
  type WalletChallengePurpose,
} from "../../../lib/server-wallet-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("accountId" in body)) {
      return NextResponse.json({ error: "Wallet account is required." }, { status: 400 });
    }

    const payload = body as Record<string, unknown>;
    const accountId = payload.accountId;
    const purpose = payload.purpose;
    const transactionHash = payload.transactionHash;
    const receiptDigest = payload.receiptDigest;
    if (
      typeof accountId !== "string" ||
      (purpose !== "merchant-history" && purpose !== "payment-record") ||
      (purpose === "payment-record" && !isTransactionHash(transactionHash)) ||
      (purpose === "payment-record" && !isReceiptDigest(receiptDigest)) ||
      (purpose === "merchant-history" &&
        (transactionHash !== undefined || receiptDigest !== undefined))
    ) {
      return NextResponse.json({ error: "Invalid wallet challenge request." }, { status: 400 });
    }

    const challenge = await createWalletChallenge(
      request,
      accountId,
      purpose as WalletChallengePurpose,
      typeof transactionHash === "string" ? transactionHash : null,
      typeof receiptDigest === "string" ? receiptDigest : null,
    );
    return NextResponse.json({
      challengeId: challenge.id,
      accountId: challenge.account_id,
      purpose: challenge.purpose,
      message: challenge.message,
      nonce: challenge.nonce,
      recipient: challenge.recipient,
      transactionHash: challenge.transaction_hash,
      expiresAt: challenge.expires_at,
    });
  } catch (error) {
    console.error("Unable to issue a NEAR wallet challenge.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to prepare wallet authorization.",
      },
      { status: 500 },
    );
  }
}
