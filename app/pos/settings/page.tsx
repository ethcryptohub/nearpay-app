"use client";

import Image from "next/image";
import { useEffect, useState, type ChangeEvent } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import Sidebar from "../../../components/Sidebar";
import {
  defaultMerchantSettings,
  isValidNearAccountId,
  parseMerchantSettings,
  type MerchantSettings,
} from "../../../lib/merchant-settings";
import {
  isValidProductImageUrl,
  merchantProductCategories,
  isMerchantProduct,
  parseMerchantProducts,
  type MerchantProduct,
  type MerchantProductCategory,
} from "../../../lib/merchant-products";
import { restaurantSampleProducts } from "../../../lib/restaurant-sample-products";
import { getWalletSelector } from "../../../lib/near-wallet-selector";
import { loadMerchantProducts, loadMerchantSettings } from "../../../lib/merchant-data";
import { signMerchantAuthorization } from "../../../lib/merchant-authorization";

const fieldClassName =
  "mt-2 w-full border border-neutral-300 bg-white px-4 py-3 text-sm outline-none transition placeholder:text-neutral-400 focus:border-black disabled:bg-neutral-50 disabled:text-neutral-500";
const fieldLabelClassName =
  "block text-xs font-bold uppercase tracking-[0.16em] text-neutral-700";

type SettingsSection = "profile" | "payments" | "catalog";

function readApiError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : fallback;
}

