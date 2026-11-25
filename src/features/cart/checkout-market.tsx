"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { AccountGate } from "@/components/market-shell";
import { Button } from "@/components/ui/button";
import { errorText, getSupabase, invoke, MarketError, rpc } from "@/lib/marketplace";
import { groupCart, VoucherFields } from "./cart-market";
import { useMarketCart, type Shortage } from "./market-cart";
import { useT } from "@/components/preferences";

type Address = { recipient: string; phone: string; address_line: string; country_code: string; region_code: string; postal_code: string };
type Quote = { currency: string; subtotal: number; shipping: number; platform_discount: number; shop_discount: number; total: number;
  shops: { shop_id: string; shop_name: string; subtotal: number; shipping: number; shop_discount: number; platform_discount: number; total: number }[] };
type CheckoutResponse = { url: string; order_id: string; expires_at: string };
const stockConflict = z.object({ shortages: z.array(z.object({ variant_id: z.uuid(),
  available_stock: z.int().nonnegative(), requested_quantity: z.int().positive(), product_title: z.string().nullable() })) });
const requestStorage = "market-checkout-in-flight";

async function checkoutRequestId(fingerprint: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const stored = sessionStorage.getItem(requestStorage);
  if (stored) {
    const cached = JSON.parse(stored) as { hash: string; id: string };
    if (cached.hash === hash) return cached.id;
  }
  const id = crypto.randomUUID();
  sessionStorage.setItem(requestStorage, JSON.stringify({ hash, id }));
  return id;
}

