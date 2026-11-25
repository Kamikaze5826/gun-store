"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AccountGate, useMarketAuth } from "@/components/market-shell";
import { Button } from "@/components/ui/button";
import type { Listing, ShopRow } from "@/features/catalog/live-types";
import { statusText, subOrderFields, type Refund, type SubOrder } from "@/features/orders/order-types";
import { RefundControls } from "@/features/orders/refund-controls";
import { errorText, getSupabase, rpc } from "@/lib/marketplace";
import { ProductEditor } from "./product-editor";
import { useT } from "@/components/preferences";

function SellerOrder({ order, refresh }: { order: SubOrder; refresh: () => void }) {
  const t = useT();
  const [tracking, setTracking] = useState(order.tracking_number ?? "");
  const update = useMutation({
    mutationFn: (next: "shipped" | "delivered") => rpc("update_fulfillment", {
      target_sub_order: order.id, next_status: next, tracking: next === "shipped" ? tracking.trim() : null,
    }),
    onSuccess: refresh,
  });
  const address = order.shipping_address;
  return <article className="market-panel">
    <h3>{t("Đơn") + " "}{order.id.slice(0, 8)} · {t(statusText(order.status))}</h3>
    <p>{t.money(order.total_amount, order.currency)}{order.refunded_amount > 0 && t(" · Đã hoàn {0}", t.money(order.refunded_amount, order.currency))}</p>
    <ul>{order.order_items.map((item) => <li key={item.id}>{item.quantity} × {item.product_title}</li>)}</ul>
    {address && <p className="muted">{[address.recipient, address.phone, address.address_line, address.region_code, address.postal_code, address.country_code].filter(Boolean).join(" · ")}</p>}
    {["pending", "processing"].includes(order.status) && <form className="market-actions" onSubmit={(event) => { event.preventDefault(); update.mutate("shipped"); }}>
      <label>{t("Mã vận đơn")}<input required maxLength={100} value={tracking} onChange={(event) => setTracking(event.target.value)} /></label>
      <Button disabled={update.isPending}>{t("Xác nhận đã gửi")}</Button>
    </form>}
    {order.status === "shipped" && <div className="market-actions"><p>{t("Mã vận đơn") + " "}{order.tracking_number}</p>
      <Button disabled={update.isPending} onClick={() => update.mutate("delivered")}>{t("Xác nhận đã giao")}</Button></div>}
    {update.isError && <p role="alert">{t(errorText(update.error))}</p>}
    {order.refund_requests.map((claim) => <RefundControls key={claim.id} claim={claim} currency={order.currency} viewer="seller" />)}
  </article>;
}

function ShopDashboard({ id }: { id: string }) {
  const t = useT();
  const [tab, setTab] = useState<"products" | "orders">("products");
  const [editing, setEditing] = useState<Listing | "new" | null>(null);
  const products = useQuery({
    queryKey: ["seller-products", id], enabled: tab === "products",
    queryFn: async () => {
      const { data, error } = await getSupabase().from("products").select("*,product_variants(*)")
        .eq("shop_id", id).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data as unknown as Listing[];
    },
  });
  const orders = useQuery({
    queryKey: ["seller-orders", id], enabled: tab === "orders",
    queryFn: async () => {
      const { data, error } = await getSupabase().from("sub_orders").select(subOrderFields)
        .eq("shop_id", id).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data as unknown as SubOrder[];
    },
  });
  return <>
    <div className="market-actions dashboard-tabs">
      <Button aria-pressed={tab === "products"} variant={tab === "products" ? "default" : "outline"} onClick={() => setTab("products")}>{t("Sản phẩm")}</Button>
      <Button aria-pressed={tab === "orders"} variant={tab === "orders" ? "default" : "outline"} onClick={() => setTab("orders")}>{t("Đơn hàng & hoàn tiền")}</Button>
    </div>
    {tab === "products" ? <div className="market-stack">
      {!editing && <Button onClick={() => setEditing("new")}>{t("Thêm sản phẩm")}</Button>}
      {editing && <ProductEditor key={editing === "new" ? "new" : editing.id} shopId={id} item={editing === "new" ? undefined : editing}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void products.refetch(); }} />}
      {products.isPending && <p>{t("Đang tải sản phẩm…")}</p>}
      {products.isError && <p role="alert">{t(errorText(products.error))}</p>}
      {products.data?.length === 0 && <p>{t("Cửa hàng chưa có sản phẩm.")}</p>}
      {products.data?.map((product) => <article className="market-panel seller-product-row" key={product.id}>
        <div><h3>{product.title}</h3><p>{product.status === "active" ? t("Đang bán") : product.status === "draft" ? t("Bản nháp") : t("Đã lưu trữ")}
          {" · "}{product.listing_type === "auction" ? t("Đấu giá") : t("{0} biến thể", product.product_variants.length)}</p></div>
        <Button variant="outline" onClick={() => setEditing(product)}>{t("Chỉnh sửa")}</Button>
      </article>)}
    </div> : <div className="market-stack">
      {orders.isPending && <p>{t("Đang tải đơn hàng…")}</p>}
      {orders.isError && <p role="alert">{t(errorText(orders.error))}</p>}
      {orders.data?.length === 0 && <p>{t("Cửa hàng chưa có đơn đã thanh toán.")}</p>}
      {orders.data?.map((order) => <SellerOrder order={order} key={order.id} refresh={() => { void orders.refetch(); }} />)}
    </div>}
  </>;
}

