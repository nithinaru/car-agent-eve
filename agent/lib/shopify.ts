export function normalizeStore(storeUrl: string): string {
  const s = storeUrl.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!s) throw new Error("storeUrl is required");
  return s.toLowerCase();
}