function CheckoutForm() {
  const t = useT();
  const params = useSearchParams();
  const cancellation = params.get("cancel");
  const stored = useMarketCart((state) => state.entries);
  const shopCodes = useMarketCart((state) => state.shopCodes);
  const platformCode = useMarketCart((state) => state.platformCode);
  const reconcile = useMarketCart((state) => state.reconcile);
  const [shortages, setShortages] = useState<Shortage[]>([]);
  const [address, setAddress] = useState<Address>({ recipient: "", phone: "", address_line: "", country_code: "VN", region_code: "", postal_code: "" });
  const entries = Object.values(stored);
  const shops = groupCart(entries);
  const payload = {
    cart_items: entries.map(({ variant_id, quantity }) => ({ variant_id, quantity })).sort((a, b) => a.variant_id.localeCompare(b.variant_id)),
    shipping_address: Object.fromEntries(Object.entries(address).map(([key, value]) => [key, value.trim()])),
    shop_voucher_codes: Object.fromEntries(Object.keys(shops).filter((key) => shopCodes[key]?.trim()).map((key) => [key, shopCodes[key].trim()])),
    platform_voucher_code: platformCode.trim() || null,
  };
  const fingerprint = JSON.stringify(payload);
  const rates = useQuery({ queryKey: ["delivery-zones"], queryFn: async () => {
    const { data, error } = await getSupabase().from("shipping_rates").select("country_code,region_code").order("region_code");
    if (error) throw error;
    return data as Array<{ country_code: string; region_code: string }>;
  } });
  const countries = Array.from(new Set(rates.data?.map((rate) => rate.country_code)));
  const regions = Array.from(new Set(rates.data?.filter((rate) => rate.country_code === address.country_code).map((rate) => rate.region_code)));
  const quote = useMutation({ mutationFn: async () => ({ quote: await rpc<Quote>("calculate_order_preview", payload), fingerprint }) });
  const quoted = quote.data?.fingerprint === fingerprint ? quote.data.quote : undefined;
  const checkout = useMutation({
    mutationFn: async () => invoke<CheckoutResponse>("create-checkout-session", {
      ...payload, request_id: await checkoutRequestId(fingerprint),
      expected_total: quoted?.total, expected_currency: quoted?.currency,
    }),
    onSuccess: ({ url, order_id }) => {
      sessionStorage.setItem(`market-order-${order_id}`, JSON.stringify(payload.cart_items));
      sessionStorage.removeItem(requestStorage);
      window.location.assign(url);
    },
    onError: (error) => {
      if (!(error instanceof MarketError) || error.status !== 409) return;
      if (!["INSUFFICIENT_STOCK", "PRICE_CHANGED", "CHECKOUT_CLOSED", "CHECKOUT_KEY_REUSED"].includes(error.code)) return;
      sessionStorage.removeItem(requestStorage);
      quote.reset();
      const conflict = stockConflict.safeParse(error.details);
      if (!conflict.success) return;
      setShortages(conflict.data.shortages.map((item) => ({ ...item,
        product_title: item.product_title ?? stored[item.variant_id]?.title ?? null })));
      reconcile(conflict.data.shortages);
    },
  });
  const cancel = useMutation({ mutationFn: () => invoke("process-refund", { action: "cancel_pending", order_id: cancellation }) });

  function update(field: keyof Address, value: string) {
    setAddress((current) => ({ ...current, [field]: value, ...(field === "country_code" ? { region_code: "" } : {}) }));
  }
  return <>
    <div className="market-page-heading"><h1>{t("Thanh toán")}</h1><p>{t("Kiểm tra địa chỉ, phí giao hàng và mã giảm giá trước khi chuyển sang Stripe.")}</p></div>
    {cancellation && <div className="market-panel">
      <p>{cancel.isSuccess ? t("Đã hủy phiên và nhả hàng giữ chỗ.") : t("Bạn vừa quay lại từ Stripe. Bạn có thể hủy phiên trước để nhả hàng đang giữ.")}</p>
      {!cancel.isSuccess && <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>{t("Hủy phiên trước")}</Button>}
      {cancel.isError && <p role="alert">{t(errorText(cancel.error))}</p>}
    </div>}
    {shortages.length > 0 && <div className="market-panel market-alert" role="alert">
      <strong>{t("Đã cập nhật giỏ hàng theo tồn kho")}</strong>
      <ul>{shortages.map((item) => <li key={item.variant_id}>{item.product_title ?? t("Sản phẩm")}{" " + t("· đã chọn") + " "}{item.requested_quantity}, {item.available_stock > 0 ? t("còn {0}", item.available_stock) : t("đã hết hàng")}</li>)}</ul>
    </div>}
    {!entries.length ? <div className="market-panel"><p>{t("Giỏ hàng đang trống.")}</p><Button asChild><Link href="/search">{t("Tìm sản phẩm")}</Link></Button></div>
      : <div className="market-columns">
        <form className="market-panel market-form" onSubmit={(event) => { event.preventDefault(); quote.mutate(); }}>
          <h2>{t("Địa chỉ giao hàng")}</h2>
          <label>{t("Người nhận")}<input required maxLength={100} autoComplete="shipping name" value={address.recipient} onChange={(event) => update("recipient", event.target.value)} /></label>
          <label>{t("Số điện thoại")}<input required type="tel" minLength={7} maxLength={24} autoComplete="shipping tel" value={address.phone} onChange={(event) => update("phone", event.target.value)} /></label>
          <label>{t("Địa chỉ")}<input required maxLength={250} autoComplete="shipping address-line1" value={address.address_line} onChange={(event) => update("address_line", event.target.value)} /></label>
          <div className="market-fields">
            <label>{t("Quốc gia")}<select value={address.country_code} onChange={(event) => update("country_code", event.target.value)}>
              {Array.from(new Set(["VN", ...countries])).map((country) => <option key={country} value={country}>{country}</option>)}
            </select></label>
            <label>{t("Khu vực")}<select required value={address.region_code} onChange={(event) => update("region_code", event.target.value)}>
              <option value="">{t("Chọn khu vực")}</option>{regions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select></label>
          </div>
          {rates.isError && <p role="alert">{t(errorText(rates.error))}</p>}
          {rates.isSuccess && !regions.length && <p>{t("Chưa có khu vực vận chuyển cho quốc gia đã chọn.")}</p>}
          <label>{t("Mã bưu chính")}<input maxLength={24} autoComplete="shipping postal-code" value={address.postal_code} onChange={(event) => update("postal_code", event.target.value)} /></label>
          <Button disabled={quote.isPending || !regions.length}>{t("Tính tổng đơn hàng")}</Button>
          {quote.isError && <p role="alert">{t(errorText(quote.error))}</p>}
        </form>
        <aside className="market-stack">
          <VoucherFields shops={shops} />
          {quoted && <section className="market-panel order-summary">
            <h2>{t("Tổng thanh toán")}</h2>
            {quoted.shops.map((shop) => <div className="shop-quote" key={shop.shop_id}>
              <strong>{shop.shop_name}</strong>
              <dl><dt>{t("Tiền hàng")}</dt><dd>{t.money(shop.subtotal, quoted.currency)}</dd>
                <dt>{t("Mã shop")}</dt><dd>−{t.money(shop.shop_discount, quoted.currency)}</dd>
                <dt>{t("Phí giao hàng")}</dt><dd>{t.money(shop.shipping, quoted.currency)}</dd>
              </dl>
            </div>)}
            <dl><dt>{t("Mã toàn sàn")}</dt><dd>−{t.money(quoted.platform_discount, quoted.currency)}</dd>
              <dt><strong>{t("Tổng cộng")}</strong></dt><dd><strong>{t.money(quoted.total, quoted.currency)}</strong></dd>
            </dl>
            <p className="muted">{t("Hàng được giữ trong 15 phút sau khi tạo phiên.")}</p>
            <Button disabled={checkout.isPending} onClick={() => checkout.mutate()}>{checkout.isPending ? t("Đang giữ hàng…") : t("Thanh toán qua Stripe")}</Button>
          </section>}
          {checkout.isError && !shortages.length && <p role="alert">{t(errorText(checkout.error))}</p>}
        </aside>
      </div>}
  </>;
}

export function CheckoutMarket() {
  return <AccountGate><CheckoutForm /></AccountGate>;
}
