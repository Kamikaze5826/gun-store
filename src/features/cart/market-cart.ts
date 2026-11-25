"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartEntry = {
  variant_id: string; product_id: string; slug: string; title: string; variant_label: string;
  shop_id: string; shop_name: string; currency: string; price: number; quantity: number;
};

export type Shortage = { variant_id: string; requested_quantity: number; available_stock: number; product_title: string | null };

type MarketCart = {
  entries: Record<string, CartEntry>;
  shopCodes: Record<string, string>;
  platformCode: string;
  setEntry: (entry: CartEntry) => void;
  setQuantity: (id: string, quantity: number) => void;
  setCode: (shop: string, code: string) => void;
  setPlatform: (code: string) => void;
  reconcile: (shortages: Shortage[]) => void;
  removePurchased: (entries: Array<{ variant_id: string; quantity: number }>) => void;
};

function updateQuantities(entries: MarketCart["entries"], quantities: Record<string, number>) {
  const next = { ...entries };
  for (const [id, quantity] of Object.entries(quantities)) {
    if (!next[id]) continue;
    if (quantity <= 0) delete next[id];
    else next[id] = { ...next[id], quantity };
  }
  return next;
}

export const useMarketCart = create<MarketCart>()(persist((set) => ({
  entries: {}, shopCodes: {}, platformCode: "",
  setEntry: (entry) => set((state) => ({ entries: { ...state.entries, [entry.variant_id]: entry } })),
  setQuantity: (id, quantity) => set((state) => ({ entries: updateQuantities(state.entries, { [id]: quantity }) })),
  setCode: (shop, code) => set((state) => ({ shopCodes: { ...state.shopCodes, [shop]: code } })),
  setPlatform: (platformCode) => set({ platformCode }),
  reconcile: (shortages) => set((state) => ({ entries: updateQuantities(state.entries,
    Object.fromEntries(shortages.map((item) => [item.variant_id,
      Math.min(state.entries[item.variant_id]?.quantity ?? 0, item.available_stock)]))) })),
  removePurchased: (entries) => set((state) => ({ entries: updateQuantities(state.entries,
    Object.fromEntries(entries.map((item) => [item.variant_id,
      (state.entries[item.variant_id]?.quantity ?? 0) - item.quantity]))) })),
}), { name: "goc-lam-viec-market-cart", skipHydration: true }));
