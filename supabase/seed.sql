-- Local sample configuration. Set actual zones and amounts for your project.
insert into public.categories (slug, name, sort_order)
values ('ban-phim', 'Bàn phím', 1), ('am-thanh', 'Âm thanh', 2),
  ('chuot', 'Chuột', 3), ('phu-kien', 'Phụ kiện', 4)
on conflict (slug) do nothing;

insert into public.shipping_rates (country_code, region_code, currency, max_weight_grams, amount)
values ('VN', 'VN-SG', 'VND', 500, 20000), ('VN', 'VN-SG', 'VND', 2000, 30000),
  ('VN', 'VN-SG', 'VND', 5000, 50000), ('VN', 'VN-HN', 'VND', 500, 25000),
  ('VN', 'VN-HN', 'VND', 2000, 35000), ('VN', 'VN-HN', 'VND', 5000, 60000)
on conflict (country_code, region_code, currency, max_weight_grams) do nothing;
