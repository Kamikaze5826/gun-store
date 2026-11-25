"use client";

import Link from "next/link";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { getSupabase, marketConfigured } from "@/lib/marketplace";
import { useMarketCart } from "@/features/cart/market-cart";
import { clearLocalAccountState } from "@/features/auth/clear-local";
import type { Viewer } from "@/features/auth/identity";
import { loginPath } from "@/features/auth/redirects";
import { usePathname } from "next/navigation";
import { PreferenceControls, useT } from "@/components/preferences";

type SessionIdentity = { user: { id: string; email?: string } };
const Auth = createContext<{ session: SessionIdentity | null; loading: boolean }>({ session: null, loading: true });
export const useMarketAuth = () => useContext(Auth);

export function AccountGate({ children }: { children: ReactNode }) {
  const t = useT();
  const { session, loading } = useMarketAuth();
  const path = usePathname();
  if (loading) return <p role="status">{t("Đang kiểm tra phiên đăng nhập…")}</p>;
  if (!session) return <div className="market-panel"><p>{t("Đăng nhập để tiếp tục.")}</p><Button asChild><Link href={loginPath(path)}>{t("Đăng nhập")}</Link></Button></div>;
  return children;
}

export function MarketShell({ children, viewer }: { children: ReactNode; viewer: Viewer | null }) {
  const t = useT();
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  const [auth, setAuth] = useState<{ session: SessionIdentity | null; loading: boolean }>(() => ({
    session: viewer ? { user: { id: viewer.id, email: viewer.email } } : null, loading: false,
  }));
  useEffect(() => {
    if (!marketConfigured) return;
    void useMarketCart.persist.rehydrate();
    const subscription = getSupabase().auth.onAuthStateChange((event, session) => {
      const user = session?.user;
      setAuth({ session: user && !user.is_anonymous ? { user: { id: user.id, email: user.email } } : null, loading: false });
      if (event === "SIGNED_OUT") {
        queryClient.clear();
        clearLocalAccountState();
      }
    });
    return () => subscription.data.subscription.unsubscribe();
  }, [queryClient]);
  if (!marketConfigured) return <>
    <header className="site-header"><div className="shell setup-preferences"><PreferenceControls /></div></header>
    <main className="shell live-main">
      <h1>{t("Kết nối marketplace")}</h1><p>{t("Điền URL và publishable key của Supabase vào tệp môi trường để dùng dữ liệu thật.")}</p>
      <Button asChild><Link href="/">{t("Mở giao diện mẫu")}</Link></Button>
    </main>
  </>;
  return <QueryClientProvider client={queryClient}><Auth.Provider value={auth}>
    <Navbar viewer={auth.session?.user.id === viewer?.id ? viewer : null} /><main className="shell live-main">{children}</main>
  </Auth.Provider></QueryClientProvider>;
}
