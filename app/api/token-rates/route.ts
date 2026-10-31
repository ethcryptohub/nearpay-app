import { NextResponse } from "next/server";

type CoinGeckoPrices = {
  near?: { usd?: number; inr?: number };
  "usd-coin"?: { usd?: number; inr?: number };
};

type CachedRates = {
  fetchedAt: string;
  prices: {
    NEAR: { USD: number; INR: number };
    USDC: { USD: number; INR: number };
  };
};

const cacheDurationMs = 5 * 60 * 1000;
const retryDelayMs = 60 * 1000;
let cachedRates: CachedRates | null = null;
let cacheExpiresAt = 0;
let retryAfter = 0;
let lastRefreshError = "";
let refreshInProgress: Promise<CachedRates> | null = null;

export const dynamic = "force-dynamic";

function respondWithRates(rates: CachedRates, stale: boolean) {
  return NextResponse.json(
    {
      ...rates,
      stale,
      warning: stale ? lastRefreshError : undefined,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function fetchCurrentRates(): Promise<CachedRates> {
  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=near%2Cusd-coin&vs_currencies=usd%2Cinr",
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`CoinGecko returned HTTP ${response.status}.`);
  }

  const prices = (await response.json()) as CoinGeckoPrices;
  const nearUsd = prices.near?.usd;
  const nearInr = prices.near?.inr;
  const usdcUsd = prices["usd-coin"]?.usd;
  const usdcInr = prices["usd-coin"]?.inr;
  if (
    typeof nearUsd !== "number" ||
    !Number.isFinite(nearUsd) ||
    nearUsd <= 0 ||
    typeof nearInr !== "number" ||
    !Number.isFinite(nearInr) ||
    nearInr <= 0 ||
    typeof usdcUsd !== "number" ||
    !Number.isFinite(usdcUsd) ||
    usdcUsd <= 0 ||
    typeof usdcInr !== "number" ||
    !Number.isFinite(usdcInr) ||
    usdcInr <= 0
  ) {
    throw new Error("CoinGecko did not return valid NEAR and USDC prices.");
  }

  return {
    fetchedAt: new Date().toISOString(),
    prices: {
      NEAR: { USD: nearUsd, INR: nearInr },
      USDC: { USD: usdcUsd, INR: usdcInr },
    },
  };
}

export async function GET() {
  const now = Date.now();
  if (cachedRates && now < cacheExpiresAt) {
    return respondWithRates(cachedRates, false);
  }
  if (cachedRates && now < retryAfter) {
    return respondWithRates(cachedRates, true);
  }

  try {
    if (!refreshInProgress) {
      refreshInProgress = fetchCurrentRates();
    }
    const updatedRates = await refreshInProgress;
    cachedRates = updatedRates;
    cacheExpiresAt = Date.now() + cacheDurationMs;
    retryAfter = 0;
    lastRefreshError = "";
    return respondWithRates(updatedRates, false);
  } catch (error) {
    console.error("Unable to fetch CoinGecko token prices.", error);
    lastRefreshError =
      error instanceof Error
        ? error.message
        : "Unable to fetch current token prices from CoinGecko.";
    retryAfter = Date.now() + retryDelayMs;
    if (cachedRates) {
      return respondWithRates(cachedRates, true);
    }
    return NextResponse.json(
      { error: lastRefreshError },
      { status: 502 },
    );
  } finally {
    refreshInProgress = null;
  }
}
