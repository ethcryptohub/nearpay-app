"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { Buffer } from "buffer";
import { useSearchParams } from "next/navigation";
import {
  actionCreators,
  type WalletSelector,
} from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { JsonRpcProvider } from "near-api-js";
import type { IScannerControls } from "@zxing/browser";
import { isValidNearAccountId } from "../../lib/merchant-settings";
import {
  isPaymentRecord,
  isReceiptItem,
  type PaymentRecord,
  type ReceiptItem,
} from "../../lib/payment-history";
import {
  calculateTokenAmount,
  fetchTokenRates,
  formatTokenAmount,
  type PaymentToken,
  type TokenRates,
} from "../../lib/token-rates";
import { getWalletSelector } from "../../lib/near-wallet-selector";
import {
  emptyCustomerProfile,
  validateCustomerProfile,
  type CustomerProfile,
} from "../../lib/customer-profile";
import { serializePaymentReceiptAuthorization } from "../../lib/payment-receipt";

type PaymentState =
  | "pending"
  | "signing"
  | "verifying"
  | "success"
  | "error";

type PaymentInvoice = {
  amount: string;
  usdcAmount: string;
  merchant: string;
  fiatAmount: string;
  fiatCurrency: "INR" | "USD";
  storeName: string;
  preferredToken: PaymentToken;
  acceptedTokens: PaymentToken[];
  items: ReceiptItem[];
};

type WalletBalanceResult = {
  accountId: string;
  nearBalance: string;
  usdcBalances: Array<{ balance: string; contractId: string }>;
  tokenWarning: string | null;
  fetchedAt: string;
  explorerUrl: string;
};

function readApiError(value: unknown, fallback: string): string {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : fallback;
}

function isWalletBalanceResult(value: unknown): value is WalletBalanceResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "accountId" in value &&
    typeof value.accountId === "string" &&
    "nearBalance" in value &&
    typeof value.nearBalance === "string" &&
    "usdcBalances" in value &&
    Array.isArray(value.usdcBalances) &&
    value.usdcBalances.every(
      (token) =>
        typeof token === "object" &&
        token !== null &&
        "balance" in token &&
        typeof token.balance === "string" &&
        "contractId" in token &&
        typeof token.contractId === "string",
    ) &&
    "tokenWarning" in value &&
    (value.tokenWarning === null || typeof value.tokenWarning === "string") &&
    "fetchedAt" in value &&
    typeof value.fetchedAt === "string" &&
    "explorerUrl" in value &&
    typeof value.explorerUrl === "string"
  );
}

function getInvoiceFromParams(
  searchParams: ReturnType<typeof useSearchParams>,
): PaymentInvoice {
  return {
    amount: searchParams.get("amount") ?? "",
    usdcAmount: searchParams.get("usdcAmount") ?? searchParams.get("amount") ?? "",
    merchant: searchParams.get("merchant") ?? "",
    fiatAmount: searchParams.get("fiatAmount") ?? "",
    fiatCurrency: searchParams.get("fiatCurrency") === "USD" ? "USD" : "INR",
    storeName: searchParams.get("storeName") ?? "",
    preferredToken:
      searchParams.get("preferredToken") === "USDC" ? "USDC" : "NEAR",
    acceptedTokens: parseAcceptedTokens(searchParams.get("acceptedTokens")),
    items: parseReceiptItems(searchParams.get("items")),
  };
}

function parseAcceptedTokens(value: string | null): PaymentToken[] {
  if (!value) {
    return ["NEAR", "USDC"];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((token) => token === "NEAR" || token === "USDC")
    ) {
      return [...new Set(parsed)] as PaymentToken[];
    }
  } catch {
    return ["NEAR", "USDC"];
  }
  return ["NEAR", "USDC"];
}

function parseReceiptItems(value: string | null): ReceiptItem[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every(isReceiptItem) ? parsed : [];
  } catch {
    return [];
  }
}

function parseQrInvoice(value: string): PaymentInvoice {
  let amount = "";
  let usdcAmount = "";
  let merchant = "";
  let fiatAmount = "";
  let fiatCurrency: "INR" | "USD" = "INR";
  let storeName = "";
  let preferredToken: PaymentToken = "NEAR";
  let acceptedTokens: PaymentToken[] = ["NEAR", "USDC"];
  let items: ReceiptItem[] = [];
  let isJsonPayload = false;

  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null) {
      const payload = parsed as Record<string, unknown>;
      amount =
        typeof payload.nearAmount === "string" ||
        typeof payload.nearAmount === "number"
          ? String(payload.nearAmount)
          : typeof payload.amount === "string" ||
              typeof payload.amount === "number"
            ? String(payload.amount)
          : "";
      usdcAmount =
        typeof payload.usdcAmount === "string" ||
        typeof payload.usdcAmount === "number"
          ? String(payload.usdcAmount)
          : amount;
      merchant =
        typeof payload.merchant === "string" ? payload.merchant : "";
      fiatAmount =
        typeof payload.fiatAmount === "string" ||
        typeof payload.fiatAmount === "number"
          ? String(payload.fiatAmount)
          : "";
      fiatCurrency = payload.fiatCurrency === "USD" ? "USD" : "INR";
      storeName = typeof payload.storeName === "string" ? payload.storeName : "";
      preferredToken = payload.preferredToken === "USDC" ? "USDC" : "NEAR";
      if (Array.isArray(payload.acceptedTokens)) {
        acceptedTokens = parseAcceptedTokens(
          JSON.stringify(payload.acceptedTokens),
        );
      }
      if (Array.isArray(payload.items) && payload.items.every(isReceiptItem)) {
        items = payload.items;
      }
      isJsonPayload = true;
    }
  } catch {
    isJsonPayload = false;
  }

  if (!isJsonPayload) {
    let url: URL;
    try {
      url = new URL(value.trim(), window.location.origin);
    } catch {
      throw new Error("The QR code does not contain a valid payment request.");
    }

    if (!url.pathname.replace(/\/+$/, "").endsWith("/customer")) {
      throw new Error("The QR code is not a NEARPay customer payment link.");
    }

    amount = url.searchParams.get("amount") ?? "";
    usdcAmount =
      url.searchParams.get("usdcAmount") ??
      url.searchParams.get("amount") ??
      "";
    merchant = url.searchParams.get("merchant") ?? "";
    fiatAmount = url.searchParams.get("fiatAmount") ?? "";
    fiatCurrency =
      url.searchParams.get("fiatCurrency") === "USD" ? "USD" : "INR";
    storeName = url.searchParams.get("storeName") ?? "";
    preferredToken =
      url.searchParams.get("preferredToken") === "USDC" ? "USDC" : "NEAR";
    acceptedTokens = parseAcceptedTokens(
      url.searchParams.get("acceptedTokens"),
    );
    items = parseReceiptItems(url.searchParams.get("items"));
  }

  if (!parseNearAmount(amount)) {
    throw new Error("The QR payment amount must be a positive NEAR amount.");
  }
  if (!isValidNearAccountId(merchant)) {
    throw new Error("The QR code does not contain a valid NEAR merchant account.");
  }

  return {
    amount,
    usdcAmount,
    merchant,
    fiatAmount,
    fiatCurrency,
    storeName,
    preferredToken,
    acceptedTokens,
    items,
  };
}

