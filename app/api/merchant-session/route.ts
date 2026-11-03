import { NextResponse } from "next/server";
import type { SignedMessage } from "@near-wallet-selector/core";
import { isValidNearAccountId } from "../../../lib/merchant-settings";
import { consumeAndVerifyWalletChallenge } from "../../../lib/server-wallet-auth";
import {
  clearMerchantSessionCookie,
  getMerchantSessionAccountId,
  setMerchantSessionCookie,
} from "../../../lib/server-merchant-session";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function GET(request: Request) {
  try {
    const accountId = new URL(request.url).searchParams.get("accountId");
    if (!accountId || !isValidNearAccountId(accountId)) {
      return NextResponse.json(
        { error: "A valid merchant account is required." },
        { status: 400 },
      );
    }

    return NextResponse.json({
      authenticated: getMerchantSessionAccountId(request) === accountId,
    });
  } catch (error) {
    console.error("Unable to check the merchant session.", error);
    return NextResponse.json(
      { error: "Unable to check the merchant session." },
      { status: 500 },
    );
  }
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
        { error: "Invalid merchant session authorization." },
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
      purpose: "merchant-settings",
      transactionHash: null,
      receiptDigest: null,
      signedMessage,
    });

    const response = NextResponse.json({ authenticated: true });
    setMerchantSessionCookie(response, body.accountId);
    return response;
  } catch (error) {
    console.error("Unable to authorize the merchant session.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to authorize the merchant session.",
      },
      { status: 401 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  clearMerchantSessionCookie(response);
  return response;
}
