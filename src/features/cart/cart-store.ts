"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type CartState = {
  quantities: Record<string, number>;
  changeQuantity: (productId: string, delta: number) => void;
  clear: () => void;
};

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      quantities: {},
      clear: () => set({ quantities: {} }),
      changeQuantity: (productId, delta) => set((state) => {
        const quantities = { ...state.quantities };
        const quantity = Math.max(0, (quantities[productId] ?? 0) + delta);
        if (quantity > 0) quantities[productId] = quantity;
        else delete quantities[productId];
        return { quantities };
      }),
    }),
    { name: "goc-lam-viec-cart", skipHydration: true },
  ),
);
