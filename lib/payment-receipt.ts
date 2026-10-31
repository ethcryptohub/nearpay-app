import type { CustomerProfile } from "./customer-profile";
import type { ReceiptItem } from "./payment-history";

export type PaymentReceiptAuthorization = {
  transactionHash: string;
  accountId: string;
  merchantAccountId: string;
  amount: string;
  fiatAmount: string;
  fiatCurrency: "INR" | "USD";
  usdcAmount: string;
  storeName: string;
  items: ReceiptItem[];
  customer: CustomerProfile;
};

export function serializePaymentReceiptAuthorization(
  receipt: PaymentReceiptAuthorization,
): string {
  return JSON.stringify({
    transactionHash: receipt.transactionHash,
    accountId: receipt.accountId,
    merchantAccountId: receipt.merchantAccountId,
    amount: receipt.amount,
    fiatAmount: receipt.fiatAmount,
    fiatCurrency: receipt.fiatCurrency,
    usdcAmount: receipt.usdcAmount,
    storeName: receipt.storeName,
    items: receipt.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPriceInr: item.unitPriceInr,
    })),
    customer: {
      name: receipt.customer.name,
      email: receipt.customer.email,
      mobile: receipt.customer.mobile,
    },
  });
}
