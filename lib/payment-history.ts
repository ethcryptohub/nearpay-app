export type ReceiptItem = {
  name: string;
  quantity: number;
  unitPriceInr: number;
  unitPrice?: number;
  fiatCurrency?: "INR" | "USD";
};

export type PaymentRecord = {
  date: string;
  fiatAmount: string;
  fiatCurrency?: "INR" | "USD";
  usdcAmount: string;
  token?: "NEAR" | "USDC";
  tokenAmount?: string;
  items?: ReceiptItem[];
  storeName?: string;
  merchantAccountId?: string;
  senderAccountId?: string;
  customerName?: string;
  customerEmail?: string;
  customerMobile?: string;
  invoiceNumber?: string;
  transactionHash?: string;
  status: "Pending" | "Success" | "Failed";
};

export function formatInvoiceNumber(transactionId: string): string {
  const normalizedId = transactionId.replace(/-/g, "");
  if (!/^[\da-f]{32}$/i.test(normalizedId)) {
    throw new Error("The transaction has an invalid invoice identifier.");
  }
  return `NP-${normalizedId.toUpperCase()}`;
}

export function isPaymentRecord(value: unknown): value is PaymentRecord {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Partial<PaymentRecord>;
  return (
    typeof record.date === "string" &&
    !Number.isNaN(Date.parse(record.date)) &&
    typeof record.fiatAmount === "string" &&
    Number.isFinite(Number(record.fiatAmount)) &&
    (record.fiatCurrency === undefined ||
      record.fiatCurrency === "INR" ||
      record.fiatCurrency === "USD") &&
    typeof record.usdcAmount === "string" &&
    Number.isFinite(Number(record.usdcAmount)) &&
    (record.token === undefined ||
      record.token === "NEAR" ||
      record.token === "USDC") &&
    (record.tokenAmount === undefined ||
      (typeof record.tokenAmount === "string" &&
        Number.isFinite(Number(record.tokenAmount)))) &&
    (record.items === undefined ||
      (Array.isArray(record.items) && record.items.every(isReceiptItem))) &&
    (record.storeName === undefined || typeof record.storeName === "string") &&
    (record.merchantAccountId === undefined ||
      typeof record.merchantAccountId === "string") &&
    (record.senderAccountId === undefined ||
      typeof record.senderAccountId === "string") &&
    (record.customerName === undefined ||
      typeof record.customerName === "string") &&
    (record.customerEmail === undefined ||
      typeof record.customerEmail === "string") &&
    (record.customerMobile === undefined ||
      typeof record.customerMobile === "string") &&
    (record.invoiceNumber === undefined ||
      (typeof record.invoiceNumber === "string" &&
        record.invoiceNumber.length > 0)) &&
    (record.transactionHash === undefined ||
      typeof record.transactionHash === "string") &&
    (record.status === "Pending" ||
      record.status === "Success" ||
      record.status === "Failed")
  );
}

export function isReceiptItem(value: unknown): value is ReceiptItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const item = value as Partial<ReceiptItem>;
  return (
    typeof item.name === "string" &&
    item.name.trim().length > 0 &&
    typeof item.quantity === "number" &&
    Number.isInteger(item.quantity) &&
    item.quantity > 0 &&
    typeof item.unitPriceInr === "number" &&
    Number.isFinite(item.unitPriceInr) &&
    item.unitPriceInr >= 0 &&
    (item.unitPrice === undefined ||
      (typeof item.unitPrice === "number" &&
        Number.isFinite(item.unitPrice) &&
        item.unitPrice >= 0)) &&
    (item.fiatCurrency === undefined ||
      item.fiatCurrency === "INR" ||
      item.fiatCurrency === "USD")
  );
}
