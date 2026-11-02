"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
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
import { getWalletSelector } from "../../../lib/near-wallet-selector";
import { loadMerchantSettings } from "../../../lib/merchant-data";
import { signMerchantAuthorization } from "../../../lib/merchant-authorization";

function readApiError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : fallback;
}

export default function HistoryPage() {
  const [transactions, setTransactions] = useState<PaymentRecord[]>([]);
  const [merchantAccountId, setMerchantAccountId] = useState(
    defaultMerchantSettings.merchantAccountId,
  );
  const [connectedAccountId, setConnectedAccountId] = useState<string | null>(
    null,
  );
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [walletModal, setWalletModal] = useState<WalletSelectorModal | null>(
    null,
  );
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [merchantSettingsLoaded, setMerchantSettingsLoaded] = useState(false);
  const [merchantSettingsAvailable, setMerchantSettingsAvailable] = useState(false);
  const syncAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    async function loadMerchantPreferences() {
      await Promise.resolve();
      if (!active) {
        return;
      }

      try {
        const settings = await loadMerchantSettings(
          defaultMerchantSettings.merchantAccountId,
        );
        if (active) {
          setMerchantAccountId(settings.merchantAccountId);
          setMerchantSettingsAvailable(true);
        }
      } catch (error) {
        console.error("Unable to load merchant settings for history.", error);
        setHistoryError(
          error instanceof Error
            ? error.message
            : "Merchant settings could not be loaded from Supabase.",
        );
      } finally {
        if (active) setMerchantSettingsLoaded(true);
      }
    }
    void loadMerchantPreferences();

    getWalletSelector()
      .then((walletSelector) => {
        if (!active) {
          return;
        }
        setSelector(walletSelector);
        setWalletModal(
          setupModal(walletSelector, {
            theme: "light",
            description: "Authorize access to this merchant's payment history.",
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
        const subscription = walletSelector.store.observable.subscribe(syncAccount);
        unsubscribe = () => subscription.unsubscribe();
      })
      .catch((error: unknown) => {
        console.error("Unable to initialize the merchant wallet for history.", error);
        if (active) {
          setHistoryError("NEAR wallet authorization could not be initialized.");
        }
      })
      .finally(() => {
        if (active) {
          setIsInitializing(false);
        }
      });

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
        if (active) {
          setMerchantAccountId(settings.merchantAccountId);
          setMerchantSettingsAvailable(true);
        }
      })
      .catch((error: unknown) => {
        console.error("Unable to load connected merchant settings.", error);
        if (active) {
          setMerchantSettingsAvailable(false);
          setHistoryError(
            error instanceof Error
              ? error.message
              : "Merchant settings could not be loaded from Supabase.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [connectedAccountId, merchantAccountId]);

  const syncSharedHistory = useCallback(async () => {
    if (
      !selector ||
      !connectedAccountId ||
      connectedAccountId !== merchantAccountId
    ) {
      setHistoryError("Connect the configured merchant NEAR wallet to sync shared history.");
      return;
    }
    setIsSyncing(true);
    setHistoryError(null);
    try {
      const authorization = await signMerchantAuthorization(
        selector,
        connectedAccountId,
        "merchant-history",
      );

      const historyResponse = await fetch("/api/merchant-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...authorization,
        }),
      });
      const result: unknown = await historyResponse.json();
      if (
        !historyResponse.ok ||
        typeof result !== "object" ||
        result === null ||
        !("records" in result) ||
        !Array.isArray(result.records) ||
        !result.records.every(isPaymentRecord)
      ) {
        throw new Error(readApiError(result, "Shared merchant history could not be loaded."));
      }
      const activeAccountId =
        selector.store.getState().accounts.find((account) => account.active)
          ?.accountId ??
        selector.store.getState().accounts[0]?.accountId ??
        null;
      if (activeAccountId === connectedAccountId) {
        setTransactions(result.records);
      }
    } catch (error) {
      console.error("Unable to synchronize shared merchant history.", error);
      setHistoryError(
        error instanceof Error
          ? error.message
          : "Shared merchant history could not be synchronized.",
      );
    } finally {
      setIsSyncing(false);
    }
  }, [connectedAccountId, merchantAccountId, selector]);

  useEffect(() => {
    if (!connectedAccountId || connectedAccountId !== merchantAccountId) {
      syncAttemptRef.current = null;
      return;
    }

    if (
      isInitializing ||
      !merchantSettingsLoaded ||
      !merchantSettingsAvailable ||
      !selector
    ) {
      return;
    }

    const attemptKey = `${connectedAccountId}:${merchantAccountId}`;
    if (syncAttemptRef.current === attemptKey) {
      return;
    }
    syncAttemptRef.current = attemptKey;
    void syncSharedHistory();
  }, [
    connectedAccountId,
    isInitializing,
    merchantAccountId,
    merchantSettingsAvailable,
    merchantSettingsLoaded,
    selector,
    syncSharedHistory,
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f4f1] font-sans text-black lg:flex-row">
      <Sidebar />
      <main className="min-w-0 flex-1 p-6 sm:p-10 lg:p-12">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.3em]">
              NEARPAY / MERCHANT
            </p>
            <h1 className="mt-4 text-4xl font-black tracking-tight">
              02 / TRANSACTIONS
            </h1>
            <p className="mt-3 text-sm text-neutral-600">
              Verified transactions are stored in Supabase and load
              automatically after merchant authorization.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {connectedAccountId ? (
              <span className="border border-neutral-300 px-3 py-2 font-mono text-xs">
                {connectedAccountId}
              </span>
            ) : null}
            {connectedAccountId === merchantAccountId ? (
              historyError ? (
                <button
                  type="button"
                  onClick={() => void syncSharedHistory()}
                  disabled={isSyncing}
                  className="border border-black px-4 py-2 text-xs font-bold uppercase tracking-wider transition hover:bg-black hover:text-white disabled:opacity-50"
                >
                  {isSyncing ? "Loading..." : "Retry secure load"}
                </button>
              ) : (
                <span role={isSyncing ? "status" : undefined} className="text-xs font-bold uppercase tracking-wider">
                  {isSyncing ? "Loading history..." : "Auto-loaded"}
                </span>
              )
            ) : (
              <button
                type="button"
                onClick={() => walletModal?.show()}
                disabled={isInitializing || !walletModal}
                className="bg-black px-5 py-3 text-xs font-bold uppercase tracking-widest text-white transition hover:bg-neutral-800 disabled:opacity-50"
              >
                {isInitializing
                  ? "Loading NEAR Wallet..."
                  : connectedAccountId
                    ? "Choose merchant wallet"
                    : "Connect merchant wallet"}
              </button>
            )}
          </div>
        </div>
        {historyError ? (
          <p role="alert" className="mt-6 border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {historyError}
          </p>
        ) : null}
        <div className="mt-8 w-full overflow-x-auto border border-black bg-white shadow-[3px_3px_0_0_#111]">
          <table className="w-full min-w-[1350px] border-collapse text-left">
            <thead className="bg-neutral-50">
              <tr className="border-b-2 border-black">
                {[
                  "Date",
                  "Customer details",
                  "Store / Merchant",
                  "Fiat total",
                  "Payment token",
                  "USDC quote",
                  "Status",
                  "Sender",
                  "Receipt",
                ].map((heading) => (
                  <th
                    key={heading}
                    scope="col"
                    className="px-4 py-4 text-xs font-black uppercase tracking-widest"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction, index) => {
                const token = transaction.token ?? "NEAR";
                const tokenAmount =
                  transaction.tokenAmount ?? transaction.usdcAmount;
                return (
                  <tr
                    key={
                      transaction.transactionHash ??
                      `${transaction.date}-${transaction.fiatAmount}-${index}`
                    }
                    className="border-b border-neutral-200 align-top"
                  >
                    <td className="whitespace-nowrap px-4 py-5 text-sm text-neutral-700">
                      {new Date(transaction.date).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                      {transaction.invoiceNumber ? (
                        <p className="mt-2 font-mono text-[10px] font-bold text-neutral-500">
                          {transaction.invoiceNumber}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-5 text-sm">
                      <p className="font-semibold">{transaction.customerName ?? "Not provided"}</p>
                      <p className="mt-1 break-all text-xs text-neutral-600">
                        {transaction.customerEmail ?? "—"}
                      </p>
                      <p className="mt-1 text-xs text-neutral-600">
                        {transaction.customerMobile ?? "—"}
                      </p>
                    </td>
                    <td className="px-4 py-5 text-sm">
                      <p className="font-semibold">{transaction.storeName ?? "NEARPay"}</p>
                      <p className="mt-1 font-mono text-xs text-neutral-500">
                        {transaction.merchantAccountId ?? "—"}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-4 py-5 text-sm font-semibold">
                      {Number(transaction.fiatAmount).toLocaleString(
                        transaction.fiatCurrency === "USD" ? "en-US" : "en-IN",
                        {
                          style: "currency",
                          currency: transaction.fiatCurrency ?? "INR",
                        },
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-5 text-sm font-semibold">
                      {token} {tokenAmount}
                    </td>
                    <td className="whitespace-nowrap px-4 py-5 text-sm">
                      {transaction.usdcAmount} USDC
                    </td>
                    <td className="px-4 py-5 text-sm font-bold">
                      <span
                        className={
                          transaction.status === "Success"
                            ? "text-emerald-700"
                            : transaction.status === "Failed"
                              ? "text-red-700"
                              : "text-amber-700"
                        }
                      >
                        {transaction.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-5 font-mono text-xs">
                      {transaction.senderAccountId ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-5 text-sm font-bold">
                      {transaction.transactionHash ? (
                        <Link
                          href={`/pos/receipt/${encodeURIComponent(transaction.transactionHash)}`}
                          className="underline underline-offset-4"
                        >
                          View receipt
                        </Link>
                      ) : (
                        <span className="text-neutral-400">No hash</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {transactions.length === 0 && !historyError ? (
                <tr className="border-b border-neutral-200">
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-neutral-500">
                    {isSyncing
                      ? "Loading verified payments from Supabase..."
                      : "No verified transactions are available for this merchant yet."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
