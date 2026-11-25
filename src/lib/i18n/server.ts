import { cookies } from "next/headers";
import { createTranslator, localeCookie, readLocale, readTheme, themeCookie } from "./preferences";

export async function getPreferences() {
  const store = await cookies();
  return { locale: readLocale(store.get(localeCookie)?.value), theme: readTheme(store.get(themeCookie)?.value) };
}

export async function getTranslator() {
  return createTranslator((await getPreferences()).locale);
}
