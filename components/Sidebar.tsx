"use client";

import { ChartNoAxesCombined, History, Settings, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Sidebar() {
  const pathname = usePathname();
  const linkClassName = (href: string) =>
    `flex shrink-0 items-center gap-2 rounded-lg px-3 py-2.5 text-xs transition-colors sm:text-sm lg:gap-3 lg:px-4 ${
      pathname === href
        ? "bg-[#121633] font-bold text-white ring-1 ring-[#ff9f1c] ring-offset-2"
        : "font-medium text-[#6b7392] hover:bg-[#fff3dc] hover:text-[#121633]"
    }`;

  return (
    <aside className="flex w-full shrink-0 items-center justify-between gap-3 border-b border-[#dde2ee] bg-white p-3 sm:p-4 lg:sticky lg:top-0 lg:h-screen lg:w-56 lg:flex-col lg:items-stretch lg:justify-start lg:border-b-0 lg:border-r lg:p-5">
      <Link
        href="/pos"
        className="flex shrink-0 items-center gap-3 text-2xl font-black tracking-tighter text-[#121633]"
        aria-label="NEARPay merchant dashboard"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#121633] text-base text-[#ff9f1c]">
          N
        </span>
        <span>NEARPay</span>
      </Link>
      <nav
        aria-label="Merchant navigation"
        className="flex min-w-0 gap-1 overflow-x-auto lg:mt-10 lg:flex-col lg:gap-2"
      >
        <Link
          href="/pos"
          aria-current={pathname === "/pos" ? "page" : undefined}
          className={linkClassName("/pos")}
        >
          <ShoppingCart size={20} /> <span>New Sale</span>
        </Link>
        <Link
          href="/pos/history"
          aria-current={pathname === "/pos/history" ? "page" : undefined}
          className={linkClassName("/pos/history")}
        >
          <History size={20} /> <span>History</span>
        </Link>
        <Link
          href="/pos/analytics"
          aria-current={pathname === "/pos/analytics" ? "page" : undefined}
          className={linkClassName("/pos/analytics")}
        >
          <ChartNoAxesCombined size={20} /> <span>Analytics</span>
        </Link>
        <Link
          href="/pos/settings"
          aria-current={pathname === "/pos/settings" ? "page" : undefined}
          className={linkClassName("/pos/settings")}
        >
          <Settings size={20} /> <span>Settings</span>
        </Link>
      </nav>
    </aside>
  );
}
