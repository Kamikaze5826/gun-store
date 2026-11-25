import { execSync } from "node:child_process";

export const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function parseEnv(text) {
  return Object.fromEntries([...text.matchAll(/^([A-Z_][A-Z0-9_]*)=(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\r\n]*))\r?$/gm)]
    .map(([, key, doubleQuoted, singleQuoted, bare]) => [key, doubleQuoted ?? singleQuoted ?? bare.trim()]));
}

export function getLocalSupabase() {
  let status;
  try {
    status = parseEnv(execSync("supabase status -o env", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } catch {
    throw new Error("Hãy chạy supabase start để khởi động Supabase local.");
  }
  const url = new URL(status.API_URL ?? status.SUPABASE_URL ?? "http://invalid.local");
  const publicKey = status.PUBLISHABLE_KEY || status.ANON_KEY;
  const serviceKey = status.SERVICE_ROLE_KEY;
  if (!loopbackHosts.has(url.hostname) || !publicKey || !serviceKey) {
    throw new Error("Không tìm thấy cấu hình Supabase local hợp lệ.");
  }
  return { url, publicKey, serviceKey };
}
