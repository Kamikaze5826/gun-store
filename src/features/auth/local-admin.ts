export const localAdminEmail = "admin@marketplace.test";

export function isLoopbackHost(host: string | undefined | null) {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

export const localAdminEnabled = process.env.NEXT_PUBLIC_ENABLE_LOCAL_ADMIN === "true" &&
  isLoopbackHost(URL.parse(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")?.hostname);

export function isAdminUsername(value: string) {
  return value.toLowerCase() === "admin";
}
