begin;

create schema marketplace_private;
revoke all on schema marketplace_private from public, anon, authenticated;
grant usage on schema marketplace_private to authenticated, service_role;

create type public.marketplace_role as enum ('buyer', 'seller', 'admin');
create type public.shop_status as enum ('pending', 'active', 'suspended');
create type public.product_status as enum ('draft', 'active', 'archived');
create type public.listing_type as enum ('fixed_price', 'auction');
create type public.payment_status as enum ('pending', 'paid', 'failed', 'cancelled', 'partially_refunded', 'refunded');
create type public.fulfillment_status as enum ('pending', 'processing', 'shipped', 'delivered', 'cancelled');
create type public.transfer_status as enum ('pending', 'transferred', 'failed', 'partially_reversed', 'reversed');
create domain public.currency_code as text check (value ~ '^[A-Z]{3}$');
create domain public.minor_amount as bigint check (value between 0 and 999999999999);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.marketplace_role not null default 'buyer',
  display_name text not null default '' check (char_length(display_name) <= 100),
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.shops (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  description text not null default '',
  logo_path text,
  status public.shop_status not null default 'pending',
  rating_count integer not null default 0 check (rating_count >= 0),
  rating_sum bigint not null default 0 check (rating_sum between rating_count and 5::bigint * rating_count),
  rating_average numeric(3,2) generated always as (
    coalesce(round(rating_sum::numeric / nullif(rating_count, 0), 2), 0)
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketplace_private.shop_payment_accounts (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  stripe_account_id text not null unique check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  transfers_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
grant all on marketplace_private.shop_payment_accounts to service_role;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories(id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  name text not null check (char_length(btrim(name)) between 1 and 160),
  sort_order integer not null default 0,
  check (parent_id is distinct from id)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id),
  category_id uuid not null references public.categories(id),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 150),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  description text not null default '',
  image_paths text[] not null default '{}',
  status public.product_status not null default 'draft',
  listing_type public.listing_type not null default 'fixed_price',
  currency public.currency_code not null,
  auction_starts_at timestamptz,
  auction_ends_at timestamptz,
  starting_bid public.minor_amount,
  bid_increment public.minor_amount,
  current_bid public.minor_amount,
  rating_count integer not null default 0 check (rating_count >= 0),
  rating_sum bigint not null default 0 check (rating_sum between rating_count and 5::bigint * rating_count),
  rating_average numeric(3,2) generated always as (
    coalesce(round(rating_sum::numeric / nullif(rating_count, 0), 2), 0)
  ) stored,
  search_vector tsvector generated always as (
    setweight(to_tsvector('pg_catalog.simple', title), 'A')
    || setweight(to_tsvector('pg_catalog.simple', description), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, slug),
  unique (id, shop_id),
  unique (id, currency),
  constraint products_auction_fields check (
    (listing_type = 'fixed_price' and auction_starts_at is null and auction_ends_at is null
      and starting_bid is null and bid_increment is null and current_bid is null)
    or
    (listing_type = 'auction' and auction_starts_at is not null and auction_ends_at is not null
      and auction_ends_at > auction_starts_at and starting_bid is not null and starting_bid > 0
      and bid_increment is not null and bid_increment > 0
      and (current_bid is null or current_bid >= starting_bid))
  )
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null check (char_length(btrim(sku)) between 1 and 100),
  size text not null default '',
  color text not null default '',
  weight_g integer check (weight_g > 0),
  length_mm integer check (length_mm > 0),
  width_mm integer check (width_mm > 0),
  height_mm integer check (height_mm > 0),
  price_amount public.minor_amount not null,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, size, color),
  unique (id, product_id)
);
create unique index product_variants_sku_idx on public.product_variants (lower(btrim(sku)));

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references public.profiles(id),
  currency public.currency_code not null,
  payment_status public.payment_status not null default 'pending',
  subtotal_amount public.minor_amount not null default 0,
  shipping_amount public.minor_amount not null default 0,
  tax_amount public.minor_amount not null default 0,
  discount_amount public.minor_amount not null default 0,
  total_amount public.minor_amount generated always as (
    subtotal_amount + shipping_amount + tax_amount - discount_amount
  ) stored,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  stripe_charge_id text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, currency),
  check ((payment_status in ('paid', 'partially_refunded', 'refunded')) = (paid_at is not null))
);

