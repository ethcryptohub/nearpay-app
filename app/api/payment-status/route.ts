import { NextResponse } from "next/server";
import { isValidNearAccountId } from "../../../lib/merchant-settings";
import { formatInvoiceNumber } from "../../../lib/payment-history";
import { getSupabaseAdmin, getSupabaseOperationError } from "../../../lib/supabase-admin";
import { isTransactionHash } from "../../../lib/server-wallet-auth";

export const dynamic = "force-dynamic";

function isValidNearAmount(amount: string): boolean {
  if (amount.length > 80 || !/^\d+(?:\.\d{1,24})?$/.test(amount)) {
    return false;
  }
  return BigInt(amount.replace(".", "")) > BigInt(0);
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const merchantId = searchParams.get("merchantId");
    const amount = searchParams.get("amount");
    const openedAtValue = searchParams.get("openedAt");
    const openedAtMs = openedAtValue ? Number(openedAtValue) : NaN;

    if (
      !merchantId ||
      !isValidNearAccountId(merchantId) ||
      !amount ||
      !isValidNearAmount(amount) ||
      !Number.isSafeInteger(openedAtMs) ||
      openedAtMs <= 0 ||
      openedAtMs > Date.now() + 60_000
    ) {
      return NextResponse.json(
        { error: "A valid merchant invoice is required." },
        { status: 400 },
      );
    }

    const { data, error } = await getSupabaseAdmin()
      .from("transactions")
      .select("id, tx_hash")
      .eq("merchant_id", merchantId)
      .eq("amount", amount)
      .eq("token_type", "NEAR")
      .eq("status", "Success")
      .gte("created_at", new Date(openedAtMs).toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw getSupabaseOperationError(
        "Unable to check this invoice's payment status",
        error,
      );
    }
    if (data && !isTransactionHash(data.tx_hash)) {
      throw new Error("The stored payment has an invalid transaction hash.");
    }

    return NextResponse.json(
      {
        transactionHash: data?.tx_hash ?? null,
        invoiceNumber: data ? formatInvoiceNumber(data.id) : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to check the merchant invoice payment status.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to check the payment status.",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
