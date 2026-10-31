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
  isReceiptItem,
  savePaymentRecord,
  type ReceiptItem,
} from "../../lib/payment-history";
import type { PaymentToken } from "../../lib/token-rates";
import { getWalletSelector } from "../../lib/near-wallet-selector";
import {
  customerProfileStorageKey,
  emptyCustomerProfile,
  parseCustomerProfile,
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
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [paymentState, setPaymentState] = useState<PaymentState>("pending");
  const [transactionHash, setTransactionHash] = useState("");
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

  function updateCustomerDetail(
    field: keyof CustomerProfile,
    value: string,
  ) {
    const updatedDetails = { ...customerDetailsRef.current, [field]: value };
    customerDetailsRef.current = updatedDetails;
    setCustomerDetails(updatedDetails);
    setProfileMessage("");
    setProfileError(null);
  }

  function saveCustomerProfile(): boolean {
    if (!accountId) {
      setProfileError("Connect your NEAR wallet before saving a profile.");
      return false;
    }
    const validationError = validateCustomerProfile(customerDetails);
    if (validationError) {
      setProfileError(validationError);
      setProfileMessage("");
      return false;
    }

    setIsSavingProfile(true);
    try {
      const normalizedProfile = {
        name: customerDetails.name.trim(),
        email: customerDetails.email.trim(),
        mobile: customerDetails.mobile.trim(),
      };
      localStorage.setItem(
        customerProfileStorageKey(accountId),
        JSON.stringify(normalizedProfile),
      );
      customerDetailsRef.current = normalizedProfile;
      setCustomerDetails(normalizedProfile);
      setProfileError(null);
      setProfileMessage("Profile saved on this device for this wallet.");
      return true;
    } catch (error) {
      console.error("Unable to save the customer wallet profile.", error);
      setProfileError(
        "Profile could not be saved in this browser. Check storage permissions.",
      );
      setProfileMessage("");
      return false;
    } finally {
      setIsSavingProfile(false);
    }
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

        try {
          const record = {
            date: new Date().toISOString(),
            fiatAmount,
            fiatCurrency,
            usdcAmount: invoice.usdcAmount || amount,
            token: "NEAR" as const,
            tokenAmount: amount,
            items: invoice.items,
            storeName: invoice.storeName,
            merchantAccountId: merchant,
            senderAccountId: outcome.transaction.signer_id,
            customerName: customerDetails.name.trim(),
            customerEmail: customerDetails.email.trim(),
            customerMobile: customerDetails.mobile.trim(),
            transactionHash: hash,
            status: "Success" as const,
          };
          savePaymentRecord(record);
          setHistorySaveError(null);
        } catch (error) {
          console.error("Unable to save the payment to browser history.", error);
          setHistorySaveError(
            "Payment succeeded, but this browser could not save the transaction history.",
          );
        }

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
          setHistorySaveError(null);
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
          setProfileMessage("");
          if (previousAccountId !== nextAccountId) {
            setProfileError(null);
            setProfileAccountId(null);
            if (!nextAccountId) {
              customerDetailsRef.current = emptyCustomerProfile;
              setCustomerDetails(emptyCustomerProfile);
            } else {
              try {
                const savedProfile = parseCustomerProfile(
                  localStorage.getItem(
                    customerProfileStorageKey(nextAccountId),
                  ),
                );
                const hasSavedProfile = Object.values(savedProfile).some(
                  (value) => value.trim().length > 0,
                );
                const hasPreConnectionDraft = Object.values(
                  customerDetailsRef.current,
                ).some((value) => value.trim().length > 0);
                const profileToUse =
                  previousAccountId === null &&
                  hasPreConnectionDraft &&
                  !hasSavedProfile
                    ? customerDetailsRef.current
                    : savedProfile;
                customerDetailsRef.current = profileToUse;
                setCustomerDetails(profileToUse);
              } catch (error) {
                console.error(
                  "Unable to load the customer wallet profile.",
                  error,
                );
                customerDetailsRef.current = emptyCustomerProfile;
                setCustomerDetails(emptyCustomerProfile);
                setProfileError(
                  "Saved profile details could not be loaded. Update the fields and save again.",
                );
              } finally {
                setProfileAccountId(nextAccountId);
              }
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

    if (!saveCustomerProfile()) {
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

      try {
        savePaymentRecord({
          date: new Date().toISOString(),
          fiatAmount,
          fiatCurrency,
          usdcAmount: invoice.usdcAmount || amount,
          token: "NEAR",
          tokenAmount: amount,
          items: invoice.items,
          storeName: invoice.storeName,
          merchantAccountId: merchant,
          senderAccountId: accountId,
          customerName: customerDetails.name.trim(),
          customerEmail: customerDetails.email.trim(),
          customerMobile: customerDetails.mobile.trim(),
          transactionHash: hash,
          status: "Pending",
        });
      } catch (error) {
        console.error("Unable to save the pending customer payment.", error);
        setHistorySaveError(
          "Payment was submitted, but its pending status could not be saved in this browser.",
        );
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
  const customerDetailsError = validateCustomerProfile(customerDetails);
  const invoiceError = !hasInvoice
    ? null
    : !amountInYocto
    ? "The invoice amount must be greater than zero and have no more than 24 decimal places."
    : !validMerchant
      ? "The merchant account in this payment link is invalid."
      : !invoice.acceptedTokens.includes("NEAR")
        ? "This invoice does not accept native NEAR, the only payment token available on testnet."
      : null;
  const visibleError = callbackError
    ? `Wallet connection or payment failed: ${callbackError}`
    : errorMessage;

  return (
    <main className="min-h-screen bg-[#f4f4f1] px-4 py-6 font-sans text-black sm:px-6 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-5 border-b border-black pb-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center bg-black text-lg font-black tracking-tight text-white">
              N
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em]">
                NEARPAY
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                Secure customer checkout
              </p>
            </div>
          </div>
          <span className="border border-black bg-white px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em]">
            NEAR TESTNET
          </span>
        </header>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-neutral-500">
              Payment portal
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              Customer checkout
            </h1>
          </div>
          <p className="max-w-md text-sm leading-6 text-neutral-600">
            Review your request, add your contact details, and approve securely
            with your NEAR wallet.
          </p>
        </div>

        <section className="mt-7 border border-black bg-white p-5 shadow-[4px_4px_0_0_#111] sm:p-7">
        {!accountId ? (
          <section className="rounded-xl border border-black bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-5">
              <div className="max-w-xl">
                <p className="text-xs font-black uppercase tracking-[0.2em]">
              Wallet authorization required
            </p>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              Connect a NEAR testnet wallet to approve this payment. You can
              review the invoice and enter your details before connecting.
            </p>
              </div>
            <button
              type="button"
              onClick={connectWallet}
              disabled={!selector || !walletModal}
              className="w-full bg-black px-6 py-4 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {!selector || !walletModal
                ? "Loading NEAR Wallets..."
                : "Connect Meteor / NEAR Wallet"}
            </button>
            </div>
            <div className="mt-7 border-t border-neutral-200 pt-5">
              <p className="text-xs font-black uppercase tracking-[0.2em]">
                New to NEAR?
              </p>
              <p className="mt-2 text-sm text-neutral-600">
                Create a testnet wallet, then return here to connect it.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <a
                  href="https://testnet.mynearwallet.com"
                  target="_blank"
                  rel="noreferrer"
                  className="border border-black px-4 py-3 text-center text-sm font-bold transition hover:bg-black hover:text-white"
                >
                  Sign Up with MyNearWallet
                </a>
                <a
                  href="https://wallet.meteorwallet.app/?network=testnet"
                  target="_blank"
                  rel="noreferrer"
                  className="border border-black px-4 py-3 text-center text-sm font-bold transition hover:bg-black hover:text-white"
                >
                  Sign Up with Meteor Wallet
                </a>
              </div>
            </div>
          </section>
        ) : null}
        {accountId ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 border border-black bg-neutral-50 p-4">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em]">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full bg-green-600"
                />
                Wallet connected
              </p>
              <p className="mt-2 break-all font-mono text-sm font-semibold">
                {accountId}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void signOutWallet()}
              disabled={isSigningOut}
              className="border border-black px-4 py-2 text-xs font-bold uppercase tracking-widest transition hover:bg-black hover:text-white disabled:opacity-50"
            >
              {isSigningOut ? "Signing out..." : "Sign Out"}
            </button>
          </div>
        ) : null}
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <section className="rounded-xl border border-black bg-white p-5 sm:p-6 lg:col-start-1 lg:row-start-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
                Step 01
              </p>
              <h2 className="mt-2 text-xl font-black tracking-tight">
                Load payment request
              </h2>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                Scan the merchant QR code or choose an image from your device.
              </p>
            </div>
            <span className="hidden border border-neutral-300 px-2 py-1 text-[10px] font-bold uppercase tracking-widest sm:block">
              QR checkout
            </span>
          </div>
          <div className="mt-5 grid grid-cols-2 border border-black p-1">
            <button
              type="button"
              onClick={() => {
                setScannerMode("camera");
                setScannerError(null);
                setIsCameraOpen(false);
              }}
              className={`px-3 py-3 text-xs font-bold uppercase tracking-wider transition sm:text-sm ${
                scannerMode === "camera"
                  ? "bg-black text-white"
                  : "bg-white text-black hover:bg-neutral-100"
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
              className={`px-3 py-3 text-xs font-bold uppercase tracking-wider transition sm:text-sm ${
                scannerMode === "upload"
                  ? "bg-black text-white"
                  : "bg-white text-black hover:bg-neutral-100"
              }`}
              aria-pressed={scannerMode === "upload"}
            >
              Upload image
            </button>
          </div>
          {scannerMode === "camera" ? (
            <div className="mt-5">
              {isCameraOpen ? (
                <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                aria-label="Live QR scanner camera preview"
                className="aspect-video w-full border border-black bg-black object-cover"
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
                <div className="border border-dashed border-neutral-400 bg-neutral-50 px-5 py-9 text-center">
                  <p className="text-sm font-bold">Scan a merchant QR code</p>
                  <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-neutral-600">
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
                    className="mt-5 bg-black px-5 py-3 text-xs font-bold uppercase tracking-widest text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Start camera scan
                  </button>
                </div>
              )}
            </div>
          ) : null}
          {scannerMode === "upload" ? (
            <label className="mt-5 flex min-h-44 cursor-pointer flex-col items-center justify-center border border-dashed border-neutral-400 bg-neutral-50 px-5 py-8 text-center transition hover:bg-neutral-100 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
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
            <p role="status" className="mt-3 text-xs font-medium text-emerald-800">
              {scannerStatus}
            </p>
          ) : null}
          {scannerError ? (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {scannerError}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-black bg-white p-5 sm:p-6 lg:col-start-2 lg:row-start-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
                Step 02
              </p>
              <h2 className="mt-2 text-xl font-black tracking-tight">
                Invoice summary
              </h2>
            </div>
            <span className="border border-neutral-300 px-2 py-1 text-[10px] font-bold uppercase tracking-widest">
              {hasInvoice ? "Ready to review" : "Awaiting QR"}
            </span>
          </div>
          {hasInvoice ? (
            <>
              <div className="mt-5 border-y border-black py-5">
                <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
                  Merchant
                </p>
                <p className="mt-2 text-lg font-black">
                  {invoice.storeName || "NEAR merchant"}
                </p>
                <p className="mt-1 break-all font-mono text-xs text-neutral-600">
                  {merchant}
                </p>
              </div>
              {invoice.items.length > 0 ? (
                <ul className="divide-y divide-neutral-200">
                  {invoice.items.map((item, index) => (
                    <li
                      key={`${item.name}-${index}`}
                      className="flex justify-between gap-4 py-3 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold">{item.name}</span>
                        <span className="mt-1 block text-xs text-neutral-500">
                          Qty {item.quantity}
                        </span>
                      </span>
                      <span className="shrink-0 text-right font-semibold">
                        INR{" "}
                        {(item.unitPriceInr * item.quantity).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-4 border border-black bg-neutral-50 p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-neutral-500">
                  Total · {fiatCurrency}
                </p>
                <p className="mt-2 text-3xl font-black tracking-tight">
                  {fiatCurrency} {fiatAmount || "—"}
                </p>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="border border-black p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    Pay on testnet
                  </p>
                  <p className="mt-2 text-lg font-black">{amount} NEAR</p>
                </div>
                <div className="border border-neutral-300 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    Conversion quote
                  </p>
                  <p className="mt-2 text-lg font-black">
                    {invoice.usdcAmount || "—"} USDC
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-5 text-neutral-500">
                The USDC amount is a conversion reference. This testnet checkout
                currently transfers native NEAR only.
              </p>
            </>
          ) : (
            <div className="mt-5 border border-dashed border-neutral-400 bg-neutral-50 px-5 py-10 text-center">
              <p className="text-sm font-bold">Your invoice will appear here</p>
              <p className="mx-auto mt-2 max-w-xs text-xs leading-5 text-neutral-600">
                Scan the merchant QR code or upload an image to load the amount
                and payment details.
              </p>
            </div>
          )}
        </section>

          <section className="rounded-xl border border-black bg-white p-5 sm:p-6 lg:col-start-1 lg:row-start-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
                  Step 03
                </p>
                <h2 className="mt-2 text-xl font-black tracking-tight">
                  Your details
                </h2>
                <p className="mt-2 text-xs leading-5 text-neutral-600">
                  Enter your contact details for the receipt. You can do this
                  before or after connecting your wallet.
                </p>
              </div>
              <span className="border border-neutral-300 px-2 py-1 text-[10px] font-bold uppercase tracking-widest">
                {accountId ? (profileLoaded ? "Wallet profile" : "Loading") : "Checkout"}
              </span>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-bold uppercase tracking-widest sm:col-span-2">
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
                  className="mt-2 w-full border border-neutral-300 px-4 py-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-black disabled:bg-neutral-50"
                  placeholder="Your name"
                  required
                />
              </label>
              <label className="block text-xs font-bold uppercase tracking-widest">
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
                  className="mt-2 w-full border border-neutral-300 px-4 py-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-black disabled:bg-neutral-50"
                  placeholder="you@example.com"
                  required
                />
              </label>
              <label className="block text-xs font-bold uppercase tracking-widest">
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
                  className="mt-2 w-full border border-neutral-300 px-4 py-3 text-sm font-normal normal-case tracking-normal outline-none focus:border-black disabled:bg-neutral-50"
                  placeholder="+91 98765 43210"
                  required
                />
              </label>
            </div>
            {profileError ? (
              <p role="alert" className="mt-4 text-sm text-red-700">
                {profileError}
              </p>
            ) : customerDetailsError ? (
              <p className="mt-4 text-sm text-neutral-600">
                {customerDetailsError}
              </p>
            ) : null}
            {profileMessage ? (
              <p role="status" className="mt-4 text-sm font-medium">
                {profileMessage}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void saveCustomerProfile()}
              disabled={!accountId || !profileLoaded || isSavingProfile}
              className="mt-5 border border-black px-4 py-3 text-sm font-bold transition hover:bg-black hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSavingProfile ? "Saving profile..." : "Save profile"}
            </button>
            <p className="mt-3 text-xs leading-5 text-neutral-500">
              {accountId
                ? "Profile storage is local to this browser. The merchant receives these details only with your wallet-authorized, verified payment."
                : "Connect your wallet to save these details to its local profile. Your contact fields remain editable until then."}
            </p>
          </section>
        
        {paymentState === "success" ? (
          <section className="rounded-xl border border-emerald-700 bg-white p-5 sm:p-6 lg:col-start-2 lg:row-start-2">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-lg font-black text-emerald-800">
                ✓
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
                  Payment complete
                </p>
                <h2 className="mt-1 text-xl font-black">Payment successful</h2>
              </div>
            </div>
            <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
              Verified transaction hash
            </p>
            <p className="mt-2 break-all font-mono text-sm">
              {transactionHash}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={copyTransactionHash}
                className="border border-black px-4 py-3 text-xs font-bold uppercase tracking-wider transition hover:bg-black hover:text-white"
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
            <a
              href={`/pos/receipt/${encodeURIComponent(transactionHash)}`}
              className="mt-4 inline-block text-sm font-bold underline underline-offset-4"
            >
              View / Print Receipt
            </a>
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
                  className="mt-3 border border-black px-4 py-2 text-sm font-bold transition hover:bg-black hover:text-white disabled:opacity-50"
                >
                  Retry merchant history sync
                </button>
              </div>
            ) : null}
          </section>
        ) : (
          <section className="rounded-xl border border-black bg-white p-5 sm:p-6 lg:col-start-2 lg:row-start-2">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
              Step 04
            </p>
            <h2 className="mt-2 text-xl font-black tracking-tight">
              Secure payment
            </h2>
            {invoiceError ? (
              <p role="alert" className="mt-4 border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                {invoiceError}
              </p>
            ) : null}
            {visibleError ? (
              <p role="alert" className="mt-4 border border-red-300 bg-red-50 p-3 text-sm text-red-800">
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
              className="mt-5 w-full bg-black px-6 py-4 text-sm font-bold uppercase tracking-widest text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
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
            <p className="mt-3 text-center text-xs leading-5 text-neutral-500">
              Review the merchant and amount in your NEAR wallet before
              approving. Payment is sent on NEAR testnet.
            </p>
            {paymentState === "signing" || paymentState === "verifying" ? (
              <p role="status" className="mt-4 border border-neutral-300 p-3 text-center text-xs font-semibold">
                {paymentState === "signing"
                  ? "Complete the approval in your wallet."
                  : "Confirming your payment on the NEAR network..."}
              </p>
            ) : null}
          </section>
        )}
        </div>
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