create table public.sub_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  shop_id uuid not null references public.shops(id),
  currency public.currency_code not null,
  status public.fulfillment_status not null default 'pending',
  subtotal_amount public.minor_amount not null default 0,
  shipping_amount public.minor_amount not null default 0,
  tax_amount public.minor_amount not null default 0,
  discount_amount public.minor_amount not null default 0,
  total_amount public.minor_amount generated always as (
    subtotal_amount + shipping_amount + tax_amount - discount_amount
  ) stored,
  platform_fee_amount public.minor_amount not null default 0,
  seller_transfer_amount public.minor_amount not null default 0,
  transfer_status public.transfer_status not null default 'pending',
  stripe_transfer_id text unique,
  shipping_address jsonb check (jsonb_typeof(shipping_address) = 'object'),
  tracking_number text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, currency) references public.orders(id, currency),
  unique (order_id, shop_id),
  unique (id, shop_id, currency),
  check (platform_fee_amount + seller_transfer_amount <= total_amount),
  check (transfer_status not in ('transferred', 'partially_reversed', 'reversed') or stripe_transfer_id is not null),
  check (status <> 'delivered' or delivered_at is not null)
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  sub_order_id uuid not null,
  shop_id uuid not null,
  product_id uuid not null,
  variant_id uuid not null,
  currency public.currency_code not null,
  product_title text not null check (btrim(product_title) <> ''),
  sku text not null check (btrim(sku) <> ''),
  variant_size text not null default '',
  variant_color text not null default '',
  quantity integer not null check (quantity between 1 and 1000000),
  unit_price_amount public.minor_amount not null,
  line_total_amount public.minor_amount generated always as (quantity * unit_price_amount) stored,
  created_at timestamptz not null default now(),
  foreign key (sub_order_id, shop_id, currency) references public.sub_orders(id, shop_id, currency),
  foreign key (product_id, shop_id) references public.products(id, shop_id),
  foreign key (variant_id, product_id) references public.product_variants(id, product_id),
  unique (sub_order_id, variant_id),
  unique (id, product_id, shop_id)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null unique,
  product_id uuid not null,
  shop_id uuid not null,
  author_id uuid not null default auth.uid() references public.profiles(id),
  rating smallint not null check (rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_item_id, product_id, shop_id) references public.order_items(id, product_id, shop_id)
);

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null,
  bidder_id uuid not null references public.profiles(id),
  currency public.currency_code not null,
  amount public.minor_amount not null check (amount > 0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (product_id, currency) references public.products(id, currency),
  unique (product_id, amount)
);

create index shops_owner_idx on public.shops (owner_id);
create index categories_parent_sort_idx on public.categories (parent_id, sort_order, id);
create index products_search_idx on public.products using gin (search_vector);
create index products_category_status_created_idx on public.products (category_id, status, created_at desc);
create index products_shop_status_created_idx on public.products (shop_id, status, created_at desc);
create index products_active_created_idx on public.products (created_at desc, id) where status = 'active';
create index products_auction_end_idx on public.products (auction_ends_at) where listing_type = 'auction' and status = 'active';
create index orders_buyer_created_idx on public.orders (buyer_id, created_at desc);
create index sub_orders_shop_status_created_idx on public.sub_orders (shop_id, status, created_at desc);
create index order_items_product_shop_idx on public.order_items (product_id, shop_id);
create index order_items_variant_idx on public.order_items (variant_id, product_id);
create index reviews_product_created_idx on public.reviews (product_id, created_at desc);
create index reviews_shop_created_idx on public.reviews (shop_id, created_at desc);
create index reviews_author_created_idx on public.reviews (author_id, created_at desc);
create index bids_bidder_created_idx on public.bids (bidder_id, created_at desc);

create function marketplace_private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create function marketplace_private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 100))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger marketplace_profile_on_signup
after insert on auth.users for each row execute function marketplace_private.create_profile();

insert into public.profiles (id, display_name)
select id, left(coalesce(raw_user_meta_data ->> 'display_name', ''), 100)
from auth.users on conflict (id) do nothing;

