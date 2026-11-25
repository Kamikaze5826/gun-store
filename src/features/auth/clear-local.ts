"use client";

import { useCart } from "@/features/cart/cart-store";
import { useMarketCart } from "@/features/cart/market-cart";
import { supabaseConfig } from "@/utils/supabase/config";

export function clearLocalAccountState() {
  useMarketCart.setState({ entries: {}, shopCodes: {}, platformCode: "" });
  useCart.setState({ quantities: {} });
  useMarketCart.persist.clearStorage();
  useCart.persist.clearStorage();
  const legacyKey = "sb-" + new URL(supabaseConfig().url).hostname.split(".")[0] + "-auth-token";
  localStorage.removeItem(legacyKey);
  localStorage.removeItem(legacyKey + "-code-verifier");
  for (let index = sessionStorage.length - 1; index >= 0; index--) {
    const key = sessionStorage.key(index);
    if (key && (key === "market-checkout-in-flight" || key.startsWith("market-order-"))) sessionStorage.removeItem(key);
  }
}
