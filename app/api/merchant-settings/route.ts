import { NextResponse } from "next/server";
import type { SignedMessage } from "@near-wallet-selector/core";
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
      typeof body.signedMessage.signature !== "string" ||
      !isRecord(body.settings)
    ) {
      return NextResponse.json(
        { error: "Invalid merchant settings authorization." },
        { status: 400 },
      );
    }

    const settings = body.settings;
    const acceptedTokens = settings.acceptedTokens;
    if (
      typeof settings.storeName !== "string" ||
      settings.storeName.trim().length === 0 ||
      settings.storeName.trim().length > 80 ||
      (settings.preferredToken !== "NEAR" &&
        settings.preferredToken !== "USDC") ||
      (settings.fiatCurrency !== "INR" &&
        settings.fiatCurrency !== "USD") ||
      !Array.isArray(acceptedTokens) ||
      acceptedTokens.length === 0 ||
      acceptedTokens.some((token) => token !== "NEAR" && token !== "USDC") ||
      new Set(acceptedTokens).size !== acceptedTokens.length ||
      !acceptedTokens.includes("NEAR") ||
      !acceptedTokens.includes(settings.preferredToken)
    ) {
      return NextResponse.json(
        { error: "The merchant settings contain invalid values." },
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

    const { data, error } = await getSupabaseAdmin()
      .from("settings")
      .upsert(
        {
          merchant_id: body.accountId,
          store_name: settings.storeName.trim(),
          preferred_token: settings.preferredToken,
          fiat_currency: settings.fiatCurrency,
          accepted_tokens: acceptedTokens,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "merchant_id" },
      )
      .select(
        "merchant_id, store_name, preferred_token, fiat_currency, accepted_tokens",
      )
      .single();

    if (error) {
      throw getSupabaseOperationError(
        "Unable to save merchant settings",
        error,
      );
    }

    return NextResponse.json({ settings: data });
  } catch (error) {
    console.error("Unable to update secured merchant settings.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save merchant settings.",
      },
      { status: 500 },
    );
  }
}
