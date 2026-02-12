const normalizeBase = (v: string): string => v.replace(/\/+$/, "");

// Used by Server Components (Node-side fetch). In Docker production, set:
// - API_BASE_URL=http://api:4000
export const API_BASE_URL = normalizeBase(
  process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000"
);

// Used by Client Components (browser fetch). When deployed behind the same-origin
// reverse-proxy shape (domain.com + /api -> api service), we can default to /api
// to avoid embedding domain-specific values at build time.
export const getClientApiBaseUrl = (): string => {
  const v = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (typeof v === "string" && v.trim()) return normalizeBase(v);
  return "/api";
};
