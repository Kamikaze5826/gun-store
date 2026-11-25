import { english } from "./en";

export type Locale = "vi" | "en";
export type Theme = "light" | "dark";
export const localeCookie = "marketplace-language";
export const themeCookie = "marketplace-theme";

export const readLocale = (value?: string): Locale => value === "en" ? "en" : "vi";
export const readTheme = (value?: string): Theme => value === "dark" ? "dark" : "light";

export function createTranslator(locale: Locale) {
  const intl = locale === "en" ? "en-US" : "vi-VN";
  function translate(source: string, ...values: Array<string | number>) {
    const message = locale === "en" && Object.hasOwn(english, source) ? english[source] : source;
    return message.replace(/\{(\d+)\}/g, (placeholder, index: string) => String(values[Number(index)] ?? placeholder));
  }
  return Object.assign(translate, {
    intl,
    money(value: number, currency: string) {
      const formatter = new Intl.NumberFormat(intl, { style: "currency", currency });
      return formatter.format(value / 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 0));
    },
  });
}
