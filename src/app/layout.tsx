import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PreferencesProvider } from "@/components/preferences";
import { getPreferences, getTranslator } from "@/lib/i18n/server";
import catalog from "@/features/catalog/model-catalog.json";
import "./globals.css";
import "@/features/catalog/model-store.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  return { title: catalog.shopName, description: t("Phù điêu giấy, sa bàn và phụ kiện cho góc trưng bày của bạn.") };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { locale, theme } = await getPreferences();
  return <html lang={locale} data-theme={theme}><body>
    <PreferencesProvider initialLocale={locale} initialTheme={theme}>{children}</PreferencesProvider>
  </body></html>;
}
