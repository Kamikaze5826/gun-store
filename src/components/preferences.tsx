"use client";

import { Languages, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createTranslator, localeCookie, readLocale, themeCookie, type Locale, type Theme } from "@/lib/i18n/preferences";

function setCookie(name: string, value: string) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

const Preferences = createContext<{
  locale: Locale; theme: Theme; t: ReturnType<typeof createTranslator>;
  changeLocale: (locale: Locale) => void; changeTheme: (theme: Theme) => void;
}>({
  locale: "vi", theme: "light", t: createTranslator("vi"),
  changeLocale: () => {}, changeTheme: () => {},
});

export function PreferencesProvider({ children, initialLocale, initialTheme }: {
  children: ReactNode; initialLocale: Locale; initialTheme: Theme;
}) {
  const [locale, setLocale] = useState(initialLocale);
  const [theme, setTheme] = useState(initialTheme);
  const router = useRouter();
  const t = useMemo(() => createTranslator(locale), [locale]);

  function changeLocale(next: Locale) {
    setCookie(localeCookie, next);
    document.documentElement.lang = next;
    setLocale(next);
    router.refresh();
  }

  function changeTheme(next: Theme) {
    setCookie(themeCookie, next);
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }

  return <Preferences.Provider value={{ locale, theme, t, changeLocale, changeTheme }}>{children}</Preferences.Provider>;
}

export function useT() {
  return useContext(Preferences).t;
}

export function PreferenceControls() {
  const { locale, theme, t, changeLocale, changeTheme } = useContext(Preferences);
  const dark = theme === "dark";
  return <div className="preference-controls">
    <label className="language-control">
      <Languages size={17} aria-hidden="true" />
      <span className="sr-only">{t("Ngôn ngữ")}</span>
      <select value={locale} onChange={(event) => changeLocale(readLocale(event.target.value))}>
        <option value="vi" lang="vi">Tiếng Việt</option>
        <option value="en" lang="en">English</option>
      </select>
    </label>
    <button type="button" className="theme-control" aria-label={t("Giao diện") + ": " + t(dark ? "Tối" : "Sáng")}
      title={t(dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối")}
      onClick={() => changeTheme(dark ? "light" : "dark")}>
      {dark ? <Moon size={17} aria-hidden="true" /> : <Sun size={17} aria-hidden="true" />}
      <span>{t(dark ? "Tối" : "Sáng")}</span>
    </button>
  </div>;
}
