grant usage on schema public to service_role;
grant select, insert, update, delete
  on table public.wallet_challenges to service_role;
grant select, insert, update, delete
  on table public.payment_records to service_role;

select
  has_schema_privilege('service_role', 'public', 'USAGE') as service_role_can_use_public,
  has_table_privilege('service_role', 'public.wallet_challenges', 'INSERT') as can_create_wallet_challenges,
  has_table_privilege('service_role', 'public.wallet_challenges', 'UPDATE') as can_update_wallet_challenges,
  has_table_privilege('service_role', 'public.wallet_challenges', 'DELETE') as can_consume_wallet_challenges,
  has_table_privilege('service_role', 'public.payment_records', 'INSERT') as can_write_payment_records,
  has_table_privilege('service_role', 'public.payment_records', 'SELECT') as can_read_payment_records;
