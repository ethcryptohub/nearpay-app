# Shared payment history setup

Live NEAR/USDC conversion is fetched from the server-side CoinGecko route and refreshed by the POS. Customer details are saved only with a successful, wallet-authorized payment. A completed payment is sent to shared merchant history only after the customer wallet signs a one-time NEP-413 receipt authorization and the server independently verifies the successful NEAR testnet transfer.

To enable cross-device merchant history:

1. In the Supabase project connected to this Vercel app, run [`supabase-schema.sql`](./supabase-schema.sql) in its SQL Editor to create the required tables and access policies. If migrating an existing installation, run [`supabase-migrate.sql`](./supabase-migrate.sql) afterward to copy rows from the earlier `merchant_products` and `payment_records` tables. The migration script does not create tables.
2. In the Supabase dashboard, copy the **Project URL**, public **anon** API key, and server-side **service_role** or **secret** API key.
3. For local development, add the values to `.env.local` in the project root:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-key
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-server-only-secret-key
   ```

4. For Vercel, add all four variables in **Project → Settings → Environment Variables** for Production (and Preview if needed). Keep the service-role key server-only: never use a `NEXT_PUBLIC_` prefix, put it in browser code, commit it, or send it in chat.
5. Restart local Next.js after editing `.env.local`. Vercel needs a new deployment after environment variables change.
6. After a successful payment, the customer signs the receipt authorization. A merchant connects the configured wallet on the History page and selects **Sync shared history**.

Set all four variables in Vercel → **Project → Settings → Environment Variables** and redeploy. Make sure `SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` identify the same project. Merchant catalog and settings reads use the server routes so they share the same Supabase connection as authorized writes. Keep the service-role key server-only; never expose or commit `SUPABASE_SERVICE_ROLE_KEY`.

Shared payment records include customer name, email, and mobile number. Merchant history is returned only after a one-time wallet signature proves control of the merchant account. Customer details are not stored in browser storage and are saved only when a verified payment completes.

## Repair `wallet_challenges` permission errors

If checkout reports `permission denied for table wallet_challenges`, open the project's Supabase **SQL Editor**, run [`supabase-permissions-fix.sql`](./supabase-permissions-fix.sql), and confirm its result columns are all `true`. This grants only the server-side `service_role` access; browser roles remain revoked by the main schema.

If the permission check is all `true` but the live app still reports a permission error, verify in Vercel → **Project Settings → Environment Variables** that `SUPABASE_SERVICE_ROLE_KEY` is set for Production to the project's server-side `service_role` or secret API key—not the anon/publishable key. Do not reveal or paste the key anywhere. Redeploy after correcting it, then retry **Retry merchant history sync**. The failed sync did not invalidate the already-verified NEAR payment.
