export type MerchantProduct = {
  id: string;
  name: string;
  priceInr: number;
  description: string;
  imageUrl: string;
};

export const merchantProductsStorageKey = "nearpay_products";

export function parseMerchantProducts(
  serializedProducts: string | null,
): MerchantProduct[] {
  if (serializedProducts === null) {
    return [];
  }

  const parsed: unknown = JSON.parse(serializedProducts);
  if (!Array.isArray(parsed) || !parsed.every(isMerchantProduct)) {
    throw new Error("Saved products have an invalid format.");
  }

  return parsed;
}

function isMerchantProduct(value: unknown): value is MerchantProduct {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const product = value as Partial<MerchantProduct>;
  return (
    typeof product.id === "string" &&
    product.id.length > 0 &&
    typeof product.name === "string" &&
    product.name.trim().length > 0 &&
    product.name.trim().length <= 100 &&
    typeof product.priceInr === "number" &&
    Number.isFinite(product.priceInr) &&
    product.priceInr > 0 &&
    typeof product.description === "string" &&
    product.description.length <= 500 &&
    typeof product.imageUrl === "string" &&
    isValidProductImageUrl(product.imageUrl)
  );
}

export function isValidProductImageUrl(imageUrl: string): boolean {
  if (!imageUrl.trim()) {
    return true;
  }

  if (imageUrl.length > 1_400_000) {
    return false;
  }

  if (imageUrl.startsWith("data:")) {
    return /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(
      imageUrl,
    );
  }

  if (imageUrl.length > 2048) {
    return false;
  }

  try {
    const url = new URL(imageUrl);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