function parseNearAmount(amount: string): bigint | null {
  const normalized = amount.trim();
  if (!/^\d+(?:\.\d{1,24})?$/.test(normalized)) {
    return null;
  }

  const [whole, fraction = ""] = normalized.split(".");
  const yocto = BigInt(whole) * BigInt(10) ** BigInt(24)
    + BigInt(fraction.padEnd(24, "0"));

  return yocto > BigInt(0) ? yocto : null;
}

function getQrDecodeErrorMessage(error: unknown): string {
  const errorName =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
      ? error.name
      : "";
  if (
    errorName === "NotFoundException" ||
    errorName === "ChecksumException" ||
    errorName === "FormatException"
  ) {
    return "No readable QR code was found. Upload a clear, uncropped image of the payment QR.";
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "The image could not be decoded. Upload a clear image containing the full payment QR.";
}

function isSuccessfulStatus(status: unknown): boolean {
  return (
    typeof status === "object" &&
    status !== null &&
    "SuccessValue" in status &&
    typeof status.SuccessValue === "string"
  );
}

function PaymentPortal() {
  const searchParams = useSearchParams();
  const [invoice, setInvoice] = useState<PaymentInvoice>(() =>
    getInvoiceFromParams(searchParams),
  );
  const amount = invoice.amount;
  const merchant = invoice.merchant;
  const fiatAmount = invoice.fiatAmount;
  const fiatCurrency = invoice.fiatCurrency;
  const callbackHash = searchParams
    .get("transactionHashes")
    ?.split(",")[0]
    ?.trim();
  const callbackError =
    searchParams.get("errorMessage") ?? searchParams.get("errorCode");
  const amountInYocto = parseNearAmount(amount);
  const validMerchant = isValidNearAccountId(merchant);

  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [walletModal, setWalletModal] = useState<WalletSelectorModal | null>(
    null,
  );
  const [accountId, setAccountId] = useState<string | null>(null);
  const [isWalletReady, setIsWalletReady] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [customerDetails, setCustomerDetails] =
    useState<CustomerProfile>(emptyCustomerProfile);
  const [profileAccountId, setProfileAccountId] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [walletBalances, setWalletBalances] =
    useState<WalletBalanceResult | null>(null);
  const [walletBalanceError, setWalletBalanceError] = useState<string | null>(
    null,
  );
  const [walletBalanceLoading, setWalletBalanceLoading] = useState(false);
  const [customerHistory, setCustomerHistory] = useState<PaymentRecord[]>([]);
  const [historyAccountId, setHistoryAccountId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [tokenRates, setTokenRates] = useState<TokenRates | null>(null);
  const [tokenRatesError, setTokenRatesError] = useState<string | null>(null);
  const [paymentState, setPaymentState] = useState<PaymentState>("pending");
  const [transactionHash, setTransactionHash] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [historySaveError, setHistorySaveError] = useState<string | null>(null);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [scannerMode, setScannerMode] = useState<"camera" | "upload">("camera");
  const [scannerStatus, setScannerStatus] = useState("");
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [isDecodingImage, setIsDecodingImage] = useState(false);
  const callbackAttempt = useRef("");
  const activeAccountIdRef = useRef<string | null>(null);
  const customerDetailsRef = useRef(customerDetails);
  const walletRef =
    useRef<Awaited<ReturnType<WalletSelector["wallet"]>> | null>(null);
  const walletRequestIdRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerControlsRef = useRef<IScannerControls | null>(null);
  const qrDecodedHandlerRef = useRef<(value: string) => void>(() => undefined);

  const profileLoaded =
    accountId === null || profileAccountId === accountId;

  const refreshWalletBalances = useCallback(async () => {
    if (!accountId) {
      setWalletBalances(null);
      setWalletBalanceError(null);
      return;
    }

    setWalletBalanceLoading(true);
    setWalletBalanceError(null);
    try {
      const response = await fetch(
        `/api/wallet-balance?accountId=${encodeURIComponent(accountId)}`,
        { cache: "no-store" },
      );
      const result: unknown = await response.json();
      if (!response.ok || !isWalletBalanceResult(result) || result.accountId !== accountId) {
        throw new Error(
          readApiError(result, "The wallet balance service returned an invalid response."),
        );
      }

      if (activeAccountIdRef.current === accountId) {
        setWalletBalances(result);
      }
    } catch (error) {
      console.error("Unable to load the connected wallet's live balance.", error);
      if (activeAccountIdRef.current === accountId) {
        setWalletBalanceError(
          error instanceof Error
            ? error.message
            : "Unable to load the connected wallet's live balance.",
        );
      }
    } finally {
      setWalletBalanceLoading(false);
    }
  }, [accountId]);

  const refreshCustomerHistory = useCallback(async () => {
    const connectedWallet = walletRef.current;
    if (!accountId || !isWalletReady || !connectedWallet) {
      setCustomerHistory([]);
      setHistoryAccountId(null);
      return;
    }

    setHistoryLoading(true);
    setHistoryError(null);
    try {
      if (!connectedWallet.signMessage) {
        throw new Error(
          "This wallet cannot sign the authorization needed to load payment history.",
        );
      }
      const challengeResponse = await fetch("/api/wallet-challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          purpose: "merchant-history",
        }),
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
        throw new Error(
          readApiError(challenge, "Could not authorize customer history access."),
        );
      }

      const signedMessage = await connectedWallet.signMessage({
        message: challenge.message,
        nonce: Buffer.from(challenge.nonce, "base64"),
        recipient: challenge.recipient,
      });
      if (!signedMessage) {
        throw new Error("The wallet did not return a history authorization signature.");
      }

      const response = await fetch("/api/customer-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          challengeId: challenge.challengeId,
          signedMessage,
        }),
      });
      const result: unknown = await response.json();
      if (
        !response.ok ||
        typeof result !== "object" ||
        result === null ||
        !("records" in result) ||
        !Array.isArray(result.records) ||
        !result.records.every(isPaymentRecord)
      ) {
        throw new Error(
          readApiError(result, "Customer transaction history could not be loaded."),
        );
      }

      if (activeAccountIdRef.current === accountId) {
        setCustomerHistory(result.records);
        setHistoryAccountId(accountId);
      }
    } catch (error) {
      console.error("Unable to load the customer's secured payment history.", error);
      if (activeAccountIdRef.current === accountId) {
        setHistoryError(
          error instanceof Error
            ? error.message
            : "Customer transaction history could not be loaded.",
        );
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [accountId, isWalletReady]);

  const refreshConversionRates = useCallback(async () => {
    try {
      const rates = await fetchTokenRates();
      setTokenRates(rates);
      setTokenRatesError(rates.warning ?? null);
    } catch (error) {
      console.error("Unable to load live customer conversion rates.", error);
      setTokenRatesError(
        error instanceof Error
          ? error.message
          : "Live token conversion is currently unavailable.",
      );
    }
  }, []);

  useEffect(() => {
    void refreshConversionRates();
    const intervalId = setInterval(() => {
      void refreshConversionRates();
    }, 60_000);
    return () => clearInterval(intervalId);
  }, [refreshConversionRates]);

  useEffect(() => {
    void refreshWalletBalances();
  }, [accountId, refreshWalletBalances]);

  useEffect(() => {
    if (accountId && isWalletReady) {
      void refreshCustomerHistory();
    } else {
      setCustomerHistory([]);
      setHistoryAccountId(null);
      setHistoryError(null);
    }
  }, [accountId, isWalletReady, refreshCustomerHistory]);

  function updateCustomerDetail(
    field: keyof CustomerProfile,
    value: string,
  ) {
    const updatedDetails = { ...customerDetailsRef.current, [field]: value };
    customerDetailsRef.current = updatedDetails;
    setCustomerDetails(updatedDetails);
    setProfileError(null);
  }

  function resetForInvoiceScan() {
    setInvoice({
      amount: "",
      usdcAmount: "",
      merchant: "",
      fiatAmount: "",
      fiatCurrency: "INR",
      storeName: "",
      preferredToken: "NEAR",
      acceptedTokens: ["NEAR", "USDC"],
      items: [],
    });
    setPaymentState("pending");
    setTransactionHash("");
    setInvoiceNumber("");
    setErrorMessage(null);
    setHistorySaveError(null);
    setCopyMessage("");
  }

  const handleDecodedQr = useCallback((value: string) => {
    try {
      const decodedInvoice = parseQrInvoice(value);
      setInvoice(decodedInvoice);
      setPaymentState("pending");
      setTransactionHash("");
      setInvoiceNumber("");
      setErrorMessage(null);
      setHistorySaveError(null);
      setCopyMessage("");
      setScannerError(null);
      setScannerStatus("Payment request loaded.");
      callbackAttempt.current = "";
      setIsCameraOpen(false);
    } catch (error) {
      console.error("Unable to parse the scanned NEARPay invoice.", error);
      setScannerError(
        error instanceof Error
          ? error.message
          : "This QR code does not contain a valid payment request.",
      );
    }
  }, []);

  useEffect(() => {
    qrDecodedHandlerRef.current = handleDecodedQr;
  }, [handleDecodedQr]);

  useEffect(() => {
    if (!isCameraOpen) {
      return;
    }

    let active = true;
    let alreadyDecoded = false;
    let controls: IScannerControls | undefined;

    async function startCameraScanner() {
      try {
        const [{ BrowserQRCodeReader }, { DecodeHintType }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (!active) {
          return;
        }
        if (!videoRef.current) {
          throw new Error("The camera preview is not available.");
        }

        const reader = new BrowserQRCodeReader(
          new Map([[DecodeHintType.TRY_HARDER, true]]),
        );
        controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result, error) => {
            if (result && active && !alreadyDecoded) {
              alreadyDecoded = true;
              setScannerStatus("QR code detected.");
              qrDecodedHandlerRef.current(result.getText());
            } else if (
              error &&
              active &&
              !["NotFoundException", "ChecksumException", "FormatException"].includes(
                error.name,
              )
            ) {
              setScannerError(error.message);
            }
          },
        );
        scannerControlsRef.current = controls;
        if (!active) {
          controls.stop();
          scannerControlsRef.current = null;
        } else {
          setScannerStatus("Camera ready. Point it at the merchant QR code.");
        }
      } catch (error) {
        console.error("Unable to start the QR camera scanner.", error);
        if (active) {
          setIsCameraOpen(false);
          setScannerStatus("");
          setScannerError(
            error instanceof Error
              ? `Camera scanner unavailable: ${error.message}`
              : "Camera access was denied or is unavailable in this browser.",
          );
        }
      }
    }

    void startCameraScanner();
    return () => {
      active = false;
      controls?.stop();
      if (scannerControlsRef.current === controls) {
        scannerControlsRef.current = null;
      }
    };
  }, [isCameraOpen]);

  async function handleScreenshotUpload(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setScannerError("Choose an image file containing a QR code.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setScannerError("The QR screenshot must be 10 MB or smaller.");
      return;
    }

    const imageUrl = URL.createObjectURL(file);
    setIsDecodingImage(true);
    setScannerError(null);
    try {
      const [{ BrowserQRCodeReader }, { DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      const reader = new BrowserQRCodeReader(
        new Map([[DecodeHintType.TRY_HARDER, true]]),
      );
      const result = await reader.decodeFromImageUrl(imageUrl);
      handleDecodedQr(result.getText());
    } catch (error) {
      console.error("Unable to decode the uploaded QR screenshot.", error);
      setScannerError(
        `Could not read a payment QR code from this image: ${getQrDecodeErrorMessage(error)}`,
      );
    } finally {
      URL.revokeObjectURL(imageUrl);
      setIsDecodingImage(false);
    }
  }

  const verifyPayment = useCallback(
    async (hash: string, signerId: string) => {
      setPaymentState("verifying");
      setErrorMessage(null);
      try {
        const provider = new JsonRpcProvider({
          url: "https://rpc.testnet.near.org",
        });
        const outcome = await provider.viewTransactionStatus({
          txHash: hash,
          accountId: signerId,
          waitUntil: "FINAL",
        });

        if (!isSuccessfulStatus(outcome.status)) {
          throw new Error("The transaction did not succeed on NEAR testnet.");
        }

        const transfer = outcome.transaction.actions.find(
          (action) =>
            typeof action === "object" &&
            action !== null &&
            "Transfer" in action,
        );
        const transferAmount =
          transfer && typeof transfer === "object" && "Transfer" in transfer
            ? String(transfer.Transfer.deposit)
            : null;

        if (
          outcome.transaction.actions.length !== 1 ||
          outcome.transaction.receiver_id !== merchant ||
          transferAmount !== amountInYocto?.toString()
        ) {
          throw new Error(
            "The confirmed transaction does not match this invoice.",
          );
        }

        let historySaved = false;
        try {
          const wallet = walletRef.current;
          if (!wallet?.signMessage) {
            throw new Error(
              "This wallet cannot sign the secure receipt authorization. The payment succeeded, but shared merchant history could not be updated.",
            );
          }

          const normalizedCustomer = {
            name: customerDetails.name.trim(),
            email: customerDetails.email.trim(),
            mobile: customerDetails.mobile.trim(),
          };
          const authorizedReceipt = serializePaymentReceiptAuthorization({
            transactionHash: hash,
            accountId: signerId,
            merchantAccountId: merchant,
            amount,
            fiatAmount,
            fiatCurrency,
            usdcAmount: invoice.usdcAmount || amount,
            storeName: invoice.storeName,
            items: invoice.items,
            customer: normalizedCustomer,
          });
          const receiptDigest = Array.from(
            new Uint8Array(
              await window.crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(authorizedReceipt),
              ),
            ),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("");

          const challengeResponse = await fetch("/api/wallet-challenge", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              accountId: signerId,
              purpose: "payment-record",
              transactionHash: hash,
              receiptDigest,
            }),
          });
          const challengeResult: unknown = await challengeResponse.json();
          if (
            !challengeResponse.ok ||
            typeof challengeResult !== "object" ||
            challengeResult === null ||
            !("challengeId" in challengeResult) ||
            typeof challengeResult.challengeId !== "string" ||
            !("message" in challengeResult) ||
            typeof challengeResult.message !== "string" ||
            !("nonce" in challengeResult) ||
            typeof challengeResult.nonce !== "string" ||
            !("recipient" in challengeResult) ||
            typeof challengeResult.recipient !== "string"
          ) {
            const apiMessage =
              typeof challengeResult === "object" &&
              challengeResult !== null &&
              "error" in challengeResult &&
              typeof challengeResult.error === "string"
                ? challengeResult.error
                : "Shared payment history is unavailable.";
            throw new Error(apiMessage);
          }

          const signedMessage = await wallet.signMessage({
            message: challengeResult.message,
            nonce: Buffer.from(challengeResult.nonce, "base64"),
            recipient: challengeResult.recipient,
          });
          if (!signedMessage) {
            throw new Error(
              "The wallet did not return a signature for the secure payment receipt.",
            );
          }

          const persistResponse = await fetch("/api/payment-records", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              challengeId: challengeResult.challengeId,
              accountId: signerId,
              signedMessage,
              transactionHash: hash,
              receiptDigest,
              merchantAccountId: merchant,
              amount,
              fiatAmount,
              fiatCurrency,
              usdcAmount: invoice.usdcAmount || amount,
              storeName: invoice.storeName,
              items: invoice.items,
              customer: normalizedCustomer,
            }),
          });
          const persistResult: unknown = await persistResponse.json();
          if (!persistResponse.ok) {
            const apiMessage =
              typeof persistResult === "object" &&
              persistResult !== null &&
              "error" in persistResult &&
              typeof persistResult.error === "string"
                ? persistResult.error
                : "The merchant history server rejected the payment record.";
            throw new Error(apiMessage);
          }
          if (
            typeof persistResult !== "object" ||
            persistResult === null ||
            !("record" in persistResult) ||
            typeof persistResult.record !== "object" ||
            persistResult.record === null ||
            !("invoiceNumber" in persistResult.record) ||
            typeof persistResult.record.invoiceNumber !== "string"
          ) {
            throw new Error("The saved payment did not return an invoice number.");
          }
          setInvoiceNumber(persistResult.record.invoiceNumber);
          setHistorySaveError(null);
          historySaved = true;
        } catch (error) {
          console.error(
            "Unable to securely synchronize the verified customer payment.",
            error,
          );
          setHistorySaveError(
            error instanceof Error
              ? `Payment succeeded, but shared merchant history was not updated: ${error.message}`
              : "Payment succeeded, but shared merchant history could not be updated.",
          );
        }

        setTransactionHash(hash);
        setPaymentState("success");
        void refreshWalletBalances();
        if (historySaved) {
          void refreshCustomerHistory();
        }
      } catch (error) {
        console.error("NEAR testnet payment verification failed.", error);
        setPaymentState("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to verify this payment with NEAR testnet.",
        );
      }
    },
    [
      amount,
      amountInYocto,
      customerDetails,
      fiatAmount,
      fiatCurrency,
      invoice,
      merchant,
      refreshCustomerHistory,
      refreshWalletBalances,
    ],
  );

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    getWalletSelector()
      .then((walletSelector) => {
        if (!active) {
          return;
        }

        setSelector(walletSelector);
        setWalletModal(
          setupModal(walletSelector, {
            theme: "light",
            description: "Connect a Meteor or NEAR Wallet to pay.",
          }),
        );
        const updateAccount = () => {
          const accounts = walletSelector.store.getState().accounts;
          const nextAccountId =
            accounts.find((account) => account.active)?.accountId ??
            accounts[0]?.accountId ??
            null;
          const previousAccountId = activeAccountIdRef.current;
          activeAccountIdRef.current = nextAccountId;
          setAccountId(nextAccountId);
          if (previousAccountId !== nextAccountId) {
            setProfileError(null);
            if (!nextAccountId) {
                customerDetailsRef.current = emptyCustomerProfile;
                setCustomerDetails(emptyCustomerProfile);
                setProfileAccountId(null);
            } else {
                const hasPreConnectionDraft = Object.values(
                  customerDetailsRef.current,
                ).some((value) => value.trim().length > 0);
                const profileToUse =
                  previousAccountId === null && hasPreConnectionDraft
                    ? customerDetailsRef.current
                    : emptyCustomerProfile;
                customerDetailsRef.current = profileToUse;
                setCustomerDetails(profileToUse);
                setProfileAccountId(nextAccountId);
            }
          }
          const requestId = ++walletRequestIdRef.current;
          walletRef.current = null;
          setIsWalletReady(false);

          if (!nextAccountId) {
            return;
          }

          void walletSelector
            .wallet()
            .then((wallet) => {
              if (!active || requestId !== walletRequestIdRef.current) {
                return;
              }
              walletRef.current = wallet;
              setIsWalletReady(true);
            })
            .catch((error: unknown) => {
              console.error("Unable to prepare the connected NEAR wallet.", error);
              if (active && requestId === walletRequestIdRef.current) {
                setErrorMessage(
                  "The connected wallet could not be prepared. Reconnect it and try again.",
                );
              }
            });
        };

        updateAccount();
        const subscription = walletSelector.store.observable.subscribe(
          updateAccount,
        );
        unsubscribe = () => subscription.unsubscribe();
      })
      .catch((error: unknown) => {
        console.error("Unable to initialize the NEAR wallet selector.", error);
        if (active) {
          setErrorMessage(
            "Unable to initialize the NEAR testnet wallet connection.",
          );
          setPaymentState("error");
        }
      });

    return () => {
      active = false;
      walletRequestIdRef.current += 1;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (
      callbackError ||
      !callbackHash ||
      !accountId ||
      !isWalletReady ||
      !profileLoaded ||
      !amountInYocto ||
      !validMerchant
    ) {
      return;
    }

    if (
      callbackAttempt.current !== callbackHash
    ) {
      callbackAttempt.current = callbackHash;
      void verifyPayment(callbackHash, accountId);
    }
  }, [
    accountId,
    amountInYocto,
    callbackError,
    callbackHash,
    isWalletReady,
    profileLoaded,
    validMerchant,
    verifyPayment,
  ]);

  function connectWallet() {
    if (!walletModal) {
      setErrorMessage("The NEAR wallet selector is still initializing. Try again shortly.");
      return;
    }

    setErrorMessage(null);
    walletModal.show();
  }

  async function signOutWallet() {
    if (!selector) {
      setErrorMessage("Wallet selector is not available. Reload and try again.");
      return;
    }

    setIsSigningOut(true);
    setErrorMessage(null);
    try {
      const wallet = await selector.wallet();
      await wallet.signOut();
      walletRequestIdRef.current += 1;
      walletRef.current = null;
      setIsWalletReady(false);
      setAccountId(null);
      setPaymentState("pending");
      setTransactionHash("");
      setInvoiceNumber("");
      setHistorySaveError(null);
    } catch (error) {
      console.error("Unable to sign out of the customer NEAR wallet.", error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to sign out of the customer NEAR wallet.",
      );
    } finally {
      setIsSigningOut(false);
    }
  }

  async function approvePayment() {
    const wallet = walletRef.current;
    if (!selector || !accountId || !wallet || !amountInYocto || !validMerchant) {
      setErrorMessage("A valid invoice and connected NEAR wallet are required.");
      setPaymentState("error");
      return;
    }

    const customerValidationError = validateCustomerProfile(customerDetails);
    if (customerValidationError) {
      setProfileError(customerValidationError);
      return;
    }

    setPaymentState("signing");
    setErrorMessage(null);
    try {
      const callbackUrl = new URL(window.location.href);
      callbackUrl.searchParams.delete("transactionHashes");
      callbackUrl.searchParams.delete("errorMessage");
      callbackUrl.searchParams.delete("errorCode");
      callbackUrl.searchParams.set("amount", amount);
      callbackUrl.searchParams.set("merchant", merchant);
      callbackUrl.searchParams.set("fiatAmount", fiatAmount);
      callbackUrl.searchParams.set("fiatCurrency", fiatCurrency);
      if (invoice.storeName) {
        callbackUrl.searchParams.set("storeName", invoice.storeName);
      } else {
        callbackUrl.searchParams.delete("storeName");
      }
      const outcome = await wallet.signAndSendTransaction({
        signerId: accountId,
        receiverId: merchant,
        actions: [actionCreators.transfer(amountInYocto)],
        callbackUrl: callbackUrl.toString(),
      });
      const hash = outcome?.transaction?.hash;

      if (!hash) {
        setPaymentState("pending");
        setErrorMessage(
          "The wallet did not return a transaction hash yet. Check the wallet activity and reconnect if the transaction was not submitted.",
        );
        return;
      }

      await verifyPayment(hash, accountId);
    } catch (error) {
      console.error("NEAR testnet payment failed.", error);
      setPaymentState("error");
      const message =
        error instanceof Error ? error.message : "";
      setErrorMessage(
        message.includes("Couldn't open popup window")
          ? "Your browser blocked the NEAR wallet popup. Allow pop-ups for this site, then try again."
          : message || "Unable to complete this payment on NEAR testnet.",
      );
    }
  }

  async function copyTransactionHash() {
    try {
      await navigator.clipboard.writeText(transactionHash);
      setCopyMessage("Copied");
    } catch (error) {
      console.error("Unable to copy the transaction hash.", error);
      setCopyMessage("Copy failed");
    }
  }

  const hasInvoice = Boolean(amount || merchant);
  const invoiceError = !hasInvoice
    ? null
    : !amountInYocto
    ? "The invoice amount must be greater than zero and have no more than 24 decimal places."
    : !validMerchant
      ? "The merchant account in this payment link is invalid."
      : !invoice.acceptedTokens.includes("NEAR")
        ? "This invoice does not accept native NEAR, the only payment token available on testnet."
      : null;
  const liveFiatAmount = Number(fiatAmount);
  const liveNearAmount =
    tokenRates && Number.isFinite(liveFiatAmount) && liveFiatAmount > 0
      ? formatTokenAmount(
          calculateTokenAmount(
            liveFiatAmount,
            fiatCurrency,
            "NEAR",
            tokenRates,
          ),
        )
      : null;
  const liveUsdcAmount =
    tokenRates && Number.isFinite(liveFiatAmount) && liveFiatAmount > 0
      ? formatTokenAmount(
          calculateTokenAmount(
            liveFiatAmount,
            fiatCurrency,
            "USDC",
            tokenRates,
          ),
        )
      : null;
  const visibleError = callbackError
    ? `Wallet connection or payment failed: ${callbackError}`
    : errorMessage;
  const currentWalletBalances =
    walletBalances?.accountId === accountId ? walletBalances : null;
  const visibleCustomerHistory =
    historyAccountId === accountId ? customerHistory : [];

  return (
    <main className="min-h-screen bg-[#eef1f7] px-4 py-4 font-sans text-[#121633] sm:py-6">
      <div className="mx-auto max-w-[460px]">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="flex h-[34px] w-[34px] items-center justify-center rounded-[10px] bg-[#121633] text-lg font-black tracking-tight text-[#ff9f1c]">
              N
            </div>
            <div>
              <p className="text-lg font-black tracking-tight">NEARPay</p>
            </div>
          </div>
          <span className="rounded-full bg-[#fff3dc] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#a66300]">
            NEAR TESTNET
          </span>
        </header>

        <section className="mt-4">
        {!accountId ? (
          <section className="rounded-3xl border border-[#dde2ee] bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <p className="text-base font-black">
                  Connect your wallet
                </p>
                <p className="mt-1 text-sm leading-5 text-[#6b7392]">
                  Use your NEAR testnet wallet to authorize payment and load your history.
                </p>
              </div>
            <button
              type="button"
              onClick={connectWallet}
              disabled={!selector || !walletModal}
              className="min-h-11 w-full rounded-xl bg-[#ff9f1c] px-5 py-3 text-sm font-bold text-[#121633] transition hover:bg-[#f39200] disabled:cursor-not-allowed disabled:bg-[#d6dae6] disabled:text-[#8a90a8] sm:w-auto"
            >
              {!selector || !walletModal
                ? "Loading NEAR Wallets..."
                : "Connect Meteor / NEAR Wallet"}
            </button>
            </div>
            <details className="mt-4 border-t border-[#dde2ee] pt-3">
              <summary className="cursor-pointer text-xs font-semibold text-[#6b7392]">
                New to NEAR? Create a testnet wallet
              </summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <a
                  href="https://testnet.mynearwallet.com"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-[#dde2ee] px-3 py-2.5 text-center text-xs font-bold transition hover:border-[#ff9f1c] hover:bg-[#fff3dc]"
                >
                  Sign Up with MyNearWallet
                </a>
                <a
                  href="https://wallet.meteorwallet.app/?network=testnet"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-[#dde2ee] px-3 py-2.5 text-center text-xs font-bold transition hover:border-[#ff9f1c] hover:bg-[#fff3dc]"
                >
                  Sign Up with Meteor Wallet
                </a>
              </div>
            </details>
          </section>
        ) : null}
        {accountId ? (
          <div className="mt-4 rounded-3xl bg-gradient-to-br from-[#121633] to-[#1d2350] p-5 text-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                <p className="flex items-center gap-2 text-xs font-medium text-[#b9c0ee]">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#12b886] shadow-[0_0_0_4px_#12b88630]" />
                  <span className="break-all">{accountId}</span>
                </p>
                <button
                  type="button"
                  onClick={() => void signOutWallet()}
                  disabled={isSigningOut}
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20 disabled:opacity-50"
                >
                  {isSigningOut ? "Disconnecting..." : "Disconnect"}
                </button>
              </div>
            </div>
            <p className="mt-5 text-xs text-[#9aa2d6]">Live NEAR balance</p>
            <p className="mt-1 font-mono text-3xl font-black leading-tight text-[#ff9f1c] sm:text-[38px]">
              {walletBalanceLoading && !currentWalletBalances
                ? "Loading..."
                : currentWalletBalances?.nearBalance ?? "—"}
              <span className="ml-2 text-base font-bold">NEAR</span>
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/15 pt-3 text-xs text-[#b9c0ee]">
              <span>
                USDC:{" "}
                {walletBalanceLoading && !currentWalletBalances
                  ? "Loading..."
                  : currentWalletBalances?.usdcBalances.length
                    ? currentWalletBalances.usdcBalances
                        .map((token) => token.balance)
                        .join(", ")
                    : currentWalletBalances?.tokenWarning
                      ? "Unavailable"
                      : "none found"}
              </span>
              {currentWalletBalances?.explorerUrl ? (
                <a
                  href={currentWalletBalances.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-white underline underline-offset-2"
                >
                  View wallet on NEARBlocks
                </a>
              ) : null}
            </div>
            {walletBalanceError ? (
              <p role="alert" className="mt-3 text-xs text-red-200">
                {walletBalanceError}
              </p>
            ) : currentWalletBalances?.tokenWarning ? (
              <p className="mt-3 text-xs text-amber-200">
                {currentWalletBalances.tokenWarning}
              </p>
            ) : null}
          </div>
        ) : null}
        <section
          className="mt-4 space-y-4"
        >
          <div className="grid items-start gap-4">
        <section
          aria-labelledby="invoice-heading"
          className="min-w-0 rounded-3xl border border-[#dde2ee] bg-white p-5 shadow-sm"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="invoice-heading" className="text-xl font-black tracking-tight">
                Scan to pay
              </h2>
              <p className="mt-1 text-[13px] leading-5 text-[#6b7392]">
                Scan the merchant QR code or upload an image to load the bill.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 rounded-[13px] bg-[#eef1f7] p-1">
            <button
              type="button"
              onClick={() => {
                setScannerMode("camera");
                setScannerError(null);
                setIsCameraOpen(false);
              }}
              className={`min-h-10 px-2 py-2 text-[10px] font-bold uppercase tracking-wider transition sm:text-xs ${
                scannerMode === "camera"
                  ? "rounded-[10px] bg-[#121633] text-white"
                  : "rounded-[10px] text-[#6b7392] hover:bg-white"
              }`}
              aria-pressed={scannerMode === "camera"}
            >
              Camera scanner
            </button>
            <button
              type="button"
              onClick={() => {
                setScannerMode("upload");
                setIsCameraOpen(false);
                setScannerError(null);
                setScannerStatus("");
              }}
              className={`min-h-10 px-2 py-2 text-[10px] font-bold uppercase tracking-wider transition sm:text-xs ${
                scannerMode === "upload"
                  ? "rounded-[10px] bg-[#121633] text-white"
                  : "rounded-[10px] text-[#6b7392] hover:bg-white"
              }`}
              aria-pressed={scannerMode === "upload"}
            >
              Upload image
            </button>
          </div>
          {scannerMode === "camera" ? (
            <div className="mt-3">
              {isCameraOpen ? (
                <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                aria-label="Live QR scanner camera preview"
                className="aspect-video max-h-52 w-full border border-black bg-black object-cover"
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p aria-live="polite" className="text-xs text-neutral-600">
                {scannerStatus}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setIsCameraOpen(false);
                    setScannerStatus("");
                  }}
                  className="text-xs font-bold underline underline-offset-4"
                >
                  Close camera
                </button>
              </div>
                </>
              ) : (
                <div className="rounded-[18px] border-2 border-dashed border-[#c4cbe2] bg-[#f8f9fd] px-4 py-6 text-center">
                  <p className="text-sm font-bold">Scan a merchant QR code</p>
                  <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-[#6b7392]">
                    Allow camera access, then hold the QR code inside the
                    camera frame.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      resetForInvoiceScan();
                      setScannerError(null);
                      setScannerStatus("Requesting camera access...");
                      setIsCameraOpen(true);
                    }}
                    disabled={
                      paymentState === "signing" ||
                      paymentState === "verifying"
                    }
                    className="mt-3 min-h-11 rounded-xl bg-[#121633] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#1d2350] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Start camera scan
                  </button>
                </div>
              )}
            </div>
          ) : null}
          {scannerMode === "upload" ? (
            <label className="mt-3 flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-[18px] border-2 border-dashed border-[#c4cbe2] bg-[#f8f9fd] px-4 py-4 text-center transition hover:bg-[#eef1f7] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
              <span className="text-sm font-bold">
                {isDecodingImage ? "Reading QR image..." : "Choose QR screenshot"}
              </span>
              <span className="mt-2 text-xs leading-5 text-neutral-600">
                PNG, JPG, or another image format · up to 10 MB
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => void handleScreenshotUpload(event)}
                disabled={
                  isDecodingImage ||
                  paymentState === "signing" ||
                  paymentState === "verifying"
                }
                className="sr-only"
              />
            </label>
          ) : null}
          {scannerStatus && !isCameraOpen ? (
            <p role="status" className="mt-3 text-xs font-medium text-[#0c8a63]">
              {scannerStatus}
            </p>
          ) : null}
          {scannerError ? (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {scannerError}
            </p>
          ) : null}
        <div className="mt-4 rounded-2xl border border-[#dde2ee] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-bold">
              Merchant invoice
            </p>
            <span className="rounded-full bg-[#eef1f7] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#6b7392]">
              {hasInvoice ? "Ready to review" : "Awaiting QR"}
            </span>
          </div>
          {hasInvoice ? (
            <>
              <div className="mt-3 border-y border-[#dde2ee] py-3">
                <p className="text-xs font-bold uppercase tracking-widest text-[#6b7392]">
                  Merchant
                </p>
                <p className="mt-2 text-lg font-black">
                  {invoice.storeName || "NEAR merchant"}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-[#6b7392]">
                  {merchant}
                </p>
              </div>
              {invoice.items.length > 0 ? (
                <ul className="max-h-36 divide-y divide-[#dde2ee] overflow-y-auto">
                  {invoice.items.map((item, index) => (
                    <li
                      key={`${item.name}-${index}`}
                      className="flex justify-between gap-4 py-3 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold">{item.name}</span>
                        <span className="mt-1 block text-xs text-[#6b7392]">
                          Qty {item.quantity}
                        </span>
                      </span>
                      <span className="shrink-0 text-right font-semibold">
                        {item.fiatCurrency ?? "INR"}{" "}
                        {(
                          (item.unitPrice ?? item.unitPriceInr) * item.quantity
                        ).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-4 rounded-2xl bg-[#f8f9fd] p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-[#6b7392]">
                  Total · {fiatCurrency}
                </p>
                <p className="mt-1 text-2xl font-black tracking-tight text-[#121633]">
                  {fiatCurrency} {fiatAmount || "—"}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-[#dde2ee] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b7392]">
                    Pay on testnet
                  </p>
                  <p className="mt-1 text-base font-black">{amount} NEAR</p>
                </div>
                <div className="rounded-xl border border-[#dde2ee] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b7392]">
                    Conversion quote
                  </p>
                  <p className="mt-1 text-base font-black">
                    {invoice.usdcAmount || "—"} USDC
                  </p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-[#dde2ee] p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-widest">
                    Live conversion
                  </p>
                  {tokenRates ? (
                    <p className="text-[10px] text-neutral-500">
                      Updated {new Date(tokenRates.fetchedAt).toLocaleTimeString()}
                    </p>
                  ) : null}
                </div>
                {liveNearAmount && liveUsdcAmount ? (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <p className="text-sm">
                      <span className="block text-xs text-[#6b7392]">Indicative NEAR</span>
                      <span className="mt-1 block font-mono font-bold">{liveNearAmount} NEAR</span>
                    </p>
                    <p className="text-sm">
                      <span className="block text-xs text-[#6b7392]">Indicative USDC</span>
                      <span className="mt-1 block font-mono font-bold">{liveUsdcAmount} USDC</span>
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-neutral-600">
                    {tokenRatesError || "Live conversion is loading."}
                  </p>
                )}
                {tokenRates?.stale ? (
                  <p className="mt-2 text-xs text-amber-900">
                    Rates are temporarily stale; confirm the amount shown in your wallet.
                  </p>
                ) : null}
              </div>
              <p className="mt-3 text-xs leading-5 text-[#6b7392]">
                The USDC amount is a conversion reference. This testnet checkout
                currently transfers native NEAR only.
              </p>
            </>
          ) : (
            <div className="mt-5 rounded-[18px] border-2 border-dashed border-[#c4cbe2] bg-[#f8f9fd] px-5 py-10 text-center">
              <p className="text-sm font-bold">Your invoice will appear here</p>
              <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-[#6b7392]">
                Scan the merchant QR code or upload an image to load the amount
                and payment details.
              </p>
            </div>
          )}
        </div>
        </section>

          <section className="min-w-0 rounded-3xl border border-[#dde2ee] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black tracking-tight">
                  Your details
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-[#6b7392]">
                  Used for your receipt. Not saved in this browser.
                </p>
              </div>
            </div>
            <div className="mt-3">
              <label className="mt-3 block text-xs font-bold text-[#6b7392]">
                Name
                <input
                  type="text"
                  autoComplete="name"
                  maxLength={100}
                  value={customerDetails.name}
                  onChange={(event) =>
                    updateCustomerDetail("name", event.target.value)
                  }
                  disabled={!profileLoaded || paymentState === "signing" || paymentState === "verifying"}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-[#dde2ee] px-3.5 py-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#ff9f1c] focus:ring-2 focus:ring-[#ff9f1c]/20 disabled:bg-[#f8f9fd]"
                  placeholder="Your name"
                  required
                />
              </label>
              <label className="mt-3 block text-xs font-bold text-[#6b7392]">
                Email
                <input
                  type="email"
                  autoComplete="email"
                  maxLength={254}
                  value={customerDetails.email}
                  onChange={(event) =>
                    updateCustomerDetail("email", event.target.value)
                  }
                  disabled={!profileLoaded || paymentState === "signing" || paymentState === "verifying"}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-[#dde2ee] px-3.5 py-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#ff9f1c] focus:ring-2 focus:ring-[#ff9f1c]/20 disabled:bg-[#f8f9fd]"
                  placeholder="you@example.com"
                  required
                />
              </label>
              <label className="mt-3 block text-xs font-bold text-[#6b7392]">
                Mobile number
                <input
                  type="tel"
                  autoComplete="tel"
                  maxLength={24}
                  value={customerDetails.mobile}
                  onChange={(event) =>
                    updateCustomerDetail("mobile", event.target.value)
                  }
                  disabled={!profileLoaded || paymentState === "signing" || paymentState === "verifying"}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-[#dde2ee] px-3.5 py-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-[#ff9f1c] focus:ring-2 focus:ring-[#ff9f1c]/20 disabled:bg-[#f8f9fd]"
                  placeholder="+91 98765 43210"
                  required
                />
              </label>
            </div>
            {profileError ? (
              <p role="alert" className="mt-4 text-sm text-red-700">
                {profileError}
              </p>
            ) : null}
            <p className="mt-3 text-xs leading-5 text-[#6b7392]">
              Your details are not saved in this browser. They are sent to the
              merchant with your wallet-authorized, verified payment.
            </p>
          </section>
          </div>

        {paymentState === "success" ? (
          <section className="rounded-3xl border border-[#dde2ee] bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-base font-black text-emerald-800">
                ✓
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#6b7392]">
                  Payment status
                </p>
                <h2 className="mt-0.5 text-lg font-black text-[#0c8a63]">
                  Payment successfully paid
                </h2>
              </div>
            </div>
            {historySaveError ? (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-900">
                Payment confirmed; invoice could not be saved yet.
              </p>
            ) : (
              <>
                <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
                  Invoice generated
                </p>
                {invoiceNumber ? (
                  <p className="mt-3 rounded-xl border border-[#dde2ee] px-3 py-2 font-mono text-sm font-bold">
                    Invoice No: {invoiceNumber}
                  </p>
                ) : null}
              </>
            )}
            <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-500">
              Verified transaction hash
            </p>
            <p className="mt-2 break-all font-mono text-sm">
              {transactionHash}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={copyTransactionHash}
                className="min-h-10 rounded-xl border border-[#dde2ee] px-3 py-2 text-xs font-bold uppercase tracking-wider transition hover:border-[#ff9f1c] hover:bg-[#fff3dc]"
              >
                Copy hash
              </button>
              {copyMessage ? (
                <span aria-live="polite" className="text-sm">
                  {copyMessage}
                </span>
              ) : null}
            </div>
            <a
              href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(transactionHash)}`}
              target="_blank"
              rel="noreferrer"
              className="mt-5 inline-block text-sm font-semibold underline underline-offset-4"
            >
              View on NEAR Explorer
            </a>
            {!historySaveError ? (
              <a
                href={`/pos/receipt/${encodeURIComponent(transactionHash)}`}
                className="mt-4 inline-block text-sm font-bold underline underline-offset-4"
              >
                View / Print Invoice
              </a>
            ) : null}
            {historySaveError ? (
              <div className="mt-4">
                <p role="alert" className="text-sm text-red-700">
                  {historySaveError}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (accountId && transactionHash) {
                      void verifyPayment(transactionHash, accountId);
                    }
                  }}
                  disabled={!isWalletReady}
                  className="mt-3 rounded-xl border border-[#dde2ee] px-4 py-2 text-sm font-bold transition hover:border-[#ff9f1c] hover:bg-[#fff3dc] disabled:opacity-50"
                >
                  Retry merchant history sync
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="rounded-3xl border border-[#dde2ee] bg-white p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-500">
                  Payment
                </p>
                <p className="text-lg font-black">
                  {fiatCurrency} {fiatAmount || "—"}
                  {hasInvoice ? (
                    <span className="ml-2 font-mono text-xs font-semibold">
                      {amount} NEAR
                    </span>
                  ) : null}
                </p>
              </div>
              {invoiceError ? (
                <span role="alert" className="max-w-[52%] text-right text-[10px] leading-4 text-red-700">
                  {invoiceError}
                </span>
              ) : null}
            </div>
            {visibleError ? (
              <p role="alert" className="mb-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {visibleError}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (accountId) {
                  void approvePayment();
                } else {
                  connectWallet();
                }
              }}
              disabled={
                !hasInvoice ||
                (accountId
                  ? !amountInYocto ||
                    !validMerchant ||
                    !invoice.acceptedTokens.includes("NEAR") ||
                    !profileLoaded ||
                    Boolean(validateCustomerProfile(customerDetails)) ||
                    !isWalletReady ||
                    paymentState === "signing" ||
                    paymentState === "verifying"
                  : !selector || !walletModal)
              }
              className="min-h-12 w-full rounded-[14px] bg-[#ff9f1c] px-5 py-3.5 text-base font-bold text-[#121633] transition hover:bg-[#f39200] disabled:cursor-not-allowed disabled:bg-[#d6dae6] disabled:text-[#8a90a8]"
            >
              {!hasInvoice
                ? "Load invoice to continue"
                : !accountId
                  ? "Connect wallet to pay"
                  : paymentState === "signing"
                    ? "Waiting for wallet..."
                    : paymentState === "verifying"
                      ? "Verifying on NEAR..."
                      : !isWalletReady
                        ? "Preparing wallet..."
                        : "Approve & Pay"}
            </button>
            <p className="mt-2 text-center text-xs leading-5 text-[#6b7392]">
              Review the merchant and amount in your NEAR wallet before
              approving. Payment is sent on NEAR testnet.
            </p>
            {paymentState === "signing" || paymentState === "verifying" ? (
              <p role="status" className="mt-3 rounded-xl border border-[#dde2ee] p-3 text-center text-xs font-semibold">
                {paymentState === "signing"
                  ? "Complete the approval in your wallet."
                  : "Confirming your payment on the NEAR network..."}
              </p>
            ) : null}
          </section>
        )}
        </section>
        <section
          id="history-panel"
          aria-labelledby="history-heading"
          className="mt-4 rounded-3xl border border-[#dde2ee] bg-white p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 id="history-heading" className="text-xl font-black tracking-tight">
                Transaction history
              </h2>
              <p className="mt-1 text-[13px] text-[#6b7392]">
                Verified payments from this wallet.
              </p>
            </div>
            {historyLoading ? (
              <span role="status" className="text-xs font-bold text-[#6b7392]">
                Loading securely...
              </span>
            ) : null}
          </div>
          {historyError ? (
            <div className="mt-4">
              <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {historyError}
              </p>
              {accountId && isWalletReady ? (
                <button
                  type="button"
                  onClick={() => void refreshCustomerHistory()}
                  disabled={historyLoading}
                  className="mt-3 min-h-10 rounded-xl border border-[#dde2ee] px-3 py-2 text-xs font-bold uppercase tracking-wider transition hover:border-[#ff9f1c] hover:bg-[#fff3dc] disabled:opacity-50"
                >
                  Retry secure history load
                </button>
              ) : null}
            </div>
          ) : null}
          {!accountId ? (
            <p className="mt-5 rounded-xl border border-dashed border-[#c4cbe2] bg-[#f8f9fd] p-5 text-sm text-[#6b7392]">
              Connect your NEAR wallet to securely load your previous payments.
            </p>
          ) : historyLoading && visibleCustomerHistory.length === 0 ? (
            <p role="status" className="mt-5 rounded-xl border border-[#dde2ee] p-5 text-sm text-[#6b7392]">
              Signing a wallet request and loading your payments...
            </p>
          ) : visibleCustomerHistory.length > 0 ? (
            <ul className="mt-4 divide-y divide-[#dde2ee]">
              {visibleCustomerHistory.map((record, index) => (
                <li
                  key={
                    record.transactionHash ??
                    `${record.date}-${record.fiatAmount}-${index}`
                  }
                  className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono text-xs font-bold">
                        {record.invoiceNumber ?? "Payment"}
                      </p>
                      <span className="rounded-full bg-[#dcf7ec] px-2.5 py-1 text-[10px] font-bold text-[#0c8a63]">
                        {record.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-semibold">
                      {record.storeName || record.merchantAccountId || "NEAR merchant"}
                    </p>
                    <p                     className="mt-1 text-xs text-[#6b7392]">
                      {new Date(record.date).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                    {record.transactionHash ? (
                      <p className="mt-2 break-all font-mono text-[10px] text-[#6b7392]">
                        {record.transactionHash}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:justify-end">
                    <p className="text-sm font-black">
                      {record.fiatCurrency ?? "INR"} {record.fiatAmount}
                    </p>
                    {record.transactionHash ? (
                      <>
                        <a
                          href={`/pos/receipt/${encodeURIComponent(record.transactionHash)}`}
                          className="text-xs font-bold text-[#1d2350] underline underline-offset-4"
                        >
                          View invoice
                        </a>
                        <a
                          href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(record.transactionHash)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-bold text-[#1d2350] underline underline-offset-4"
                        >
                          Explorer
                        </a>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 rounded-xl border border-dashed border-[#c4cbe2] bg-[#f8f9fd] p-5 text-sm text-[#6b7392]">
              {historyLoading
                ? "Loading your verified payments..."
                : "No verified payments were found for this wallet."}
            </p>
          )}
        </section>
        </section>
      </div>
    </main>
  );
}

export default function PayPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-white text-sm font-semibold text-black">
          Loading payment...
        </main>
      }
    >
      <PaymentPortal />
    </Suspense>
  );
}
