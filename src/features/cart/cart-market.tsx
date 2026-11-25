"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {  } from "@/lib/marketplace";
import { useMarketCart, type CartEntry } from "./market-cart";
import { useT } from "@/components/preferences";

export function groupCart(entries: CartEntry[]) {
  const shops: Record<string, CartEntry[]> = {};
  for (const item of entries) (shops[item.shop_id] ??= []).push(item);
  return shops;
}

export function VoucherFields({ shops }: { shops: ReturnType<typeof groupCart> }) {
  const t = useT();
  const codes = useMarketCart((state) => state.shopCodes);
  const platform = useMarketCart((state) => state.platformCode);
  const setCode = useMarketCart((state) => state.setCode);
  const setPlatform = useMarketCart((state) => state.setPlatform);
  return <section className="market-panel market-form">
    <h2>{t("Mã giảm giá")}</h2>
    {Object.entries(shops).map(([shop, items]) => <label key={shop}>{t("Mã của") + " "}{items?.[0]?.shop_name}
      <input maxLength={50} value={codes[shop] ?? ""} onChange={(event) => setCode(shop, event.target.value.toUpperCase())} />
    </label>)}
    <label>{t("Mã toàn sàn")}<input maxLength={50} value={platform} onChange={(event) => setPlatform(event.target.value.toUpperCase())} /></label>
  </section>;
}

export function CartMarket() {
  const t = useT();
  const stored = useMarketCart((state) => state.entries);
  const setQuantity = useMarketCart((state) => state.setQuantity);
  const entries = Object.values(stored);
  const shops = groupCart(entries);
  return <>
    <div className="market-page-heading"><h1>{t("Giỏ hàng")}</h1><p>{entries.length}{" " + t("dòng sản phẩm")}</p></div>
    {entries.length === 0 ? <div className="market-panel"><p>{t("Giỏ hàng đang trống.")}</p>
      <Button asChild><Link href="/search">{t("Tìm sản phẩm")}</Link></Button></div>
      : <div className="market-columns">
        <div className="market-stack">
          {Object.entries(shops).map(([shop, items]) => <section className="market-panel" key={shop}>
            <h2>{items?.[0]?.shop_name}</h2>
            <ul className="cart-lines">
              {items?.map((item) => <li key={item.variant_id}>
                <div><Link href={`/products/${item.slug}?shop=${item.shop_id}`}><strong>{t(item.title)}</strong></Link>
                  {item.variant_label && <span>{t(item.variant_label)}</span>}
                  <span>{t.money(item.price, item.currency)}{" " + t("/ sản phẩm")}</span></div>
                <div className="market-actions">
                  <label className="cart-qty"><span className="sr-only">{t("Số lượng") + " "}{t(item.title)}</span>
                    <input type="number" min={1} max={1000} value={item.quantity} onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      if (Number.isInteger(value) && value >= 1 && value <= 1000) setQuantity(item.variant_id, value);
                    }} />
                  </label>
                  <Button variant="outline" onClick={() => setQuantity(item.variant_id, 0)}>{t("Bỏ")}</Button>
                </div>
              </li>)}
            </ul>
          </section>)}
        </div>
        <aside className="market-stack">
          <VoucherFields shops={shops} />
          <Button asChild><Link href="/checkout">{t("Tiếp tục thanh toán")}</Link></Button>
        </aside>
      </div>}
  </>;
}
