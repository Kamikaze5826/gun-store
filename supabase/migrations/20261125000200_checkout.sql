begin;

-- stock_quantity counts physical units, including units held for checkout.
alter table public.product_variants
  add column reserved_quantity integer not null default 0,
  add constraint variant_reservation_bounds check (reserved_quantity between 0 and stock_quantity),
  add column available_stock integer generated always as (stock_quantity - reserved_quantity) stored;

alter table public.orders
  add column checkout_key uuid,
  add column checkout_input jsonb,
  add column expires_at timestamptz,
  add column checkout_url text,
  add column late_payment_intent_id text unique,
  add unique (buyer_id, checkout_key);
-- Internal checkout request and Stripe URL are available through service RPCs.
revoke select on public.orders from authenticated;
grant select (id, buyer_id, currency, payment_status, subtotal_amount, shipping_amount, tax_amount,
  discount_amount, total_amount, paid_at, expires_at, created_at, updated_at) on public.orders to authenticated;
create index orders_checkout_expiry_idx on public.orders (expires_at, id)
  where payment_status = 'pending' and expires_at is not null;

alter table public.sub_orders
  add column shop_discount_amount public.minor_amount not null default 0,
  add column platform_discount_amount public.minor_amount not null default 0,
  add column weight_grams bigint not null default 0 check (weight_grams >= 0),
  add column refunded_amount public.minor_amount not null default 0 check (refunded_amount <= total_amount);

create table public.vouchers (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('platform','shop')),
  shop_id uuid references public.shops(id),
  code text not null check (code ~ '^[A-Z0-9_-]{1,50}$'),
  currency public.currency_code not null,
  discount_type text not null check (discount_type in ('percentage','fixed')),
  discount_value numeric(14,2) not null check (discount_value > 0),
  max_discount_amount public.minor_amount,
  min_order_value public.minor_amount not null default 0,
  usage_limit integer check (usage_limit > 0),
  used_count integer not null default 0 check (used_count >= 0),
  reserved_count integer not null default 0 check (reserved_count >= 0),
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  is_active boolean not null default true,
  check ((scope = 'shop') = (shop_id is not null)),
  check (valid_until > valid_from),
  check (usage_limit is null or used_count::bigint + reserved_count <= usage_limit),
  check (case discount_type when 'percentage' then discount_value <= 100
    else discount_value = trunc(discount_value) and discount_value <= 999999999999 end),
  unique nulls not distinct (shop_id, code)
);

create table public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  region_code text not null check (region_code ~ '^[A-Z0-9-]{1,24}$'),
  currency public.currency_code not null,
  max_weight_grams bigint not null check (max_weight_grams > 0),
  amount public.minor_amount not null,
  unique (country_code, region_code, currency, max_weight_grams)
);

create table marketplace_private.order_vouchers (
  order_id uuid not null references public.orders(id),
  voucher_id uuid not null references public.vouchers(id),
  primary key (order_id, voucher_id)
);
create index order_vouchers_voucher_idx on marketplace_private.order_vouchers (voucher_id);

alter table public.vouchers enable row level security;
alter table public.shipping_rates enable row level security;
revoke all on public.vouchers, public.shipping_rates from public, anon, authenticated;
grant all on public.vouchers, public.shipping_rates to service_role;
grant select on public.vouchers to authenticated;
grant insert (scope, shop_id, code, currency, discount_type, discount_value, max_discount_amount,
  min_order_value, usage_limit, valid_from, valid_until, is_active),
  update (discount_type, discount_value, max_discount_amount, min_order_value, usage_limit,
    valid_from, valid_until, is_active) on public.vouchers to authenticated;
grant select on public.shipping_rates to anon, authenticated;
grant insert, update, delete on public.shipping_rates to authenticated;

create policy vouchers_manage_own on public.vouchers for all to authenticated using (
  (scope = 'platform' and (select marketplace_private.current_role()) = 'admin')
  or (scope = 'shop' and marketplace_private.owns_shop(shop_id))
) with check (
  (scope = 'platform' and (select marketplace_private.current_role()) = 'admin')
  or (scope = 'shop' and marketplace_private.owns_shop(shop_id))
);
create policy shipping_rates_read on public.shipping_rates for select to anon, authenticated using (true);
create policy shipping_rates_admin on public.shipping_rates for all to authenticated
  using ((select marketplace_private.current_role()) = 'admin')
  with check ((select marketplace_private.current_role()) = 'admin');