create function marketplace_private.current_role() returns public.marketplace_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid());
$$;

create function marketplace_private.owns_shop(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shops s join public.profiles p on p.id = s.owner_id
    where s.id = target and s.owner_id = (select auth.uid()) and p.role = 'seller'
  );
$$;

create function marketplace_private.owns_order(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.orders o where o.id = target and o.buyer_id = (select auth.uid()));
$$;

create function marketplace_private.seller_can_read_order(target uuid, shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select marketplace_private.owns_shop(shop) and exists (
    select 1 from public.orders o join public.sub_orders so on so.order_id = o.id
    where o.id = target and so.shop_id = shop and o.paid_at is not null
  );
$$;

create function marketplace_private.can_review(item uuid, product uuid, shop uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.order_items i
    join public.sub_orders so on so.id = i.sub_order_id
    join public.orders o on o.id = so.order_id
    join public.shops s on s.id = i.shop_id
    where i.id = item and i.product_id = product and i.shop_id = shop
      and o.buyer_id = (select auth.uid()) and s.owner_id <> o.buyer_id
      and o.payment_status in ('paid', 'partially_refunded') and so.status = 'delivered'
  );
$$;

create function marketplace_private.guard_category_tree() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.parent_id is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(1865401201);
  if exists (
    with recursive ancestors(id, parent_id) as (
      select c.id, c.parent_id from public.categories c where c.id = new.parent_id
      union
      select c.id, c.parent_id from public.categories c join ancestors a on c.id = a.parent_id
    )
    select 1 from ancestors where id = new.id
  ) then
    raise exception 'Category hierarchy cannot contain a cycle' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger marketplace_category_tree
before insert or update of parent_id on public.categories
for each row execute function marketplace_private.guard_category_tree();

create function marketplace_private.guard_auction_terms() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.current_bid is not null and
    (new.listing_type, new.currency, new.auction_starts_at, new.auction_ends_at,
      new.starting_bid, new.bid_increment, new.shop_id) is distinct from
    (old.listing_type, old.currency, old.auction_starts_at, old.auction_ends_at,
      old.starting_bid, old.bid_increment, old.shop_id) then
    raise exception 'Auction terms are locked after the first bid' using errcode = '23514';
  end if;
  if old.current_bid is not null and new.status <> old.status
    and (new.status <> 'archived' or clock_timestamp() < old.auction_ends_at) then
    raise exception 'An auction with bids can only be archived after its end' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger marketplace_auction_terms
before update on public.products for each row execute function marketplace_private.guard_auction_terms();

create function marketplace_private.update_review_ratings() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  target_product uuid;
  target_shop uuid;
  count_delta integer;
  sum_delta integer;
begin
  if tg_op = 'INSERT' then
    target_product := new.product_id;
    target_shop := new.shop_id;
    count_delta := 1;
    sum_delta := new.rating;
  elsif tg_op = 'DELETE' then
    target_product := old.product_id;
    target_shop := old.shop_id;
    count_delta := -1;
    sum_delta := -old.rating;
  else
    if (new.order_item_id, new.product_id, new.shop_id, new.author_id) is distinct from
       (old.order_item_id, old.product_id, old.shop_id, old.author_id) then
      raise exception 'Review ownership and purchase are immutable' using errcode = '23514';
    end if;
    target_product := new.product_id;
    target_shop := new.shop_id;
    count_delta := 0;
    sum_delta := new.rating - old.rating;
    if sum_delta = 0 then
      return null;
    end if;
  end if;

  update public.shops set rating_count = rating_count + count_delta, rating_sum = rating_sum + sum_delta
  where id = target_shop;
  update public.products set rating_count = rating_count + count_delta, rating_sum = rating_sum + sum_delta
  where id = target_product;
  return null;
end;
$$;

create trigger marketplace_review_ratings
after insert or update or delete on public.reviews for each row
execute function marketplace_private.update_review_ratings();

create function public.place_bid(target_product uuid, bid_amount public.minor_amount) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  listing public.products%rowtype;
  store public.shops%rowtype;
  placed_bid uuid;
  bid_time timestamptz;
  minimum_amount bigint;
begin
  if caller is null or coalesce(marketplace_private.current_role() not in ('buyer', 'seller'), true) then
    raise exception 'A buyer or seller account is required' using errcode = '42501';
  end if;
  select s.* into store from public.shops s
    join public.products p on p.shop_id = s.id where p.id = target_product for share of s;
  select * into listing from public.products where id = target_product for update;
  bid_time := clock_timestamp();
  if listing.id is null or store.id is null or listing.shop_id <> store.id or listing.listing_type <> 'auction'
     or listing.status <> 'active' or store.status <> 'active'
     or bid_time < listing.auction_starts_at or bid_time >= listing.auction_ends_at then
    raise exception 'Auction is unavailable' using errcode = '22023';
  end if;
  if store.owner_id = caller then
    raise exception 'A shop owner cannot bid on their own listing' using errcode = '42501';
  end if;
  minimum_amount := coalesce(listing.current_bid + listing.bid_increment, listing.starting_bid);
  if bid_amount is null or bid_amount < minimum_amount then
    raise exception 'Bid must be at least % %', minimum_amount, listing.currency using errcode = '22023';
  end if;
  insert into public.bids (product_id, bidder_id, currency, amount, created_at)
  values (listing.id, caller, listing.currency, bid_amount, bid_time) returning id into placed_bid;
  update public.products set current_bid = bid_amount where id = listing.id;
  return placed_bid;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['profiles', 'shops', 'products', 'product_variants', 'orders', 'sub_orders', 'reviews']
  loop
    execute format('create trigger marketplace_touch before update on public.%I for each row execute function marketplace_private.touch_updated_at()', table_name);
  end loop;
  foreach table_name in array array['profiles', 'shops', 'categories', 'products', 'product_variants', 'orders', 'sub_orders', 'order_items', 'reviews', 'bids']
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
  end loop;
end;
$$;

revoke execute on all functions in schema marketplace_private from public, anon, authenticated;
grant execute on function marketplace_private.current_role(), marketplace_private.owns_shop(uuid),
  marketplace_private.owns_order(uuid), marketplace_private.seller_can_read_order(uuid, uuid),
  marketplace_private.can_review(uuid, uuid, uuid) to authenticated;
revoke execute on function public.place_bid(uuid, public.minor_amount) from public, anon, authenticated;
grant execute on function public.place_bid(uuid, public.minor_amount) to authenticated;

grant select on public.shops, public.categories, public.products, public.product_variants, public.reviews to anon;
grant update (display_name, avatar_path) on public.profiles to authenticated;
grant insert (slug, name, description, logo_path),
  update (slug, name, description, logo_path, status) on public.shops to authenticated;
grant insert, update, delete on public.categories to authenticated;
grant insert (shop_id, category_id, slug, title, description, image_paths, status, listing_type,
    currency, auction_starts_at, auction_ends_at, starting_bid, bid_increment),
  update (category_id, slug, title, description, image_paths, status, listing_type,
    currency, auction_starts_at, auction_ends_at, starting_bid, bid_increment) on public.products to authenticated;
grant insert (product_id, sku, size, color, weight_g, length_mm, width_mm, height_mm, price_amount,
    stock_quantity, is_active),
  update (sku, size, color, weight_g, length_mm, width_mm, height_mm, price_amount,
    stock_quantity, is_active) on public.product_variants to authenticated;
grant insert (order_item_id, product_id, shop_id, rating, body),
  update (rating, body), delete on public.reviews to authenticated;

create function marketplace_private.guard_shop_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and auth.uid() is not null
     and marketplace_private.current_role() is distinct from 'admin'::public.marketplace_role then
    raise exception 'Only an administrator can change shop status' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function marketplace_private.guard_shop_status() from public, anon, authenticated;
create trigger marketplace_shop_status before update of status on public.shops
for each row execute function marketplace_private.guard_shop_status();

create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select marketplace_private.current_role()) = 'admin');
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select marketplace_private.current_role()) = 'admin')
  with check (id = (select auth.uid()) or (select marketplace_private.current_role()) = 'admin');

