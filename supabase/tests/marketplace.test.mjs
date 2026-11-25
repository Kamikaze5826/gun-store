import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const ids = {
  buyer: "10000000-0000-0000-0000-000000000001",
  otherBuyer: "10000000-0000-0000-0000-000000000002",
  seller: "10000000-0000-0000-0000-000000000003",
  otherSeller: "10000000-0000-0000-0000-000000000004",
  admin: "10000000-0000-0000-0000-000000000005",
  shop: "20000000-0000-0000-0000-000000000001",
  otherShop: "20000000-0000-0000-0000-000000000002",
  category: "30000000-0000-0000-0000-000000000001",
  product: "40000000-0000-0000-0000-000000000001",
  auction: "40000000-0000-0000-0000-000000000002",
  variant: "50000000-0000-0000-0000-000000000001",
  order: "60000000-0000-0000-0000-000000000001",
  subOrder: "70000000-0000-0000-0000-000000000001",
  item: "80000000-0000-0000-0000-000000000001",
};

test("marketplace migration, catalog, RLS, verified reviews and bidding", async (context) => {
  const db = new PGlite();
  context.after(() => db.close());
  const migration = await readFile(new URL("../migrations/20261125000100_marketplace.sql", import.meta.url), "utf8");
  const S = ids;

  async function useRole(role, actor = "") {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor]);
    await db.exec(`set role ${role}`);
  }

  async function read(query) {
    return (await db.query(query)).rows;
  }

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid stable language sql as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    insert into auth.users values ('${S.admin}', '{"display_name":"Admin"}');
  `);
  await db.exec(migration);
  await db.exec(`
    insert into auth.users values
      ('${S.buyer}', '{"display_name":"Người mua","role":"admin"}'),
      ('${S.otherBuyer}', '{}'), ('${S.seller}', '{}'), ('${S.otherSeller}', '{}');
    update public.profiles set role = 'seller' where id in ('${S.seller}', '${S.otherSeller}');
    update public.profiles set role = 'admin' where id = '${S.admin}';
    insert into public.shops (id, owner_id, slug, name, status) values
      ('${S.shop}', '${S.seller}', 'active-shop', 'Studio Phím', 'active'),
      ('${S.otherShop}', '${S.otherSeller}', 'pending-shop', 'Tiệm Giấy', 'pending');
    insert into public.categories (id, slug, name) values ('${S.category}', 'ban-phim', 'Bàn phím');
    insert into public.products (id, shop_id, category_id, slug, title, status, currency)
      values ('${S.product}', '${S.shop}', '${S.category}', 'ban-phim-co', 'Bàn phím cơ', 'active', 'VND'),
        (gen_random_uuid(), '${S.otherShop}', '${S.category}', 'hidden', 'Hidden', 'active', 'VND');
    insert into public.products (id, shop_id, category_id, slug, title, status, currency, listing_type,
      auction_starts_at, auction_ends_at, starting_bid, bid_increment)
      values ('${S.auction}', '${S.shop}', '${S.category}', 'dau-gia', 'Bàn phím cổ', 'active',
        'VND', 'auction', now() - interval '1 hour', now() + interval '1 hour', 100000, 10000);
    insert into public.product_variants (id, product_id, sku, size, color, price_amount)
      values ('${S.variant}', '${S.product}', 'KEY-001', '75%', 'đen', 500000);
    insert into public.orders (id, buyer_id, currency, subtotal_amount)
      values ('${S.order}', '${S.buyer}', 'VND', 500000);
    insert into public.sub_orders (id, order_id, shop_id, currency, subtotal_amount)
      values ('${S.subOrder}', '${S.order}', '${S.shop}', 'VND', 500000);
    insert into public.order_items (id, sub_order_id, shop_id, product_id, variant_id, currency,
      product_title, sku, quantity, unit_price_amount)
      values ('${S.item}', '${S.subOrder}', '${S.shop}', '${S.product}', '${S.variant}', 'VND',
        'Bàn phím cơ', 'KEY-001', 1, 500000);
  `);

  await useRole("anon");
  assert.equal((await read("select id from public.shops")).length, 1);
  assert.equal((await read("select id from public.products")).length, 2);
  assert.equal((await read("select id from public.product_variants")).length, 1);
  assert.equal((await read("select id from public.reviews")).length, 0);
  assert.deepEqual(await read("select id from public.products where search_vector @@ websearch_to_tsquery('pg_catalog.simple', 'phím cơ')"), [{ id: S.product }]);
  await assert.rejects(() => db.query("select * from public.orders"), { code: "42501" });

  await useRole("authenticated", S.buyer);
  assert.deepEqual(await read("select role, display_name from public.profiles"), [{ role: "buyer", display_name: "Người mua" }]);
  await assert.rejects(() => db.query("update public.profiles set role = 'admin'"), { code: "42501" });
  await assert.rejects(() => db.query("update public.orders set payment_status = 'paid'"), { code: "42501" });
  const review = `insert into public.reviews (order_item_id, product_id, shop_id, rating) values
    ('${S.item}', '${S.product}', '${S.shop}', 5)`;
  await assert.rejects(() => db.query(review), { code: "42501" });
  await db.query("select public.place_bid($1, $2)", [S.auction, 100000]);
  assert.equal((await read("select id from public.bids")).length, 1);

  await useRole("authenticated", S.otherBuyer);
  assert.equal((await read("select id from public.bids")).length, 0);
  assert.equal((await read("select id from public.orders")).length, 0);
  await assert.rejects(() => db.query("select public.place_bid($1, $2)", [S.auction, 109999]), { code: "22023" });
  await db.query("select public.place_bid($1, $2)", [S.auction, 110000]);

  await useRole("authenticated", S.seller);
  assert.equal((await read("select id from public.order_items")).length, 0);
  await assert.rejects(() => db.query(`update public.shops set status = 'suspended' where id = '${S.shop}'`), { code: "42501" });
  await assert.rejects(() => db.query(`update public.products set auction_ends_at = now() + interval '2 hours' where id = '${S.auction}'`), { code: "23514" });
  await assert.rejects(() => db.query("select public.place_bid($1, $2)", [S.auction, 120000]), { code: "42501" });

  await useRole("service_role");
  await db.exec(`update public.orders set payment_status = 'paid', paid_at = now() where id = '${S.order}'`);
  await db.exec(`update public.sub_orders set status = 'delivered', delivered_at = now() where id = '${S.subOrder}'`);

  await useRole("authenticated", S.otherBuyer);
  await assert.rejects(() => db.query(review), { code: "42501" });
  await useRole("authenticated", S.buyer);
  await db.query(review);
  await assert.rejects(() => db.query(review), { code: "23505" });
  for (const [table, id] of [["products", S.product], ["shops", S.shop]]) {
    assert.deepEqual(await read(`select rating_count, rating_average from public.${table} where id = '${id}'`),
      [{ rating_count: 1, rating_average: "5.00" }]);
  }
  await db.query("update public.reviews set rating = 3");
  assert.deepEqual(await read(`select rating_average from public.products where id = '${S.product}'`), [{ rating_average: "3.00" }]);

  await useRole("authenticated", S.seller);
  assert.equal((await read("select id from public.orders")).length, 0);
  assert.equal((await read("select id from public.order_items")).length, 1);
  await useRole("authenticated", S.otherSeller);
  assert.equal((await read("select id from public.order_items")).length, 0);
  assert.deepEqual(await read(`update public.products set title = 'forbidden' where id = '${S.product}' returning id`), []);

  await useRole("authenticated", S.admin);
  assert.equal((await read("select id from public.orders")).length, 1);
  assert.equal((await read("select id from public.bids")).length, 2);
  await db.query("delete from public.reviews");
  await db.query(`update public.shops set status = 'active' where id = '${S.otherShop}'`);
  assert.deepEqual(await read(`select rating_count, rating_average from public.shops where id = '${S.shop}'`),
    [{ rating_count: 0, rating_average: "0.00" }]);
});
