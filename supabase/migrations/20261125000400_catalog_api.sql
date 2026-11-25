begin;

create or replace function public.place_bid(target_product uuid, bid_amount public.minor_amount) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  listing public.products%rowtype;
  store public.shops%rowtype;
  placed_bid uuid;
  bid_time timestamptz;
  minimum_amount bigint;
begin
  if caller is null or coalesce(marketplace_private.current_role() not in ('buyer','seller'), true) then
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
  minimum_amount := coalesce(listing.current_bid + listing.bid_increment + 1, listing.starting_bid);
  if bid_amount is null or bid_amount < minimum_amount then
    raise exception 'Bid must be at least % %', minimum_amount, listing.currency using errcode = '22023';
  end if;
  insert into public.bids (product_id, bidder_id, currency, amount, created_at)
  values (listing.id, caller, listing.currency, bid_amount, bid_time) returning id into placed_bid;
  update public.products set current_bid = bid_amount where id = listing.id;
  return placed_bid;
end;
$$;

create function public.search_marketplace(
  search_term text default '', category uuid default null, min_price bigint default null,
  max_price bigint default null, min_rating numeric default null, page_offset integer default 0, page_size integer default 24
) returns table (
  id uuid, slug text, title text, image_paths text[], listing_type public.listing_type,
  currency public.currency_code, rating_average numeric, rating_count integer, shop_id uuid,
  shop_name text, price bigint, available_stock bigint
) language sql stable security invoker set search_path = '' as $$
  with query as (
    select websearch_to_tsquery('pg_catalog.simple', coalesce(left(search_term, 160), '')) as term
  )
  select p.id, p.slug, p.title, p.image_paths, p.listing_type, p.currency, p.rating_average, p.rating_count,
    p.shop_id, s.name, case when p.listing_type = 'auction' then coalesce(p.current_bid, p.starting_bid)
      else variant_stats.price end, coalesce(variant_stats.available_stock, 0)
  from public.products p
  join public.shops s on s.id = p.shop_id and s.status = 'active'
  cross join query
  cross join lateral (
    select min(v.price_amount) as price, sum(v.available_stock) as available_stock
    from public.product_variants v where v.product_id = p.id and v.is_active
      and (min_price is null or v.price_amount >= min_price) and (max_price is null or v.price_amount <= max_price)
  ) variant_stats
  where p.status = 'active' and (category is null or p.category_id = category)
    and (min_rating is null or p.rating_average >= min_rating)
    and (numnode(query.term) = 0 or p.search_vector @@ query.term)
    and (case when p.listing_type = 'auction' then
      (min_price is null or coalesce(p.current_bid, p.starting_bid) >= min_price)
      and (max_price is null or coalesce(p.current_bid, p.starting_bid) <= max_price)
    else (min_price is null and max_price is null) or variant_stats.price is not null end)
  order by ts_rank(p.search_vector, query.term) desc, p.created_at desc, p.id
  offset greatest(coalesce(page_offset, 0), 0)
  limit greatest(1, least(coalesce(page_size, 24), 49));
$$;

