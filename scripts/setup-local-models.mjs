import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { getLocalSupabase } from "./local-supabase.mjs";

const ownerId = "64bca915-c08f-42fd-a8e2-96652d9e719a";
const ownerEmail = "catalog@marketplace.test";
const catalog = JSON.parse(await readFile(new URL("../src/features/catalog/model-catalog.json", import.meta.url), "utf8"));

function unwrap(result, operation) {
  if (result.error) throw new Error(operation + ": " + result.error.message);
  return result.data;
}

async function main() {
  const { url, serviceKey } = getLocalSupabase();
  const supabase = createClient(url.href, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const account = await supabase.auth.admin.getUserById(ownerId);
  const user = account.error?.status === 404
    ? unwrap(await supabase.auth.admin.createUser({
      id: ownerId, email: ownerEmail, email_confirm: true,
      user_metadata: { display_name: catalog.shopName },
      app_metadata: { marketplace_model_catalog: true },
    }), "Tạo hồ sơ chủ danh mục").user
    : unwrap(account, "Kiểm tra hồ sơ chủ danh mục").user;

  if (user?.email !== ownerEmail || user.app_metadata.marketplace_model_catalog !== true) {
    throw new Error("ID chủ danh mục đang được dùng bởi tài khoản khác.");
  }
  unwrap(await supabase.from("profiles").update({ role: "seller" }).eq("id", ownerId).select("id").single(), "Cấp quyền người bán");

  unwrap(await supabase.from("shops").upsert({
    id: catalog.shopId, owner_id: ownerId, name: catalog.shopName, slug: catalog.shopSlug,
    description: "Phù điêu giấy và mô hình tĩnh để trưng bày.", status: "active",
  }, { onConflict: "id", ignoreDuplicates: true }), "Tạo cửa hàng mẫu");
  const shop = unwrap(await supabase.from("shops").select("owner_id,slug,name").eq("id", catalog.shopId).single(), "Kiểm tra cửa hàng");
  if (shop.owner_id !== ownerId || shop.slug !== catalog.shopSlug) throw new Error("ID cửa hàng mẫu đã được dùng.");
  if (shop.name !== catalog.shopName) {
    unwrap(await supabase.from("shops").update({ name: catalog.shopName }).eq("id", catalog.shopId)
      .eq("owner_id", ownerId), "Cập nhật tên cửa hàng");
  }

  unwrap(await supabase.from("categories").upsert(catalog.categories.map((item, index) => ({
    ...item, sort_order: index,
  })), { onConflict: "slug", ignoreDuplicates: true }), "Tạo danh mục");
  const categories = unwrap(await supabase.from("categories").select("id,slug")
    .in("slug", catalog.categories.map((item) => item.slug)), "Đọc danh mục");
  const idsBySlug = new Map(categories.map(({ slug, id }) => [slug, id]));
  const bucket = supabase.storage.from("product-media");

  for (const item of catalog.products) {
    const path = catalog.shopId + "/" + item.photo;
    const photo = await readFile(new URL("../public/marketplace/models/" + item.photo, import.meta.url));
    unwrap(await bucket.upload(path, photo, { contentType: "image/jpeg", upsert: true }), "Đăng ảnh tham chiếu");
    unwrap(await supabase.from("products").upsert({
      shop_id: catalog.shopId, category_id: idsBySlug.get(item.category), slug: item.id,
      title: item.name, description: item.description, image_paths: [path], status: "active", currency: "VND",
    }, { onConflict: "shop_id,slug", ignoreDuplicates: true }), "Tạo sản phẩm");
    const product = unwrap(await supabase.from("products").select("id")
      .eq("shop_id", catalog.shopId).eq("slug", item.id).single(), "Đọc sản phẩm");
    unwrap(await supabase.from("product_variants").upsert({
      product_id: product.id, sku: ("KMM-" + item.id).toUpperCase(), price_amount: item.price,
      stock_quantity: 12, weight_g: 200,
    }, { onConflict: "product_id,size,color", ignoreDuplicates: true }), "Thêm giá và tồn kho mẫu");
  }
  console.log("Đã chuẩn bị " + catalog.products.length + " món trưng bày trong Supabase local.");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
