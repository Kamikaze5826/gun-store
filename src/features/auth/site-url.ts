export function authSiteOrigin() {
  return new URL(process.env.APP_URL || "http://localhost:3000").origin;
}
