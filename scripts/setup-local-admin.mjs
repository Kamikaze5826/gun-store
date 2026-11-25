import { readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { getLocalSupabase, loopbackHosts, parseEnv } from "./local-supabase.mjs";

const email = "admin@marketplace.test";
const id = "0e7cd3c5-3969-4c63-996f-0c067e4a748f";
// Bcrypt hash of the explicitly requested local fixture password.
const passwordHash = "$2a$10$bbWMh.mcp2zbwccNciu6Uu6XJqYz57Qw3dZ6l2zmqicZ9pc.Cv1Ji";
async function main() {
  const { url, publicKey, serviceKey } = getLocalSupabase();

  const envFile = new URL("../.env.local", import.meta.url);
  const original = await readFile(envFile, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const existing = parseEnv(original);
  if (existing.NEXT_PUBLIC_SUPABASE_URL) {
    const existingUrl = new URL(existing.NEXT_PUBLIC_SUPABASE_URL);
    if (!loopbackHosts.has(existingUrl.hostname) || existingUrl.port !== url.port) {
      throw new Error(".env.local đang trỏ tới một dự án khác. Hãy dùng cấu hình Supabase local.");
    }
  }
  if (existing.APP_URL && !loopbackHosts.has(new URL(existing.APP_URL).hostname)) {
    throw new Error("APP_URL phải dùng địa chỉ loopback để bật tài khoản admin thử.");
  }

  const supabase = createClient(url.href, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const lookup = await supabase.auth.admin.getUserById(id);
  if (lookup.error && lookup.error.status !== 404) throw new Error("Không thể kiểm tra tài khoản admin local.");
  let user = lookup.data?.user;
  if (!user) {
    const result = await supabase.auth.admin.createUser({
      id, email, password_hash: passwordHash, email_confirm: true,
      user_metadata: { display_name: "Admin" }, app_metadata: { marketplace_local_admin: true },
    });
    if (result.error || !result.data.user) throw new Error("Không thể tạo tài khoản admin local.");
    user = result.data.user;
  }
  if (user.id !== id || user.email !== email || user.app_metadata.marketplace_local_admin !== true) {
    throw new Error("Tài khoản đã tồn tại và không thuộc cấu hình admin local.");
  }
  const { error } = await supabase.from("profiles").update({ role: "admin" }).eq("id", user.id).select("id").single();
  if (error) throw new Error("Chưa cấp được quyền admin. Kiểm tra các migration Supabase local.");

  const settings = {
    NEXT_PUBLIC_SUPABASE_URL: existing.NEXT_PUBLIC_SUPABASE_URL || url.origin,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
    APP_URL: existing.APP_URL || "http://localhost:3000",
    NEXT_PUBLIC_ENABLE_LOCAL_ADMIN: "true",
  };
  let next = original.trimEnd();
  for (const [key, value] of Object.entries(settings)) {
    const line = key + "=" + value;
    const match = new RegExp("^" + key + "=.*$", "gm");
    next = match.test(next) ? next.replace(match, line) : [next, line].filter(Boolean).join("\n");
  }
  await writeFile(envFile, next + "\n");
  console.log("Admin local ready. Sign in with username admin.");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
