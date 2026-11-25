import { createServerSupabase } from "@/utils/supabase/server";
import { isSupabaseConfigured } from "@/utils/supabase/config";
import { demoProducts, type Product } from "./demo-catalog";
import catalog from "./model-catalog.json";

export type ModelListing = Product & {
  listingId?: string;
  variantId?: string;
  available?: number;
};

export async function getModelListings() {
  if (!isSupabaseConfigured) return [];
  const client = await createServerSupabase();
  const { data } = await client.from("products")
    .select("id,slug,currency,product_variants(id,price_amount,available_stock,is_active)")
    .eq("shop_id", catalog.shopId).eq("status", "active").eq("listing_type", "fixed_price")
    .eq("currency", "VND").in("slug", demoProducts.map((item) => item.id));

  return demoProducts.flatMap((item): ModelListing[] => {
    const listing = data?.find((row) => row.slug === item.id);
    const variant = listing?.product_variants.filter((row) => row.is_active)
      .sort((a, b) => Number(b.available_stock > 0) - Number(a.available_stock > 0) || a.price_amount - b.price_amount)[0];
    if (!listing || !variant) return [];
    return [{ ...item, listingId: listing.id, variantId: variant.id, price: variant.price_amount, available: variant.available_stock }];
  });
}
