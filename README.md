# NEARPay

NEARPay is a testnet point-of-sale and customer checkout app built with Next.js, Tailwind CSS, and NEAR Wallet Selector.

> Payments are NEAR testnet transfers. USDC amounts are conversion quotes; this app does not transfer or settle USDC.

## Requirements

- Node.js 22.x
- npm

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Merchant preferences, products, customer profiles, and local history are stored in the browser. Live NEAR and USDC quote rates are served by `/api/token-rates`.

## Enable shared merchant history

1. Run [`lib/supabase-schema.sql`](./lib/supabase-schema.sql) in the Supabase SQL Editor.
2. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` for local development.
3. For production, set those variables in **Vercel → Project → Settings → Environment Variables** and redeploy.

The service-role/secret key must remain server-only. Never prefix it with `NEXT_PUBLIC_`, commit it, or send it in chat. See [`lib/SUPABASE_SETUP.md`](./lib/SUPABASE_SETUP.md) for details.

## Deploy

Import the GitHub repository into Vercel as a Next.js project. The project uses `npm run build`; Node.js 22.x is specified in `package.json`. Configure the Supabase environment variables before using shared history in production.

## Checks

```bash
npm run lint
npx tsc --noEmit --incremental false
npm run build
```