function SellerShops({ userId }: { userId: string }) {
  const t = useT();
  const [chosen, setChosen] = useState("");
  const shops = useQuery({
    queryKey: ["seller-shops", userId],
    queryFn: async () => {
      const { data, error } = await getSupabase().from("shops").select("id,slug,name,status")
        .eq("owner_id", userId).order("name");
      if (error) throw error;
      return data as ShopRow[];
    },
  });
  const create = useMutation({
    mutationFn: async (form: FormData) => {
      const { error } = await getSupabase().from("shops").insert({
        name: String(form.get("name") ?? "").trim(), slug: String(form.get("slug") ?? "").trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => { void shops.refetch(); },
  });
  const shop = shops.data?.find((item) => item.id === chosen) ?? shops.data?.[0];
  if (shops.isPending) return <p>{t("Đang tải cửa hàng…")}</p>;
  if (shops.isError) return <p role="alert">{t(errorText(shops.error))}</p>;
  if (!shop) return <form className="market-panel market-form" onSubmit={(event) => {
    event.preventDefault(); create.mutate(new FormData(event.currentTarget));
  }}>
    <h2>{t("Tạo cửa hàng")}</h2>
    <label>{t("Tên cửa hàng")}<input name="name" required maxLength={160} /></label>
    <label>Slug<input name="slug" required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" /></label>
    <Button disabled={create.isPending}>{t("Gửi duyệt cửa hàng")}</Button>
    {create.isError && <p role="alert">{t(errorText(create.error))}</p>}
  </form>;
  return <>
    <label className="market-panel shop-select">{t("Cửa hàng")}<select value={shop.id} onChange={(event) => setChosen(event.target.value)}>
      {shops.data.map((element) => <option key={element.id} value={element.id}>{element.name}</option>)}
    </select>{shop.status === "pending" && <span>{t("Đang chờ admin duyệt.")}</span>}
      {shop.status === "suspended" && <span>{t("Cửa hàng đang bị đình chỉ.")}</span>}
    </label>
    <ShopDashboard key={shop.id} id={shop.id} />
  </>;
}

export function AdminDisputes() {
  const t = useT();
  const disputes = useQuery({
    queryKey: ["admin-disputes"],
    queryFn: async () => {
      const { data, error } = await getSupabase().from("refund_requests").select("*,sub_orders!inner(currency)")
        .or("status.in.(disputed,admin_resolved),and(status.eq.seller_approved,settlement_status.eq.failed)")
        .order("updated_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data as unknown as Array<Refund & { sub_orders: { currency: string } }>;
    },
  });
  return <section className="market-panel">
    <h2>{t("Tranh chấp & hoàn tiền")}</h2>
    {disputes.isPending && <p>{t("Đang tải tranh chấp…")}</p>}
    {disputes.isError && <p role="alert">{t(errorText(disputes.error))}</p>}
    {disputes.data?.length === 0 && <p>{t("Chưa có tranh chấp cần xử lý.")}</p>}
    {disputes.data?.map((claim) => <RefundControls claim={claim} currency={claim.sub_orders.currency} viewer="admin" key={claim.id} />)}
  </section>;
}

function SellerContent() {
  const t = useT();
  const { session } = useMarketAuth();
  const role = useQuery({
    queryKey: ["market-role", session?.user.id],
    queryFn: async () => {
      const { data, error } = await getSupabase().from("profiles").select("role").eq("id", session!.user.id).single();
      if (error) throw error;
      return data.role as "buyer" | "seller" | "admin";
    },
  });
  if (role.isPending) return <p role="status">{t("Đang kiểm tra quyền…")}</p>;
  if (role.isError) return <p role="alert">{t(errorText(role.error))}</p>;
  return <>
    <div className="market-page-heading"><h1>{role.data === "admin" ? t("Quản lý tranh chấp") : t("Kênh người bán")}</h1></div>
    {role.data === "admin" ? <AdminDisputes /> : role.data === "seller" ? <SellerShops userId={session!.user.id} />
      : <p>{t("Bạn cần tài khoản người bán để mở dashboard.")}</p>}
  </>;
}

export function SellerMarket() {
  return <AccountGate><SellerContent /></AccountGate>;
}
