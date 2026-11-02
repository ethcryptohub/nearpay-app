create table if not exists public.products (
  id text not null,
  merchant_id text not null,
  name text not null,
  category text not null check (
    category in ('Beverages', 'Snacks', 'Lunch', 'Dinner', 'Desserts', 'Other')
  ),
  price numeric(12, 2) not null check (price > 0),
  currency text not null check (currency in ('INR', 'USD')),
  description text not null default '',
  image_url text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (merchant_id, id)
);

create table if not exists public.settings (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null unique,
  store_name text not null check (char_length(store_name) between 1 and 80),
  preferred_token text not null check (preferred_token in ('USDC', 'NEAR')),
  fiat_currency text not null check (fiat_currency in ('INR', 'USD')),
  accepted_tokens text[] not null check (
    cardinality(accepted_tokens) > 0
    and accepted_tokens <@ array['USDC', 'NEAR']::text[]
  ),
  updated_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  customer_address text not null,
  customer_name text,
  customer_email text,
  customer_mobile text,
  amount numeric(36, 24) not null,
  token_type text not null check (token_type in ('NEAR', 'USDC')),
  tx_hash text not null unique,
  status text not null check (status in ('Pending', 'Success', 'Failed')),
  created_at timestamptz not null default now(),
  fiat_amount numeric(18, 2) not null,
  fiat_currency text not null check (fiat_currency in ('INR', 'USD')),
  usdc_amount numeric(36, 18) not null,
  items jsonb not null default '[]'::jsonb,
  store_name text not null default ''
);

create table if not exists public.wallet_challenges (
  id uuid primary key default gen_random_uuid(),
  account_id text not null,
  purpose text not null check (
    purpose in (
      'merchant-history',
      'merchant-catalog',
      'merchant-settings',
      'merchant-transaction',
      'payment-record'
    )
  ),
  nonce text not null unique,
  recipient text not null,
  message text not null default '',
  transaction_hash text,
  receipt_digest text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (
    (purpose = 'payment-record' and transaction_hash is not null and receipt_digest is not null)
    or (purpose <> 'payment-record' and transaction_hash is null and receipt_digest is null)
  )
);

create index if not exists products_merchant_category_name_idx
  on public.products (merchant_id, category, name);

create index if not exists transactions_merchant_created_at_idx
  on public.transactions (merchant_id, created_at desc);

create index if not exists wallet_challenges_expiration_idx
  on public.wallet_challenges (expires_at);

alter table public.products enable row level security;
alter table public.settings enable row level security;
alter table public.transactions enable row level security;
alter table public.wallet_challenges enable row level security;

drop policy if exists "Public can read products" on public.products;
create policy "Public can read products"
  on public.products for select to anon, authenticated
  using (true);

drop policy if exists "Public can read merchant settings" on public.settings;
create policy "Public can read merchant settings"
  on public.settings for select to anon, authenticated
  using (true);

revoke all on table public.products from anon, authenticated;
revoke all on table public.settings from anon, authenticated;
revoke all on table public.transactions from anon, authenticated;
revoke all on table public.wallet_challenges from anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant select on table public.products, public.settings to anon, authenticated;
grant select, insert, update, delete
  on table public.products, public.settings, public.transactions, public.wallet_challenges
  to service_role;
