import { JsonRpcProvider } from "near-api-js";

const testnetProvider = new JsonRpcProvider({
  url: "https://rpc.testnet.near.org",
});

type ExpectedTransfer = {
  receiverId: string;
  amountYocto: string;
};

export type IncomingNativeTransfer = {
  transactionHash: string;
  senderAccountId: string;
  blockTimestampMs: number;
};

const yoctoPerMillisecond = BigInt(1_000_000);

export async function getLatestFinalizedBlockHeight(): Promise<number> {
  const block = await testnetProvider.viewBlock({ finality: "final" });
  return block.header.height;
}

export async function findMatchingNativeTransferInBlock({
  blockHeight,
  receiverId,
  amountYocto,
  openedAtMs,
}: {
  blockHeight: number;
  receiverId: string;
  amountYocto: string;
  openedAtMs: number;
}): Promise<IncomingNativeTransfer | null> {
  const block = await testnetProvider.viewBlock({ blockId: blockHeight });
  const blockTimestampMs = Number(
    BigInt(block.header.timestamp_nanosec) / yoctoPerMillisecond,
  );

  if (blockTimestampMs < openedAtMs) {
    return null;
  }

  const chunks = await Promise.all(
    block.chunks.map((chunk) => testnetProvider.viewChunk(chunk.chunk_hash)),
  );

  for (const chunk of chunks) {
    for (const transaction of chunk.transactions) {
      if (
        transaction.receiver_id !== receiverId ||
        transaction.actions.length !== 1
      ) {
        continue;
      }

      const transfer = transaction.actions.find(
        (action) =>
          typeof action === "object" &&
          action !== null &&
          "Transfer" in action,
      );
      const transferAmount =
        transfer && typeof transfer === "object" && "Transfer" in transfer
          ? String(transfer.Transfer.deposit)
          : null;

      if (transferAmount !== amountYocto) {
        continue;
      }

      const outcome = await testnetProvider.viewTransactionStatus({
        txHash: transaction.hash,
        accountId: transaction.signer_id,
        waitUntil: "FINAL",
      });
      const succeeded =
        typeof outcome.status === "object" &&
        outcome.status !== null &&
        "SuccessValue" in outcome.status &&
        typeof outcome.status.SuccessValue === "string";

      if (succeeded) {
        return {
          transactionHash: transaction.hash,
          senderAccountId: transaction.signer_id,
          blockTimestampMs,
        };
      }
    }
  }

  return null;
}

export async function verifyTransactionOnChain(
  txHash: string,
  accountId: string,
  expectedTransfer?: ExpectedTransfer,
): Promise<boolean> {
  if (!txHash.trim()) {
    throw new Error("Transaction hash must not be empty.");
  }

  if (!accountId.trim()) {
    throw new Error("Account ID must not be empty.");
  }

  const outcome = await testnetProvider.viewTransactionStatus({
    txHash: txHash.trim(),
    accountId: accountId.trim(),
    waitUntil: "FINAL",
  });

  const succeeded =
    typeof outcome.status === "object" &&
    outcome.status !== null &&
    "SuccessValue" in outcome.status &&
    typeof outcome.status.SuccessValue === "string";

  if (!succeeded) {
    return false;
  }

  if (!expectedTransfer) {
    return true;
  }

  const transfer = outcome.transaction.actions.find(
    (action) =>
      typeof action === "object" && action !== null && "Transfer" in action,
  );
  const amount =
    transfer && typeof transfer === "object" && "Transfer" in transfer
      ? String(transfer.Transfer.deposit)
      : null;

  return (
    outcome.transaction.actions.length === 1 &&
    outcome.transaction.receiver_id === expectedTransfer.receiverId &&
    amount === expectedTransfer.amountYocto
  );
}