create function marketplace_private.cart_lines(items jsonb)
returns table (variant_id uuid, quantity integer) language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(items) is distinct from 'array' then
    raise exception 'INVALID_CART' using errcode = '22023';
  end if;
  if jsonb_array_length(items) not between 1 and 50 or exists (
    select 1 from jsonb_to_recordset(items) as i(variant_id uuid, quantity integer)
    where i.variant_id is null or i.quantity is null or i.quantity not between 1 and 1000
  ) then
    raise exception 'INVALID_CART' using errcode = '22023';
  end if;
  return query
    select i.variant_id, sum(i.quantity)::integer
    from jsonb_to_recordset(items) as i(variant_id uuid, quantity integer)
    group by i.variant_id order by i.variant_id;
end;
$$;

create function marketplace_private.stock_errors(items jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'variant_id', i.variant_id, 'requested_quantity', i.quantity,
    'available_stock', case when p.id is null then 0 else v.available_stock end,
    'product_title', p.title
  ) order by i.variant_id), '[]'::jsonb)
  from marketplace_private.cart_lines(items) i
  left join public.product_variants v on v.id = i.variant_id and v.is_active
  left join public.products p on p.id = v.product_id and p.status = 'active'
    and p.listing_type = 'fixed_price'
    and exists (select 1 from public.shops s where s.id = p.shop_id and s.status = 'active')
  where p.id is null or i.quantity > v.available_stock;
$$;

create function marketplace_private.voucher_discount(voucher public.vouchers, base_amount bigint, pricing_at timestamptz)
returns bigint language plpgsql immutable set search_path = '' as $$
declare
  discount bigint;
begin
  if voucher.id is null or not voucher.is_active or pricing_at < voucher.valid_from
     or pricing_at >= voucher.valid_until or base_amount < voucher.min_order_value
     or (voucher.usage_limit is not null and voucher.used_count::bigint + voucher.reserved_count >= voucher.usage_limit) then
    raise exception 'VOUCHER_UNAVAILABLE' using errcode = '22023';
  end if;
  discount := case voucher.discount_type when 'percentage'
    then floor(base_amount::numeric * voucher.discount_value / 100)::bigint
    else voucher.discount_value::bigint end;
  return least(discount, coalesce(voucher.max_discount_amount, discount), base_amount);
end;
$$;

