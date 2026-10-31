export type MerchantSettings = {
  merchantAccountId: string;
  storeName: string;
  preferredToken: "USDC" | "NEAR";
  fiatCurrency: "INR" | "USD";
  acceptedTokens: Array<"USDC" | "NEAR">;
};

export const merchantSettingsStorageKey = "nearpay_settings";

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
  serializedSettings: string | null,
): MerchantSettings {
  if (serializedSettings === null) {
    return defaultMerchantSettings;
  }

  const parsed: unknown = JSON.parse(serializedSettings);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Saved merchant settings have an invalid format.");
  }

  const settings = parsed as Partial<MerchantSettings>;
  const acceptedTokens =
    settings.acceptedTokens === undefined
      ? (["NEAR", "USDC"] as Array<"USDC" | "NEAR">)
      : settings.acceptedTokens;
  if (
    typeof settings.merchantAccountId !== "string" ||
    !isValidNearAccountId(settings.merchantAccountId) ||
    typeof settings.storeName !== "string" ||
    settings.storeName.trim().length === 0 ||
    settings.storeName.trim().length > 80 ||
    (settings.preferredToken !== "USDC" &&
      settings.preferredToken !== "NEAR") ||
    (settings.fiatCurrency !== "INR" && settings.fiatCurrency !== "USD") ||
    !Array.isArray(acceptedTokens) ||
    acceptedTokens.length === 0 ||
    acceptedTokens.some((token) => token !== "NEAR" && token !== "USDC") ||
    new Set(acceptedTokens).size !== acceptedTokens.length
  ) {
    throw new Error("Saved merchant settings have invalid values.");
  }

  return {
    merchantAccountId: settings.merchantAccountId,
    storeName: settings.storeName,
    preferredToken: settings.preferredToken,
    fiatCurrency: settings.fiatCurrency,
    acceptedTokens,
  };
}
