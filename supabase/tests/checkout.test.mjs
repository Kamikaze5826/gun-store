import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("checkout holds, voucher capacity, expiry, settlement, refunds and RLS", async (context) => {
  const db = new PGlite();
  context.after(() => db.close());
  const uuid = (number) => `90000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const [buyer, buyer2, seller, seller2, admin, shop, shop2, category, product, product2, first, second] =
    Array.from({ length: 12 }, (_, index) => uuid(index + 1));
  const country = { country_code: "VN", region_code: "VN-SG" };
  const items = [{ variant_id: first, quantity: 1 }];
  const shipping = JSON.stringify(country);
  const read = async (sql, args) => (await db.query(sql, args)).rows;
  const one = async (sql, args) => (await read(sql, args))[0].result;
  const preview = (cart, codes = {}, platform = null) => one(
    "select public.calculate_order_preview($1,$2,$3,$4) result",
    [JSON.stringify(cart), shipping, JSON.stringify(codes), platform],
  );
  const reserve = (actor, key, cart, codes = {}, platform = null) => one(
    "select public.reserve_inventory($1,$2,$3,$4,$5,$6) result",
    [actor, uuid(key), JSON.stringify(cart), shipping, JSON.stringify(codes), platform],
  );
  async function as(role, user = "") {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec(`set role ${role}`);
  }
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid stable language sql as
      $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
    create function auth.jwt() returns jsonb stable language sql as $$select '{}'::jsonb$$;
    grant usage on schema auth to anon, authenticated, service_role;
    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit integer, allowed_mime_types text[]);
    create table storage.objects (bucket_id text, name text);
    alter table storage.objects enable row level security;
    create schema cron;
    create table cron.jobs (name text, frequency text, command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.jobs values ($1,$2,$3) returning 1::bigint
    $$;
    create publication supabase_realtime;
  `);
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(file, directory), "utf8");
    // PGlite has no background worker. Execute the cron registration against the shim above.
    await db.exec(sql.replace(/^create extension if not exists (pg_cron|pg_net|supabase_vault) with schema [a-z_]+;$/gm, ""));
  }
  await db.exec(`
    insert into auth.users values ('${buyer}','{}'),('${buyer2}','{}'),('${seller}','{}'),('${seller2}','{}'),('${admin}','{}');
    update public.profiles set role = 'seller' where id in ('${seller}','${seller2}');
    update public.profiles set role = 'admin' where id = '${admin}';
    insert into public.shops (id,owner_id,slug,name,status) values
      ('${shop}','${seller}','studio','Studio','active'), ('${shop2}','${seller2}','paper','Paper','active');
    insert into public.categories (id,slug,name) values ('${category}','workspace','Workspace');
    insert into public.products (id,shop_id,category_id,slug,title,currency,status) values
      ('${product}','${shop}','${category}','keyboard','Keyboard','VND','active'),
      ('${product2}','${shop2}','${category}','paper','Paper','VND','active');
    insert into public.product_variants (id,product_id,sku,price_amount,stock_quantity,weight_g) values
      ('${first}','${product}','KEYBOARD-01',100000,1,400),
      ('${second}','${product2}','PAPER-01',50000,2,150);
    insert into public.shipping_rates (country_code,region_code,currency,max_weight_grams,amount) values
      ('VN','VN-SG','VND',500,15000), ('VN','VN-SG','VND',2000,30000);
    insert into public.vouchers (scope,shop_id,code,currency,discount_type,discount_value,max_discount_amount,
      min_order_value,usage_limit,valid_until) values
      ('shop','${shop}','STUDIO','VND','percentage',20,10000,80000,1,now()+interval '1 hour'),
      ('platform',null,'PLATFORM','VND','fixed',13001,null,120000,1,now()+interval '1 hour');
  `);
  assert.equal((await read("select count(*)::int jobs from cron.jobs where frequency = '* * * * *'"))[0].jobs, 2);
  await as("authenticated", buyer);
  const both = [...items, { variant_id: second, quantity: 1 }];
  const quote = await preview(both, { [shop]: "studio" }, "platform");
  assert.equal(quote.total, 156999);
  assert.equal(quote.shops.reduce((sum, entry) => sum + entry.total, 0), quote.total);
  assert.equal((await read("select id from public.vouchers")).length, 0);
  await assert.rejects(() => reserve(buyer, 101, items), { code: "42501" });
  await as("anon");
  assert.deepEqual(await read("select id, price from public.search_marketplace('keyboard')"), [{ id: product, price: 100000 }]);

  await as("service_role");
  const changedPrice = await one("select public.reserve_inventory($1,$2,$3,$4,'{}',null,$5) result",
    [buyer, uuid(104), JSON.stringify(items), shipping, JSON.stringify({ client_total: 1, client_currency: "VND" })]);
  assert.equal(changedPrice.code, "PRICE_CHANGED");
  const hold = await reserve(buyer, 101, both, { [shop]: "studio" }, "platform");
  assert.ok(hold.ok);
  assert.deepEqual(await reserve(buyer, 101, both, { [shop]: "studio" }, "platform"), hold);
  assert.equal((await reserve(buyer, 101, items)).code, "CHECKOUT_KEY_REUSED");
  const unavailable = await reserve(buyer2, 102, both);
  assert.equal(unavailable.code, "INSUFFICIENT_STOCK");
  assert.equal(unavailable.shortages[0].available_stock, 0);
  await assert.rejects(() => preview(both, { [shop]: "STUDIO" }, "PLATFORM"), /VOUCHER_UNAVAILABLE/);
  assert.equal(await one("select available_stock result from public.product_variants where id = $1", [second]), 1);
  assert.equal(await one("select count(*)::integer result from public.orders"), 1);
  await db.query("update public.orders set expires_at = now()-interval '1 second' where id = $1", [hold.order_id]);
  assert.equal(await one("select public.release_expired_inventory() result"), 1);
  assert.equal(await one("select public.release_expired_inventory() result"), 0);
  assert.equal(await one("select available_stock result from public.product_variants where id = $1", [first]), 1);
  assert.equal(await one("select public.confirm_inventory_deduction($1,'cs_late','pi_late','ch_late',$2,'vnd') result",
    [hold.order_id, hold.total]), "late");

  const checkout = await reserve(buyer2, 103, both, { [shop]: "studio" }, "platform");
  assert.equal(await one("select public.attach_checkout_session($1,'cs_ok','https://example.test') result", [checkout.order_id]), true);
  for (let index = 0; index < 2; index++) {
    assert.equal(await one("select public.confirm_inventory_deduction($1,'cs_ok','pi_ok','ch_ok',$2,'vnd') result",
      [checkout.order_id, checkout.total]), "paid");
  }
  assert.equal(await one("select stock_quantity result from public.product_variants where id = $1", [first]), 0);
  assert.equal(await one("select count(*)::int result from public.vouchers where used_count = 1 and reserved_count = 0"), 2);

  const sub = await one("select id result from public.sub_orders where order_id = $1 and shop_id = $2", [checkout.order_id, shop]);
  await as("authenticated", buyer);
  await assert.rejects(() => one("select public.request_refund($1,'cancel_before_shipping','test') result", [sub]), { code: "42501" });
  await as("authenticated", buyer2);
  const refund = await one("select public.request_refund($1,'cancel_before_shipping','test') result", [sub]);
  await db.query("insert into public.dispute_messages (refund_request_id,body) values ($1,'test')", [refund]);
  await as("authenticated", seller2);
  assert.equal(await one("select count(*)::integer result from public.dispute_messages"), 0);
  await as("authenticated", seller);
  await assert.rejects(() => one("select public.update_fulfillment($1,'shipped','TEST') result", [sub]), /FULFILLMENT_TRANSITION_FORBIDDEN/);
  await as("service_role");
  await assert.rejects(() => one("select public.begin_refund($1,$2) result", [refund, seller2]), { code: "42501" });
  const job = await one("select public.begin_refund($1,$2) result", [refund, seller]);
  for (let index = 0; index < 2; index++) {
    assert.equal(await one("select public.record_refund_result($1,1,'re_ok','succeeded',$2,'vnd','pi_ok') result",
      [refund, job.amount]), "refunded");
  }
  assert.equal(await one("select stock_quantity result from public.product_variants where id = $1", [first]), 1);
  assert.equal(await one("select status result from public.sub_orders where id = $1", [sub]), "cancelled");
  assert.equal(await one("select refund_state result from public.sub_orders where id = $1", [sub]), "full");
  assert.equal(await one("select payment_status result from public.orders where id = $1", [checkout.order_id]), "partially_refunded");

  const shippedSub = await one("select id result from public.sub_orders where order_id = $1 and shop_id = $2", [checkout.order_id, shop2]);
  await as("authenticated", seller2);
  assert.equal(await one("select public.update_fulfillment($1,'shipped','TEST') result", [shippedSub]), "shipped");
  assert.equal(await one("select public.update_fulfillment($1,'delivered') result", [shippedSub]), "delivered");
  await as("authenticated", buyer2);
  const returnClaim = await one("select public.request_refund($1,'return','test return',5000) result", [shippedSub]);
  await as("authenticated", seller2);
  assert.equal(await one("select public.update_refund_dispute($1,'reject') result", [returnClaim]), "seller_rejected");
  await as("authenticated", buyer2);
  assert.equal(await one("select public.update_refund_dispute($1,'dispute') result", [returnClaim]), "disputed");
  await as("service_role");
  assert.equal((await one("select public.begin_refund($1,$2) result", [returnClaim, admin])).status, "admin_resolved");
  assert.equal(await one("select public.record_refund_result($1,1,'re_partial','pending',5000,'vnd','pi_ok') result", [returnClaim]), "pending");
  assert.equal(await one("select public.record_refund_result($1,1,'re_partial','succeeded',5000,'vnd','pi_ok') result", [returnClaim]), "refunded");
  assert.equal(await one("select refund_state result from public.sub_orders where id = $1", [shippedSub]), "partial");
  assert.equal(await one("select stock_quantity result from public.product_variants where id = $1", [second]), 1);

  await as("authenticated", seller);
  const listing = { title: "Keyboard", slug: "keyboard", category_id: category,
    status: "active", listing_type: "fixed_price", currency: "VND" };
  const draft = { id: first, sku: "KEYBOARD-01", price_amount: 100000, stock_quantity: 2,
    original_stock_quantity: 0, weight_g: 400 };
  await assert.rejects(() => one("select public.save_seller_product($1,$2,$3,$4) result",
    [shop, product, JSON.stringify(listing), JSON.stringify([draft])]), { code: "40001" });
  await assert.rejects(() => db.query("update public.product_variants set stock_quantity = 0 where id = $1", [first]), { code: "42501" });
  assert.equal(await one("select public.save_seller_product($1,$2,$3,$4) result",
    [shop, product, JSON.stringify(listing), JSON.stringify([{ ...draft, original_stock_quantity: 1 }])]), product);
  assert.equal(await one("select available_stock result from public.product_variants where id = $1", [first]), 2);

  await as("service_role");
  await db.query("insert into public.shipping_rates (country_code,region_code,currency,max_weight_grams,amount) values ('VN','FREE','VND',500,0)");
  await db.query("update public.product_variants set price_amount = 0 where id = $1", [first]);
  const freeOrder = await one("select public.reserve_inventory($1,$2,$3,$4) result",
    [buyer, uuid(105), JSON.stringify(items), JSON.stringify({ ...country, region_code: "FREE" })]);
  assert.equal(freeOrder.total, 0);
  assert.equal(await one("select public.confirm_inventory_deduction($1,'cs_free',null,null,0,'vnd') result",
    [freeOrder.order_id]), "paid");
  const freeSub = await one("select id result from public.sub_orders where order_id = $1", [freeOrder.order_id]);
  await as("authenticated", buyer);
  const freeRefund = await one("select public.request_refund($1,'cancel_before_shipping','test free order') result", [freeSub]);
  await as("service_role");
  assert.equal((await one("select public.begin_refund($1,$2) result", [freeRefund, seller])).amount, 0);
  assert.equal(await one("select public.record_refund_result($1,1,null,'succeeded',0,'vnd',null) result", [freeRefund]), "refunded");
  assert.equal(await one("select available_stock result from public.product_variants where id = $1", [first]), 2);

  const auction = uuid(106);
  await db.query(`insert into public.products (id,shop_id,category_id,slug,title,currency,status,listing_type,
    auction_starts_at,auction_ends_at,starting_bid,bid_increment)
    values ($1,$2,$3,'auction','Auction','VND','active','auction',now()-interval '1 minute',now()+interval '1 hour',100,10)`,
  [auction, shop, category]);
  await as("authenticated", buyer);
  assert.ok(await one("select public.place_bid($1,100) result", [auction]));
  await as("authenticated", buyer2);
  await assert.rejects(() => one("select public.place_bid($1,110) result", [auction]), { code: "22023" });
  assert.ok(await one("select public.place_bid($1,111) result", [auction]));

  const apply = () => one("select public.open_marketplace_shop('New Workspace','new-workspace','Description','Warehouse address','0900000000') result");
  const newShop = await apply();
  assert.equal(await one("select role result from public.profiles where id = $1", [buyer2]), "seller");
  assert.equal(await one("select status result from public.shops where id = $1", [newShop]), "pending");
  assert.equal(await apply(), newShop);
  await assert.rejects(() => read("select * from marketplace_private.shop_onboarding_details"), { code: "42501" });
  await as("authenticated", buyer);
  await assert.rejects(apply, { code: "23505" });
  assert.equal(await one("select role result from public.profiles where id = $1", [buyer]), "buyer");
  await as("authenticated", admin);
  await assert.rejects(apply, { code: "42501" });
  await as("anon");
  await assert.rejects(apply, { code: "42501" });
  assert.equal(await one("select count(*)::int result from public.shops where id = $1", [newShop]), 0);
  await as("service_role");
  assert.equal(await one("select warehouse_address result from marketplace_private.shop_onboarding_details where shop_id = $1", [newShop]), "Warehouse address");
});
