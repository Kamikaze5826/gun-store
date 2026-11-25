"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type InputHTMLAttributes } from "react";
import { Button } from "@/components/ui/button";
import { fetchCategories } from "@/features/catalog/search-market";
import type { Listing, Variant } from "@/features/catalog/live-types";
import { errorText, getSupabase, imageExtension, MarketError, mediaUrl, rpc } from "@/lib/marketplace";
import { useT } from "@/components/preferences";

type VariantDraft = Omit<Variant, "id" | "available_stock" | "reserved_quantity"> & {
  id?: string; localId: string; original_stock_quantity?: number; reserved_quantity: number;
};

function draftVariant(item?: Variant, localId = "variant-1"): VariantDraft {
  return {
    localId, id: item?.id, original_stock_quantity: item?.stock_quantity, reserved_quantity: item?.reserved_quantity ?? 0,
    sku: item?.sku ?? "", size: item?.size ?? "", color: item?.color ?? "",
    price_amount: item?.price_amount ?? 0, stock_quantity: item?.stock_quantity ?? 0, is_active: item?.is_active ?? true,
    weight_g: item?.weight_g ?? null, length_mm: item?.length_mm ?? null,
    width_mm: item?.width_mm ?? null, height_mm: item?.height_mm ?? null,
  };
}

function localTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function Input({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return <label>{label}<input {...props} /></label>;
}

export function ProductEditor({ shopId, item, onClose, onSaved }: {
  shopId: string; item?: Listing; onClose: () => void; onSaved: () => void;
}) {
  const t = useT();
  const categories = useQuery({ queryKey: ["categories"], queryFn: fetchCategories });
  const [variants, setVariants] = useState(() => item?.product_variants.map((variant) => draftVariant(variant, variant.id)) ?? [draftVariant()]);
  const [listingType, setListingType] = useState(item?.listing_type ?? "fixed_price");
  const [images, setImages] = useState(item?.image_paths ?? []);
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      if (images.length + files.length > 8 || files.some((file) => !file.type.startsWith("image/") ||
        !imageExtension(file.type) || file.size > 8 * 1024 * 1024)) throw new MarketError("INVALID_PRODUCT_IMAGE");
      const bucket = getSupabase().storage.from("product-media");
      const paths: string[] = [];
      try {
        for (const file of files) {
          const path = `${shopId}/${crypto.randomUUID()}.${imageExtension(file.type)}`;
          const { error } = await bucket.upload(path, file, { contentType: file.type });
          if (error) throw error;
          paths.push(path);
        }
        return paths;
      } catch (error) {
        if (paths.length) await bucket.remove(paths).catch(() => undefined);
        throw error;
      }
    },
    onSuccess: (paths) => setImages((current) => [...current, ...paths]),
  });
  const save = useMutation({ mutationFn: async (form: FormData) => {
    const text = (key: string) => String(form.get(key) ?? "").trim();
    const auction = listingType === "auction";
    const listing = {
      title: text("title"), slug: text("slug"), category_id: text("category_id"), description: text("description"),
      status: text("status"), currency: text("currency").toUpperCase(), listing_type: listingType, image_paths: images,
      auction_starts_at: auction ? new Date(text("auction_starts_at")).toISOString() : null,
      auction_ends_at: auction ? new Date(text("auction_ends_at")).toISOString() : null,
      starting_bid: auction ? Number(text("starting_bid")) : null, bid_increment: auction ? Number(text("bid_increment")) : null,
    };
    const variantRows = variants.map(({ localId, reserved_quantity, ...variant }) => variant);
    await rpc("save_seller_product", {
      target_shop: shopId, target_product: item?.id ?? null, listing,
      variants: !auction || item?.product_variants.length ? variantRows : [],
    });
  }, onSuccess: onSaved });
  const hasBids = item?.current_bid != null;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate(new FormData(event.currentTarget));
  }
  function changeVariant(id: string, patch: Partial<VariantDraft>) {
    setVariants((current) => current.map((variant) => variant.localId === id ? { ...variant, ...patch } : variant));
  }
  return <form className="market-panel market-form" onSubmit={submit}>
    <h2>{item ? t("Sửa sản phẩm") : t("Thêm sản phẩm")}</h2>
    <div className="market-fields">
      <Input label={t("Tên sản phẩm")} name="title" required maxLength={200} defaultValue={item?.title} />
      <Input label="Slug" name="slug" required maxLength={150} pattern="[a-z0-9]+(-[a-z0-9]+)*" defaultValue={item?.slug} />
      <label>{t("Danh mục")}<select name="category_id" required defaultValue={item?.category_id ?? ""} key={categories.data?.length}>
        <option value="">{t("Chọn danh mục")}</option>
        {categories.data?.map((row) => <option key={row.id} value={row.id}>{t(row.name)}</option>)}
      </select></label>
      <label>{t("Trạng thái")}<select name="status" defaultValue={item?.status ?? "draft"}>
        <option value="draft">{t("Bản nháp")}</option><option value="active">{t("Đang bán")}</option><option value="archived">{t("Lưu trữ")}</option>
      </select></label>
      <Input label={t("Tiền tệ")} name="currency" required pattern="[A-Za-z]{3}" maxLength={3} defaultValue={item?.currency ?? "VND"} readOnly={hasBids} />
      <label>{t("Loại sản phẩm")}<select value={listingType} disabled={hasBids}
        onChange={(event) => setListingType(event.target.value as Listing["listing_type"])}>
        <option value="fixed_price">{t("Giá cố định")}</option><option value="auction">{t("Đấu giá")}</option>
      </select></label>
    </div>
    {categories.isError && <p role="alert">{t(errorText(categories.error))}</p>}
    <label>{t("Mô tả")}<textarea name="description" maxLength={10000} defaultValue={item?.description} /></label>
    <label>{t("Ảnh sản phẩm (tối đa 8 ảnh, 8 MB mỗi ảnh)")}<input type="file" multiple accept="image/jpeg,image/png,image/webp"
      disabled={upload.isPending || images.length >= 8} onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length) upload.mutate(files);
        event.target.value = "";
      }} /></label>
    {upload.isError && <p role="alert">{t(errorText(upload.error))}</p>}
    {images.length > 0 && <div className="media-preview">{images.map((path) => <div key={path}>
      <img src={mediaUrl(path)} alt="" /><Button type="button" variant="outline" onClick={() => setImages((current) => current.filter((value) => value !== path))}>{t("Bỏ ảnh")}</Button>
    </div>)}</div>}
    {listingType === "auction" ? <fieldset className="variant-editor"><legend>{t("Thông số đấu giá")}</legend>
      {hasBids ? <p>{t("Điều khoản đã khóa vì sản phẩm đã có lượt đặt giá.")}</p>
        : <div className="market-fields">
          <Input label={t("Bắt đầu")} required name="auction_starts_at" type="datetime-local" defaultValue={localTime(item?.auction_starts_at)} />
          <Input label={t("Kết thúc")} required name="auction_ends_at" type="datetime-local" defaultValue={localTime(item?.auction_ends_at)} />
          <Input label={t("Giá mở đầu")} required name="starting_bid" type="number" min={1} max={999999999999} defaultValue={item?.starting_bid ?? ""} />
          <Input label={t("Bước giá")} required name="bid_increment" type="number" min={1} max={999999999999} defaultValue={item?.bid_increment ?? ""} />
        </div>}
      {hasBids && <>
        <input type="hidden" name="auction_starts_at" value={item?.auction_starts_at ?? ""} />
        <input type="hidden" name="auction_ends_at" value={item?.auction_ends_at ?? ""} />
        <input type="hidden" name="starting_bid" value={item?.starting_bid ?? ""} />
        <input type="hidden" name="bid_increment" value={item?.bid_increment ?? ""} />
      </>}
    </fieldset> : <>
      <h3>{t("Biến thể")}</h3>
      {variants.map((variant, index) => <fieldset className="variant-editor" key={variant.localId}>
        <legend>{variant.sku || t("Biến thể {0}", index + 1)}</legend>
        <div className="market-fields">
          {([["sku", "SKU"], ["size", t("Kích cỡ")], ["color", t("Màu")]] as const).map(([key, label]) =>
            <Input key={key} label={label} required={key === "sku"} maxLength={100} value={variant[key]}
              onChange={(event) => changeVariant(variant.localId, { [key]: event.target.value })} />)}
          <Input label={t("Giá (đơn vị nhỏ nhất)")} required type="number" min={0} max={999999999999} value={variant.price_amount}
            onChange={(event) => changeVariant(variant.localId, { price_amount: Number(event.target.value) })} />
          <Input label={t("Tồn kho vật lý · đang giữ {0}", variant.reserved_quantity)} required type="number" min={variant.reserved_quantity}
            max={2147483647} value={variant.stock_quantity} onChange={(event) => changeVariant(variant.localId, { stock_quantity: Number(event.target.value) })} />
          {([["weight_g", t("Cân nặng (g)")], ["length_mm", t("Dài (mm)")], ["width_mm", t("Rộng (mm)")], ["height_mm", t("Cao (mm)")]] as const)
            .map(([key, label]) => <Input key={key} label={label} required={key === "weight_g"} type="number" min={1} max={2147483647}
              value={variant[key] ?? ""} onChange={(event) => changeVariant(variant.localId, { [key]: event.target.value ? Number(event.target.value) : null })} />)}
          <label className="market-checkbox"><input type="checkbox" checked={variant.is_active}
            onChange={(event) => changeVariant(variant.localId, { is_active: event.target.checked })} />{" " + t("Đang bán")}</label>
        </div>
        {!variant.id && variants.length > 1 && <Button type="button" variant="outline"
          onClick={() => setVariants((current) => current.filter((entry) => entry.localId !== variant.localId))}>{t("Bỏ biến thể")}</Button>}
      </fieldset>)}
      <Button type="button" variant="outline" disabled={variants.length >= 100}
        onClick={() => setVariants((current) => [...current, draftVariant(undefined, crypto.randomUUID())])}>{t("Thêm biến thể")}</Button>
    </>}
    <div className="market-actions"><Button disabled={save.isPending || upload.isPending}>{t("Lưu sản phẩm")}</Button>
      <Button type="button" variant="outline" onClick={onClose}>{t("Đóng")}</Button></div>
    {save.isError && <p role="alert">{t(errorText(save.error))}</p>}
  </form>;
}
