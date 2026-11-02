"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import QRCode from "react-qr-code";
import { Check, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import type { WalletSelector } from "@near-wallet-selector/core";
import {
  setupModal,
  type WalletSelectorModal,
} from "@near-wallet-selector/modal-ui";
import Sidebar from "../../components/Sidebar";
import {
  findMatchingNativeTransferInBlock,
  getLatestFinalizedBlockHeight,
  type IncomingNativeTransfer,
} from "../../lib/near";
import {
  defaultMerchantSettings,
  type MerchantSettings,
} from "../../lib/merchant-settings";
import {
  type MerchantProduct,
} from "../../lib/merchant-products";
import {
  loadMerchantProducts,
  loadMerchantSettings,
} from "../../lib/merchant-data";
import {
  calculateTokenAmount,
  fetchTokenRates,
  formatTokenAmount,
  type TokenRates,
} from "../../lib/token-rates";
import type { ReceiptItem } from "../../lib/payment-history";
import { getWalletSelector } from "../../lib/near-wallet-selector";
import { signMerchantAuthorization } from "../../lib/merchant-authorization";

type CartLine = {
  productId: string;
  quantity: number;
};

function nearAmountToYocto(amount: string): string | null {
  const match = /^(\d+)(?:\.(\d{1,24}))?$/.exec(amount);
  if (!match) {
    return null;
  }

  const total =
    BigInt(match[1]) * BigInt(10) ** BigInt(24) +
    BigInt((match[2] ?? "").padEnd(24, "0") || "0");

  return total > BigInt(0) ? total.toString() : null;
}

function getCurrentTimeMs(): number {
  return Date.now();
}

function readApiError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : fallback;
}

function getPaymentBaseUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const paymentUrl = new URL(configuredUrl || window.location.origin);
  if (
    !["http:", "https:"].includes(paymentUrl.protocol) ||
    paymentUrl.username ||
    paymentUrl.password
  ) {
    throw new Error(
      "Set NEXT_PUBLIC_APP_URL to a valid customer-accessible HTTP or HTTPS origin.",
    );
  }
  return paymentUrl.origin;
}

