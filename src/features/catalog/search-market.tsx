"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Package, Search, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { errorText, getSupabase, mediaUrl, rpc } from "@/lib/marketplace";
import type { CategoryRow, SearchRow } from "./live-types";
import { useT } from "@/components/preferences";
import catalogData from "./model-catalog.json";

const pageSize = 24;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const number = (value: string | null, max: number) => {
  const parsed = value ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? Math.trunc(parsed) : null;
};

export async function fetchCategories() {
  const { data, error } = await getSupabase().from("categories").select("id,name").order("sort_order").order("name");
  if (error) throw error;
  return data as CategoryRow[];
}

export function SearchMarket() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const search = params.get("q")?.slice(0, 160) ?? "";
  const [draft, setDraft] = useState({ search, value: search });
  const searchValue = draft.search === search ? draft.value : search;
  const category = params.get("category") ?? "";
  const minimum = number(params.get("min"), 999_999_999_999);
  const maximum = number(params.get("max"), 999_999_999_999);
  const rating = number(params.get("rating"), 5);
  const page = Math.max(1, number(params.get("page"), 1000) ?? 1);
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const invalidRange = minimum !== null && maximum !== null && minimum > maximum;
  const catalog = useQuery({
    queryKey: ["live-search", search, category, minimum, maximum, rating, page],
    queryFn: () => rpc<SearchRow[]>("search_marketplace", { search_term: search, category: uuid.test(category) ? category : null,
      min_price: minimum, max_price: maximum, min_rating: rating, page_offset: (page - 1) * pageSize, page_size: pageSize + 1 }),
    enabled: !invalidRange,
  });

  useEffect(() => {
    if (searchValue.trim() === search) return;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (searchValue.trim()) next.set("q", searchValue.trim());
      else next.delete("q");
      next.delete("page");
      router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchValue, search, params, pathname, router]);

  function change(values: Record<string, string>, resetPage = true) {
    const next = new URLSearchParams(params);
    if (resetPage) next.delete("page");
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.push(next.size ? `${pathname}?${next}` : pathname, { scroll: !resetPage });
  }

  return <>
    <div className="market-page-heading"><h1>{t("Tìm sản phẩm")}</h1><p>{t("Phù điêu giấy, sa bàn và phụ kiện cho góc trưng bày của bạn.")}</p></div>
    <label className="site-search live-search"><Search size={20} /><span className="sr-only">{t("Từ khóa")}</span>
      <input type="search" maxLength={160} value={searchValue} placeholder={t("Tìm mô hình, chất liệu…")}
        onChange={(event) => setDraft({ search, value: event.target.value })} />
    </label>
    <form className="market-panel search-filters" key={`${category}:${minimum}:${maximum}:${rating}`} onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      change(Object.fromEntries(["category", "min", "max", "rating"].map((key) => [key, String(form.get(key) ?? "")])));
    }}>
      <label>{t("Danh mục")}<select name="category" defaultValue={category} key={categories.data?.length}><option value="">{t("Tất cả")}</option>
        {categories.data?.map((item) => <option key={item.id} value={item.id}>{t(item.name)}</option>)}
      </select></label>
      <label>{t("Giá từ")}<input name="min" type="number" min="0" step="1" max="999999999999" defaultValue={minimum ?? ""} /></label>
      <label>{t("Giá đến")}<input name="max" type="number" min="0" step="1" max="999999999999" defaultValue={maximum ?? ""} /></label>
      <label>{t("Đánh giá")}<select name="rating" defaultValue={rating ?? ""}><option value="">{t("Tất cả")}</option>
        {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{t("Từ") + " "}{value}{" " + t("sao")}</option>)}
      </select></label>
      <Button>{t("Áp dụng")}</Button>
      <Button type="button" variant="outline" onClick={() => change({ category: "", min: "", max: "", rating: "" })}>{t("Xóa lọc")}</Button>
    </form>
    {invalidRange ? <p role="alert">{t("Giá thấp nhất phải nhỏ hơn hoặc bằng giá cao nhất.")}</p>
      : catalog.isPending ? <p role="status">{t("Đang tìm sản phẩm…")}</p>
      : catalog.isError ? <p role="alert">{t(errorText(catalog.error))}</p>
      : catalog.data.length === 0 ? <div className="empty-state">{t("Không tìm thấy sản phẩm phù hợp.")}</div>
      : <>
        <div className="product-grid" aria-label={t("Kết quả tìm kiếm")}>
          {catalog.data.slice(0, pageSize).map((item) => <article className="product-card live-card" key={item.id}>
            <Link href={`/products/${item.slug}?shop=${item.shop_id}`} className="product-preview">
              {item.image_paths[0] ? <span className="live-reference-photo">
                <img className="product-image" src={mediaUrl(item.image_paths[0])} alt="" loading="lazy" />
                {item.shop_id === catalogData.shopId && <span className="model-reference">{t("Ảnh tham chiếu")}</span>}
              </span>
                : <span className="product-image product-placeholder"><Package size={36} /></span>}
              <span className="product-shop">{item.shop_name}</span>
              <span className="product-name">{t(item.title)}</span>
            </Link>
            <div className="product-bottom live-card-meta"><strong>{item.price === null ? t("Chưa có giá") : t.money(item.price, item.currency)}</strong>
              <span className="rating"><Star size={15} /> {Number(item.rating_average).toFixed(1)} ({item.rating_count})</span>
            </div>
            {item.listing_type === "auction" || item.available_stock <= 0 ? <p className="live-badge">
              {item.listing_type === "auction" ? t("Đấu giá") : t("Hết hàng")}
            </p> : null}
          </article>)}
        </div>
        {(page > 1 || catalog.data.length > pageSize) && <div className="market-actions live-pagination">
          <Button variant="outline" disabled={page <= 1} onClick={() => change({ page: String(page - 1) }, false)}>{t("Trang trước")}</Button>
          <span>{t("Trang") + " "}{page}</span>
          <Button variant="outline" disabled={catalog.data.length <= pageSize || page >= 1000} onClick={() => change({ page: String(page + 1) }, false)}>{t("Trang sau")}</Button>
        </div>}
      </>}
  </>;
}