create function public.calculate_order_preview(
  cart_items jsonb, shipping_address jsonb, shop_voucher_codes jsonb default '{}', platform_voucher_code text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  order_currency public.currency_code;
  item_count integer;
  valid_count integer;
  currency_count integer;
  shop_record record;
  voucher public.vouchers%rowtype;
  region text := upper(btrim(shipping_address ->> 'region_code'));
  country text := upper(btrim(shipping_address ->> 'country_code'));
  entered_code text;
  subtotal bigint := 0;
  shipping_total bigint := 0;
  shop_discounts bigint := 0;
  platform_discount bigint := 0;
  shop_discount bigint;
  shipping_fee bigint;
  platform_base bigint;
  suborders jsonb := '[]';
  platform_id uuid;
  pricing_at timestamptz := clock_timestamp();
begin
  if jsonb_typeof(shipping_address) is distinct from 'object' or country is null or region is null
    or country !~ '^[A-Z]{2}$' or region !~ '^[A-Z0-9-]{1,24}$' then
    raise exception 'INVALID_SHIPPING_ADDRESS' using errcode = '22023';
  end if;
  if jsonb_typeof(shop_voucher_codes) is distinct from 'object' or exists (
    select 1 from jsonb_each(shop_voucher_codes) c where jsonb_typeof(c.value) <> 'string'
  ) then
    raise exception 'INVALID_VOUCHER_CODES' using errcode = '22023';
  end if;

  select count(*), count(s.id), count(distinct p.currency), min(p.currency)
    into item_count, valid_count, currency_count, order_currency
  from marketplace_private.cart_lines(cart_items) i
  left join public.product_variants v on v.id = i.variant_id and v.is_active
  left join public.products p on p.id = v.product_id and p.status = 'active' and p.listing_type = 'fixed_price'
  left join public.shops s on s.id = p.shop_id and s.status = 'active';
  if item_count <> valid_count then raise exception 'PRODUCT_UNAVAILABLE' using errcode = '22023'; end if;
  if currency_count <> 1 then raise exception 'MIXED_CURRENCY' using errcode = '22023'; end if;

  for shop_record in
    select p.shop_id, s.name as shop_name,
      sum(i.quantity::bigint * v.price_amount)::bigint as subtotal,
      sum(i.quantity::bigint * v.weight_g)::bigint as weight_grams,
      bool_or(v.weight_g is null) as missing_weight,
      jsonb_agg(jsonb_build_object(
        'variant_id', v.id, 'product_id', p.id, 'product_title', p.title, 'sku', v.sku,
        'size', v.size, 'color', v.color, 'quantity', i.quantity, 'unit_price_amount', v.price_amount,
        'available_stock', v.available_stock
      ) order by v.id) as items
    from marketplace_private.cart_lines(cart_items) i
    join public.product_variants v on v.id = i.variant_id
    join public.products p on p.id = v.product_id
    join public.shops s on s.id = p.shop_id
    group by p.shop_id, s.name order by p.shop_id
  loop
    if shop_record.missing_weight then raise exception 'MISSING_PRODUCT_WEIGHT' using errcode = '22023'; end if;
    entered_code := nullif(upper(btrim(shop_voucher_codes ->> shop_record.shop_id::text)), '');
    shop_discount := 0;
    voucher := null;
    if entered_code is not null then
      select * into voucher from public.vouchers
        where shop_id = shop_record.shop_id and vouchers.code = entered_code
          and currency = order_currency;
      shop_discount := marketplace_private.voucher_discount(voucher, shop_record.subtotal, pricing_at);
    end if;
    select r.amount into shipping_fee from public.shipping_rates r
      where r.country_code = country and r.region_code = region and r.currency = order_currency
        and r.max_weight_grams >= shop_record.weight_grams order by r.max_weight_grams limit 1;
    if shipping_fee is null then raise exception 'SHIPPING_RATE_UNAVAILABLE' using errcode = '22023'; end if;
    subtotal := subtotal + shop_record.subtotal;
    shipping_total := shipping_total + shipping_fee;
    shop_discounts := shop_discounts + shop_discount;
    suborders := suborders || jsonb_build_array(to_jsonb(shop_record) - 'missing_weight' || jsonb_build_object(
      'shop_voucher_id', voucher.id, 'shop_discount', shop_discount, 'shipping', shipping_fee,
      'platform_base', shop_record.subtotal - shop_discount + shipping_fee
    ));
  end loop;

  if exists (select 1 from jsonb_object_keys(shop_voucher_codes) as k(key)
    where not exists (select 1 from jsonb_array_elements(suborders) s where s ->> 'shop_id' = k.key)) then
    raise exception 'VOUCHER_SHOP_NOT_IN_CART' using errcode = '22023';
  end if;
  platform_base := subtotal - shop_discounts + shipping_total;
  entered_code := nullif(upper(btrim(platform_voucher_code)), '');
  if entered_code is not null then
    select * into voucher from public.vouchers
      where scope = 'platform' and vouchers.code = entered_code and currency = order_currency;
    platform_discount := marketplace_private.voucher_discount(voucher, platform_base, pricing_at);
    platform_id := voucher.id;
  end if;
  if greatest(subtotal, shipping_total, platform_base) > 999999999999 then
    raise exception 'ORDER_TOTAL_TOO_LARGE' using errcode = '22023';
  end if;

  -- Consecutive rounded cumulative shares add up to the exact platform discount.
  select jsonb_agg(part - 'platform_base' || jsonb_build_object(
      'platform_discount', share, 'total', (part ->> 'platform_base')::bigint - share
    ) order by position)
  into suborders
  from (
    select part, position, coalesce(
      (floor(running * platform_discount / nullif(platform_base, 0))
        - floor((running - (part ->> 'platform_base')::bigint) * platform_discount / nullif(platform_base, 0)))::bigint, 0
    ) as share
    from (
      select part, position, sum((part ->> 'platform_base')::bigint) over (order by position) as running
      from jsonb_array_elements(suborders) with ordinality as s(part, position)
    ) weighted
  ) allocations;
  return jsonb_build_object('currency', order_currency, 'subtotal', subtotal, 'shipping', shipping_total,
    'shop_discount', shop_discounts, 'platform_discount', platform_discount, 'platform_voucher_id', platform_id,
    'total', platform_base - platform_discount, 'shops', suborders,
    'shortages', marketplace_private.stock_errors(cart_items));
end;
$$;

create function public.reserve_inventory(
  buyer uuid, request_id uuid, cart_items jsonb, shipping_address jsonb,
  shop_voucher_codes jsonb default '{}', platform_voucher_code text default null,
  expected_quote jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_order public.orders%rowtype;
  request_input jsonb := jsonb_build_array(cart_items, shipping_address, shop_voucher_codes, platform_voucher_code);
  shortages jsonb;
  quote jsonb;
  shop_quote jsonb;
  new_sub_order uuid;
  selected_voucher uuid;
begin
  if buyer is null or request_id is null or not exists (
    select 1 from public.profiles p where p.id = buyer and p.role in ('buyer','seller')
  ) then raise exception 'BUYER_REQUIRED' using errcode = '42501'; end if;

  -- Serialize both replays and concurrent checkout creation for this buyer.
  perform pg_advisory_xact_lock(hashtextextended(buyer::text, 7939));
  select * into current_order from public.orders o where o.buyer_id = buyer and o.checkout_key = request_id;
  if current_order.id is not null then
    if current_order.checkout_input is distinct from request_input then
      return jsonb_build_object('ok', false, 'code', 'CHECKOUT_KEY_REUSED');
    end if;
    if current_order.payment_status <> 'pending' or current_order.expires_at <= clock_timestamp() then
      return jsonb_build_object('ok', false, 'code', 'CHECKOUT_CLOSED');
    end if;
    if expected_quote ? 'client_total' and
      (current_order.total_amount, current_order.currency::text) is distinct from
      ((expected_quote ->> 'client_total')::bigint, expected_quote ->> 'client_currency') then
      return jsonb_build_object('ok', false, 'code', 'PRICE_CHANGED');
    end if;
  else
    if (select count(*) from public.orders o where o.buyer_id = buyer
      and o.payment_status = 'pending' and o.expires_at > clock_timestamp()) >= 3 then
      return jsonb_build_object('ok', false, 'code', 'TOO_MANY_CHECKOUTS');
    end if;
    perform v.id from public.vouchers v
      where (v.scope = 'platform' and v.code = upper(btrim(platform_voucher_code)))
        or (v.scope = 'shop' and v.code = upper(btrim(shop_voucher_codes ->> v.shop_id::text)))
      order by v.id for update of v;
    perform v.id from public.product_variants v join marketplace_private.cart_lines(cart_items) i on i.variant_id = v.id
      order by v.id for update of v;
    shortages := marketplace_private.stock_errors(cart_items);
    if jsonb_array_length(shortages) > 0 then
      return jsonb_build_object('ok', false, 'code', 'INSUFFICIENT_STOCK', 'shortages', shortages);
    end if;
    quote := public.calculate_order_preview(cart_items, shipping_address, shop_voucher_codes, platform_voucher_code);
    if (expected_quote ? 'total' and (quote -> 'currency', quote -> 'subtotal', quote -> 'shipping',
      quote -> 'shop_discount', quote -> 'platform_discount', quote -> 'total') is distinct from
      (expected_quote -> 'currency', expected_quote -> 'subtotal', expected_quote -> 'shipping',
      expected_quote -> 'shop_discount', expected_quote -> 'platform_discount', expected_quote -> 'total'))
      or (expected_quote ? 'client_total' and (quote ->> 'total', quote ->> 'currency') is distinct from
        (expected_quote ->> 'client_total', expected_quote ->> 'client_currency')) then
      return jsonb_build_object('ok', false, 'code', 'PRICE_CHANGED', 'preview', quote);
    end if;
    if (quote ->> 'total')::bigint > 99999999 then
      raise exception 'STRIPE_AMOUNT_TOO_LARGE' using errcode = '22023';
    end if;
    insert into public.orders (buyer_id, currency, subtotal_amount, shipping_amount, discount_amount,
      checkout_key, checkout_input, expires_at)
    values (buyer, quote ->> 'currency', (quote ->> 'subtotal')::bigint, (quote ->> 'shipping')::bigint,
      (quote ->> 'shop_discount')::bigint + (quote ->> 'platform_discount')::bigint, request_id, request_input,
      clock_timestamp() + interval '15 minutes') returning * into current_order;

    for shop_quote in select value from jsonb_array_elements(quote -> 'shops') loop
      insert into public.sub_orders (order_id, shop_id, currency, subtotal_amount, shipping_amount, discount_amount,
        shop_discount_amount, platform_discount_amount, weight_grams, shipping_address)
      values (current_order.id, (shop_quote ->> 'shop_id')::uuid, current_order.currency,
        (shop_quote ->> 'subtotal')::bigint, (shop_quote ->> 'shipping')::bigint,
        (shop_quote ->> 'shop_discount')::bigint + (shop_quote ->> 'platform_discount')::bigint,
        (shop_quote ->> 'shop_discount')::bigint, (shop_quote ->> 'platform_discount')::bigint,
        (shop_quote ->> 'weight_grams')::bigint, shipping_address) returning id into new_sub_order;
      insert into public.order_items (sub_order_id, shop_id, product_id, variant_id, currency,
        product_title, sku, variant_size, variant_color, quantity, unit_price_amount)
      select new_sub_order, (shop_quote ->> 'shop_id')::uuid, i.product_id, i.variant_id, current_order.currency,
        i.product_title, i.sku, i.size, i.color, i.quantity, i.unit_price_amount
      from jsonb_to_recordset(shop_quote -> 'items') as i(product_id uuid, variant_id uuid,
        product_title text, sku text, size text, color text, quantity integer, unit_price_amount bigint);
      selected_voucher := (shop_quote ->> 'shop_voucher_id')::uuid;
      if selected_voucher is not null then
        insert into marketplace_private.order_vouchers values (current_order.id, selected_voucher);
      end if;
    end loop;
    selected_voucher := (quote ->> 'platform_voucher_id')::uuid;
    if selected_voucher is not null then
      insert into marketplace_private.order_vouchers values (current_order.id, selected_voucher);
    end if;
    update public.vouchers v set reserved_count = v.reserved_count + 1
      from marketplace_private.order_vouchers ov where v.id = ov.voucher_id and ov.order_id = current_order.id;
    update public.product_variants v set reserved_quantity = v.reserved_quantity + i.quantity
      from marketplace_private.cart_lines(cart_items) i where v.id = i.variant_id;
  end if;
  return jsonb_build_object('ok', true, 'order_id', current_order.id, 'expires_at', current_order.expires_at,
    'currency', current_order.currency, 'total', current_order.total_amount, 'checkout_url', current_order.checkout_url);
end;
$$;

create function marketplace_private.apply_order_hold(target_order uuid, deduct boolean) returns void
language plpgsql set search_path = '' as $$
begin
  perform v.id from public.vouchers v join marketplace_private.order_vouchers ov on ov.voucher_id = v.id
    where ov.order_id = target_order order by v.id for update of v;
  perform v.id from public.product_variants v where exists (
    select 1 from public.order_items i join public.sub_orders so on so.id = i.sub_order_id
    where so.order_id = target_order and i.variant_id = v.id
  ) order by v.id for update of v;
  update public.vouchers v set reserved_count = v.reserved_count - 1,
    used_count = v.used_count + case when deduct then 1 else 0 end
  from marketplace_private.order_vouchers ov where v.id = ov.voucher_id and ov.order_id = target_order;
  update public.product_variants v set reserved_quantity = v.reserved_quantity - i.quantity,
    stock_quantity = v.stock_quantity - case when deduct then i.quantity else 0 end
  from (select oi.variant_id, sum(oi.quantity)::integer as quantity
    from public.order_items oi join public.sub_orders so on so.id = oi.sub_order_id
    where so.order_id = target_order group by oi.variant_id) i where v.id = i.variant_id;
end;
$$;

create function public.confirm_inventory_deduction(
  order_id uuid, checkout_session_id text, payment_intent_id text, charge_id text, amount bigint, currency text
) returns text language plpgsql security definer set search_path = '' as $$
declare
  target public.orders%rowtype;
begin
  select * into target from public.orders o where o.id = order_id for update;
  if target.id is null or target.checkout_key is null or checkout_session_id is null
    or (target.stripe_checkout_session_id is not null and target.stripe_checkout_session_id <> checkout_session_id)
    or target.total_amount is distinct from amount or target.currency is distinct from upper(currency)
    or (amount > 0 and (payment_intent_id is null or charge_id is null)) then
    raise exception 'PAYMENT_MISMATCH' using errcode = '22023';
  end if;
  if target.payment_status in ('paid','partially_refunded','refunded') then
    if target.stripe_payment_intent_id is distinct from payment_intent_id then
      raise exception 'PAYMENT_MISMATCH' using errcode = '22023';
    end if;
    return 'paid';
  end if;
  if target.payment_status <> 'pending' or target.expires_at <= clock_timestamp() then
    if target.payment_status = 'pending' then
      perform marketplace_private.apply_order_hold(order_id, false);
      update public.sub_orders so set status = 'cancelled' where so.order_id = target.id;
    end if;
    update public.orders set payment_status = 'cancelled', stripe_checkout_session_id = checkout_session_id,
      late_payment_intent_id = payment_intent_id where id = target.id;
    return 'late';
  end if;
  perform marketplace_private.apply_order_hold(order_id, true);
  update public.orders set payment_status = 'paid', paid_at = clock_timestamp(),
    stripe_checkout_session_id = checkout_session_id, stripe_payment_intent_id = payment_intent_id,
    stripe_charge_id = charge_id where id = target.id;
  update public.sub_orders so set status = 'processing' where so.order_id = target.id;
  return 'paid';
end;
$$;

create function public.release_expired_inventory(
  target_order uuid default null, release_reason text default 'expired', checkout_session_id text default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  candidates uuid[];
  candidate uuid;
begin
  if release_reason is null or release_reason not in ('expired','cancelled','payment_failed','stripe_expired')
    or (target_order is null and release_reason <> 'expired') then
    raise exception 'INVALID_RELEASE_REASON' using errcode = '22023';
  end if;
  if target_order is not null then
    select array[o.id] into candidates from public.orders o
    where o.id = target_order and o.payment_status = 'pending' and o.expires_at is not null
      and (release_reason <> 'expired' or o.expires_at <= clock_timestamp())
      and (checkout_session_id is null or o.stripe_checkout_session_id is null
        or o.stripe_checkout_session_id = checkout_session_id)
    for update;
  else
    select array_agg(id) into candidates from (
    select o.id from public.orders o where o.payment_status = 'pending' and o.expires_at is not null
      and o.expires_at <= clock_timestamp()
    order by o.expires_at, o.id limit 100 for update skip locked
    ) pending;
  end if;
  if candidates is null then return 0; end if;
  perform v.id from public.vouchers v where exists (select 1 from marketplace_private.order_vouchers ov
    where ov.voucher_id = v.id and ov.order_id = any(candidates)) order by v.id for update;
  perform v.id from public.product_variants v where exists (select 1 from public.order_items oi
    join public.sub_orders so on so.id = oi.sub_order_id
    where oi.variant_id = v.id and so.order_id = any(candidates)) order by v.id for update;
  foreach candidate in array candidates loop
    perform marketplace_private.apply_order_hold(candidate, false);
  end loop;
  update public.orders set payment_status = case when release_reason = 'payment_failed'
    then 'failed'::public.payment_status else 'cancelled'::public.payment_status end
    where id = any(candidates);
  update public.sub_orders set status = 'cancelled' where order_id = any(candidates);
  return cardinality(candidates);
end;
$$;

create function public.attach_checkout_session(target_order uuid, session_id text, session_url text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.orders o set stripe_checkout_session_id = session_id, checkout_url = session_url
    where o.id = target_order and o.payment_status = 'pending' and o.expires_at > clock_timestamp()
      and (o.stripe_checkout_session_id is null or o.stripe_checkout_session_id = session_id);
  return found;
end;
$$;

revoke execute on function marketplace_private.cart_lines(jsonb), marketplace_private.stock_errors(jsonb),
  marketplace_private.voucher_discount(public.vouchers,bigint,timestamptz),
  marketplace_private.apply_order_hold(uuid,boolean) from public, anon, authenticated;

revoke execute on function public.calculate_order_preview(jsonb,jsonb,jsonb,text),
  public.reserve_inventory(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb),
  public.confirm_inventory_deduction(uuid,text,text,text,bigint,text),
  public.release_expired_inventory(uuid,text,text), public.attach_checkout_session(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.calculate_order_preview(jsonb,jsonb,jsonb,text) to authenticated, service_role;
grant execute on function public.reserve_inventory(uuid,uuid,jsonb,jsonb,jsonb,text,jsonb),
  public.confirm_inventory_deduction(uuid,text,text,text,bigint,text),
  public.release_expired_inventory(uuid,text,text), public.attach_checkout_session(uuid,text,text) to service_role;

commit;
