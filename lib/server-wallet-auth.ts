import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import {
  verifyFullKeyBelongsToUser,
  verifySignature,
  type SignedMessage,
} from "@near-wallet-selector/core";
import { isValidNearAccountId } from "./merchant-settings";
import { getSupabaseAdmin } from "./supabase-admin";

export type WalletChallengePurpose = "merchant-history" | "payment-record";

export type WalletChallenge = {
  id: string;
  account_id: string;
  purpose: WalletChallengePurpose;
  message: string;
  nonce: string;
  recipient: string;
  transaction_hash: string | null;
  receipt_digest: string | null;
  expires_at: string;
};

const challengeLifetimeMs = 5 * 60 * 1000;
const testnetNetwork = {
  networkId: "testnet",
  nodeUrl: "https://rpc.testnet.near.org",
  helperUrl: "https://helper.testnet.near.org",
  explorerUrl: "https://testnet.nearblocks.io",
  indexerUrl: "https://indexer.testnet.near.org",
};

export function isTransactionHash(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(value)
  );
}

export function isReceiptDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export async function createWalletChallenge(
  request: Request,
  accountId: string,
  purpose: WalletChallengePurpose,
  transactionHash: string | null,
  receiptDigest: string | null,
): Promise<WalletChallenge> {
  if (!isValidNearAccountId(accountId)) {
    throw new Error("A valid NEAR account ID is required.");
  }
  if (
    (purpose === "payment-record" && (!transactionHash || !receiptDigest)) ||
    (purpose === "merchant-history" && (transactionHash || receiptDigest))
  ) {
    throw new Error("Wallet challenge fields do not match the requested purpose.");
  }

  const originHeader = request.headers.get("origin");
  const requestOrigin = originHeader
    ? new URL(originHeader).origin
    : new URL(request.url).origin;
  const originUrl = new URL(requestOrigin);
  if (
    !["http:", "https:"].includes(originUrl.protocol) ||
    (process.env.NODE_ENV === "production" && originUrl.protocol !== "https:")
  ) {
    throw new Error("Wallet authorization requires a secure site origin.");
  }

  const supabase = getSupabaseAdmin();
  const nonce = randomBytes(32).toString("base64");
  const expiresAt = new Date(Date.now() + challengeLifetimeMs).toISOString();
  const { data: inserted, error: insertError } = await supabase
    .from("wallet_challenges")
    .insert({
      account_id: accountId,
      purpose,
      nonce,
      recipient: requestOrigin,
      transaction_hash: transactionHash,
      receipt_digest: receiptDigest,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (insertError) {
    throw new Error(`Unable to create a wallet challenge: ${insertError.message}`);
  }

  const message = [
    "NEARPay authorization",
    `purpose=${purpose}`,
    `account=${accountId}`,
    `challenge=${inserted.id}`,
    ...(transactionHash ? [`transaction=${transactionHash}`] : []),
    ...(receiptDigest ? [`receipt=${receiptDigest}`] : []),
  ].join("\n");
  const { data: updated, error: updateError } = await supabase
    .from("wallet_challenges")
    .update({ message })
    .eq("id", inserted.id)
    .select("*")
    .single();

  if (updateError) {
    throw new Error(`Unable to finalize a wallet challenge: ${updateError.message}`);
  }
  return updated as WalletChallenge;
}

export async function consumeAndVerifyWalletChallenge({
  challengeId,
  accountId,
  purpose,
  transactionHash,
  receiptDigest,
  signedMessage,
}: {
  challengeId: string;
  accountId: string;
  purpose: WalletChallengePurpose;
  transactionHash: string | null;
  receiptDigest: string | null;
  signedMessage: SignedMessage;
}): Promise<WalletChallenge> {
  const supabase = getSupabaseAdmin();
  const { data: challenge, error: consumeError } = await supabase
    .from("wallet_challenges")
    .delete()
    .eq("id", challengeId)
    .eq("account_id", accountId)
    .eq("purpose", purpose)
    .select("*")
    .maybeSingle();

  if (consumeError) {
    throw new Error(`Unable to validate wallet challenge: ${consumeError.message}`);
  }
  if (!challenge) {
    throw new Error("Wallet challenge is invalid, expired, or already used.");
  }

  const typedChallenge = challenge as WalletChallenge;
  if (
    Date.parse(typedChallenge.expires_at) <= Date.now() ||
    typedChallenge.transaction_hash !== transactionHash ||
    typedChallenge.receipt_digest !== receiptDigest ||
    signedMessage.accountId !== accountId
  ) {
    throw new Error("Wallet signature does not match the requested action.");
  }

  const signatureValid = verifySignature({
    publicKey: signedMessage.publicKey,
    signature: signedMessage.signature,
    message: typedChallenge.message,
    nonce: Buffer.from(typedChallenge.nonce, "base64"),
    recipient: typedChallenge.recipient,
  });
  if (!signatureValid) {
    throw new Error("The wallet signature could not be verified.");
  }

  const keyBelongsToAccount = await verifyFullKeyBelongsToUser({
    publicKey: signedMessage.publicKey,
    accountId,
    network: testnetNetwork,
  });
  if (!keyBelongsToAccount) {
    throw new Error("The signing key does not belong to this NEAR account.");
  }

  return typedChallenge;
}
