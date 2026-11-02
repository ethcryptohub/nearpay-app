grant usage on schema public to service_role;
grant select, insert, update, delete
  on table public.wallet_challenges to service_role;
grant select, insert, update, delete
  on table public.transactions to service_role;
grant select, insert, update, delete
  on table public.products to service_role;
grant select, insert, update, delete
  on table public.settings to service_role;

select
  has_schema_privilege('service_role', 'public', 'USAGE') as service_role_can_use_public,
  has_table_privilege('service_role', 'public.wallet_challenges', 'INSERT') as can_create_wallet_challenges,
  has_table_privilege('service_role', 'public.wallet_challenges', 'UPDATE') as can_update_wallet_challenges,
  has_table_privilege('service_role', 'public.wallet_challenges', 'DELETE') as can_consume_wallet_challenges,
  has_table_privilege('service_role', 'public.transactions', 'INSERT') as can_write_transactions,
  has_table_privilege('service_role', 'public.transactions', 'SELECT') as can_read_transactions,
  has_table_privilege('service_role', 'public.products', 'SELECT') as can_read_products,
  has_table_privilege('service_role', 'public.products', 'INSERT') as can_write_products,
  has_table_privilege('service_role', 'public.products', 'DELETE') as can_delete_products,
  has_table_privilege('service_role', 'public.settings', 'SELECT') as can_read_settings,
  has_table_privilege('service_role', 'public.settings', 'INSERT') as can_write_settings;
