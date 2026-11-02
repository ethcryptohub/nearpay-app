"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  isPaymentRecord,
  type PaymentRecord,
} from "../../../../lib/payment-history";

export default function ReceiptPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [record, setRecord] = useState<PaymentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function loadReceipt() {
      try {
        const response = await fetch(
          `/api/payment-records?txHash=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        const result: unknown = await response.json();
        if (
          !response.ok ||
          typeof result !== "object" ||
          result === null ||
          !("record" in result) ||
          !isPaymentRecord(result.record) ||
          result.record.transactionHash !== id
        ) {
          const apiMessage =
            typeof result === "object" &&
            result !== null &&
            "error" in result &&
            typeof result.error === "string"
              ? result.error
              : "The payment receipt could not be loaded from Supabase.";
          throw new Error(apiMessage);
        }
        if (active) {
          setRecord(result.record);
        }
      } catch (loadError) {
        console.error("Unable to load the payment receipt.", loadError);
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "The payment receipt could not be loaded from Supabase.",
          );
        }
      }
    }
    void loadReceipt();
    return () => {
      active = false;
    };
  }, [id]);

  const token = record?.token ?? "NEAR";
  const tokenAmount = record?.tokenAmount ?? record?.usdcAmount;

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10 font-mono text-black sm:py-16">
      <div className="mx-auto max-w-md">
        <div className="mb-5 flex items-center justify-between print:hidden">
          <Link href="/pos/history" className="text-sm font-bold underline underline-offset-4">
            Back to history
          </Link>
          {record ? (
            <button
              type="button"
              onClick={() => window.print()}
              className="bg-black px-5 py-3 text-xs font-bold uppercase tracking-wider text-white"
            >
              Print Receipt
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="border border-red-300 bg-white p-5 text-sm text-red-700">
            {error}
          </p>
        ) : record ? (
          <article id="thermal-receipt" className="bg-white px-7 py-9 shadow-sm sm:px-10">
            <header className="border-b border-dashed border-black pb-6 text-center">
              <p className="text-xs font-bold tracking-[0.3em]">NEARPAY</p>
              <h1 className="mt-4 text-2xl font-black uppercase">
                {record.storeName ?? "Payment Receipt"}
              </h1>
              {record.merchantAccountId ? (
                <p className="mt-2 break-all text-xs">{record.merchantAccountId}</p>
              ) : null}
              {record.invoiceNumber ? (
                <p className="mt-3 text-xs font-bold">
                  Invoice No: {record.invoiceNumber}
                </p>
              ) : null}
              <p className="mt-3 text-xs">
                {new Date(record.date).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </header>

            <section className="border-b border-dashed border-black py-6">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-widest">
                Items
              </h2>
              {record.items?.length ? (
                <ul className="space-y-3">
                  {record.items.map((item, index) => (
                    <li key={`${item.name}-${index}`} className="flex justify-between gap-4 text-xs">
                      <span>
                        {item.name} × {item.quantity}
                        <span className="mt-1 block text-neutral-500">
                          {item.fiatCurrency ?? "INR"}{" "}
                          {(item.unitPrice ?? item.unitPriceInr).toFixed(2)} each
                        </span>
                      </span>
                      <span className="whitespace-nowrap">
                        {item.fiatCurrency ?? "INR"}{" "}
                        {(
                          (item.unitPrice ?? item.unitPriceInr) * item.quantity
                        ).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-neutral-500">Sale total</p>
              )}
              <div className="mt-5 flex justify-between border-t border-black pt-4 text-sm font-bold">
                <span>FIAT TOTAL</span>
                <span>
                  {record.fiatCurrency ?? "INR"} {record.fiatAmount}
                </span>
              </div>
            </section>

            <section className="border-b border-dashed border-black py-6 text-xs">
              <p className="flex justify-between gap-3">
                <span>SETTLED TOKEN</span>
                <span className="font-bold">{token}</span>
              </p>
              <p className="mt-3 flex justify-between gap-3">
                <span>TOKEN AMOUNT</span>
                <span className="font-bold">{tokenAmount} {token}</span>
              </p>
              <p className="mt-3 flex justify-between gap-3">
                <span>USDC QUOTE</span>
                <span>{record.usdcAmount} USDC</span>
              </p>
              <p className="mt-3 flex justify-between gap-3">
                <span>STATUS</span>
                <span className="font-bold">{record.status}</span>
              </p>
            </section>

            <footer className="pt-6">
              <p className="text-xs font-bold uppercase tracking-widest">
                {record.status === "Success"
                  ? "Verified NEAR Transaction"
                  : "NEAR Transaction"}
              </p>
              <p className="mt-2 break-all text-[10px] leading-5">
                {record.transactionHash ?? "Transaction hash unavailable"}
              </p>
              {record.senderAccountId ? (
                <p className="mt-3 break-all text-[10px] text-neutral-500">
                  Paid by: {record.senderAccountId}
                </p>
              ) : null}
              <p className="mt-8 text-center text-[10px] tracking-widest">
                THANK YOU
              </p>
            </footer>
          </article>
        ) : (
          <p className="bg-white p-6 text-sm">Loading receipt...</p>
        )}
      </div>
      <style>{`
        @media print {
          @page { size: 80mm auto; margin: 4mm; }
          body { background: white !important; }
          body * { visibility: hidden; }
          #thermal-receipt, #thermal-receipt * { visibility: visible; }
          #thermal-receipt {
            position: absolute;
            left: 0;
            top: 0;
            width: 72mm;
            padding: 0;
            box-shadow: none;
          }
        }
      `}</style>
    </main>
  );
}