function isLoopbackPaymentUrl(paymentUrl: string): boolean {
  const hostname = new URL(paymentUrl).hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function convertFiatAmount(
  amount: number,
  fromCurrency: "INR" | "USD",
  toCurrency: "INR" | "USD",
  rates: TokenRates | null,
): number | null {
  if (fromCurrency === toCurrency) {
    return amount;
  }
  if (!rates) {
    return null;
  }
  return (
    amount *
    (rates.prices.USDC[toCurrency] / rates.prices.USDC[fromCurrency])
  );
}

function formatFiatAmount(amount: number, currency: "INR" | "USD"): string {
  return `${currency === "INR" ? "₹" : "$"}${amount.toFixed(2)}`;
}

type ActiveInvoice = {
  fiatAmount: string;
  fiatCurrency: "INR" | "USD";
  usdcAmount: string;
  nearAmount: string;
  items: ReceiptItem[];
  amountYocto: string;
  merchantAccountId: string;
  storeName: string;
  qrPayload: string;
  openedAtMs: number;
  startAfterBlockHeight: number;
};

export default function POSPage() {
  const [fiatAmount, setFiatAmount] = useState("");
  const [fiatCurrency, setFiatCurrency] = useState<"INR" | "USD">("INR");
  const [merchantSettings, setMerchantSettings] =
    useState<MerchantSettings>(defaultMerchantSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [merchantSettingsError, setMerchantSettingsError] = useState<
    string | null
  >(null);
  const [products, setProducts] = useState<MerchantProduct[]>([]);
  const [productsLoaded, setProductsLoaded] = useState(false);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [tokenRates, setTokenRates] = useState<TokenRates | null>(null);
  const [ratesError, setRatesError] = useState<string | null>(null);
  const [walletSelector, setWalletSelector] = useState<WalletSelector | null>(
    null,
  );
  const [walletModal, setWalletModal] = useState<WalletSelectorModal | null>(
    null,
  );
  const [connectedAccountId, setConnectedAccountId] = useState<string | null>(
    null,
  );
  const [walletInitializing, setWalletInitializing] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPreparingInvoice, setIsPreparingInvoice] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<"pending" | "success">(
    "pending",
  );
  const [transactionHash, setTransactionHash] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [historySaveError, setHistorySaveError] = useState<string | null>(null);
  const [receiptGenerated, setReceiptGenerated] = useState(false);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [paymentLinkMessage, setPaymentLinkMessage] = useState("");
  const [activeInvoice, setActiveInvoice] = useState<ActiveInvoice | null>(
    null,
  );
  const completedTransactionHashes = useRef(new Set<string>());

  const merchantAccountId = merchantSettings.merchantAccountId;
  const hasMerchantAccess =
    settingsLoaded &&
    !merchantSettingsError &&
    connectedAccountId === merchantAccountId;

  const persistObservedTransaction = useCallback(async (
    invoice: ActiveInvoice,
    transfer: IncomingNativeTransfer,
  ) => {
    if (
      !walletSelector ||
      connectedAccountId !== invoice.merchantAccountId
    ) {
      throw new Error("Connect the configured merchant wallet to save this sale.");
    }

    const authorization = await signMerchantAuthorization(
      walletSelector,
      invoice.merchantAccountId,
      "merchant-transaction",
    );
    const response = await fetch("/api/merchant-transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...authorization,
        transactionHash: transfer.transactionHash,
        customerAddress: transfer.senderAccountId,
        amount: invoice.nearAmount,
        fiatAmount: invoice.fiatAmount,
        fiatCurrency: invoice.fiatCurrency,
        usdcAmount: invoice.usdcAmount,
        storeName: invoice.storeName,
        items: invoice.items,
      }),
    });
    const result: unknown = await response.json();
    if (!response.ok) {
      throw new Error(
        readApiError(result, "The verified sale could not be saved to Supabase."),
      );
    }
    if (
      typeof result !== "object" ||
      result === null ||
      !("record" in result) ||
      typeof result.record !== "object" ||
      result.record === null ||
      !("invoiceNumber" in result.record) ||
      typeof result.record.invoiceNumber !== "string"
    ) {
      throw new Error("The saved sale did not return an invoice number.");
    }
    return result.record.invoiceNumber;
  }, [connectedAccountId, walletSelector]);

  useEffect(() => {
    let active = true;

    async function loadMerchantPreferences() {
      await Promise.resolve();
      let accountId = defaultMerchantSettings.merchantAccountId;
      try {
        const savedSettings = await loadMerchantSettings(accountId);
        accountId = savedSettings.merchantAccountId;
        if (active) {
          setMerchantSettings(savedSettings);
          setFiatCurrency(savedSettings.fiatCurrency);
          setMerchantSettingsError(null);
        }
      } catch (error) {
        console.error("Unable to load merchant settings for the POS.", error);
        if (active) {
          setMerchantSettingsError(
            error instanceof Error
              ? error.message
              : "Merchant settings could not be loaded from Supabase.",
          );
        }
      }

      try {
        const savedProducts = await loadMerchantProducts(accountId);
        if (active) {
          setProducts(savedProducts);
          setProductsError(null);
        }
      } catch (error) {
        console.error("Unable to load the shared merchant product catalog.", error);
        if (active) {
          setProductsError(
            error instanceof Error
              ? error.message
              : "The shared product catalog could not be loaded from Supabase.",
          );
        }
      }
      if (active) {
        setProductsLoaded(true);
        setSettingsLoaded(true);
      }
    }

    void loadMerchantPreferences();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!connectedAccountId || connectedAccountId === merchantSettings.merchantAccountId) {
      return;
    }

    let active = true;
    setSettingsLoaded(false);
    setProductsLoaded(false);
    setMerchantSettingsError(null);
    setProductsError(null);

    Promise.all([
      loadMerchantSettings(connectedAccountId),
      loadMerchantProducts(connectedAccountId),
    ])
      .then(([savedSettings, savedProducts]) => {
        if (!active) return;
        setMerchantSettings(savedSettings);
        setFiatCurrency(savedSettings.fiatCurrency);
        setProducts(savedProducts);
      })
      .catch((error: unknown) => {
        console.error("Unable to load data for the connected merchant.", error);
        if (active) {
          const message =
            error instanceof Error
              ? error.message
              : "Merchant data could not be loaded from Supabase.";
          setMerchantSettingsError(message);
          setProductsError(message);
        }
      })
      .finally(() => {
        if (active) {
          setSettingsLoaded(true);
          setProductsLoaded(true);
        }
      });

    return () => {
      active = false;
    };
  }, [connectedAccountId, merchantSettings.merchantAccountId]);

  const cartRows = cart
    .map((line) => ({
      ...line,
      product: products.find((product) => product.id === line.productId),
    }))
    .filter(
      (
        line,
      ): line is CartLine & {
        product: MerchantProduct;
      } => Boolean(line.product),
    );
  const cartUnitPrices = cartRows.map((line) =>
    convertFiatAmount(
      line.product.price,
      line.product.currency,
      fiatCurrency,
      tokenRates,
    ),
  );
  const hasCartConversionError = cartUnitPrices.some(
    (price) => price === null,
  );
  const cartSubtotalInSelectedCurrency = cartRows.reduce(
    (total, line, index) =>
      total + (cartUnitPrices[index] ?? 0) * line.quantity,
    0,
  );
  const quickAmount = Number(fiatAmount);
  const validQuickAmount =
    Number.isFinite(quickAmount) && quickAmount > 0 ? quickAmount : 0;
  const unroundedFiatTotal =
    cartSubtotalInSelectedCurrency + validQuickAmount;
  const fiatTotal =
    !hasCartConversionError &&
    Number.isFinite(unroundedFiatTotal) &&
    unroundedFiatTotal > 0
      ? Math.round((unroundedFiatTotal + Number.EPSILON) * 100) / 100
      : 0;
  const fiatTotalFormatted = hasCartConversionError
    ? "—"
    : fiatTotal > 0
      ? fiatTotal.toFixed(2)
      : "0.00";
  const usdcAmount =
    tokenRates && fiatTotal > 0
      ? formatTokenAmount(
          calculateTokenAmount(fiatTotal, fiatCurrency, "USDC", tokenRates),
        )
      : "0.00";
  const nearAmount =
    tokenRates && fiatTotal > 0
      ? formatTokenAmount(
          calculateTokenAmount(fiatTotal, fiatCurrency, "NEAR", tokenRates),
        )
      : "0.000000";
  const expectedPaymentAmountYocto = nearAmountToYocto(nearAmount);

  useEffect(() => {
    let active = true;
    const updateRates = async () => {
      try {
        const nextRates = await fetchTokenRates();
        if (active) {
          setTokenRates(nextRates);
          setRatesError(nextRates.stale ? nextRates.warning ?? "Showing a cached quote; waiting for a fresh exchange rate." : null);
        }
      } catch (error) {
        console.error("Unable to load current NEAR and USDC rates.", error);
        if (active) {
          setRatesError(
            error instanceof Error
              ? error.message
              : "Current exchange rates are unavailable.",
          );
        }
      }
    };

    void updateRates();
    const intervalId = setInterval(() => void updateRates(), 60_000);
    return () => {
      active = false;
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, []);

  useEffect(() => {
    if (!settingsLoaded || merchantSettingsError) {
      return;
    }

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
            description: `Connect ${merchantAccountId} to access the merchant POS.`,
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
        setWalletInitializing(false);
      })
      .catch((error: unknown) => {
        console.error("Unable to initialize the merchant NEAR wallet.", error);
        if (active) {
          setWalletError(
            "The NEAR testnet wallet selector could not be initialized.",
          );
          setWalletInitializing(false);
        }
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [merchantAccountId, merchantSettingsError, settingsLoaded]);

  useEffect(() => {
    if (
      !hasMerchantAccess ||
      !isModalOpen ||
      !activeInvoice ||
      paymentStatus === "success"
    ) {
      return;
    }

    let active = true;
    let isPolling = false;
    let nextBlockHeight = activeInvoice.startAfterBlockHeight + 1;
    const invoice = activeInvoice;
    const intervalId = setInterval(() => {
      void pollForPayment();
    }, 3000);

    async function pollForPayment() {
      if (!active || isPolling) {
        return;
      }

      isPolling = true;
      let statusCheckError: string | null = null;
      try {
        try {
          const statusResponse = await fetch(
            `/api/payment-status?${new URLSearchParams({
              merchantId: invoice.merchantAccountId,
              amount: invoice.nearAmount,
              openedAt: String(invoice.openedAtMs),
            })}`,
            { cache: "no-store" },
          );
          const statusResult: unknown = await statusResponse.json();
          if (!statusResponse.ok) {
            throw new Error(
              readApiError(
                statusResult,
                "Unable to check the saved payment status.",
              ),
            );
          }
          if (
            typeof statusResult !== "object" ||
            statusResult === null ||
            !("transactionHash" in statusResult) ||
            (statusResult.transactionHash !== null &&
              typeof statusResult.transactionHash !== "string") ||
            !("invoiceNumber" in statusResult) ||
            (statusResult.invoiceNumber !== null &&
              typeof statusResult.invoiceNumber !== "string") ||
            (statusResult.transactionHash !== null &&
              typeof statusResult.invoiceNumber !== "string")
          ) {
            throw new Error("The payment status response has an invalid format.");
          }

          if (statusResult.transactionHash) {
            setTransactionHash(statusResult.transactionHash);
            setInvoiceNumber(statusResult.invoiceNumber ?? "");
            setHistorySaveError(null);
            setReceiptGenerated(true);
            setPollingError(null);
            setCart([]);
            setFiatAmount("");
            setPaymentStatus("success");
            clearInterval(intervalId);
            return;
          }
        } catch (error) {
          console.error("Unable to check the saved invoice payment status.", error);
          statusCheckError =
            error instanceof Error
              ? `Instant payment updates are temporarily unavailable: ${error.message}`
              : "Instant payment updates are temporarily unavailable.";
        }

        const latestBlockHeight = await getLatestFinalizedBlockHeight();

        let scannedBlocks = 0;
        while (
          active &&
          nextBlockHeight <= latestBlockHeight &&
          scannedBlocks < 12
        ) {
          const transfer = await findMatchingNativeTransferInBlock({
            blockHeight: nextBlockHeight,
            receiverId: invoice.merchantAccountId,
            amountYocto: invoice.amountYocto,
            openedAtMs: invoice.openedAtMs,
          });
          nextBlockHeight += 1;
          scannedBlocks += 1;

          if (
            transfer &&
            !completedTransactionHashes.current.has(transfer.transactionHash)
          ) {
            completedTransactionHashes.current.add(transfer.transactionHash);
            let savedInvoiceNumber = "";
            try {
              savedInvoiceNumber = await persistObservedTransaction(invoice, transfer);
              setHistorySaveError(null);
              setReceiptGenerated(true);
            } catch (error) {
              console.error(
                "Unable to save the verified payment to Supabase.",
                error,
              );
              setHistorySaveError(
                error instanceof Error
                  ? `Payment succeeded on NEAR, but Supabase history was not updated: ${error.message}`
                  : "Payment succeeded on NEAR, but Supabase history could not be updated.",
              );
            }

            setTransactionHash(transfer.transactionHash);
            setInvoiceNumber(savedInvoiceNumber);
            setPollingError(null);
            setCart([]);
            setFiatAmount("");
            setPaymentStatus("success");
            clearInterval(intervalId);
            return;
          }
        }

        setPollingError(statusCheckError);
      } catch (error) {
        console.error("Unable to poll NEAR testnet for this payment.", error);
        setPollingError(
          error instanceof Error
            ? `Payment monitoring will retry: ${error.message}`
            : "Payment monitoring will retry after a NEAR RPC error.",
        );
      } finally {
        isPolling = false;
      }
    }

    void pollForPayment();

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [
    activeInvoice,
    connectedAccountId,
    hasMerchantAccess,
    isModalOpen,
    paymentStatus,
    persistObservedTransaction,
    walletSelector,
  ]);

  function handleStartNewSale() {
    setTransactionHash("");
    setInvoiceNumber("");
    setActiveInvoice(null);
    setPollingError(null);
    setHistorySaveError(null);
    setReceiptGenerated(false);
    setFiatAmount("");
    setCart([]);
    setPaymentStatus("pending");
    setIsModalOpen(false);
    setPaymentLinkMessage("");
  }

  async function copyPaymentLink() {
    if (!activeInvoice) {
      return;
    }

    try {
      await navigator.clipboard.writeText(activeInvoice.qrPayload);
      setPaymentLinkMessage("Payment link copied.");
    } catch (error) {
      console.error("Unable to copy the customer payment link.", error);
      setPaymentLinkMessage(
        "Could not copy the link. Open the payment link directly below.",
      );
    }
  }

  function addProductToCart(product: MerchantProduct) {
    setCart((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) {
        return current.map((line) =>
          line.productId === product.id
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [...current, { productId: product.id, quantity: 1 }];
    });
  }

  function updateCartQuantity(productId: string, change: number) {
    setCart((current) =>
      current
        .map((line) =>
          line.productId === productId
            ? { ...line, quantity: line.quantity + change }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  async function handleSignOut() {
    if (!walletSelector) {
      setWalletError("Wallet selector is not available. Reload and try again.");
      return;
    }

    setIsSigningOut(true);
    setWalletError(null);
    try {
      const wallet = await walletSelector.wallet();
      await wallet.signOut();
      setConnectedAccountId(null);
      setIsModalOpen(false);
      setActiveInvoice(null);
    } catch (error) {
      console.error("Unable to sign out of the merchant NEAR wallet.", error);
      setWalletError(
        error instanceof Error
          ? error.message
          : "Unable to sign out of the merchant NEAR wallet.",
      );
    } finally {
      setIsSigningOut(false);
    }
  }

  async function handleGenerateQr() {
    if (
      !hasMerchantAccess ||
      !tokenRates ||
      ratesError ||
      !expectedPaymentAmountYocto
    ) {
      return;
    }

    setIsPreparingInvoice(true);
    setPollingError(null);
    try {
      const startAfterBlockHeight = await getLatestFinalizedBlockHeight();
      const openedAtMs = getCurrentTimeMs();
      const items: ReceiptItem[] = cartRows.map(({ product, quantity }) => ({
        name: product.name,
        quantity,
        unitPriceInr:
          convertFiatAmount(
            product.price,
            product.currency,
            "INR",
            tokenRates,
          ) ?? 0,
        unitPrice:
          convertFiatAmount(
            product.price,
            product.currency,
            fiatCurrency,
            tokenRates,
          ) ?? 0,
        fiatCurrency,
      }));
      const qrPayload = `${getPaymentBaseUrl()}/customer?${new URLSearchParams({
        amount: nearAmount,
        nearAmount,
        usdcAmount,
        merchant: merchantAccountId,
        storeName: merchantSettings.storeName,
        fiatAmount: fiatTotalFormatted,
        fiatCurrency,
        acceptedTokens: JSON.stringify(merchantSettings.acceptedTokens),
        preferredToken: merchantSettings.preferredToken,
        items: JSON.stringify(items),
      }).toString()}`;

      setActiveInvoice({
        fiatAmount: fiatTotalFormatted,
        fiatCurrency,
        usdcAmount,
        nearAmount,
        items,
        amountYocto: expectedPaymentAmountYocto,
        merchantAccountId,
        storeName: merchantSettings.storeName,
        qrPayload,
        openedAtMs,
        startAfterBlockHeight,
      });
      setTransactionHash("");
      setInvoiceNumber("");
      setHistorySaveError(null);
      setReceiptGenerated(false);
      setPaymentLinkMessage("");
      setPaymentStatus("pending");
      setIsModalOpen(true);
    } catch (error) {
      console.error("Unable to prepare a NEAR testnet payment invoice.", error);
      setPollingError(
        error instanceof Error
          ? `Unable to open the payment QR: ${error.message}`
          : "Unable to open the payment QR because NEAR testnet could not be reached.",
      );
    } finally {
      setIsPreparingInvoice(false);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-[#f4f4f1] font-sans text-black lg:flex-row">
      {!hasMerchantAccess ? (
        <main className="flex min-h-screen items-center justify-center px-6 py-12">
          <section className="w-full max-w-lg border border-black bg-white p-8 shadow-[5px_5px_0_0_#111] sm:p-12">
            <p className="text-xs font-bold uppercase tracking-[0.3em]">
              NEARPAY / MERCHANT ACCESS
            </p>
            <h1 className="mt-8 text-4xl font-black tracking-tight">
              MERCHANT POS
            </h1>
            <p className="mt-5 text-sm leading-6 text-neutral-600">
              Connect the merchant testnet account{" "}
              <span className="font-mono font-bold">{merchantAccountId}</span>{" "}
              to open the POS dashboard.
            </p>
            {merchantSettingsError ? (
              <div className="mt-5 text-sm">
                <p role="alert" className="text-red-700">
                  {merchantSettingsError}
                </p>
                <a
                  href="/pos/settings"
                  className="mt-3 inline-block font-bold underline underline-offset-4"
                >
                  Open Merchant Settings
                </a>
              </div>
            ) : null}
            {walletInitializing ? (
              <p className="mt-8 text-sm font-semibold">Loading wallet options...</p>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (walletModal) {
                    setWalletError(null);
                    walletModal.show();
                  }
                }}
                disabled={!walletSelector || !walletModal}
                className="mt-8 w-full bg-black px-6 py-4 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {connectedAccountId
                  ? "Choose Merchant Wallet"
                  : "Sign In as Merchant"}
              </button>
            )}
            {connectedAccountId ? (
              <div role="alert" className="mt-5 border-l-2 border-black pl-3 text-sm">
                <p>
                  Connected account{" "}
                  <span className="break-all font-mono font-semibold">
                    {connectedAccountId}
                  </span>{" "}
                  is not authorized for this merchant POS.
                </p>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={isSigningOut}
                  className="mt-3 font-bold underline underline-offset-4 disabled:opacity-50"
                >
                  {isSigningOut ? "Signing out..." : "Sign Out Current Wallet"}
                </button>
              </div>
            ) : null}
            {walletError ? (
              <p role="alert" className="mt-5 text-sm text-red-700">
                {walletError}
              </p>
            ) : null}
          </section>
        </main>
      ) : (
        <>
          <Sidebar />

          <main className="min-w-0 flex-1 bg-[#f4f4f1] p-4 sm:p-6 lg:p-8">
            <header className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
                  {merchantSettings.storeName} / TESTNET TERMINAL
                </p>
                <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
                  New sale
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="border border-neutral-300 bg-white px-4 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    Merchant wallet
                  </p>
                  <p className="mt-1 flex items-center gap-2 font-mono text-xs font-semibold">
                    <span className="h-2 w-2 rounded-full bg-green-600" />
                    {connectedAccountId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={isSigningOut}
                  className="border border-black bg-white px-4 py-3 text-xs font-bold uppercase tracking-widest transition hover:bg-black hover:text-white disabled:opacity-50"
                >
                  {isSigningOut ? "Signing out..." : "Sign out"}
                </button>
              </div>
            </header>

            {walletError ? (
              <p role="alert" className="mb-5 border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                {walletError}
              </p>
            ) : null}

            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.85fr)]">
              <div className="space-y-5">
                <section
                  aria-labelledby="catalog-heading"
                  className="border border-neutral-200 bg-white p-5 sm:p-6"
                >
                  <div className="mb-5 flex items-end justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-neutral-500">
                        Browse items
                      </p>
                      <h2 id="catalog-heading" className="mt-1 text-xl font-black">
                        Product catalog
                      </h2>
                    </div>
                    <span className="text-xs font-semibold text-neutral-500">
                      {products.length}{" "}
                      {products.length === 1 ? "item" : "items"}
                    </span>
                  </div>
                  {productsError ? (
                    <p role="alert" className="mb-4 border-l-2 border-red-700 pl-3 text-sm text-red-700">
                      {productsError}
                    </p>
                  ) : null}
                  {!productsLoaded ? (
                    <p className="py-8 text-sm text-neutral-500">Loading catalog...</p>
                  ) : products.length > 0 ? (
                    <div className="grid max-h-[34rem] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 2xl:grid-cols-4">
                      {products.map((product) => (
                        <button
                          key={product.id}
                          type="button"
                          onClick={() => addProductToCart(product)}
                          className="group flex min-h-44 flex-col border border-neutral-200 bg-white p-3 text-left transition hover:-translate-y-0.5 hover:border-black hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black"
                        >
                          {product.imageUrl ? (
                            <Image
                              src={product.imageUrl}
                              alt=""
                              width={240}
                              height={140}
                              unoptimized
                              loading="lazy"
                              className="h-24 w-full border border-neutral-100 object-cover"
                            />
                          ) : (
                            <span className="flex h-24 w-full items-center justify-center bg-neutral-100">
                              <ShoppingBag
                                aria-hidden="true"
                                size={26}
                                className="text-neutral-400"
                              />
                            </span>
                          )}
                          <span className="mt-3 line-clamp-1 text-sm font-bold">
                            {product.name}
                          </span>
                          <span className="mt-1 line-clamp-1 text-xs text-neutral-500">
                            {product.description || "Tap to add to sale"}
                          </span>
                          <span className="mt-auto flex w-full items-center justify-between pt-3">
                            <span className="font-black">
                              {formatFiatAmount(product.price, product.currency)}
                            </span>
                            <span className="flex h-7 w-7 items-center justify-center bg-black text-white transition group-hover:bg-neutral-700">
                              <Plus aria-hidden="true" size={16} />
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="border border-dashed border-neutral-300 px-5 py-10 text-center">
                      <ShoppingBag className="mx-auto text-neutral-400" size={28} />
                      <p className="mt-3 text-sm font-semibold">Your catalog is empty.</p>
                      <p className="mt-1 text-xs text-neutral-500">
                        Products can be configured from merchant settings.
                      </p>
                    </div>
                  )}
                </section>

                <section
                  aria-labelledby="cart-heading"
                  className="border border-neutral-200 bg-white p-5 sm:p-6"
                >
                  <div className="flex items-center justify-between border-b border-neutral-200 pb-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-neutral-500">
                        Current order
                      </p>
                      <h2 id="cart-heading" className="mt-1 text-xl font-black">
                        Sale items
                      </h2>
                    </div>
                    <span className="bg-neutral-100 px-3 py-2 text-xs font-bold">
                      {cartRows.reduce((count, row) => count + row.quantity, 0)}{" "}
                      {cartRows.reduce((count, row) => count + row.quantity, 0) === 1
                        ? "item"
                        : "items"}
                    </span>
                  </div>
                  {cartRows.length > 0 ? (
                    <ul className="divide-y divide-neutral-200">
                      {cartRows.map(({ product, quantity }, index) => {
                        const selectedUnitPrice = cartUnitPrices[index];
                        return (
                        <li
                          key={product.id}
                          className="flex items-center justify-between gap-3 py-4"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-bold">{product.name}</p>
                            <p className="mt-1 text-xs text-neutral-500">
                              {selectedUnitPrice === null
                                ? `${formatFiatAmount(product.price, product.currency)} each`
                                : `${formatFiatAmount(selectedUnitPrice, fiatCurrency)} each`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => updateCartQuantity(product.id, -1)}
                              aria-label={`Decrease ${product.name} quantity`}
                              className="flex h-8 w-8 items-center justify-center border border-neutral-300 transition hover:border-black"
                            >
                              <Minus aria-hidden="true" size={14} />
                            </button>
                            <span className="min-w-6 text-center text-sm font-bold">
                              {quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateCartQuantity(product.id, 1)}
                              aria-label={`Increase ${product.name} quantity`}
                              className="flex h-8 w-8 items-center justify-center border border-neutral-300 transition hover:border-black"
                            >
                              <Plus aria-hidden="true" size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setCart((current) =>
                                  current.filter((line) => line.productId !== product.id),
                                )
                              }
                              aria-label={`Remove ${product.name} from sale`}
                              className="ml-1 p-2 text-neutral-500 transition hover:text-red-700"
                            >
                              <Trash2 aria-hidden="true" size={16} />
                            </button>
                          </div>
                          <span className="w-24 text-right text-sm font-bold">
                            {selectedUnitPrice === null
                              ? "—"
                              : formatFiatAmount(
                                  selectedUnitPrice * quantity,
                                  fiatCurrency,
                                )}
                          </span>
                        </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="py-8 text-center text-sm text-neutral-500">
                      No items yet. Choose a product above or enter a custom amount.
                    </p>
                  )}
                  {cartRows.length > 0 ? (
                    <div className="flex justify-between border-t border-neutral-200 pt-4 text-sm">
                      <span className="text-neutral-500">Items subtotal</span>
                      <span className="font-bold">
                        {hasCartConversionError
                          ? "Rate unavailable"
                          : formatFiatAmount(
                              cartSubtotalInSelectedCurrency,
                              fiatCurrency,
                            )}
                      </span>
                    </div>
                  ) : null}
                </section>
              </div>

              <aside className="border border-black bg-white p-5 sm:p-6 xl:sticky xl:top-6">
                <div className="flex items-start justify-between gap-3 border-b border-neutral-200 pb-5">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-neutral-500">
                      Checkout
                    </p>
                    <h2 className="mt-1 text-xl font-black">Payment summary</h2>
                  </div>
                  <span className="border border-neutral-300 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-700">
                    Testnet
                  </span>
                </div>

                <label
                  htmlFor="fiat-amount"
                  className="mt-5 block text-xs font-bold uppercase tracking-[0.16em] text-neutral-600"
                >
                  Quick amount
                </label>
                <div className="mt-2 flex border border-neutral-300 focus-within:border-black">
                  <select
                    aria-label="Fiat currency"
                    value={fiatCurrency}
                    onChange={(event) =>
                      setFiatCurrency(event.target.value === "USD" ? "USD" : "INR")
                    }
                    className="border-r border-neutral-300 bg-neutral-50 px-3 text-sm font-bold outline-none"
                  >
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                  </select>
                  <input
                    id="fiat-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={fiatAmount}
                    onChange={(event) => setFiatAmount(event.target.value)}
                    placeholder="0.00"
                    className="min-w-0 flex-1 px-4 py-4 text-right text-3xl font-black outline-none placeholder:text-neutral-300"
                  />
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  Optional extra charge; product prices use live exchange rates.
                </p>

                <div className="mt-6 border border-black bg-black p-5 text-white">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-300">
                    Total due
                  </p>
                  <p className="mt-2 text-4xl font-black tracking-tight">
                    {fiatCurrency === "INR" ? "₹" : "$"}
                    {fiatTotalFormatted}
                  </p>
                  <p className="mt-2 text-xs text-neutral-300">
                    {cartRows.reduce((count, row) => count + row.quantity, 0)}{" "}
                    cart items · {fiatCurrency}
                  </p>
                </div>

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="border border-neutral-200 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                      Payable on testnet
                    </p>
                    <p className="mt-2 break-all text-lg font-black">
                      {nearAmount} <span className="text-xs">NEAR</span>
                    </p>
                  </div>
                  <div className="border border-neutral-200 p-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-800">
                      USDC equivalent · preview
                    </p>
                    <p className="mt-2 break-all text-xl font-black text-emerald-950">
                      {usdcAmount} <span className="text-xs">USDC</span>
                    </p>
                  </div>
                </div>
                {tokenRates ? (
                  <div className="mt-3 space-y-1 text-xs leading-5 text-neutral-600">
                    <p>
                      1 NEAR ≈ {fiatCurrency}{" "}
                      {tokenRates.prices.NEAR[fiatCurrency].toLocaleString(
                        undefined,
                        { maximumFractionDigits: 2 },
                      )}
                    </p>
                    <p className="font-semibold text-emerald-900">
                      1 USDC ≈ {fiatCurrency}{" "}
                      {tokenRates.prices.USDC[fiatCurrency].toLocaleString(
                        undefined,
                        { maximumFractionDigits: 4 },
                      )}{" "}
                      · {fiatCurrency} 1 ≈{" "}
                      {(
                        1 / tokenRates.prices.USDC[fiatCurrency]
                      ).toLocaleString(undefined, {
                        maximumFractionDigits: 6,
                      })}{" "}
                      USDC
                    </p>
                    <p className="text-neutral-500">
                      Updated {new Date(tokenRates.fetchedAt).toLocaleTimeString()}
                    </p>
                  </div>
                ) : null}
                {ratesError ? (
                  <p role="alert" className="mt-3 border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800">
                    {tokenRates?.stale
                      ? `Cached quote is not usable for checkout: ${ratesError}`
                      : `Live rates unavailable: ${ratesError}`}
                  </p>
                ) : null}

                <button
                  type="button"
                  disabled={
                    !tokenRates ||
                    Boolean(ratesError) ||
                    hasCartConversionError ||
                    !expectedPaymentAmountYocto ||
                    isPreparingInvoice
                  }
                  onClick={() => void handleGenerateQr()}
                  className="mt-5 flex w-full items-center justify-center gap-3 bg-black px-5 py-4 text-sm font-black uppercase tracking-[0.13em] text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                >
                  {isPreparingInvoice
                    ? "Preparing QR..."
                    : "Generate payment QR"}
                  {!isPreparingInvoice ? <Plus aria-hidden="true" size={18} /> : null}
                </button>
                <p className="mt-3 text-center text-[11px] leading-5 text-neutral-500">
                  Testnet settles in native NEAR. USDC is an informational quote only.
                </p>
                {pollingError && !isModalOpen ? (
                  <p role="alert" className="mt-3 text-sm text-red-700">
                    {pollingError}
                  </p>
                ) : null}
              </aside>
            </div>
          </main>
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="qr-title"
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col items-center gap-4 overflow-y-auto rounded-3xl bg-white p-5 text-center shadow-2xl sm:p-6"
          >
            <h2 id="qr-title" className="text-xl font-black">
              {paymentStatus === "success" ? "Payment Complete" : "Scan to Pay"}
            </h2>
            {paymentStatus === "success" ? (
              <div
                aria-live="polite"
                className="flex w-full flex-col items-center gap-3"
              >
                <Check
                  aria-hidden="true"
                  className="h-14 w-14 text-green-600"
                  strokeWidth={3}
                />
                <p className="text-xl font-black text-green-700">
                  Payment successfully paid
                </p>
                <p className="text-sm font-semibold text-neutral-600">
                  {activeInvoice?.fiatCurrency === "INR" ? "₹" : "$"}
                  {activeInvoice?.fiatAmount} · {activeInvoice?.nearAmount} NEAR
                </p>
                {invoiceNumber ? (
                  <p className="border border-neutral-300 px-3 py-2 font-mono text-sm font-bold">
                    Invoice No: {invoiceNumber}
                  </p>
                ) : null}
                {receiptGenerated ? (
                  <p className="border border-green-200 bg-green-50 px-3 py-2 text-sm font-bold text-green-800">
                    Invoice generated
                  </p>
                ) : (
                  <p className="border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
                    Payment confirmed; invoice is not available yet.
                  </p>
                )}
                <p className="max-w-full break-all font-mono text-xs text-gray-600">
                  Transaction: {transactionHash}
                </p>
                <a
                  href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(transactionHash)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-bold underline underline-offset-4"
                >
                  View on NEAR Explorer
                </a>
                {receiptGenerated ? (
                  <a
                    href={`/pos/receipt/${encodeURIComponent(transactionHash)}`}
                    className="text-sm font-bold underline underline-offset-4"
                  >
                    View / Print Invoice
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={handleStartNewSale}
                  className="mt-2 w-full rounded-xl bg-black px-5 py-3 font-bold text-white transition-colors hover:bg-gray-800"
                >
                  Start New Sale
                </button>
              </div>
            ) : (
              <>
                <div className="rounded-xl border-2 border-gray-100 bg-white p-2 shadow-inner">
                  <QRCode
                    value={activeInvoice?.qrPayload ?? ""}
                    size={208}
                    level="L"
                  />
                </div>
                <p className="text-center text-sm font-medium text-gray-600">
                  Invoice: {activeInvoice?.nearAmount} NEAR to{" "}
                  {activeInvoice?.merchantAccountId}. The USDC quote (
                  {activeInvoice?.usdcAmount}) is informational only; NEAR is
                  the only token transferred on testnet.
                </p>
                {activeInvoice ? (
                  <div className="w-full space-y-2">
                    <a
                      href={activeInvoice.qrPayload}
                      target="_blank"
                      rel="noreferrer"
                      className="block break-all text-center text-sm font-bold underline underline-offset-4"
                    >
                      Open customer payment link
                    </a>
                    <button
                      type="button"
                      onClick={() => void copyPaymentLink()}
                      className="w-full border border-black px-4 py-3 text-sm font-bold transition hover:bg-black hover:text-white"
                    >
                      Copy payment link
                    </button>
                    {paymentLinkMessage ? (
                      <p role="status" className="text-center text-xs text-neutral-600">
                        {paymentLinkMessage}
                      </p>
                    ) : null}
                    {isLoopbackPaymentUrl(activeInvoice.qrPayload) ? (
                      <p
                        role="alert"
                        className="border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900"
                      >
                        This QR uses a local-only address and will not open on
                        another phone. Set NEXT_PUBLIC_APP_URL to your
                        customer-accessible website or computer&apos;s LAN URL,
                        then restart the app and create a new QR.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {pollingError && (
                  <p
                    role="alert"
                    className="w-full text-left text-sm text-red-700"
                  >
                    {pollingError}
                  </p>
                )}
                <p className="text-sm font-semibold text-neutral-500">
                  Waiting for payment confirmation. Checking every 3 seconds.
                </p>
              </>
            )}
            {historySaveError && (
              <p role="alert" className="text-sm font-medium text-red-700">
                {historySaveError}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setIsModalOpen(false);
              }}
              className="w-full rounded-xl bg-gray-100 py-3 font-bold text-black transition-colors hover:bg-gray-200"
            >
              Close
            </button>
          </section>
        </div>
      )}
        </>
      )}
    </div>
  );
}
