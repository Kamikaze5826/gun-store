begin;

create table marketplace_private.shop_onboarding_details (
  shop_id uuid primary key references public.shops(id) on delete cascade,
  warehouse_address text not null check (char_length(btrim(warehouse_address)) between 5 and 500),
  phone text not null check (phone ~ '^\+?[0-9][0-9 ()-]{6,23}$'),
  created_at timestamptz not null default now()
);
revoke all on marketplace_private.shop_onboarding_details from public, anon, authenticated;
grant select on marketplace_private.shop_onboarding_details to service_role;

create function public.open_marketplace_shop(
  shop_name text, shop_slug text, shop_description text, warehouse_address text, warehouse_phone text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  caller_role public.marketplace_role;
  existing_shop uuid;
  new_shop uuid;
  normalized_slug text := lower(btrim(shop_slug));
begin
  if caller is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if coalesce(char_length(btrim(shop_name)), 0) not between 2 and 160
    or normalized_slug is null or char_length(normalized_slug) > 100
    or normalized_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    or char_length(coalesce(shop_description, '')) > 2000
    or coalesce(char_length(btrim(warehouse_address)), 0) not between 5 and 500
    or warehouse_phone is null or btrim(warehouse_phone) !~ '^\+?[0-9][0-9 ()-]{6,23}$'
    or char_length(regexp_replace(warehouse_phone, '[^0-9]', '', 'g')) not between 7 and 15 then
    raise exception 'INVALID_SHOP_DETAILS' using errcode = '22023';
  end if;

  -- The profile lock serializes concurrent submissions for the same buyer.
  select role into caller_role from public.profiles where id = caller for update;
  if caller_role = 'seller' then
    select s.id into existing_shop from public.shops s
    join marketplace_private.shop_onboarding_details d on d.shop_id = s.id
    where s.owner_id = caller and s.slug = normalized_slug;
    if existing_shop is not null then return existing_shop; end if;
    raise exception 'SHOP_ALREADY_OPEN' using errcode = '42501';
  end if;
  if caller_role is distinct from 'buyer'::public.marketplace_role then
    raise exception 'ONBOARDING_ROLE_REQUIRED' using errcode = '42501';
  end if;
  if exists (select 1 from public.shops where owner_id = caller) then
    raise exception 'SHOP_ALREADY_OPEN' using errcode = '42501';
  end if;

  insert into public.shops (owner_id, slug, name, description, status)
  values (caller, normalized_slug, btrim(shop_name), btrim(coalesce(shop_description, '')), 'pending')
  returning id into new_shop;
  insert into marketplace_private.shop_onboarding_details (shop_id, warehouse_address, phone)
  values (new_shop, btrim(warehouse_address), btrim(warehouse_phone));
  update public.profiles set role = 'seller' where id = caller;
  return new_shop;
end;
$$;

revoke execute on function public.open_marketplace_shop(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.open_marketplace_shop(text,text,text,text,text) to authenticated;

create or replace function marketplace_private.create_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), btrim(new.raw_user_meta_data ->> 'name'), ''), 100))
  on conflict (id) do nothing;
  return new;
end;
$$;

commit;
