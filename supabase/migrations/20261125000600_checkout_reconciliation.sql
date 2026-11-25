begin;

alter table public.orders
  add column checkout_closed_at timestamptz,
  add column late_refund_id text unique,
  add column late_refund_status text
    check (late_refund_status in ('pending','requires_action','succeeded','failed','canceled'));
create index orders_stripe_reconcile_idx on public.orders (expires_at, id)
  where stripe_checkout_session_id is not null and checkout_closed_at is null
    and checkout_key is not null and payment_status in ('cancelled','failed');

alter table public.sub_orders add column refund_state text generated always as (
  case when refunded_amount = 0 then 'none'
    when refunded_amount = subtotal_amount + shipping_amount + tax_amount - discount_amount then 'full'
    else 'partial' end
) stored;

-- The inventory release job always runs. This companion job closes open Stripe
-- sessions when the maintenance credentials have been provisioned in Vault.
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;
create function marketplace_private.enqueue_checkout_reconciliation() returns void
language plpgsql set search_path = '' as $$
declare
  project_url text;
  job_secret text;
begin
  if not exists (select 1 from public.orders where stripe_checkout_session_id is not null
    and checkout_closed_at is null and checkout_key is not null
    and payment_status in ('cancelled', 'failed')) then return; end if;
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'marketplace_project_url';
  select decrypted_secret into job_secret from vault.decrypted_secrets where name = 'marketplace_maintenance_secret';
  if project_url is null or job_secret is null then return; end if;
  perform net.http_post(
    url := rtrim(project_url, '/') || '/functions/v1/reconcile-checkout',
    headers := jsonb_build_object('content-type', 'application/json', 'x-marketplace-maintenance', job_secret),
    body := '{}'::jsonb
  );
end;
$$;
revoke execute on function marketplace_private.enqueue_checkout_reconciliation() from public, anon, authenticated;
select cron.schedule('marketplace-close-stripe-checkouts', '* * * * *',
  $job$select marketplace_private.enqueue_checkout_reconciliation();$job$);

commit;
