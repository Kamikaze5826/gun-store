"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Package, Plus, Star } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useMarketAuth } from "@/components/market-shell";
import { Button } from "@/components/ui/button";
import { errorText, getSupabase, invoke, mediaUrl } from "@/lib/marketplace";
import { useMarketCart } from "@/features/cart/market-cart";
import { loginPath } from "@/features/auth/redirects";
import type { Listing } from "./live-types";
import { useT } from "@/components/preferences";
import catalogData from "./model-catalog.json";

async function fetchListing(slug: string, shop?: string) {
  let query = getSupabase().from("products").select("*,shops!inner(id,slug,name,status),product_variants(*)")
    .eq("slug", slug).eq("status", "active").eq("shops.status", "active");
  if (shop) query = query.eq("shop_id", shop);
  const { data, error } = await query.order("id").limit(20);
  if (error) throw error;
  return data as unknown as Listing[];
}

function Auction({ listing, refresh }: { listing: Listing; refresh: () => Promise<unknown> }) {
  const t = useT();
  const { session } = useMarketAuth();
  const [now, setNow] = useState<number | null>(null);
  const [bid, setBid] = useState("");
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  const mutation = useMutation({ mutationFn: (amount: number) => invoke("place-bid", { product_id: listing.id, amount }),
    onSettled: () => { void refresh(); } });
  const current = listing.current_bid ?? listing.starting_bid ?? 0;
  const min = listing.current_bid === null ? current : current + (listing.bid_increment ?? 0) + 1;
  const end = Date.parse(listing.auction_ends_at ?? "");
  const started = now !== null && now >= Date.parse(listing.auction_starts_at ?? "");
  const seconds = now === null ? 0 : Math.max(0, Math.ceil((end - now) / 1000));
  const open = started && seconds > 0;
  return <section className="market-panel auction-panel">
    <h2>{t("Đấu giá trực tiếp")}</h2>
    <p>{listing.current_bid === null ? t("Giá mở đầu") : t("Giá hiện tại")} <strong>{t.money(current, listing.currency)}</strong></p>
    <p>{now === null ? t("Đang kiểm tra thời gian…") : seconds === 0 ? t("Đã kết thúc")
      : !started ? t("Chưa bắt đầu") : t("Còn {0} giờ {1} phút {2} giây", Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60)}</p>
    {open && <>
      <p>{t("Mức đặt tối thiểu") + " "}{t.money(min, listing.currency)}.</p>
      {session ? <form className="market-actions" onSubmit={(event) => {
        event.preventDefault();
        if (Number.isSafeInteger(Number(bid)) && Number(bid) >= min) mutation.mutate(Number(bid));
      }}>
        <label>{t("Giá đặt (đơn vị nhỏ nhất)")}<input type="number" step="1" min={min} max={999999999999} value={bid}
          onChange={(event) => setBid(event.target.value)} required /></label>
        <Button disabled={mutation.isPending}>{t("Đặt giá")}</Button>
      </form> : <Button asChild><Link href={loginPath(`/products/${listing.slug}?shop=${listing.shop_id}`)}>{t("Đăng nhập để đặt giá")}</Link></Button>}
    </>}
    {mutation.isError && <p role="alert">{t(errorText(mutation.error))}</p>}
    {mutation.isSuccess && <p role="status">{t("Đã nhận giá đặt.")}</p>}
  </section>;
}

