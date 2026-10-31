import {
  setupWalletSelector,
  type WalletSelector,
} from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";

let selectorPromise: Promise<WalletSelector> | undefined;

export function getWalletSelector(): Promise<WalletSelector> {
  if (!selectorPromise) {
    selectorPromise = setupWalletSelector({
      network: "testnet",
      modules: [setupMeteorWallet(), setupMyNearWallet()],
    }).catch((error: unknown) => {
      selectorPromise = undefined;
      throw error;
    });
  }

  return selectorPromise;
}
