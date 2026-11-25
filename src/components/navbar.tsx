"use client";

import { ChevronDown, ShoppingBag, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { logout } from "@/features/auth/actions";
import { clearLocalAccountState } from "@/features/auth/clear-local";
import type { Viewer } from "@/features/auth/identity";
import { loginPath, safeRedirect } from "@/features/auth/redirects";
import { useMarketCart } from "@/features/cart/market-cart";
import { PreferenceControls, useT } from "@/components/preferences";
import catalog from "@/features/catalog/model-catalog.json";

function GuestLinks({ destination }: { destination: string }) {
  const t = useT();
  return <div className="navbar-auth-links">
    <Link href={loginPath(destination)}>{t("Đăng nhập")}</Link>
    <Button asChild variant="outline"><Link href={"/register?" + new URLSearchParams({ redirect: destination })}>{t("Đăng ký")}</Link></Button>
  </div>;
}

function GuestMenu() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const destination = safeRedirect(pathname + (searchParams.size ? "?" + searchParams.toString() : ""));
  return <GuestLinks destination={destination} />;
}

function UserMenu({ viewer }: { viewer: Viewer }) {
  const t = useT();
  const details = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [badPhoto, setBadPhoto] = useState<string>();
  const initials = viewer.displayName.split(/\s+/).slice(-2).map((part) => Array.from(part)[0]).join("").toUpperCase();
  function close() { if (details.current) details.current.open = false; }

  async function signOut() {
    setError("");
    setBusy(true);
    try {
      const result = await logout();
      if ("error" in result) { setError(result.error); return; }
      try { clearLocalAccountState(); } finally { window.location.replace(result.redirect ?? "/"); }
    } catch {
      setError("Chưa thể đăng xuất. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return <details className="navbar-user" ref={details} onKeyDown={(event) => {
    if (event.key === "Escape") { close(); details.current?.querySelector("summary")?.focus(); }
  }}>
    <summary aria-label={t("Tài khoản {0}", viewer.displayName)}>
      <span className="navbar-avatar" aria-hidden="true">{viewer.avatar && badPhoto !== viewer.avatar
        ? <img src={viewer.avatar} alt="" referrerPolicy="no-referrer" onError={() => setBadPhoto(viewer.avatar ?? undefined)} />
        : initials || <UserRound size={16} />}</span>
      <span className="navbar-display-name">{viewer.displayName}</span><ChevronDown size={16} aria-hidden="true" />
    </summary>
    <div className="navbar-dropdown">
      <Link href="/profile" onClick={close}>{t("Hồ sơ cá nhân")}</Link>
      <Link href="/orders" onClick={close}>{t("Đơn mua")}</Link>
      {viewer.hasShop && <Link href="/seller" onClick={close}>{t("Kênh người bán")}</Link>}
      {viewer.role === "buyer" && <Link href="/seller/onboarding" onClick={close}>{t("Mở cửa hàng")}</Link>}
      {viewer.role === "admin" && <Link href="/admin" onClick={close}>{t("Quản trị")}</Link>}
      <button type="button" disabled={busy} onClick={() => void signOut()}>{busy ? t("Đang đăng xuất…") : t("Đăng xuất")}</button>
      {error && <p role="alert">{t(error)}</p>}
    </div>
  </details>;
}

export function Navbar({ viewer }: { viewer: Viewer | null }) {
  const t = useT();
  const entries = useMarketCart((state) => state.entries);
  const count = Object.values(entries).reduce((total, item) => total + item.quantity, 0);
  return <header className="site-header">
    <div className="shell live-toolbar">
      <Link href="/" className="brand">
        <span className="brand-mark"><ShoppingBag size={20} aria-hidden="true" /></span> {catalog.shopName}
      </Link>
      <nav aria-label={t("Điều hướng marketplace")}>
        <Link href="/search">{t("Sản phẩm")}</Link>
        <Link href="/orders">{t("Đơn hàng")}</Link>
      </nav>
      <PreferenceControls />
      <div className="navbar-actions">
        <Button variant="outline" asChild><Link href="/cart" aria-label={t("Giỏ hàng, {0} sản phẩm", count)}>
          <ShoppingBag size={17} aria-hidden="true" /> <span className="cart-label">{t("Giỏ hàng")}</span><span className="cart-count">{count}</span>
        </Link></Button>
        {viewer ? <UserMenu key={viewer.id} viewer={viewer} /> : <Suspense fallback={<GuestLinks destination="/search" />}><GuestMenu /></Suspense>}
      </div>
    </div>
  </header>;
}
