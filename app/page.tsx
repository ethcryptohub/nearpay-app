import Link from "next/link";
import { ArrowUpRight, LockKeyhole, ShoppingBag } from "lucide-react";

const destinations = [
  {
    href: "/pos",
    number: "01",
    title: "Access Merchant POS",
    description: "Connect the merchant wallet, create invoices, and monitor payments.",
  },
  {
    href: "/customer",
    number: "02",
    title: "Customer Payment Portal",
    description: "Connect a NEAR wallet and approve a testnet payment.",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#f4f4f1] px-5 py-6 text-black sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between border-b border-black pb-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center bg-black text-lg font-black text-white">
              N
            </span>
            <div>
              <p className="text-sm font-black tracking-tight">NEARPAY</p>
              <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">
                Web3 point of sale
              </p>
            </div>
          </div>
          <span className="border border-black bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em]">
            NEAR TESTNET
          </span>
        </header>

        <section className="grid gap-8 py-12 sm:py-16 lg:grid-cols-[1.1fr_0.9fr] lg:items-end lg:py-20">
          <div>
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.28em] text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-700" />
              A clearer way to take crypto payments
            </p>
            <h1 className="mt-6 max-w-3xl text-5xl font-black leading-[0.94] tracking-[-0.06em] sm:text-7xl">
              Checkout,
              <br />
              without friction.
            </h1>
          </div>
          <div className="max-w-lg lg:justify-self-end">
            <p className="text-base leading-7 text-neutral-700">
              A focused payment workspace for merchants and customers. Create
              an invoice, scan the QR, and approve directly with a NEAR wallet.
            </p>
            <p className="mt-5 border-l-2 border-emerald-700 pl-4 text-xs leading-5 text-neutral-500">
              Testnet experience · Wallet-authorized · No private keys stored
            </p>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          {destinations.map((destination) => (
            <Link
              key={destination.href}
              href={destination.href}
              className="group flex min-h-64 flex-col justify-between border border-black bg-white p-6 shadow-[4px_4px_0_0_#111] transition duration-200 hover:-translate-y-1 hover:bg-black hover:text-white hover:shadow-[7px_7px_0_0_#047857] sm:p-8"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center border border-current">
                  {destination.href === "/pos" ? (
                    <ShoppingBag aria-hidden="true" size={18} />
                  ) : (
                    <LockKeyhole aria-hidden="true" size={18} />
                  )}
                </span>
                <span className="text-xs font-black tracking-[0.2em]">
                  {destination.number}
                </span>
              </div>
              <div className="mt-12 flex items-end justify-between gap-4">
                <span>
                  <span className="block text-2xl font-black tracking-tight sm:text-3xl">
                    {destination.title}
                  </span>
                  <span className="mt-3 block max-w-sm text-sm leading-6 text-neutral-600 group-hover:text-neutral-300">
                    {destination.description}
                  </span>
                </span>
                <ArrowUpRight
                  aria-hidden="true"
                  size={22}
                  className="mb-1 shrink-0 transition-transform group-hover:translate-x-1 group-hover:-translate-y-1"
                />
              </div>
            </Link>
          ))}
        </div>
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-300 pt-5 text-xs text-neutral-500">
          <span>NEARPAY · Secure testnet checkout</span>
          <span>NEAR Protocol</span>
        </footer>
      </div>
    </main>
  );
}
