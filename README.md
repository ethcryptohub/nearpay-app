# NEARPay

NEARPay is a point-of-sale and customer checkout app for merchants accepting native NEAR. A merchant creates a sale and displays a payment QR code; a customer scans or uploads the QR, connects a NEAR wallet, and approves the payment.

> Payments are native NEAR testnet transfers. USDC amounts are conversion quotes only; this app does not transfer or settle USDC.

## Try it locally

Requirements: Node.js 22.x and npm.

For the complete checkout and shared merchant data, first configure Supabase by following [`lib/SUPABASE_SETUP.md`](./lib/SUPABASE_SETUP.md).

```bash
npm install
npm run dev
```

Without a publicly reachable deployment, a `localhost` payment QR is only reachable from the device running the app.

1. Open [http://localhost:3000](http://localhost:3000) and choose **Access Merchant POS**.
2. Connect a merchant NEAR testnet wallet, prepare a sale, and select **Generate payment QR**.
3. Open the **Customer Payment Portal**, scan the QR code or upload its screenshot, connect a customer wallet, and approve the testnet transfer.
4. Return to the POS to see the payment confirmation. Merchant history and customer transaction history are also available in the app.

The app uses NEAR Wallet Selector and verifies successful transfers on NEAR testnet. Merchant settings, products, and shared payment history use Supabase. Live NEAR and USDC quote rates are served by `/api/token-rates`.

## NEAR HACKATHON

**Track fit:** Real-World Money (`realworld`), for merchant payments. The implemented payment rail is native NEAR testnet—not NEAR Intents or USDC settlement.

NEARPay predates the hackathon: the pre-event snapshot already included a NEAR testnet POS and customer checkout. Event-period changes added shared merchant data, customer wallet balances and transaction history, payment-confirmation improvements, invoice numbering, and merchant-specific product handling. The pre-event baseline and event-period snapshot are separated by the `pre-hackathon` and `hackathon-submission` tags:

- [Pre-hackathon baseline](https://github.com/ethcryptohub/nearpay-app/tree/pre-hackathon)
- [Hackathon submission snapshot](https://github.com/ethcryptohub/nearpay-app/tree/hackathon-submission)
- [Changes between snapshots](https://github.com/ethcryptohub/nearpay-app/compare/pre-hackathon...hackathon-submission)

The public repository is [github.com/ethcryptohub/nearpay-app](https://github.com/ethcryptohub/nearpay-app). A public demo post has not yet been linked. The team must publish its own demo post and provide the link before submitting.

## Shared merchant history

To enable cross-device merchant history, follow [`lib/SUPABASE_SETUP.md`](./lib/SUPABASE_SETUP.md). This requires the Supabase schema and the public and server-only environment variables described there.

The service-role/secret key must remain server-only. Never prefix it with `NEXT_PUBLIC_`, commit it, or send it in chat.

## Stack

Next.js, React, Tailwind CSS, NEAR Wallet Selector, `near-api-js`, Supabase, ZXing QR scanning, and `react-qr-code`. See [`package.json`](./package.json) for the full dependency list.

## Deploy

Import the GitHub repository into Vercel as a Next.js project. The project uses `npm run build`; Node.js 22.x is specified in `package.json`. Configure the Supabase environment variables before using shared history in production.

## License

This project is licensed under the [MIT License](./LICENSE).

## Checks

```bash
npm run lint
npx tsc --noEmit --incremental false
npm run build
```
