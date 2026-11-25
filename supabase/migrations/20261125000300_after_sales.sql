begin;

create type public.refund_status as enum (
  'requested','seller_approved','seller_rejected','disputed','admin_resolved','refunded'
);
create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  sub_order_id uuid not null references public.sub_orders(id),
  kind text not null check (kind in ('cancel_before_shipping','return')),
  reason text not null check (char_length(btrim(reason)) between 1 and 2000),
  evidence_urls text[] not null default '{}' check (cardinality(evidence_urls) <= 5),
  refund_amount public.minor_amount not null check (refund_amount > 0 or kind = 'cancel_before_shipping'),
  status public.refund_status not null default 'requested',
  stripe_refund_id text unique,
  settlement_status text check (settlement_status in ('pending','failed','succeeded','denied')),
  settlement_attempt integer not null default 0,
  settlement_started_at timestamptz,
  decided_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A rejected request can be escalated in place. Only finalized refunds allow a new request.
create unique index refund_one_open_per_sub_order on public.refund_requests (sub_order_id)
  where status <> 'refunded' and settlement_status is distinct from 'denied';
create index refunds_sub_order_created_idx on public.refund_requests (sub_order_id, created_at desc);
create table public.dispute_messages (
  id uuid primary key default gen_random_uuid(),
  refund_request_id uuid not null references public.refund_requests(id),
  author_id uuid not null default auth.uid() references public.profiles(id),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index dispute_messages_timeline_idx on public.dispute_messages (refund_request_id, created_at, id);

create trigger marketplace_refund_updated before update on public.refund_requests
for each row execute function marketplace_private.touch_updated_at();

alter table public.refund_requests enable row level security;
alter table public.dispute_messages enable row level security;
revoke all on public.refund_requests, public.dispute_messages from public, anon, authenticated;
grant all on public.refund_requests, public.dispute_messages to service_role;
grant select on public.refund_requests, public.dispute_messages to authenticated;
grant insert (refund_request_id, body) on public.dispute_messages to authenticated;

create policy refund_participant_read on public.refund_requests for select to authenticated
  using (exists (select 1 from public.sub_orders so where so.id = sub_order_id));
create policy dispute_participant_read on public.dispute_messages for select to authenticated
  using (exists (select 1 from public.refund_requests r where r.id = refund_request_id));
create policy dispute_participant_write on public.dispute_messages for insert to authenticated
  with check (author_id = (select auth.uid()) and exists (
    select 1 from public.refund_requests r where r.id = refund_request_id and r.status <> 'refunded'
      and r.settlement_status is distinct from 'denied'
  ));

create function public.request_refund(target_sub_order uuid, request_kind text, request_reason text,
  requested_amount bigint default null, evidence_paths text[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  buyer uuid := auth.uid();
  target public.sub_orders%rowtype;
  parent public.orders%rowtype;
  result uuid;
  refundable bigint;
begin
  select o.* into parent from public.orders o join public.sub_orders so on so.order_id = o.id
    where so.id = target_sub_order and o.buyer_id = buyer for update of o;
  if parent.id is null then raise exception 'ORDER_NOT_FOUND' using errcode = '42501'; end if;
  select * into target from public.sub_orders where id = target_sub_order for update;
  if (parent.payment_status not in ('paid','partially_refunded')
    and not (parent.payment_status = 'refunded' and target.total_amount = 0)) or target.status = 'cancelled' then
    raise exception 'ORDER_NOT_REFUNDABLE' using errcode = '22023';
  end if;
  if request_kind = 'cancel_before_shipping' then
    if target.status not in ('pending','processing') or target.refunded_amount <> 0 then
      raise exception 'ORDER_ALREADY_SHIPPED_OR_REFUNDED' using errcode = '22023';
    end if;
    refundable := target.total_amount;
  elsif request_kind = 'return' and target.status = 'delivered' then
    refundable := coalesce(requested_amount, target.total_amount - target.refunded_amount);
  else
    raise exception 'INVALID_REFUND_KIND_FOR_ORDER' using errcode = '22023';
  end if;
  if refundable < 0 or refundable > target.total_amount - target.refunded_amount
    or (refundable = 0 and request_kind <> 'cancel_before_shipping')
    or (refundable > 0 and parent.stripe_payment_intent_id is null) then
    raise exception 'INVALID_REFUND_AMOUNT' using errcode = '22023';
  end if;
  if evidence_paths is null or exists (select 1 from unnest(evidence_paths) p
    where p is null or split_part(p, '/', 1) <> buyer::text or char_length(p) > 500) then
    raise exception 'INVALID_EVIDENCE_PATH' using errcode = '22023';
  end if;
  insert into public.refund_requests (sub_order_id, kind, reason, refund_amount, evidence_urls)
    values (target.id, request_kind, btrim(request_reason), refundable, evidence_paths)
    returning id into result;
  return result;
end;
$$;

create function public.update_refund_dispute(target_request uuid, action text)
returns public.refund_status language plpgsql security definer set search_path = '' as $$
declare
  claim public.refund_requests%rowtype;
  target public.sub_orders%rowtype;
  result public.refund_status;
begin
  select so.* into target from public.sub_orders so join public.refund_requests r on r.sub_order_id = so.id
    where r.id = target_request for update of so;
  select * into claim from public.refund_requests where id = target_request for update;
  if action = 'reject' and marketplace_private.owns_shop(target.shop_id) and claim.status = 'requested' then
    result := 'seller_rejected';
  elsif action = 'dispute' and marketplace_private.owns_order(target.order_id) and claim.status = 'seller_rejected' then
    result := 'disputed';
  elsif action = 'deny' and marketplace_private.current_role() = 'admin' and claim.status = 'disputed' then
    update public.refund_requests set status = 'admin_resolved', settlement_status = 'denied', decided_by = auth.uid()
      where id = target_request;
    return 'admin_resolved';
  else
    raise exception 'INVALID_REFUND_TRANSITION' using errcode = '42501';
  end if;
  update public.refund_requests set status = result where id = target_request;
  return result;
end;
$$;

create function public.begin_refund(target_request uuid, actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  claim public.refund_requests%rowtype;
  parent public.orders%rowtype;
  target public.sub_orders%rowtype;
  actor_role public.marketplace_role;
  seller_owner uuid;
  decision public.refund_status;
begin
  select o.* into parent from public.orders o join public.sub_orders so on so.order_id = o.id
    join public.refund_requests r on r.sub_order_id = so.id where r.id = target_request for update of o;
  if parent.id is null then raise exception 'REFUND_NOT_FOUND' using errcode = '42501'; end if;
  select so.* into target from public.sub_orders so join public.refund_requests r on r.sub_order_id = so.id
    where r.id = target_request for update of so;
  select * into claim from public.refund_requests where id = target_request for update;
  select role into actor_role from public.profiles where id = actor;
  select owner_id into seller_owner from public.shops where id = target.shop_id;
  if actor_role = 'seller' and seller_owner = actor and claim.status in ('requested','seller_approved') then
    decision := 'seller_approved';
  elsif actor_role = 'admin' and (claim.status = 'disputed'
    or (claim.status = 'admin_resolved' and claim.settlement_status is distinct from 'denied')
    or claim.status = 'seller_approved' and claim.settlement_status = 'failed') then
    decision := 'admin_resolved';
  elsif claim.status = 'refunded' and (actor_role = 'admin' or (actor_role = 'seller' and seller_owner = actor)) then
    return jsonb_build_object('status', 'refunded', 'stripe_refund_id', claim.stripe_refund_id);
  else
    raise exception 'REFUND_APPROVAL_FORBIDDEN' using errcode = '42501';
  end if;
  if (parent.payment_status not in ('paid','partially_refunded')
     and not (parent.payment_status = 'refunded' and target.total_amount = 0))
     or (claim.refund_amount > 0 and parent.stripe_payment_intent_id is null)
     or claim.refund_amount > target.total_amount - target.refunded_amount
     or (claim.kind = 'cancel_before_shipping' and target.status not in ('pending','processing')) then
    raise exception 'ORDER_NOT_REFUNDABLE' using errcode = '22023';
  end if;
  if claim.settlement_status is distinct from 'pending' then
    update public.refund_requests set status = decision, decided_by = actor, settlement_status = 'pending',
      settlement_attempt = settlement_attempt + 1, stripe_refund_id = null, settlement_started_at = clock_timestamp()
    where id = target_request returning * into claim;
  end if;
  if claim.stripe_refund_id is null and claim.settlement_started_at < clock_timestamp() - interval '23 hours' then
    raise exception 'REFUND_RECONCILIATION_REQUIRED' using errcode = '22023';
  end if;
  return jsonb_build_object('status', claim.status, 'stripe_refund_id', claim.stripe_refund_id,
    'payment_intent', parent.stripe_payment_intent_id, 'amount', claim.refund_amount,
    'currency', parent.currency, 'attempt', claim.settlement_attempt);
end;
$$;

create function public.record_refund_result(target_request uuid, attempt integer, stripe_id text,
  stripe_status text, amount bigint, currency text, payment_intent text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  claim public.refund_requests%rowtype;
  parent public.orders%rowtype;
  target public.sub_orders%rowtype;
  total_refunded bigint;
begin
  select o.* into parent from public.orders o join public.sub_orders so on so.order_id = o.id
    join public.refund_requests r on r.sub_order_id = so.id where r.id = target_request for update of o;
  if parent.id is null then raise exception 'REFUND_NOT_FOUND' using errcode = '22023'; end if;
  select so.* into target from public.sub_orders so join public.refund_requests r on r.sub_order_id = so.id
    where r.id = target_request for update of so;
  select * into claim from public.refund_requests where id = target_request for update;
  if claim.settlement_attempt <> attempt then return 'stale'; end if;
  if claim.refund_amount is distinct from amount or parent.currency is distinct from upper(currency)
    or parent.stripe_payment_intent_id is distinct from payment_intent
    or (claim.refund_amount > 0 and stripe_id is null)
    or (claim.refund_amount = 0 and (stripe_id is not null or stripe_status is distinct from 'succeeded'))
    or (claim.stripe_refund_id is not null and claim.stripe_refund_id <> stripe_id)
    or claim.status not in ('seller_approved','admin_resolved','refunded') then
    raise exception 'REFUND_MISMATCH' using errcode = '22023';
  end if;
  if claim.status = 'refunded' then return 'refunded'; end if;
  if claim.settlement_status = 'failed' and stripe_status <> 'succeeded' then return 'failed'; end if;
  if stripe_status in ('failed','canceled') then
    update public.refund_requests set stripe_refund_id = stripe_id, settlement_status = 'failed' where id = claim.id;
    return 'failed';
  elsif stripe_status is distinct from 'succeeded' then
    update public.refund_requests set stripe_refund_id = stripe_id where id = claim.id;
    return 'pending';
  end if;

  if claim.kind = 'cancel_before_shipping' then
    perform v.id from public.product_variants v join public.order_items i on i.variant_id = v.id
      where i.sub_order_id = target.id order by v.id for update of v;
    update public.product_variants v set stock_quantity = v.stock_quantity + i.quantity
      from public.order_items i where i.sub_order_id = target.id and i.variant_id = v.id;
  end if;
  update public.sub_orders set refunded_amount = refunded_amount + claim.refund_amount,
    status = case when claim.kind = 'cancel_before_shipping' then 'cancelled'::public.fulfillment_status else status end
    where id = target.id;
  select sum(so.refunded_amount) into total_refunded from public.sub_orders so where so.order_id = parent.id;
  update public.orders set payment_status = case
    when total_amount = 0 and not exists (
      select 1 from public.sub_orders so where so.order_id = parent.id and so.status <> 'cancelled'
    ) then 'refunded'::public.payment_status
    when total_refunded = 0 then payment_status
    when total_refunded = total_amount then 'refunded'::public.payment_status
    else 'partially_refunded'::public.payment_status end where id = parent.id;
  update public.refund_requests set status = 'refunded', stripe_refund_id = stripe_id, settlement_status = 'succeeded'
    where id = claim.id;
  return 'refunded';
end;
$$;

create function public.update_fulfillment(target_sub_order uuid, next_status public.fulfillment_status,
  tracking text default null) returns public.fulfillment_status
language plpgsql security definer set search_path = '' as $$
declare
  target public.sub_orders%rowtype;
  parent public.orders%rowtype;
begin
  select o.* into parent from public.orders o join public.sub_orders so on so.order_id = o.id
    where so.id = target_sub_order for update of o;
  select * into target from public.sub_orders where id = target_sub_order for update;
  if not coalesce(marketplace_private.owns_shop(target.shop_id), false) then
    raise exception 'ORDER_FORBIDDEN' using errcode = '42501';
  end if;
  if (parent.payment_status not in ('paid','partially_refunded')
    and not (parent.payment_status = 'refunded' and target.total_amount = 0)) or parent.paid_at is null
    or not coalesce((target.status in ('pending','processing') and next_status = 'shipped'
      and char_length(btrim(tracking)) between 1 and 100) or (target.status = 'shipped' and next_status = 'delivered'), false)
    or exists (select 1 from public.refund_requests r where r.sub_order_id = target.id
      and r.kind = 'cancel_before_shipping' and r.status in ('requested','disputed','seller_approved','admin_resolved')
      and r.settlement_status is distinct from 'denied') then
    raise exception 'FULFILLMENT_TRANSITION_FORBIDDEN' using errcode = '22023';
  end if;
  update public.sub_orders set status = next_status,
    tracking_number = case when next_status = 'shipped' then btrim(tracking) else tracking_number end,
    delivered_at = case when next_status = 'delivered' then clock_timestamp() else delivered_at end
    where id = target.id;
  return next_status;
end;
$$;

create function public.buyer_pending_checkout(target_order uuid, actor uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('checkout_session_id', o.stripe_checkout_session_id, 'status', o.payment_status)
  from public.orders o where o.id = target_order and o.buyer_id = actor and o.checkout_key is not null;
$$;

revoke execute on function public.request_refund(uuid,text,text,bigint,text[]), public.update_refund_dispute(uuid,text),
  public.begin_refund(uuid,uuid), public.record_refund_result(uuid,integer,text,text,bigint,text,text),
  public.update_fulfillment(uuid,public.fulfillment_status,text), public.buyer_pending_checkout(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.request_refund(uuid,text,text,bigint,text[]),
  public.update_refund_dispute(uuid,text), public.update_fulfillment(uuid,public.fulfillment_status,text) to authenticated;
grant execute on function public.begin_refund(uuid,uuid), public.record_refund_result(uuid,integer,text,text,bigint,text,text),
  public.buyer_pending_checkout(uuid,uuid) to service_role;

commit;