create policy shops_public_read on public.shops for select to anon, authenticated using (status = 'active');
create policy shops_staff_read on public.shops for select to authenticated
  using (marketplace_private.owns_shop(id) or (select marketplace_private.current_role()) = 'admin');
create policy shops_seller_insert on public.shops for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select marketplace_private.current_role()) = 'seller'
    and status = 'pending');
create policy shops_staff_update on public.shops for update to authenticated
  using (marketplace_private.owns_shop(id) or (select marketplace_private.current_role()) = 'admin')
  with check (marketplace_private.owns_shop(id) or (select marketplace_private.current_role()) = 'admin');

create policy categories_read on public.categories for select to anon, authenticated using (true);
create policy categories_admin on public.categories for all to authenticated
  using ((select marketplace_private.current_role()) = 'admin')
  with check ((select marketplace_private.current_role()) = 'admin');

create policy products_public_read on public.products for select to anon, authenticated
  using (status = 'active' and exists (select 1 from public.shops s where s.id = shop_id and s.status = 'active'));
create policy products_staff_read on public.products for select to authenticated
  using (marketplace_private.owns_shop(shop_id) or (select marketplace_private.current_role()) = 'admin');
create policy products_staff_insert on public.products for insert to authenticated
  with check (marketplace_private.owns_shop(shop_id) or (select marketplace_private.current_role()) = 'admin');
