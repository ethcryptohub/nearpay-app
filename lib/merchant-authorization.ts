"use client";

import { Buffer } from "buffer";
import type { WalletSelector } from "@near-wallet-selector/core";

export async function getMerchantSession(accountId: string): Promise<boolean> {
  const response = await fetch(
    `/api/merchant-session?accountId=${encodeURIComponent(accountId)}`,
    { cache: "no-store" },
  );
  const session: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      typeof session === "object" &&
        session !== null &&
        "error" in session &&
        typeof session.error === "string"
        ? session.error
        : "Could not check the merchant session.",
    );
  }
  if (
    typeof session !== "object" ||
    session === null ||
    !("authenticated" in session) ||
    typeof session.authenticated !== "boolean"
  ) {
    throw new Error("The merchant session response has an invalid format.");
  }
  return session.authenticated;
}

export async function signMerchantAuthorization(
  selector: WalletSelector,
  accountId: string,
  allowWalletPrompt = true,
): Promise<{ accountId: string }> {
  if (await getMerchantSession(accountId)) {
    return { accountId };
  }
  if (!allowWalletPrompt) {
    throw new Error("The merchant session expired. Reauthorize the merchant wallet.");
  }

  const wallet = await selector.wallet();
  if (!wallet.signMessage) {
    throw new Error("This wallet cannot sign merchant authorization requests.");
  }

  const challengeResponse = await fetch("/api/wallet-challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, purpose: "merchant-settings" }),
  });
  const challenge: unknown = await challengeResponse.json();
  if (
    !challengeResponse.ok ||
    typeof challenge !== "object" ||
    challenge === null ||
    !("challengeId" in challenge) ||
    typeof challenge.challengeId !== "string" ||
    !("message" in challenge) ||
    typeof challenge.message !== "string" ||
    !("nonce" in challenge) ||
    typeof challenge.nonce !== "string" ||
    !("recipient" in challenge) ||
    typeof challenge.recipient !== "string"
  ) {
    const message =
      typeof challenge === "object" &&
      challenge !== null &&
      "error" in challenge &&
      typeof challenge.error === "string"
        ? challenge.error
        : "Could not authorize the merchant action.";
    throw new Error(message);
  }

  const signedMessage = await wallet.signMessage({
    message: challenge.message,
    nonce: Buffer.from(challenge.nonce, "base64"),
    recipient: challenge.recipient,
  });
  if (!signedMessage) {
    throw new Error("The wallet did not return a merchant authorization signature.");
  }

  const authorization = {
    accountId,
    challengeId: challenge.challengeId,
    signedMessage,
  };
  const response = await fetch("/api/merchant-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(authorization),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "Could not create a secure merchant session.";
    throw new Error(message);
  }
  return { accountId };
}
