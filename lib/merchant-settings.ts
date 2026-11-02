export type MerchantSettings = {
  merchantAccountId: string;
  storeName: string;
  preferredToken: "USDC" | "NEAR";
  fiatCurrency: "INR" | "USD";
  acceptedTokens: Array<"USDC" | "NEAR">;
};

export const defaultMerchantSettings: MerchantSettings = {
  merchantAccountId: "ethcryptohub.testnet",
  storeName: "ETHcryptohub",
  preferredToken: "NEAR",
  fiatCurrency: "INR",
  acceptedTokens: ["NEAR", "USDC"],
};

export function isValidNearAccountId(accountId: string): boolean {
  return (
    accountId.length >= 2 &&
    accountId.length <= 64 &&
    /^[a-z0-9._-]+$/.test(accountId) &&
    /^[a-z0-9]/.test(accountId) &&
    /[a-z0-9]$/.test(accountId) &&
    !/[._-]{2}/.test(accountId)
  );
}

export function parseMerchantSettings(
  value: unknown,
  fallbackMerchantAccountId = defaultMerchantSettings.merchantAccountId,
): MerchantSettings {
  if (value === null) {
    return {
      ...defaultMerchantSettings,
      merchantAccountId: fallbackMerchantAccountId,
    };
  }

  if (typeof value !== "object" || value === null) {
    throw new Error("Merchant settings have an invalid format.");
  }

  const row = value as Record<string, unknown>;
  const merchantAccountId = row.merchant_id;
  const storeName = row.store_name;
  const preferredToken = row.preferred_token;
  const fiatCurrency = row.fiat_currency;
  const acceptedTokens = row.accepted_tokens;
  if (
    typeof merchantAccountId !== "string" ||
    !isValidNearAccountId(merchantAccountId) ||
    typeof storeName !== "string" ||
    storeName.trim().length === 0 ||
    storeName.trim().length > 80 ||
    (preferredToken !== "USDC" && preferredToken !== "NEAR") ||
    (fiatCurrency !== "INR" && fiatCurrency !== "USD") ||
    !Array.isArray(acceptedTokens) ||
    acceptedTokens.length === 0 ||
    acceptedTokens.some((token) => token !== "NEAR" && token !== "USDC") ||
    new Set(acceptedTokens).size !== acceptedTokens.length
  ) {
    throw new Error("Saved merchant settings have invalid values.");
  }

  return {
    merchantAccountId,
    storeName,
    preferredToken,
    fiatCurrency,
    acceptedTokens: acceptedTokens as Array<"USDC" | "NEAR">,
  };
}
