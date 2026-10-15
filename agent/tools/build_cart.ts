import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Build a Shopify cart permalink with the chosen variants pre-loaded. Returns the checkout URL.",
  inputSchema: z.object({
    storeUrl: z.string(),
    items: z.array(z.object({ variantId: z.number().int(), qty: z.number().int().min(1).default(1) })).min(1),
  }),
  execute({ storeUrl, items }) {
    const store = normalizeStore(storeUrl);
    const path = items.map((i) => `${i.variantId}:${i.qty ?? 1}`).join(",");
    return { cartUrl: `https://${store}/cart/${path}` };
  },
});

function normalizeStore(storeUrl: string): string {
  const s = storeUrl.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!s) throw new Error("storeUrl is required");
  return s.toLowerCase();
}