create policy products_staff_update on public.products for update to authenticated
  using (marketplace_private.owns_shop(shop_id) or (select marketplace_private.current_role()) = 'admin')
  with check (marketplace_private.owns_shop(shop_id) or (select marketplace_private.current_role()) = 'admin');

create policy variants_public_read on public.product_variants for select to anon, authenticated
  using (is_active and exists (
    select 1 from public.products p join public.shops s on s.id = p.shop_id
    where p.id = product_id and p.status = 'active' and s.status = 'active'
  ));
create policy variants_staff_read on public.product_variants for select to authenticated
  using ((select marketplace_private.current_role()) = 'admin' or exists (
    select 1 from public.products p where p.id = product_id and marketplace_private.owns_shop(p.shop_id)
  ));
create policy variants_staff_insert on public.product_variants for insert to authenticated
  with check ((select marketplace_private.current_role()) = 'admin' or exists (
    select 1 from public.products p where p.id = product_id and marketplace_private.owns_shop(p.shop_id)
  ));
create policy variants_staff_update on public.product_variants for update to authenticated
  using ((select marketplace_private.current_role()) = 'admin' or exists (
    select 1 from public.products p where p.id = product_id and marketplace_private.owns_shop(p.shop_id)
  ))
  with check ((select marketplace_private.current_role()) = 'admin' or exists (
    select 1 from public.products p where p.id = product_id and marketplace_private.owns_shop(p.shop_id)
  ));

create policy orders_read on public.orders for select to authenticated
  using (buyer_id = (select auth.uid()) or (select marketplace_private.current_role()) = 'admin');
create policy sub_orders_read on public.sub_orders for select to authenticated
  using ((select marketplace_private.current_role()) = 'admin'
    or marketplace_private.owns_order(order_id)
    or marketplace_private.seller_can_read_order(order_id, shop_id));
create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from public.sub_orders so where so.id = sub_order_id));

create policy reviews_public_read on public.reviews for select to anon, authenticated
  using (exists (
    select 1 from public.products p join public.shops s on s.id = p.shop_id
    where p.id = product_id and p.status = 'active' and s.status = 'active'
  ));
create policy reviews_private_read on public.reviews for select to authenticated
  using (author_id = (select auth.uid()) or marketplace_private.owns_shop(shop_id)
    or (select marketplace_private.current_role()) = 'admin');
create policy reviews_author_insert on public.reviews for insert to authenticated
  with check (author_id = (select auth.uid()) and (select marketplace_private.current_role()) in ('buyer', 'seller')
    and marketplace_private.can_review(order_item_id, product_id, shop_id));
create policy reviews_author_update on public.reviews for update to authenticated
  using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));
create policy reviews_author_or_admin_delete on public.reviews for delete to authenticated
  using (author_id = (select auth.uid()) or (select marketplace_private.current_role()) = 'admin');

create policy bids_read on public.bids for select to authenticated
  using (bidder_id = (select auth.uid()) or (select marketplace_private.current_role()) = 'admin');

commit;
