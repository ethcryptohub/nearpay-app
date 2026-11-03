import { NextResponse } from "next/server";
import {
  isMerchantProduct,
  type MerchantProduct,
} from "../../../lib/merchant-products";
import { isValidNearAccountId } from "../../../lib/merchant-settings";
import { getMerchantSessionAccountId } from "../../../lib/server-merchant-session";
import {
  getSupabaseAdmin,
  getSupabaseOperationError,
} from "../../../lib/supabase-admin";

export const dynamic = "force-dynamic";

type MerchantProductRow = {
  merchant_id: string;
  id: string;
  name: string;
  category: MerchantProduct["category"];
  price: number | string;
  currency: MerchantProduct["currency"];
  description: string;
  image_url: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toMerchantProduct(row: MerchantProductRow): MerchantProduct {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price),
    currency: row.currency,
    description: row.description,
    imageUrl: row.image_url,
  };
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
      .from("products")
      .select(
        "merchant_id, id, name, category, price, currency, description, image_url",
      )
      .eq("merchant_id", accountId)
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      throw getSupabaseOperationError(
        "Unable to load the merchant product catalog",
        error,
      );
    }

    const products = (data ?? []).map((row) =>
      toMerchantProduct(row as MerchantProductRow),
    );
    return NextResponse.json({ products });
  } catch (error) {
    console.error("Unable to load the shared merchant product catalog.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load the merchant product catalog.",
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
      (body.action !== "upsert" &&
        body.action !== "delete" &&
        body.action !== "import")
    ) {
      return NextResponse.json(
        { error: "Invalid merchant product authorization." },
        { status: 400 },
      );
    }

    if (body.action === "upsert" && !isMerchantProduct(body.product)) {
      return NextResponse.json(
        { error: "The product details are invalid." },
        { status: 400 },
      );
    }
    if (
      body.action === "import" &&
      (!Array.isArray(body.products) ||
        body.products.length === 0 ||
        body.products.length > 100 ||
        !body.products.every(isMerchantProduct) ||
        new Set(body.products.map((product) => product.id)).size !==
          body.products.length)
    ) {
      return NextResponse.json(
        { error: "The product import must contain 1–100 unique valid products." },
        { status: 400 },
      );
    }
    if (
      body.action === "delete" &&
      (typeof body.productId !== "string" ||
        body.productId.length === 0 ||
        body.productId.length > 120)
    ) {
      return NextResponse.json(
        { error: "A valid product ID is required." },
        { status: 400 },
      );
    }

    if (getMerchantSessionAccountId(request) !== body.accountId) {
      return NextResponse.json(
        { error: "Authorize this merchant wallet to manage its catalog." },
        { status: 401 },
      );
    }

    const supabase = getSupabaseAdmin();
    if (body.action === "upsert") {
      const product = body.product as MerchantProduct;
      const { error } = await supabase.from("products").upsert(
        {
          merchant_id: body.accountId,
          id: product.id,
          name: product.name.trim(),
          category: product.category,
          price: product.price,
          currency: product.currency,
          description: product.description.trim(),
          image_url: product.imageUrl.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "merchant_id,id" },
      );
      if (error) {
        throw getSupabaseOperationError(
          "Unable to save the merchant product",
          error,
        );
      }
    } else if (body.action === "delete") {
      const { data, error } = await supabase
        .from("products")
        .delete()
        .eq("merchant_id", body.accountId)
        .eq("id", body.productId as string)
        .select("id")
        .maybeSingle();
      if (error) {
        throw getSupabaseOperationError(
          "Unable to delete the merchant product",
          error,
        );
      }
      if (!data) {
        return NextResponse.json(
          { error: "The product was not found in this merchant catalog." },
          { status: 404 },
        );
      }
    } else {
      const products = body.products as MerchantProduct[];
      const { error } = await supabase.from("products").upsert(
        products.map((product) => ({
          merchant_id: body.accountId as string,
          id: product.id,
          name: product.name.trim(),
          category: product.category,
          price: product.price,
          currency: product.currency,
          description: product.description.trim(),
          image_url: product.imageUrl.trim(),
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "merchant_id,id" },
      );
      if (error) {
        throw getSupabaseOperationError(
          "Unable to import the merchant products",
          error,
        );
      }
    }

    const { data, error } = await supabase
      .from("products")
      .select(
        "merchant_id, id, name, category, price, currency, description, image_url",
      )
      .eq("merchant_id", body.accountId)
      .order("category", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      throw getSupabaseOperationError(
        "Unable to refresh the merchant product catalog",
        error,
      );
    }

    return NextResponse.json({
      products: (data ?? []).map((row) =>
        toMerchantProduct(row as MerchantProductRow),
      ),
    });
  } catch (error) {
    console.error("Unable to update the secured merchant product catalog.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to update the merchant product catalog.",
      },
      { status: 500 },
    );
  }
}
