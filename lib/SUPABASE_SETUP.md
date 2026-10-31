# Shared payment history setup

Live NEAR/USDC conversion is fetched from the server-side CoinGecko route and refreshed by the POS. Customer profile fields are saved in that customer's browser under their connected NEAR account. A completed payment is sent to shared merchant history only after the customer wallet signs a one-time NEP-413 receipt authorization and the server independently verifies the successful NEAR testnet transfer.

To enable cross-device merchant history:

1. Create a Supabase project and run [`supabase-schema.sql`](./supabase-schema.sql) in its SQL Editor.
2. In the Supabase dashboard, copy the **Project URL** and the server-side **service_role** or **secret** API key. Do not use the public/publishable key here.
3. For local development, add the values to `.env.local` in the project root:

   ```dotenv
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-server-only-secret-key
   ```

4. For Vercel, add both variables in **Project → Settings → Environment Variables** for Production (and Preview if needed). Keep the key server-only: never use a `NEXT_PUBLIC_` prefix, put it in browser code, commit it, or send it in chat.
5. Restart local Next.js after editing `.env.local`. Vercel needs a new deployment after environment variables change.
6. After a successful payment, the customer signs the receipt authorization. A merchant connects the configured wallet on the History page and selects **Sync shared history**.

Shared payment records include customer name, email, and mobile number. Merchant history is returned only after a one-time wallet signature proves control of the merchant account. Customer profile editing remains local to the customer's browser; it is not a globally hosted profile.
