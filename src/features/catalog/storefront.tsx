"use client";

import { Blocks, Box, Frame, Grid2X2, Layers3, Maximize2, Minus, Plus, RectangleHorizontal, Search, ShoppingBag, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PreferenceControls, useT } from "@/components/preferences";
import { Button } from "@/components/ui/button";
import type { Viewer } from "@/features/auth/identity";
import { useCart } from "@/features/cart/cart-store";
import { useMarketCart } from "@/features/cart/market-cart";
import { categories, demoProducts, searchCatalog } from "./demo-catalog";
import type { ModelListing } from "./model-listings";
import catalog from "./model-catalog.json";

const icons: Record<string, typeof Grid2X2> = {
  "": Grid2X2,
  "trung-bay-sung-truong": Layers3,
  "trung-bay-sung-ngan": Frame,
  "sa-ban-bom-luu-dan": Blocks,
  "trung-bay-shotgun": RectangleHorizontal,
  "trung-bay-dang-gon": Frame,
  "phu-dieu-co-lon": Maximize2,
};

export function Storefront({ products, viewer, accountEnabled }: {
  products: ModelListing[]; viewer: Viewer | null; accountEnabled: boolean;
}) {
  const t = useT();
  const live = products.length > 0;
  const inventory: ModelListing[] = live ? products : demoProducts;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("featured");
  const [selectedId, setSelectedId] = useState<string>();
  const [lastAdded, setLastAdded] = useState<string>();
  const [demoOrder, setDemoOrder] = useState<{ count: number; total: number }>();
  const [review, setReview] = useState(false);
  const grid = useRef<HTMLElement>(null);
  const cartDialog = useRef<HTMLDialogElement>(null);
  const productDialog = useRef<HTMLDialogElement>(null);
  const quantities = useCart((state) => state.quantities);
  const changeQuantity = useCart((state) => state.changeQuantity);
  const clearDemoCart = useCart((state) => state.clear);
  const entries = useMarketCart((state) => state.entries);
  const setEntry = useMarketCart((state) => state.setEntry);

  useEffect(() => {
    if (live) void useMarketCart.persist.rehydrate();
    else void useCart.persist.rehydrate();
  }, [live]);

  const results = searchCatalog(inventory, category, search, sort, t);
  const selected = inventory.find((product) => product.id === selectedId);
  const cartItems = demoProducts.filter((product) => quantities[product.id] > 0);
  const itemCount = live
    ? Object.values(entries).reduce((sum, item) => sum + item.quantity, 0)
    : cartItems.reduce((sum, item) => sum + quantities[item.id], 0);
  const total = cartItems.reduce((sum, item) => sum + item.price * quantities[item.id], 0);

  function canAdd(product: ModelListing) {
    return !product.variantId || (product.available ?? 0) >
      (entries[product.variantId]?.quantity ?? 0);
  }

  function addItem(product: ModelListing) {
    if (!canAdd(product)) return;
    if (product.variantId && product.listingId) {
      setEntry({
        variant_id: product.variantId, product_id: product.listingId, slug: product.id,
        title: product.name, variant_label: product.material, shop_id: catalog.shopId,
        shop_name: product.shop, currency: "VND", price: product.price,
        quantity: (entries[product.variantId]?.quantity ?? 0) + 1,
      });
    } else {
      changeQuantity(product.id, 1);
      setDemoOrder(undefined);
    }
    setLastAdded(product.name);
  }

  function openDetails(product: ModelListing) {
    setLastAdded(undefined);
    setSelectedId(product.id);
    productDialog.current?.showModal();
  }

  function openDemoCart() {
    setReview(false);
    cartDialog.current?.showModal();
  }

  return <div className="model-store">
    <header className="model-header">
      <div className="shell model-toolbar">
        <Link href="/" className="model-brand"><span className="model-brand-icon"><Layers3 size={23} aria-hidden="true" /></span>{catalog.shopName}<span className="model-brand-dot">.</span></Link>
        <form className="model-search" role="search" onSubmit={(event) => {
          event.preventDefault();
          grid.current?.scrollIntoView();
        }}>
          <Search size={19} aria-hidden="true" />
          <input aria-label={t("Tìm mô hình")} type="search" value={search} placeholder={t("Tìm mô hình, chất liệu…")}
            onChange={(event) => setSearch(event.target.value)} />
          <button type="submit">{t("Tìm")}</button>
        </form>
        <PreferenceControls />
        <div className="model-tools">
          {accountEnabled && <Button variant="outline" size="icon" asChild>
            <Link href={viewer?.role === "admin" ? "/admin" : viewer ? "/profile" : "/login"}
              aria-label={t(viewer ? "Tài khoản" : "Đăng nhập")} title={t(viewer ? "Tài khoản" : "Đăng nhập")}>
              <UserRound size={19} aria-hidden="true" />
            </Link>
          </Button>}
          {live ? <Button className="model-cart-button" asChild><Link href="/cart" aria-label={t("Giỏ hàng, {0} sản phẩm", itemCount)}>
            <ShoppingBag size={18} aria-hidden="true" /><span className="cart-label">{t("Giỏ hàng")}</span><span className="model-cart-count">{itemCount}</span>
          </Link></Button> : <Button className="model-cart-button" onClick={openDemoCart} aria-label={t("Giỏ hàng, {0} sản phẩm", itemCount)}>
            <ShoppingBag size={18} aria-hidden="true" /><span className="cart-label">{t("Giỏ hàng")}</span><span className="model-cart-count">{itemCount}</span>
          </Button>}
        </div>
      </div>
    </header>

    <main className="shell model-main">
      <section className="model-hero" aria-labelledby="model-title">
        <div className="model-hero-copy">
          <h1 id="model-title">{t("Mô hình sưu tầm.")}</h1>
          <p>{t("Phù điêu giấy, sa bàn và phụ kiện cho góc trưng bày của bạn.")}</p>
          <div className="market-actions">
            <Button asChild className="model-hero-action"><a href="#catalog">{t("Khám phá bộ sưu tập")}</a></Button>
            {live && <Link className="model-demo-link" href="/?mode=demo">{t("Thử đặt hàng mô phỏng")}</Link>}
          </div>
        </div>
        <figure className="model-hero-art">
          <div className="model-print">
            <img src="/marketplace/models/m16.jpg" alt={t("Ảnh tham chiếu M16")} width={348} height={145} />
            <figcaption><span>{t("Ảnh tham chiếu")}</span><strong>M16</strong></figcaption>
          </div>
        </figure>
      </section>

      <section className="model-catalog" id="catalog" ref={grid} aria-labelledby="model-catalog-title">
        <div className="model-category-row" role="group" aria-label={t("Lọc sản phẩm theo danh mục")}>
          {categories.map(({ slug, name }) => {
            const Icon = icons[slug] ?? Box;
            const count = slug ? inventory.filter((item) => item.category === slug).length : inventory.length;
            return <button key={slug} className="model-category" type="button" aria-pressed={category === slug} onClick={() => setCategory(slug)}>
              <span className="model-category-icon"><Icon size={20} aria-hidden="true" /></span>
              <span>{t(name)}</span><span className="model-category-count">{count}</span>
            </button>;
          })}
        </div>

        <div className="model-catalog-head">
          <div>
            <h2 id="model-catalog-title">{search.trim() ? t("Kết quả tìm kiếm") : t(categories.find((item) => item.slug === category && category)?.name ?? "Bộ sưu tập mô hình")}</h2>
            <p role="status">{t("Sản phẩm, {0} mục", results.length)} · {t("Ảnh minh họa tham chiếu")}</p>
          </div>
          <label className="model-sort">
            <span className="sr-only">{t("Sắp xếp sản phẩm")}</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="featured">{t("Nổi bật")}</option>
              <option value="price-asc">{t("Giá thấp đến cao")}</option>
              <option value="price-desc">{t("Giá cao đến thấp")}</option>
            </select>
          </label>
        </div>

        {results.length ? <div className="model-grid">{results.map((product) =>
          <article className="model-card" key={product.id}>
            <button type="button" className="model-card-preview" onClick={() => openDetails(product)}>
              <span className="model-card-photo">
                <img src={product.image} alt="" width={348} height={225} loading="lazy" />
                <span className="model-reference">{t("Ảnh tham chiếu")}</span>
              </span>
              <span className="model-card-group">{t(product.categoryName)}</span>
              <span className="model-card-name">{t(product.name)}</span>
              <span className="model-material">{t(product.material)}</span>
            </button>
            <div className="model-card-action">
              <strong>{t.money(product.price, "VND")}</strong>
              <Button size="icon" variant="outline" disabled={!canAdd(product)}
                title={t(canAdd(product) ? "Thêm vào giỏ" : "Hết hàng")}
                aria-label={t("Thêm {0} vào giỏ", t(product.name))} onClick={() => addItem(product)}>
                <Plus size={19} aria-hidden="true" />
              </Button>
            </div>
          </article>,
        )}</div> : <div className="empty-state">
          <p>{t("Không tìm thấy sản phẩm phù hợp.")}</p>
          <Button variant="outline" onClick={() => { setCategory(""); setSearch(""); }}>{t("Xóa bộ lọc")}</Button>
        </div>}
      </section>
    </main>

    <footer className="shell footer model-footer">
      <strong>{catalog.shopName}</strong>
      <span>{t(live ? "Giá danh mục mẫu. Đồ trang trí tĩnh dành cho trưng bày." : "Giá mẫu và đơn thử dùng để trải nghiệm cửa hàng.")}</span>
      {!live && accountEnabled && <Link href="/">{t("Về danh mục cửa hàng")}</Link>}
    </footer>
    <p className="sr-only" role="status">{lastAdded && t("Đã thêm vào giỏ: {0}", t(lastAdded))}</p>

    <dialog className="market-dialog model-dialog" ref={productDialog} aria-labelledby="product-dialog-title">
      <form method="dialog" className="dialog-close">
        <Button size="icon" variant="outline" aria-label={t("Đóng chi tiết sản phẩm")}><X size={20} aria-hidden="true" /></Button>
      </form>
      <h2 id="product-dialog-title">{t(selected?.name ?? "Chi tiết sản phẩm")}</h2>
      {selected && <>
        <figure className="model-detail-photo">
          <img src={selected.image} alt={t("Ảnh tham chiếu của {0}", t(selected.name))} />
          <figcaption>{t("Ảnh tham chiếu")}</figcaption>
        </figure>
        <p className="dialog-shop">{t(selected.material)}</p>
        <p>{t(selected.description)} {t("Đồ trang trí tĩnh dành cho trưng bày.")}</p>
        <p className="detail-price">{t.money(selected.price, "VND")}</p>
        <div className="market-actions">
          <Button disabled={!canAdd(selected)} onClick={() => addItem(selected)}>{t(canAdd(selected) ? "Thêm vào giỏ" : "Hết hàng")}</Button>
          {selected.listingId && <Button asChild variant="outline"><Link href={`/products/${selected.id}?shop=${catalog.shopId}`}>{t("Mở trang sản phẩm")}</Link></Button>}
        </div>
        {lastAdded === selected.name && <p className="model-inline-status" role="status">{t("Đã thêm vào giỏ: {0}", t(lastAdded))}</p>}
      </>}
    </dialog>

    <dialog className="market-dialog model-dialog" ref={cartDialog} aria-labelledby="cart-dialog-title">
      <form method="dialog" className="dialog-close">
        <Button size="icon" variant="outline" aria-label={t("Đóng giỏ hàng")}><X size={20} aria-hidden="true" /></Button>
      </form>
      <h2 id="cart-dialog-title">{t(review ? "Kiểm tra đơn thử" : "Giỏ hàng")}</h2>
      {demoOrder && <p role="status">{t("Đơn thử đã tạo: {0} món, tổng {1}.", demoOrder.count, t.money(demoOrder.total, "VND"))}</p>}
      {cartItems.length === 0 ? <p>{t("Giỏ hàng đang trống.")}</p> : <>
        <ul className="cart-lines">
          {cartItems.map((product) => <li key={product.id}>
            <div><strong>{t(product.name)}</strong><span>{t.money(product.price, "VND")}</span></div>
            <div className="cart-controls">
              {!review && <Button size="icon" variant="outline" aria-label={t("Giảm số lượng {0}", t(product.name))} onClick={() => changeQuantity(product.id, -1)}><Minus size={16} aria-hidden="true" /></Button>}
              <span aria-live="polite">{quantities[product.id]}</span>
              {!review && <Button size="icon" variant="outline" aria-label={t("Tăng số lượng {0}", t(product.name))} onClick={() => changeQuantity(product.id, 1)}><Plus size={16} aria-hidden="true" /></Button>}
            </div>
          </li>)}
        </ul>
        <p className="cart-total"><span>{t("Tạm tính")}</span><strong>{t.money(total, "VND")}</strong></p>
        <div className="market-actions">
          {review && <Button variant="outline" onClick={() => setReview(false)}>{t("Sửa giỏ hàng")}</Button>}
          <Button onClick={() => {
            if (!review) { setReview(true); return; }
            setDemoOrder({ count: itemCount, total });
            clearDemoCart();
            setReview(false);
          }}>{t(review ? "Xác nhận đơn thử" : "Đặt hàng thử")}</Button>
        </div>
      </>}
    </dialog>
  </div>;
}
