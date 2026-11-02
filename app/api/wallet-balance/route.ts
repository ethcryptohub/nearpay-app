import { NextResponse } from "next/server";
import { JsonRpcProvider } from "near-api-js";
import { isValidNearAccountId } from "../../../lib/merchant-settings";

export const dynamic = "force-dynamic";

const testnetProvider = new JsonRpcProvider({
  url: "https://rpc.testnet.near.org",
});

type ExplorerToken = {
  balance: string;
  contractId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatBaseUnitAmount(amount: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error("The token explorer returned an invalid token balance.");
  }
  if (/^\d+\.\d+$/.test(amount)) {
    return amount
      .slice(0, amount.indexOf(".") + 9)
      .replace(/(\.\d*?[1-9])0+$/, "$1")
      .replace(/\.0+$/, "");
  }
  if (!/^\d+$/.test(amount)) {
    throw new Error("The token explorer returned an invalid token balance.");
  }

  const padded = amount.padStart(decimals + 1, "0");
  if (decimals === 0) {
    return padded;
  }

  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).slice(0, 8).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function readUsdcBalances(value: unknown): ExplorerToken[] {
  if (
    !isRecord(value) ||
    !isRecord(value.tokens) ||
    !Array.isArray(value.tokens.fts)
  ) {
    throw new Error("The testnet explorer returned an invalid token list.");
  }

  return value.tokens.fts.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.symbol !== "string" || entry.symbol.toUpperCase() !== "USDC") {
      return [];
    }

    const contractId =
      typeof entry.contract === "string"
        ? entry.contract
        : typeof entry.contract_id === "string"
          ? entry.contract_id
          : null;
    const amount =
      typeof entry.amount === "string" || typeof entry.amount === "number"
        ? String(entry.amount)
        : null;
    const decimals = entry.decimals;
    if (
      !contractId ||
      !isValidNearAccountId(contractId) ||
      !amount ||
      !/^\d+(?:\.\d+)?$/.test(amount) ||
      typeof decimals !== "number" ||
      !Number.isInteger(decimals) ||
      decimals < 0 ||
      decimals > 36
    ) {
      return [];
    }

    return [{ balance: formatBaseUnitAmount(amount, decimals), contractId }];
  });
}

export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get("accountId");
  if (!accountId || !isValidNearAccountId(accountId)) {
    return NextResponse.json(
      { error: "A valid NEAR testnet account ID is required." },
      { status: 400 },
    );
  }

  try {
    const [account, tokenResult] = await Promise.all([
      testnetProvider.viewAccount({ accountId }),
      (async () => {
        try {
          const response = await fetch(
            `https://api-testnet.nearblocks.io/v1/account/${encodeURIComponent(accountId)}/tokens`,
            { cache: "no-store", signal: AbortSignal.timeout(8_000) },
          );
          if (!response.ok) {
            throw new Error(`Testnet explorer returned ${response.status}.`);
          }
          return {
            balances: readUsdcBalances(await response.json()),
            warning: null,
          };
        } catch (error) {
          console.error("Unable to load fungible-token balances from NEARBlocks.", error);
          return {
            balances: [],
            warning: "USDC token balances are temporarily unavailable from the testnet explorer.",
          };
        }
      })(),
    ]);

    return NextResponse.json(
      {
        accountId,
        nearBalance: formatBaseUnitAmount(String(account.amount), 24),
        usdcBalances: tokenResult.balances,
        tokenWarning: tokenResult.warning,
        fetchedAt: new Date().toISOString(),
        explorerUrl: `https://testnet.nearblocks.io/address/${encodeURIComponent(accountId)}`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to load a NEAR testnet wallet balance.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load the NEAR testnet wallet balance.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
