export const merchantProductCategories = [
  "Beverages",
  "Snacks",
  "Lunch",
  "Dinner",
  "Desserts",
  "Other",
] as const;

export type MerchantProductCategory =
  (typeof merchantProductCategories)[number];

export type MerchantProduct = {
  id: string;
  name: string;
  category: MerchantProductCategory;
  price: number;
  currency: "INR" | "USD";
  description: string;
  imageUrl: string;
};

export function parseMerchantProducts(
  value: unknown,
): MerchantProduct[] {
  if (!Array.isArray(value)) {
    throw new Error("The Supabase product catalog has an invalid format.");
  }

  if (!value.every(isMerchantProduct)) {
    throw new Error("The Supabase product catalog has invalid values.");
  }
  return value;
}

export function isMerchantProduct(value: unknown): value is MerchantProduct {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const product = value as Partial<MerchantProduct>;
  return (
    isValidProductDetails(product) &&
    typeof product.price === "number" &&
    Number.isFinite(product.price) &&
    product.price > 0 &&
    isMerchantProductCategory(product.category) &&
    (product.currency === "INR" || product.currency === "USD")
  );
}

function isValidProductDetails(
  product: Partial<MerchantProduct>,
): boolean {
  return (
    typeof product.id === "string" &&
    product.id.length > 0 &&
    typeof product.name === "string" &&
    product.name.trim().length > 0 &&
    product.name.trim().length <= 100 &&
    (product.category === undefined ||
      isMerchantProductCategory(product.category)) &&
    typeof product.description === "string" &&
    product.description.length <= 500 &&
    typeof product.imageUrl === "string" &&
    isValidProductImageUrl(product.imageUrl)
  );
}

function isMerchantProductCategory(
  value: unknown,
): value is MerchantProductCategory {
  return (
    typeof value === "string" &&
    merchantProductCategories.some((category) => category === value)
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
