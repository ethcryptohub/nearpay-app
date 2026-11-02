"use client";

import {
  defaultMerchantSettings,
  parseMerchantSettings,
  type MerchantSettings,
} from "./merchant-settings";
import {
  isMerchantProduct,
  type MerchantProduct,
} from "./merchant-products";
import { getSupabaseClient } from "./supabase";

export async function loadMerchantSettings(
  merchantAccountId: string,
): Promise<MerchantSettings> {
  const { data, error } = await getSupabaseClient()
    .from("settings")
    .select("*")
    .eq("merchant_id", merchantAccountId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load merchant settings: ${error.message}`);
  }

  return data
    ? parseMerchantSettings(data)
    : { ...defaultMerchantSettings, merchantAccountId };
}

export async function loadMerchantProducts(
  merchantAccountId: string,
): Promise<MerchantProduct[]> {
  const { data, error } = await getSupabaseClient()
    .from("products")
    .select("*")
    .eq("merchant_id", merchantAccountId)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Unable to load the product catalog: ${error.message}`);
  }

  const products = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    currency: row.currency,
    description: row.description,
    imageUrl: row.image_url,
  }));
  if (!products.every(isMerchantProduct)) {
    throw new Error("The Supabase product catalog contains invalid data.");
  }
  return products;
}
