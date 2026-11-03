import { NextResponse } from "next/server";
import { isValidNearAccountId } from "../../../lib/merchant-settings";
import { getMerchantSessionAccountId } from "../../../lib/server-merchant-session";
import {
  getSupabaseAdmin,
  getSupabaseOperationError,
} from "../../../lib/supabase-admin";

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

    const { data, error } = await getSupabaseAdmin()
      .from("settings")
      .select(
        "merchant_id, store_name, preferred_token, fiat_currency, accepted_tokens",
      )
      .eq("merchant_id", accountId)
      .maybeSingle();

    if (error) {
      throw getSupabaseOperationError(
        "Unable to load merchant settings",
        error,
      );
    }

    return NextResponse.json({ settings: data });
  } catch (error) {
    console.error("Unable to load the shared merchant settings.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load merchant settings.",
      },
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
      !isRecord(body.settings)
    ) {
      return NextResponse.json(
        { error: "Invalid merchant settings authorization." },
        { status: 400 },
      );
    }

    if (getMerchantSessionAccountId(request) !== body.accountId) {
      return NextResponse.json(
        { error: "Authorize this merchant wallet to update its settings." },
        { status: 401 },
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