export default function MerchantSettingsPage() {
  const [settings, setSettings] = useState<MerchantSettings>(
    defaultMerchantSettings,
  );
  const [products, setProducts] = useState<MerchantProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [productError, setProductError] = useState<string | null>(null);
  const [productMessage, setProductMessage] = useState("");
  const [productName, setProductName] = useState("");
  const [productCategory, setProductCategory] =
    useState<MerchantProductCategory>("Other");
  const [productPrice, setProductPrice] = useState("");
  const [productCurrency, setProductCurrency] = useState<"INR" | "USD">("INR");
  const [productDescription, setProductDescription] = useState("");
  const [productImageUrl, setProductImageUrl] = useState("");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [activeSection, setActiveSection] =
    useState<SettingsSection>("profile");
  const [walletSelector, setWalletSelector] = useState<WalletSelector | null>(
    null,
  );
  const [walletModal, setWalletModal] = useState<WalletSelectorModal | null>(
    null,
  );
  const [connectedAccountId, setConnectedAccountId] = useState<string | null>(
    null,
  );
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  async function loadSharedProducts(
    merchantAccountId: string,
    isActive: () => boolean = () => true,
  ) {
    if (isActive()) {
      setProductsLoaded(false);
      setProductError(null);
    }

    try {
      const savedProducts = await loadMerchantProducts(merchantAccountId);
      if (isActive()) {
        setProducts(savedProducts);
      }
    } catch (error) {
      console.error("Unable to load the shared merchant product catalog.", error);
      if (isActive()) {
        setProducts([]);
        setProductError(
          error instanceof Error
            ? error.message
            : "The shared product catalog could not be loaded from Supabase.",
        );
      }
    } finally {
      if (isActive()) setProductsLoaded(true);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadSettingsAndProducts() {
      await Promise.resolve();
      let merchantAccountId = defaultMerchantSettings.merchantAccountId;
      try {
        const savedSettings = await loadMerchantSettings(merchantAccountId);
        merchantAccountId = savedSettings.merchantAccountId;
        if (active) {
          setSettings(savedSettings);
          setProductCurrency(savedSettings.fiatCurrency);
        }
      } catch (error) {
        console.error("Unable to load merchant settings.", error);
        if (active) {
          setSettingsError(
            error instanceof Error
              ? error.message
              : "Merchant settings could not be loaded from Supabase.",
          );
        }
      }

      await loadSharedProducts(merchantAccountId, () => active);
      if (active) {
        setIsLoading(false);
      }
    }

    void loadSettingsAndProducts();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!connectedAccountId || connectedAccountId === settings.merchantAccountId) {
      return;
    }

    const connectedMerchantId = connectedAccountId;
    let active = true;
    async function loadConnectedMerchant() {
      setIsLoading(true);
      setSettingsError(null);
      try {
        const savedSettings = await loadMerchantSettings(connectedMerchantId);
        if (active) {
          setSettings(savedSettings);
          setProductCurrency(savedSettings.fiatCurrency);
        }
        await loadSharedProducts(connectedMerchantId, () => active);
      } catch (error) {
        console.error("Unable to load settings for the connected merchant.", error);
        if (active) {
          setSettingsError(
            error instanceof Error
              ? error.message
              : "Merchant settings could not be loaded from Supabase.",
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void loadConnectedMerchant();
    return () => {
      active = false;
    };
  }, [connectedAccountId, settings.merchantAccountId]);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    getWalletSelector()
      .then((selector) => {
        if (!active) {
          return;
        }
        setWalletSelector(selector);
        setWalletModal(
          setupModal(selector, {
            theme: "light",
            description: "Authorize changes to the shared product catalog.",
          }),
        );
        const syncAccount = () => {
          const accounts = selector.store.getState().accounts;
          setConnectedAccountId(
            accounts.find((account) => account.active)?.accountId ??
              accounts[0]?.accountId ??
              null,
          );
        };
        syncAccount();
        const subscription = selector.store.observable.subscribe(syncAccount);
        unsubscribe = () => subscription.unsubscribe();
      })
      .catch((error: unknown) => {
        console.error("Unable to initialize the merchant wallet for catalog updates.", error);
        if (active) {
          setProductError("A NEAR wallet is required to manage the shared catalog.");
        }
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  function updateSettings<K extends keyof MerchantSettings>(
    field: K,
    value: MerchantSettings[K],
  ) {
    setSettings((current) => ({ ...current, [field]: value }));
    setSettingsError(null);
    setSettingsMessage("");
  }

  function toggleAcceptedToken(token: "NEAR" | "USDC", enabled: boolean) {
    const acceptedTokens = enabled
      ? [...new Set([...settings.acceptedTokens, token])]
      : settings.acceptedTokens.filter((accepted) => accepted !== token);
    const preferredToken =
      !enabled && settings.preferredToken === token
        ? "NEAR"
        : settings.preferredToken;
    setSettings((current) => ({
      ...current,
      acceptedTokens,
      preferredToken,
    }));
    setSettingsError(null);
    setSettingsMessage("");
  }

  async function saveSettings() {
    const merchantAccountId = settings.merchantAccountId.trim();
    const storeName = settings.storeName.trim();
    if (!storeName || storeName.length > 80) {
      setSettingsError("Store name must be between 1 and 80 characters.");
      return;
    }
    if (!isValidNearAccountId(merchantAccountId)) {
      setSettingsError("Enter a valid NEAR account ID.");
      return;
    }
    if (
      !settings.acceptedTokens.includes("NEAR") ||
      !settings.acceptedTokens.includes(settings.preferredToken)
    ) {
      setSettingsError(
        "Enable NEAR for testnet payments and choose a token that is enabled.",
      );
      return;
    }

    const nextSettings = { ...settings, merchantAccountId, storeName };
    if (
      !walletSelector ||
      !connectedAccountId ||
      connectedAccountId !== merchantAccountId
    ) {
      setSettingsError(
        "Connect the configured merchant NEAR wallet to save settings.",
      );
      walletModal?.show();
      return;
    }

    setIsSavingSettings(true);
    setSettingsError(null);
    setSettingsMessage("");
    try {
      const authorization = await signMerchantAuthorization(
        walletSelector,
        connectedAccountId,
        "merchant-settings",
      );
      const response = await fetch("/api/merchant-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...authorization,
          settings: nextSettings,
        }),
      });
      const result: unknown = await response.json();
      if (
        !response.ok ||
        typeof result !== "object" ||
        result === null ||
        !("settings" in result)
      ) {
        throw new Error(
          readApiError(result, "Merchant settings could not be saved to Supabase."),
        );
      }
      const savedSettings = parseMerchantSettings(result.settings);
      setSettings(savedSettings);
      setProductCurrency(savedSettings.fiatCurrency);
      setSettingsMessage("Settings saved to Supabase.");
    } catch (error) {
      console.error("Unable to save merchant settings.", error);
      setSettingsError(
        error instanceof Error
          ? error.message
          : "Merchant settings could not be saved to Supabase.",
      );
      setSettingsMessage("");
    } finally {
      setIsSavingSettings(false);
    }
  }

  function resetProductForm() {
    setProductName("");
    setProductCategory("Other");
    setProductPrice("");
    setProductCurrency(settings.fiatCurrency);
    setProductDescription("");
    setProductImageUrl("");
    setEditingProductId(null);
    setProductError(null);
  }

  async function handleProductImageUpload(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const supportedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!supportedTypes.includes(file.type)) {
      setProductError("Choose a JPG, PNG, WebP, or GIF image.");
      event.target.value = "";
      return;
    }
    if (file.size > 1024 * 1024) {
      setProductError("Product images must be 1 MB or smaller.");
      event.target.value = "";
      return;
    }

    try {
      const imageData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
          } else {
            reject(new Error("The selected image could not be read."));
          }
        };
        reader.onerror = () =>
          reject(reader.error ?? new Error("The selected image could not be read."));
        reader.readAsDataURL(file);
      });
      setProductImageUrl(imageData);
      setProductError(null);
      setProductMessage("");
    } catch (error) {
      console.error("Unable to read the selected product image.", error);
      setProductError(
        error instanceof Error
          ? error.message
          : "The selected image could not be read.",
      );
    } finally {
      event.target.value = "";
    }
  }

  async function mutateSharedCatalog(
    mutation:
      | { action: "upsert"; product: MerchantProduct }
      | { action: "delete"; productId: string }
      | { action: "import"; products: MerchantProduct[] },
  ): Promise<boolean> {
    if (!walletSelector || connectedAccountId !== settings.merchantAccountId) {
      setProductError(
        "Connect the configured merchant NEAR wallet to authorize this catalog change.",
      );
      walletModal?.show();
      return false;
    }

    setIsSavingProduct(true);
    setProductError(null);
    setProductMessage("");
    try {
      const authorization = await signMerchantAuthorization(
        walletSelector,
        connectedAccountId,
        "merchant-catalog",
      );

      const response = await fetch("/api/merchant-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...mutation,
          ...authorization,
        }),
      });
      const result: unknown = await response.json();
      if (
        !response.ok ||
        typeof result !== "object" ||
        result === null ||
        !("products" in result) ||
        !Array.isArray(result.products) ||
        !result.products.every(isMerchantProduct)
      ) {
        throw new Error(
          readApiError(result, "The product catalog could not be updated in Supabase."),
        );
      }

      setProducts(parseMerchantProducts(result.products));
      if (mutation.action === "import") {
        setProductMessage(
          `Imported ${mutation.products.length} product(s) into the shared Supabase catalog.`,
        );
      } else {
        setProductMessage(
          mutation.action === "delete"
            ? "Product deleted from the shared Supabase catalog."
            : "Product saved to the shared Supabase catalog.",
        );
      }
      return true;
    } catch (error) {
      console.error("Unable to update the shared merchant product catalog.", error);
      setProductError(
        error instanceof Error
          ? error.message
          : "The product catalog could not be updated in Supabase.",
      );
      return false;
    } finally {
      setIsSavingProduct(false);
    }
  }

  async function saveProduct() {
    const name = productName.trim();
    const price = Number(productPrice);
    const description = productDescription.trim();
    const imageUrl = productImageUrl.trim();

    if (!name || name.length > 100) {
      setProductError("Product name must be between 1 and 100 characters.");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setProductError("Enter a product price greater than zero.");
      return;
    }
    if (description.length > 500) {
      setProductError("Product description must be 500 characters or fewer.");
      return;
    }
    if (!isValidProductImageUrl(imageUrl)) {
      setProductError(
        "Enter a valid HTTP or HTTPS image URL, or upload an image up to 1 MB.",
      );
      return;
    }

    const product: MerchantProduct = {
      id: editingProductId ?? crypto.randomUUID(),
      name,
      category: productCategory,
      price: Math.round(price * 100) / 100,
      currency: productCurrency,
      description,
      imageUrl,
    };
    if (await mutateSharedCatalog({ action: "upsert", product })) {
      resetProductForm();
    }
  }

  function editProduct(product: MerchantProduct) {
    setProductName(product.name);
    setProductCategory(product.category);
    setProductPrice(product.price.toFixed(2));
    setProductCurrency(product.currency);
    setProductDescription(product.description);
    setProductImageUrl(product.imageUrl);
    setEditingProductId(product.id);
    setProductError(null);
    setProductMessage("");
    document.getElementById("product-name")?.focus();
  }

  async function deleteProduct(productId: string) {
    if (!(await mutateSharedCatalog({ action: "delete", productId }))) {
      return;
    }
    if (editingProductId === productId) {
      resetProductForm();
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f4f1] font-sans text-black lg:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 p-5 sm:p-8 lg:p-12">
        <div className="mx-auto max-w-5xl">
          <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-black pb-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-neutral-500">
                NEARPAY / MERCHANT
              </p>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
                Settings
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-600">
                Manage your store profile, accepted payment tokens, and product
                catalog. Your changes are stored in Supabase.
              </p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
              {isLoading ? "Loading settings" : "Supabase settings"}
            </span>
          </header>

          <nav
            aria-label="Settings sections"
            role="tablist"
            className="mb-6 grid grid-cols-3 border border-black"
          >
            {(
              [
                ["profile", "Store profile"],
                ["payments", "Payments"],
                ["catalog", "Products"],
              ] as const
            ).map(([section, label], index) => (
              <button
                key={section}
                id={`${section}-tab`}
                type="button"
                role="tab"
                aria-selected={activeSection === section}
                aria-controls={`${section}-panel`}
                onClick={() => setActiveSection(section)}
                className={`min-h-14 px-2 py-3 text-xs font-bold uppercase tracking-wider transition sm:px-4 sm:text-sm ${
                  activeSection === section
                    ? "bg-black text-white"
                    : "bg-white text-neutral-600 hover:bg-neutral-100 hover:text-black"
                } ${index < 2 ? "border-r border-black" : ""}`}
              >
                {label}
              </button>
            ))}
          </nav>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void saveSettings();
            }}
            className="space-y-5"
          >
            {activeSection === "profile" ? (
              <section
                id="profile-panel"
                role="tabpanel"
                aria-labelledby="profile-tab"
                className="border border-black p-5 sm:p-7"
              >
                <div className="mb-6 border-b border-neutral-200 pb-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
                    01 / STORE PROFILE
                  </p>
                  <h2 className="mt-2 text-xl font-black">Business details</h2>
                </div>
                <div className="space-y-5">
                  <label className={fieldLabelClassName} htmlFor="store-name">
                    Store Name
                    <input
                      id="store-name"
                      type="text"
                      maxLength={80}
                      required
                      value={settings.storeName}
                      onChange={(event) =>
                        updateSettings("storeName", event.target.value)
                      }
                      placeholder="ETHcryptohub"
                      disabled={isLoading || isSavingSettings}
                      className={fieldClassName}
                    />
                  </label>
                  <label
                    className={fieldLabelClassName}
                    htmlFor="merchant-account"
                  >
                    Merchant Account ID
                    <input
                      id="merchant-account"
                      type="text"
                      autoComplete="off"
                      required
                      value={settings.merchantAccountId}
                      onChange={(event) =>
                        updateSettings("merchantAccountId", event.target.value)
                      }
                      placeholder="ethcryptohub.testnet"
                      disabled={isLoading || isSavingSettings}
                      className={`${fieldClassName} font-mono normal-case tracking-normal`}
                    />
                    <span className="mt-2 block text-xs font-normal normal-case tracking-normal text-neutral-500">
                      This account receives testnet NEAR payments.
                    </span>
                  </label>
                  <label
                    className={fieldLabelClassName}
                    htmlFor="fiat-currency"
                  >
                    Fiat Currency
                    <select
                      id="fiat-currency"
                      value={settings.fiatCurrency}
                      onChange={(event) =>
                        updateSettings(
                          "fiatCurrency",
                          event.target.value === "USD" ? "USD" : "INR",
                        )
                      }
                      disabled={isLoading || isSavingSettings}
                      className={fieldClassName}
                    >
                      <option value="INR">INR — Indian Rupee</option>
                      <option value="USD">USD — US Dollar</option>
                    </select>
                  </label>
                </div>
              </section>
            ) : null}

            {activeSection === "payments" ? (
              <section
                id="payments-panel"
                role="tabpanel"
                aria-labelledby="payments-tab"
                className="border border-black p-5 sm:p-7"
              >
                <div className="mb-6 border-b border-neutral-200 pb-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
                    02 / PAYMENT PREFERENCES
                  </p>
                  <h2 className="mt-2 text-xl font-black">Tokens & checkout</h2>
                </div>
                <div className="space-y-5">
                  <label
                    className={fieldLabelClassName}
                    htmlFor="preferred-token"
                  >
                    Default Token
                    <select
                      id="preferred-token"
                      value={settings.preferredToken}
                      onChange={(event) =>
                        updateSettings(
                          "preferredToken",
                          event.target.value === "USDC" ? "USDC" : "NEAR",
                        )
                      }
                      disabled={isLoading || isSavingSettings}
                      className={fieldClassName}
                    >
                      <option value="NEAR">NEAR</option>
                      <option
                        value="USDC"
                        disabled={!settings.acceptedTokens.includes("USDC")}
                      >
                        USDC quote preview
                      </option>
                    </select>
                  </label>

                  <fieldset className="space-y-3">
                    <legend className={`${fieldLabelClassName} mb-3`}>
                      Accepted Tokens
                    </legend>
                    {(["NEAR", "USDC"] as const).map((token) => {
                      const enabled = settings.acceptedTokens.includes(token);
                      return (
                        <label
                          key={token}
                          className="flex cursor-pointer items-center justify-between gap-4 border border-neutral-200 p-4 transition hover:border-black"
                        >
                          <span>
                            <span className="block text-sm font-bold">
                              {token}
                              {token === "USDC" ? " quote preview" : ""}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-neutral-500">
                              {token === "NEAR"
                                ? "Required for actual NEAR testnet payment."
                                : "Informational only; no USDC testnet contract is configured."}
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            checked={enabled}
                            disabled={isLoading || isSavingSettings || token === "NEAR"}
                            onChange={(event) =>
                              toggleAcceptedToken(token, event.target.checked)
                            }
                            aria-label={`Accept ${token}`}
                            className="h-5 w-5 shrink-0 accent-black"
                          />
                        </label>
                      );
                    })}
                  </fieldset>
                  <p className="border-l-2 border-black pl-3 text-xs leading-5 text-neutral-600">
                    The testnet checkout can only transfer native NEAR. Enabling
                    USDC displays a quote; it does not enable USDC settlement.
                  </p>
                </div>
              </section>
            ) : null}

            {activeSection !== "catalog" && settingsError ? (
              <p
                role="alert"
                className="border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
              >
                {settingsError}
              </p>
            ) : null}
            {activeSection !== "catalog" && settingsMessage ? (
              <p
                role="status"
                className="border border-neutral-300 px-4 py-3 text-sm font-semibold"
              >
                {settingsMessage}
              </p>
            ) : null}
            {activeSection !== "catalog" ? (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isLoading || isSavingSettings}
                className="w-full bg-black px-7 py-4 text-sm font-bold uppercase tracking-[0.16em] text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {isSavingSettings ? "Saving..." : "Save Changes"}
              </button>
            </div>
            ) : null}
          </form>

          {activeSection === "catalog" ? (
          <section
            id="catalog-panel"
            role="tabpanel"
            aria-labelledby="catalog-tab"
            className="border border-black p-5 sm:p-7"
          >
            <div className="flex flex-wrap items-end justify-between gap-4 border-b border-neutral-200 pb-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
                  03 / PRODUCT CATALOG
                </p>
                <h2 className="mt-2 text-xl font-black">Catalog manager</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-600">
                  Products are shared through Supabase for{" "}
                  <span className="font-mono font-semibold text-black">
                    {settings.merchantAccountId}
                  </span>
                  . Changes require authorization from that NEAR wallet.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
                  {products.length}{" "}
                  {products.length === 1 ? "product" : "products"}
                </span>
                {connectedAccountId === settings.merchantAccountId ? (
                  <span className="border border-emerald-700 px-3 py-2 text-xs font-bold text-emerald-800">
                    WALLET AUTHORIZED
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => walletModal?.show()}
                    disabled={!walletSelector || !walletModal}
                    className="border border-black px-4 py-2 text-xs font-bold uppercase tracking-widest transition hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Connect Merchant Wallet
                  </button>
                )}
              </div>
            </div>

            {products.length === 0 ? (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border border-neutral-300 p-4">
                <p className="text-sm leading-6 text-neutral-600">
                  Start with 12 sample Indian restaurant products, then edit
                  them any time.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    void mutateSharedCatalog({
                      action: "import",
                      products: restaurantSampleProducts,
                    })
                  }
                  disabled={
                    !productsLoaded ||
                    isSavingProduct ||
                    connectedAccountId !== settings.merchantAccountId
                  }
                  className="bg-black px-4 py-3 text-xs font-bold uppercase tracking-widest text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSavingProduct ? "Saving..." : "Add 12 Sample Products"}
                </button>
              </div>
            ) : null}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveProduct();
              }}
              className="mt-6 border border-neutral-300 p-4 sm:p-6"
            >
              <div className="mb-5 flex items-center gap-2">
                {editingProductId ? (
                  <Pencil aria-hidden="true" size={16} />
                ) : (
                  <Plus aria-hidden="true" size={18} />
                )}
                <h3 className="text-sm font-bold">
                  {editingProductId ? "Edit product" : "Add a product"}
                </h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className={fieldLabelClassName} htmlFor="product-name">
                  Product Name
                  <input
                    id="product-name"
                    type="text"
                    maxLength={100}
                    required
                    value={productName}
                    onChange={(event) => setProductName(event.target.value)}
                    disabled={!productsLoaded || isSavingProduct}
                    placeholder="Product name"
                    className={fieldClassName}
                  />
                </label>
                <label
                  className={fieldLabelClassName}
                  htmlFor="product-category"
                >
                  Category
                  <select
                    id="product-category"
                    value={productCategory}
                    onChange={(event) => {
                      const category = event.target.value;
                      setProductCategory(
                        merchantProductCategories.find(
                          (option) => option === category,
                        ) ?? "Other",
                      );
                    }}
                    disabled={!productsLoaded || isSavingProduct}
                    className={fieldClassName}
                  >
                    {merchantProductCategories.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <label className={fieldLabelClassName} htmlFor="product-price">
                    Price
                  </label>
                  <div className="mt-2 flex">
                    <select
                      id="product-currency"
                      aria-label="Product price currency"
                      value={productCurrency}
                      onChange={(event) =>
                        setProductCurrency(
                          event.target.value === "USD" ? "USD" : "INR",
                        )
                      }
                      disabled={!productsLoaded || isSavingProduct}
                      className="border border-neutral-300 bg-neutral-50 px-3 text-sm font-bold outline-none focus:border-black"
                    >
                      <option value="INR">INR</option>
                      <option value="USD">USD</option>
                    </select>
                    <input
                      id="product-price"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      value={productPrice}
                      onChange={(event) => setProductPrice(event.target.value)}
                      disabled={!productsLoaded || isSavingProduct}
                      placeholder="0.00"
                      className={`${fieldClassName} mt-0`}
                    />
                  </div>
                </div>
                <label
                  className={`${fieldLabelClassName} sm:col-span-2`}
                  htmlFor="product-description"
                >
                  Description <span className="font-normal normal-case tracking-normal">(optional)</span>
                  <textarea
                    id="product-description"
                    rows={3}
                    maxLength={500}
                    value={productDescription}
                    onChange={(event) =>
                      setProductDescription(event.target.value)
                    }
                    disabled={!productsLoaded || isSavingProduct}
                    placeholder="A short product description"
                    className={`${fieldClassName} resize-y`}
                  />
                </label>
                <div className="sm:col-span-2">
                  <label
                    className={fieldLabelClassName}
                    htmlFor="product-image-url"
                  >
                    Image URL{" "}
                    <span className="font-normal normal-case tracking-normal">
                      (optional)
                    </span>
                    <input
                      id="product-image-url"
                      type="text"
                      inputMode="url"
                      value={
                        productImageUrl.startsWith("data:")
                          ? ""
                          : productImageUrl
                      }
                      onChange={(event) =>
                        setProductImageUrl(event.target.value)
                      }
                      disabled={!productsLoaded || isSavingProduct}
                      placeholder="https://example.com/product-image.jpg"
                      className={fieldClassName}
                    />
                  </label>
                  <label
                    className={`${fieldLabelClassName} mt-4`}
                    htmlFor="product-image-upload"
                  >
                    Or upload an image{" "}
                    <span className="font-normal normal-case tracking-normal">
                      (JPG, PNG, WebP, GIF · up to 1 MB)
                    </span>
                    <input
                      id="product-image-upload"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={(event) =>
                        void handleProductImageUpload(event)
                      }
                      disabled={!productsLoaded || isSavingProduct}
                      className={`${fieldClassName} file:mr-4 file:border-0 file:bg-black file:px-3 file:py-2 file:text-xs file:font-bold file:uppercase file:text-white`}
                    />
                  </label>
                  {productImageUrl ? (
                    <div className="mt-3 flex items-center gap-3">
                      <Image
                        src={productImageUrl}
                        alt="Product image preview"
                        width={64}
                        height={64}
                        unoptimized
                        className="h-16 w-16 border border-neutral-200 object-cover"
                      />
                      <span className="text-xs font-semibold text-neutral-600">
                        {productImageUrl.startsWith("data:")
                          ? "Uploaded image ready"
                          : "Image URL preview"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setProductImageUrl("")}
                        className="ml-auto text-xs font-bold underline underline-offset-4"
                      >
                        Remove image
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>

              {productError ? (
                <p
                  role="alert"
                  className="mt-4 border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800"
                >
                  {productError}
                </p>
              ) : null}
              {productMessage ? (
                <p role="status" className="mt-4 text-sm font-medium">
                  {productMessage}
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={!productsLoaded || isSavingProduct}
                  className="inline-flex items-center justify-center gap-2 bg-black px-6 py-3 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {editingProductId ? (
                    <Pencil aria-hidden="true" size={16} />
                  ) : (
                    <Plus aria-hidden="true" size={18} />
                  )}
                  {isSavingProduct
                    ? "Saving..."
                    : editingProductId
                      ? "Update Product"
                      : "Add Product"}
                </button>
                {editingProductId ? (
                  <button
                    type="button"
                    onClick={resetProductForm}
                    className="inline-flex items-center gap-2 border border-black px-5 py-3 text-sm font-bold transition hover:bg-neutral-100"
                  >
                    <X aria-hidden="true" size={16} />
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>

            <div className="mt-6">
              {products.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {products.map((product) => (
                    <article
                      key={product.id}
                      className="flex min-w-0 items-start justify-between gap-4 border border-neutral-200 p-4"
                    >
                      <div className="min-w-0">
                        <h3 className="break-words font-bold">{product.name}</h3>
                        <p className="mt-1 text-sm font-semibold">
                          {product.currency} {product.price.toFixed(2)}
                        </p>
                        {product.description ? (
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-5 text-neutral-600">
                            {product.description}
                          </p>
                        ) : null}
                        {product.imageUrl ? (
                          <Image
                            src={product.imageUrl}
                            alt={`${product.name} product`}
                            width={80}
                            height={80}
                            unoptimized
                            className="mt-3 h-20 w-20 border border-neutral-200 object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => editProduct(product)}
                          aria-label={`Edit ${product.name}`}
                          className="border border-black p-2.5 transition hover:bg-neutral-100"
                        >
                          <Pencil aria-hidden="true" size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteProduct(product.id)}
                          disabled={isSavingProduct}
                          aria-label={`Delete ${product.name}`}
                          className="border border-black p-2.5 transition hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Trash2 aria-hidden="true" size={16} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : productsLoaded ? (
                <p className="border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
                  No products yet. Add your first product above.
                </p>
              ) : (
                <p className="py-8 text-center text-sm text-neutral-500">
                  Loading products...
                </p>
              )}
            </div>
          </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
