do $$
begin
  if to_regclass('public.merchant_products') is not null then
    execute $migration$
      insert into public.products (
        id, merchant_id, name, category, price, currency, description, image_url,
        created_at, updated_at
      )
      select
        product_id, merchant_account_id, name, category, price, currency,
        description, image_url, created_at, updated_at
      from public.merchant_products
      on conflict (merchant_id, id) do nothing
    $migration$;
  end if;

  if to_regclass('public.payment_records') is not null then
    execute $migration$
      insert into public.transactions (
        merchant_id, customer_address, customer_name, customer_email,
        customer_mobile, amount, token_type, tx_hash, status, created_at,
        fiat_amount, fiat_currency, usdc_amount, items, store_name
      )
      select
        merchant_account_id, sender_account_id, customer_name, customer_email,
        customer_mobile, token_amount, token, transaction_hash, status, date,
        fiat_amount, fiat_currency, usdc_amount, items, store_name
      from public.payment_records
      on conflict (tx_hash) do nothing
    $migration$;
  end if;
end
$$;
