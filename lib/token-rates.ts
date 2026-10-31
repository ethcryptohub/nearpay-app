export type FiatCurrency = "INR" | "USD";
export type PaymentToken = "NEAR" | "USDC";

export type TokenRates = {
  fetchedAt: string;
  stale: boolean;
  warning?: string;
  prices: Record<PaymentToken, Record<FiatCurrency, number>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function fetchTokenRates(): Promise<TokenRates> {
  const response = await fetch("/api/token-rates", {
    cache: "no-store",
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "The exchange-rate service is unavailable.";
    throw new Error(message);
  }

  const result: unknown = await response.json();
  if (
    !isRecord(result) ||
    typeof result.fetchedAt !== "string" ||
    typeof result.stale !== "boolean" ||
    (result.warning !== undefined && typeof result.warning !== "string") ||
    !isRecord(result.prices)
  ) {
    throw new Error("The exchange-rate service returned an invalid response.");
  }

  const prices: TokenRates["prices"] = {
    NEAR: { USD: 0, INR: 0 },
    USDC: { USD: 0, INR: 0 },
  };
  for (const token of ["NEAR", "USDC"] as const) {
    for (const currency of ["INR", "USD"] as const) {
      const tokenPrices = result.prices[token];
      if (!isRecord(tokenPrices)) {
        throw new Error("The exchange-rate service returned invalid prices.");
      }
      const price = tokenPrices[currency];
      if (
        typeof price !== "number" ||
        !Number.isFinite(price) ||
        price <= 0
      ) {
        throw new Error("The exchange-rate service returned invalid prices.");
      }
      prices[token][currency] = price;
    }
  }

  return {
    fetchedAt: result.fetchedAt,
    stale: result.stale,
    warning: result.warning,
    prices,
  };
}

export function calculateTokenAmount(
  fiatAmount: number,
  fiatCurrency: FiatCurrency,
  token: PaymentToken,
  rates: TokenRates,
): number {
  if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
    return 0;
  }
  return fiatAmount / rates.prices[token][fiatCurrency];
}

export function formatTokenAmount(
  amount: number,
): string {
  return amount.toFixed(6);
}
