"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "../../../components/Sidebar";
import {
  isPaymentRecord,
  paymentHistoryStorageKey,
  type PaymentRecord,
} from "../../../lib/payment-history";
import {
  defaultMerchantSettings,
  merchantSettingsStorageKey,
  parseMerchantSettings,
} from "../../../lib/merchant-settings";

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadAnalytics() {
      await Promise.resolve();
      try {
        const settings = parseMerchantSettings(
          localStorage.getItem(merchantSettingsStorageKey),
        );
        if (active) {
          setMerchantAccountId(settings.merchantAccountId);
        }

        const saved = localStorage.getItem(paymentHistoryStorageKey);
        const parsed: unknown = saved ? JSON.parse(saved) : [];
        if (!Array.isArray(parsed) || !parsed.every(isPaymentRecord)) {
          throw new Error("Saved transaction history has an invalid format.");
        }
        if (active) {
          setTransactions(
            parsed.filter(
              (record) =>
                record.merchantAccountId === settings.merchantAccountId,
            ),
          );
        }
      } catch (loadError) {
        console.error("Unable to load sales analytics.", loadError);
        if (active) {
          setError(
            "Sales data or merchant settings could not be read from this browser.",
          );
        }
      }
    }
    void loadAnalytics();
    return () => {
      active = false;
    };
  }, []);

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
          Verified sales for {merchantAccountId}, saved in this browser.
          Pending and failed transactions are excluded from revenue.
        </p>
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
              No successful sales for this merchant have been recorded in this
              browser yet.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
