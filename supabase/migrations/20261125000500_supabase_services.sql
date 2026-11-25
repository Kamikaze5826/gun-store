begin;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('marketplace-release-inventory', '* * * * *',
  $job$select public.release_expired_inventory();$job$);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'products') then
    alter publication supabase_realtime add table public.products;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'product_variants') then
    alter publication supabase_realtime add table public.product_variants;
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('product-media','product-media',true,8388608,array['image/jpeg','image/png','image/webp']),
  ('refund-evidence','refund-evidence',false,20971520,array['image/jpeg','image/png','image/webp','video/mp4','video/webm'])
on conflict (id) do nothing;

create function marketplace_private.owns_storage_shop(object_name text) returns boolean
language sql stable set search_path = '' as $$
  select case when split_part(object_name, '/', 1) ~
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then marketplace_private.owns_shop(split_part(object_name, '/', 1)::uuid)
    else false end;
$$;
revoke execute on function marketplace_private.owns_storage_shop(text) from public, anon, authenticated;
grant execute on function marketplace_private.owns_storage_shop(text) to authenticated;

create policy marketplace_product_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'product-media' and marketplace_private.owns_storage_shop(name));
create policy marketplace_product_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'product-media' and marketplace_private.owns_storage_shop(name));
create policy marketplace_product_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-media' and marketplace_private.owns_storage_shop(name));

create policy marketplace_evidence_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'refund-evidence' and split_part(name, '/', 1) = (select auth.uid())::text);
create policy marketplace_evidence_read on storage.objects for select to authenticated using (
  bucket_id = 'refund-evidence' and (split_part(name, '/', 1) = (select auth.uid())::text or exists (
    select 1 from public.refund_requests r where name = any(r.evidence_urls)
  ))
);
create policy marketplace_evidence_cleanup on storage.objects for delete to authenticated using (
  bucket_id = 'refund-evidence' and split_part(name, '/', 1) = (select auth.uid())::text
  and not exists (select 1 from public.refund_requests r where name = any(r.evidence_urls))
);

commit;
