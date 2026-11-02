"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import Sidebar from "../../../components/Sidebar";
import {
  isPaymentRecord,
  type PaymentRecord,
} from "../../../lib/payment-history";
import {
  defaultMerchantSettings,
} from "../../../lib/merchant-settings";
import { loadMerchantSettings } from "../../../lib/merchant-data";
import { signMerchantAuthorization } from "../../../lib/merchant-authorization";
import { getWalletSelector } from "../../../lib/near-wallet-selector";

type DailySales = {
  day: string;
  fiatCurrency: "INR" | "USD";
  revenue: number;
  count: number;
};

function getTokenAmount(record: PaymentRecord, token: "NEAR" | "USDC"): number {
  if ((record.token ?? "NEAR") !== token) {
    return 0;
  }
  return Number(record.tokenAmount ?? 0) || 0;
}

export default function AnalyticsPage() {
  const [transactions, setTransactions] = useState<PaymentRecord[]>([]);
  const [merchantAccountId, setMerchantAccountId] = useState(
    defaultMerchantSettings.merchantAccountId,
  );
  const [connectedAccountId, setConnectedAccountId] = useState<string | null>(null);
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [walletModal, setWalletModal] = useState<WalletSelectorModal | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const syncAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    async function initializeAnalytics() {
      const [settingsResult, selectorResult] = await Promise.allSettled([
        loadMerchantSettings(defaultMerchantSettings.merchantAccountId),
        getWalletSelector(),
      ]);
      if (!active) return;

      if (settingsResult.status === "fulfilled") {
        setMerchantAccountId(settingsResult.value.merchantAccountId);
      } else {
        console.error("Unable to load analytics merchant settings.", settingsResult.reason);
        setError(
          settingsResult.reason instanceof Error
            ? settingsResult.reason.message
            : "Merchant settings could not be loaded from Supabase.",
        );
      }

      if (selectorResult.status === "fulfilled") {
        const walletSelector = selectorResult.value;
        setSelector(walletSelector);
        setWalletModal(
          setupModal(walletSelector, {
            theme: "light",
            description: "Authorize access to this merchant's sales analytics.",
          }),
        );
        const syncAccount = () => {
          const accounts = walletSelector.store.getState().accounts;
          setConnectedAccountId(
            accounts.find((account) => account.active)?.accountId ??
              accounts[0]?.accountId ??
              null,
          );
        };
        syncAccount();
        const subscription =
          walletSelector.store.observable.subscribe(syncAccount);
        unsubscribe = () => subscription.unsubscribe();
      } else {
        console.error("Unable to initialize the analytics merchant wallet.", selectorResult.reason);
        setError("NEAR wallet authorization could not be initialized.");
      }
      setIsLoading(false);
    }
    void initializeAnalytics();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!connectedAccountId) {
      setTransactions([]);
      return;
    }
    if (connectedAccountId === merchantAccountId) return;
    let active = true;
    setTransactions([]);
    void loadMerchantSettings(connectedAccountId)
      .then((settings) => {
        if (active) setMerchantAccountId(settings.merchantAccountId);
      })
      .catch((loadError: unknown) => {
        console.error("Unable to load connected merchant settings.", loadError);
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Merchant settings could not be loaded from Supabase.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [connectedAccountId, merchantAccountId]);

  const syncAnalytics = useCallback(async () => {
    if (!selector || !connectedAccountId || connectedAccountId !== merchantAccountId) {
      setError("Connect the configured merchant NEAR wallet to load analytics.");
      walletModal?.show();
      return;
    }
    setIsSyncing(true);
    setError(null);
    try {
      const authorization = await signMerchantAuthorization(
        selector,
        connectedAccountId,
        "merchant-history",
      );
      const response = await fetch("/api/merchant-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(authorization),
      });
      const result: unknown = await response.json();
      if (
        !response.ok ||
        typeof result !== "object" ||
        result === null ||
        !("records" in result) ||
        !Array.isArray(result.records) ||
        !result.records.every(isPaymentRecord)
      ) {
        const message =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "Verified sales could not be loaded from Supabase.";
        throw new Error(message);
      }
      const activeAccountId =
        selector.store.getState().accounts.find((account) => account.active)
          ?.accountId ??
        selector.store.getState().accounts[0]?.accountId ??
        null;
      if (activeAccountId === connectedAccountId) {
        setTransactions(result.records);
      }
    } catch (syncError) {
      console.error("Unable to load analytics from Supabase.", syncError);
      setError(
        syncError instanceof Error
          ? syncError.message
          : "Verified sales could not be loaded from Supabase.",
      );
    } finally {
      setIsSyncing(false);
    }
  }, [connectedAccountId, merchantAccountId, selector, walletModal]);

  useEffect(() => {
    if (!connectedAccountId || connectedAccountId !== merchantAccountId) {
      syncAttemptRef.current = null;
      return;
    }

    if (isLoading || !selector) {
      return;
    }

    const attemptKey = `${connectedAccountId}:${merchantAccountId}`;
    if (syncAttemptRef.current === attemptKey) {
      return;
    }
    syncAttemptRef.current = attemptKey;
    void syncAnalytics();
  }, [
    connectedAccountId,
    isLoading,
    merchantAccountId,
    selector,
    syncAnalytics,
  ]);
  const settledTransactions = useMemo(
    () =>
      transactions.filter(
        (transaction) =>
          transaction.status === "Success" &&
          transaction.merchantAccountId === merchantAccountId,
      ),
    [merchantAccountId, transactions],
  );

  const dailySales = useMemo(() => {
    const groups = new Map<string, DailySales>();
    for (const transaction of settledTransactions) {
      const date = new Date(transaction.date);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const fiatCurrency = transaction.fiatCurrency ?? "INR";
      const key = `${day}-${fiatCurrency}`;
      const current = groups.get(key) ?? {
        day,
        fiatCurrency,
        revenue: 0,
        count: 0,
      };
      current.revenue += Number(transaction.fiatAmount) || 0;
      current.count += 1;
      groups.set(key, current);
    }
    return [...groups.values()]
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, 14);
  }, [settledTransactions]);

  const totalNear = settledTransactions.reduce(
    (total, transaction) => total + getTokenAmount(transaction, "NEAR"),
    0,
  );
  const totalUsdc = settledTransactions.reduce(
    (total, transaction) => total + getTokenAmount(transaction, "USDC"),
    0,
  );
  const maxDailyRevenue = Math.max(
    1,
    ...dailySales.map((sale) => sale.revenue),
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f4f1] font-sans text-black lg:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 p-6 sm:p-10 lg:p-12">
        <p className="text-xs font-bold uppercase tracking-[0.3em]">
          NEARPAY / MERCHANT
        </p>
        <h1 className="mt-5 text-right text-4xl font-black tracking-tight">
          04 / ANALYTICS
        </h1>
        <p className="mt-4 text-sm text-neutral-600">
          Verified sales for {merchantAccountId}, securely loaded from Supabase.
          Pending and failed transactions are excluded from revenue.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border border-neutral-300 bg-white p-4">
          <div className="text-sm">
            {isLoading
              ? "Loading merchant settings and wallet..."
              : connectedAccountId === merchantAccountId
                ? isSyncing
                  ? "Authorizing and loading sales from Supabase..."
                  : transactions.length > 0
                    ? `${transactions.length} verified transaction(s) loaded from Supabase.`
                    : "Sales are loaded automatically after merchant authorization."
                : "Connect the configured merchant wallet to load sales."}
          </div>
          {connectedAccountId === merchantAccountId ? (
            error ? (
              <button
                type="button"
                onClick={() => void syncAnalytics()}
                disabled={isSyncing}
                className="border border-black px-4 py-2 text-xs font-bold uppercase tracking-wider transition hover:bg-black hover:text-white disabled:opacity-50"
              >
                {isSyncing ? "Loading..." : "Retry secure load"}
              </button>
            ) : (
              <span role={isSyncing ? "status" : undefined} className="text-xs font-bold uppercase tracking-wider">
                {isSyncing ? "Loading sales..." : "Auto-loaded"}
              </span>
            )
          ) : (
            <button
              type="button"
              onClick={() => walletModal?.show()}
              disabled={isLoading || !walletModal}
              className="border border-black px-4 py-3 text-xs font-bold uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-50"
            >
              Connect Merchant Wallet
            </button>
          )}
        </div>
        {error ? (
          <p role="alert" className="mt-6 text-sm text-red-700">{error}</p>
        ) : null}

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          <article className="border border-black p-6">
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
              Successful transactions
            </p>
            <p className="mt-4 text-4xl font-black">
              {settledTransactions.length}
            </p>
          </article>
          <article className="border border-black p-6">
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
              NEAR Revenue
            </p>
            <p className="mt-4 break-words text-3xl font-black">
              {totalNear.toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
              <span className="text-base">NEAR</span>
            </p>
          </article>
          <article className="border border-black p-6">
            <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
              USDC Revenue
            </p>
            <p className="mt-4 break-words text-3xl font-black">
              {totalUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
              <span className="text-base">USDC</span>
            </p>
          </article>
        </section>

        <section className="mt-12">
          <h2 className="border-b border-black pb-4 text-sm font-black uppercase tracking-[0.2em]">
            Daily Sales Volume
          </h2>
          {dailySales.length > 0 ? (
            <ul className="divide-y divide-neutral-200">
              {dailySales.map((sale) => (
                <li
                  key={`${sale.day}-${sale.fiatCurrency}`}
                  className="grid gap-3 py-5 sm:grid-cols-[130px_1fr_auto]"
                >
                  <span className="text-sm font-bold">{sale.day}</span>
                  <span
                    role="img"
                    aria-label={`${sale.revenue.toLocaleString(
                      sale.fiatCurrency === "USD" ? "en-US" : "en-IN",
                      { style: "currency", currency: sale.fiatCurrency },
                    )} sales volume`}
                    className="flex h-8 items-center border border-neutral-200 bg-neutral-50 px-1"
                  >
                    <span
                      className="h-3/5 rounded-sm bg-emerald-600 transition-[width] duration-500"
                      style={{
                        width: `${Math.max(4, (sale.revenue / maxDailyRevenue) * 72)}%`,
                      }}
                    />
                  </span>
                  <span className="text-sm font-semibold sm:text-right">
                    {sale.revenue.toLocaleString(
                      sale.fiatCurrency === "USD" ? "en-US" : "en-IN",
                      {
                        style: "currency",
                        currency: sale.fiatCurrency,
                      },
                    )}{" "}
                    <span className="text-neutral-500">
                      · {sale.count} sale{sale.count === 1 ? "" : "s"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-sm text-neutral-500">
              No sales have been loaded. Authorize the merchant wallet to read
              verified transactions from Supabase.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
