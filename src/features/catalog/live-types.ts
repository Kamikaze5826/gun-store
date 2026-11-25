export type CategoryRow = { id: string; name: string };
export type ShopRow = { id: string; slug: string; name: string; status: string };
export type Variant = {
  id: string; sku: string; size: string; color: string; price_amount: number; stock_quantity: number;
  reserved_quantity: number; available_stock: number; is_active: boolean; weight_g: number | null;
  length_mm: number | null; width_mm: number | null; height_mm: number | null;
};
export type Listing = {
  id: string; slug: string; title: string; description: string; shop_id: string; category_id: string;
  status: "draft" | "active" | "archived"; listing_type: "fixed_price" | "auction"; currency: string;
  image_paths: string[]; rating_average: number; rating_count: number; starting_bid: number | null;
  current_bid: number | null; bid_increment: number | null; auction_starts_at: string | null; auction_ends_at: string | null;
  shops: ShopRow; product_variants: Variant[];
};
export type SearchRow = Pick<Listing, "id" | "slug" | "title" | "shop_id" | "listing_type" |
  "currency" | "image_paths" | "rating_count" | "rating_average"> & {
  shop_name: string; price: number | null; available_stock: number;
};
