const base = "https://marketplace.invalid";
const authPaths = /^\/(?:auth(?:\/|$)|login(?:\/|$)|register(?:\/|$)|forgot-password(?:\/|$)|update-password(?:\/|$))/i;

export function safeRedirect(value: unknown, fallback = "/search") {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/") || value.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const target = new URL(value, base);
    const path = decodeURIComponent(target.pathname);
    if (target.origin !== base || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path) || authPaths.test(path)) return fallback;
    return target.pathname + target.search + target.hash;
  } catch {
    return fallback;
  }
}

export function loginPath(path: string) {
  return "/login?" + new URLSearchParams({ redirect: safeRedirect(path) }).toString();
}

export function isSection(path: string, section: string) {
  return path === section || path.startsWith(section + "/");
}
