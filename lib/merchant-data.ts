"use client";

import {
  parseMerchantSettings,
  type MerchantSettings,
} from "./merchant-settings";
import {
  parseMerchantProducts,
  type MerchantProduct,
} from "./merchant-products";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getApiError(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === "string"
    ? value.error
    : fallback;
}

async function fetchApiPayload(
  path: string,
  fallback: string,
): Promise<unknown> {
  const response = await fetch(path, { cache: "no-store" });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${fallback} The server returned an invalid response.`);
  }
  if (!response.ok) {
    throw new Error(getApiError(payload, fallback));
  }
  return payload;
}

export async function loadMerchantSettings(
  merchantAccountId: string,
): Promise<MerchantSettings> {
  const payload = await fetchApiPayload(
    `/api/merchant-settings?accountId=${encodeURIComponent(merchantAccountId)}`,
    "Unable to load merchant settings.",
  );
  if (!isRecord(payload) || !("settings" in payload)) {
    throw new Error("The merchant settings response has an invalid format.");
  }

  return parseMerchantSettings(payload.settings, merchantAccountId);
}

export async function loadMerchantProducts(
  merchantAccountId: string,
): Promise<MerchantProduct[]> {
  const payload = await fetchApiPayload(
    `/api/merchant-products?accountId=${encodeURIComponent(merchantAccountId)}`,
    "Unable to load the product catalog.",
  );
  if (!isRecord(payload) || !Array.isArray(payload.products)) {
    throw new Error("The Supabase product catalog has an invalid format.");
  }

  return parseMerchantProducts(payload.products);
}