function BuyOptions({ listing }: { listing: Listing }) {
  const t = useT();
  const [selection, setSelection] = useState<string>();
  const [count, setCount] = useState(1);
  const [addedQuantity, setAddedQuantity] = useState(0);
  const entries = useMarketCart((state) => state.entries);
  const setEntry = useMarketCart((state) => state.setEntry);
  const variants = listing.product_variants.filter((item) => item.is_active);
  const selected = variants.find((item) => item.id === selection) ?? variants[0];
  if (!selected) return <p>{t("Hiện chưa có biến thể đang bán.")}</p>;
  const colors = variants.filter((item) => item.size === selected.size);
  const inCart = entries[selected.id]?.quantity ?? 0;
  const available = Math.max(0, Math.min(1000, selected.available_stock) - inCart);
  const quantity = Math.min(count, available);
  return <div className="market-form buy-options">
    <strong className="live-price">{t.money(selected.price_amount, listing.currency)}</strong>
    <div className="market-actions">
      <label>{t("Kích cỡ")}<select value={selected.size} onChange={(event) => {
        setSelection(variants.find((item) => item.size === event.target.value)?.id); setCount(1);
      }}>{Array.from(new Set(variants.map((item) => item.size))).map((size) =>
        <option key={size} value={size}>{size || t("Mặc định")}</option>)}</select></label>
      <label>{t("Màu")}<select value={selected.id} onChange={(event) => { setSelection(event.target.value); setCount(1); }}>
        {colors.map((item) => <option key={item.id} value={item.id}>{item.color || t("Mặc định")}</option>)}
      </select></label>
    </div>
    <p>{selected.available_stock > 0 ? t("Còn {0} sản phẩm", selected.available_stock) : t("Hết hàng")}{inCart > 0 && t(" · {0} trong giỏ", inCart)}</p>
    <div className="market-actions">
      <Button size="icon" variant="outline" disabled={quantity <= 1} aria-label={t("Giảm số lượng")} onClick={() => setCount(quantity - 1)}><Minus size={16} /></Button>
      <span aria-live="polite">{quantity}</span>
      <Button size="icon" variant="outline" disabled={quantity >= available} aria-label={t("Tăng số lượng")} onClick={() => setCount(quantity + 1)}><Plus size={16} /></Button>
      <Button disabled={!quantity} onClick={() => {
        setEntry({ variant_id: selected.id, product_id: listing.id, slug: listing.slug, title: listing.title,
          variant_label: [selected.size, selected.color].filter(Boolean).join(" · "), shop_id: listing.shop_id,
          shop_name: listing.shops.name, currency: listing.currency, price: selected.price_amount, quantity: inCart + quantity });
        setAddedQuantity(quantity);
      }}>{t("Thêm vào giỏ")}</Button>
    </div>
    <p role="status">{addedQuantity > 0 ? t("Đã thêm {0} sản phẩm vào giỏ.", addedQuantity) : ""}</p>
  </div>;
}

export function ProductMarket({ slug, shop }: { slug: string; shop?: string }) {
  const t = useT();
  const client = useQueryClient();
  const queryKey = ["live-product", slug, shop];
  const product = useQuery({ queryKey, queryFn: () => fetchListing(slug, shop), refetchInterval: 20_000 });
  const listing = product.data?.length === 1 ? product.data[0] : undefined;
  const listingId = listing?.id;
  useEffect(() => {
    if (!listingId) return;
    const supabase = getSupabase();
    const invalidate = () => { void client.invalidateQueries({ queryKey: ["live-product", slug, shop] }); };
    const channel = supabase.channel(`market-product-${listingId}-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "products", filter: `id=eq.${listingId}` }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "product_variants", filter: `product_id=eq.${listingId}` }, invalidate)
      .subscribe((status) => { if (status === "SUBSCRIBED") invalidate(); });
    return () => { void supabase.removeChannel(channel); };
  }, [client, listingId, slug, shop]);

  if (product.isPending) return <p role="status">{t("Đang tải sản phẩm…")}</p>;
  if (product.isError) return <p role="alert">{t(errorText(product.error))}</p>;
  if (!listing) return <div className="market-panel">
    <h1>{product.data.length ? t("Chọn cửa hàng") : t("Sản phẩm không còn hiển thị")}</h1>
    {product.data.map((item) => <p key={item.id}><Link href={`/products/${item.slug}?shop=${item.shop_id}`}>{item.title} · {item.shops.name}</Link></p>)}
    <Button asChild variant="outline"><Link href="/search">{t("Quay lại tìm kiếm")}</Link></Button>
  </div>;
  return <div className="product-detail">
    <div className="detail-gallery">
      {listing.image_paths.length > 0 ? listing.image_paths.map((image, index) =>
        <figure key={image} className="live-reference-photo">
          <img src={mediaUrl(image)} alt={t("{0}, ảnh {1}", t(listing.title), index + 1)} loading={index === 0 ? "eager" : "lazy"} />
          {listing.shop_id === catalogData.shopId && <figcaption className="model-reference">{t("Ảnh tham chiếu")}</figcaption>}
        </figure>)
        : <div className="product-placeholder"><Package size={60} /></div>}
    </div>
    <section className="market-panel product-detail-info">
      <p className="muted">{listing.shops.name}</p>
      <h1>{t(listing.title)}</h1>
      <p className="rating"><Star size={18} /> {Number(listing.rating_average).toFixed(1)} ({listing.rating_count}{" " + t("đánh giá)")}</p>
      {listing.description && <p className="listing-description">{t(listing.description)}</p>}
      {listing.shop_id === catalogData.shopId && <p className="muted">{t("Đồ trang trí tĩnh dành cho trưng bày.")}</p>}
      {listing.listing_type === "auction" ? <Auction listing={listing} refresh={product.refetch} /> : <BuyOptions listing={listing} />}
    </section>
  </div>;
}
