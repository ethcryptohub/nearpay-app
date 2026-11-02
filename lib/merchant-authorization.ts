"use client";

import { Buffer } from "buffer";
import type { SignedMessage, WalletSelector } from "@near-wallet-selector/core";

type MerchantAuthorizationPurpose =
  | "merchant-catalog"
  | "merchant-history"
  | "merchant-settings"
  | "merchant-transaction";

export async function signMerchantAuthorization(
  selector: WalletSelector,
  accountId: string,
  purpose: MerchantAuthorizationPurpose,
): Promise<{
  accountId: string;
  challengeId: string;
  signedMessage: SignedMessage;
}> {
  const wallet = await selector.wallet();
  if (!wallet.signMessage) {
    throw new Error("This wallet cannot sign merchant authorization requests.");
  }

  const challengeResponse = await fetch("/api/wallet-challenge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, purpose }),
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

  return {
    accountId,
    challengeId: challenge.challengeId,
    signedMessage,
  };
}