create function public.save_seller_product(target_shop uuid, target_product uuid, listing jsonb, variants jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  result uuid;
  variant_row record;
begin
  if not marketplace_private.owns_shop(target_shop) then raise exception 'SHOP_FORBIDDEN' using errcode = '42501'; end if;
  if jsonb_typeof(listing) is distinct from 'object' or jsonb_typeof(variants) is distinct from 'array'
    or jsonb_array_length(variants) > 100 then
    raise exception 'INVALID_LISTING' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements_text(coalesce(listing -> 'image_paths', '[]')) image
    where split_part(image, '/', 1) <> target_shop::text) then
    raise exception 'INVALID_PRODUCT_IMAGE_PATH' using errcode = '22023';
  end if;
  if target_product is null then
    if coalesce(listing ->> 'listing_type', 'fixed_price') = 'fixed_price' and jsonb_array_length(variants) = 0
      then raise exception 'VARIANT_REQUIRED' using errcode = '22023'; end if;
    insert into public.products (shop_id, category_id, slug, title, description, image_paths, status, listing_type,
      currency, auction_starts_at, auction_ends_at, starting_bid, bid_increment)
    values (target_shop, (listing ->> 'category_id')::uuid, listing ->> 'slug', listing ->> 'title',
      coalesce(listing ->> 'description', ''), array(select jsonb_array_elements_text(coalesce(listing -> 'image_paths','[]'))),
      (listing ->> 'status')::public.product_status, (listing ->> 'listing_type')::public.listing_type,
      listing ->> 'currency', (listing ->> 'auction_starts_at')::timestamptz, (listing ->> 'auction_ends_at')::timestamptz,
      (listing ->> 'starting_bid')::bigint, (listing ->> 'bid_increment')::bigint) returning id into result;
  else
    -- Match the stock reservation lock order for existing variants.
    if not exists (select 1 from public.products where id = target_product and shop_id = target_shop)
      then raise exception 'PRODUCT_FORBIDDEN' using errcode = '42501'; end if;
    perform v.id from public.product_variants v where v.product_id = target_product order by v.id for update;
    update public.products set category_id = (listing ->> 'category_id')::uuid, slug = listing ->> 'slug',
      title = listing ->> 'title', description = coalesce(listing ->> 'description',''),
      image_paths = array(select jsonb_array_elements_text(coalesce(listing -> 'image_paths','[]'))),
      status = (listing ->> 'status')::public.product_status,
      listing_type = (listing ->> 'listing_type')::public.listing_type, currency = listing ->> 'currency',
      auction_starts_at = (listing ->> 'auction_starts_at')::timestamptz,
      auction_ends_at = (listing ->> 'auction_ends_at')::timestamptz,
      starting_bid = (listing ->> 'starting_bid')::bigint, bid_increment = (listing ->> 'bid_increment')::bigint
    where id = target_product and shop_id = target_shop returning id into result;
    if result is null then raise exception 'PRODUCT_FORBIDDEN' using errcode = '42501'; end if;
  end if;

  for variant_row in
    select * from jsonb_to_recordset(variants) as v(id uuid, sku text, size text, color text,
      price_amount bigint, stock_quantity integer, original_stock_quantity integer, weight_g integer,
      length_mm integer, width_mm integer, height_mm integer, is_active boolean)
  loop
    if variant_row.id is null then
      insert into public.product_variants (product_id, sku, size, color, price_amount, stock_quantity, weight_g,
        length_mm, width_mm, height_mm, is_active)
      values (result, variant_row.sku, coalesce(variant_row.size,''), coalesce(variant_row.color,''),
        variant_row.price_amount, variant_row.stock_quantity, variant_row.weight_g, variant_row.length_mm,
        variant_row.width_mm, variant_row.height_mm, coalesce(variant_row.is_active,true));
    else
      -- An absolute stock edit must not overwrite a sale that completed since the seller loaded the form.
      update public.product_variants set sku = variant_row.sku, size = coalesce(variant_row.size,''),
        color = coalesce(variant_row.color,''), price_amount = variant_row.price_amount,
        stock_quantity = case when variant_row.stock_quantity = variant_row.original_stock_quantity
          then stock_quantity else variant_row.stock_quantity end, weight_g = variant_row.weight_g,
        length_mm = variant_row.length_mm, width_mm = variant_row.width_mm, height_mm = variant_row.height_mm,
        is_active = coalesce(variant_row.is_active,true)
      where id = variant_row.id and product_id = result
        and (variant_row.stock_quantity = variant_row.original_stock_quantity
          or stock_quantity = variant_row.original_stock_quantity);
      if not found then raise exception 'VARIANT_CHANGED_OR_FORBIDDEN' using errcode = '40001'; end if;
    end if;
  end loop;
  return result;
end;
$$;

-- Route inventory edits through the seller RPC so stale absolute values cannot resurrect sold units.
revoke update (stock_quantity) on public.product_variants from authenticated;
revoke execute on function public.search_marketplace(text,uuid,bigint,bigint,numeric,integer,integer),
  public.save_seller_product(uuid,uuid,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.search_marketplace(text,uuid,bigint,bigint,numeric,integer,integer) to anon, authenticated;
grant execute on function public.save_seller_product(uuid,uuid,jsonb,jsonb) to authenticated;

commit;
