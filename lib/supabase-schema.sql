create table if not exists public.wallet_challenges (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  purpose text not null check (purpose in ('merchant-history', 'payment-record')),
  nonce text not null,
  recipient text not null,
  message text not null default '',
  transaction_hash text,
  receipt_digest text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists wallet_challenges_expiry_idx
  on public.wallet_challenges (expires_at);

create table if not exists public.payment_records (
  transaction_hash text primary key,
  date timestamptz not null,
  fiat_amount numeric(20, 2) not null,
  fiat_currency text not null check (fiat_currency in ('INR', 'USD')),
  usdc_amount numeric(30, 6) not null,
  token text not null check (token in ('NEAR', 'USDC')),
  token_amount numeric(40, 24) not null,
  items jsonb not null default '[]'::jsonb,
  store_name text not null,
  merchant_account_id text not null,
  sender_account_id text not null,
  customer_name text not null,
  customer_email text not null,
  customer_mobile text not null,
  status text not null check (status in ('Pending', 'Success', 'Failed')),
  created_at timestamptz not null default now()
);

create index if not exists payment_records_merchant_date_idx
  on public.payment_records (merchant_account_id, date desc);

alter table public.wallet_challenges enable row level security;
alter table public.payment_records enable row level security;

revoke all on public.wallet_challenges from anon, authenticated;
revoke all on public.payment_records from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.wallet_challenges to service_role;
grant select, insert, update, delete on public.payment_records to service_role;
