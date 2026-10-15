import { defineTool } from "eve/tools";
import { z } from "zod";

type ShopifyVariant = { id: number; title: string; price: string; available?: boolean };
type ShopifyProduct = {
  title: string;
  handle: string;
  product_type?: string;
  tags?: string[] | string;
  body_html?: string;
  variants: ShopifyVariant[];
  images?: { src: string }[];
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export default defineTool({
  description:
    "Search a Shopify store's real catalog. Returns up to 8 matching products with price, variantId, image, productUrl and availability. Call this before recommending anything. Use short keyword queries (e.g. 'running shoe', 'socks'); call multiple times for multiple item types.",
  inputSchema: z.object({
    storeUrl: z.string().describe("Store domain, e.g. www.allbirds.com"),
    query: z.string().describe("Keywords to match against title/type/tags"),
    maxPrice: z.number().optional().describe("Max price in store currency"),
  }),
  async execute({ storeUrl, query, maxPrice }) {
    const store = normalizeStore(storeUrl);
    const products: ShopifyProduct[] = [];
    let host = store;
    for (let page = 1; page <= 4; page++) {
      const res = await fetch(`https://${store}/products.json?limit=250&page=${page}`, {
        headers: { "user-agent": UA, accept: "application/json" },
        redirect: "follow",
      });
      if (!res.ok) {
        if (page === 1) return { error: `Could not load catalog from ${store} (HTTP ${res.status}). Is it a Shopify store?` };
        break;
      }
      host = new URL(res.url).host;
      const data = (await res.json()) as { products?: ShopifyProduct[] };
      const batch = data.products ?? [];
      products.push(...batch);
      if (batch.length < 250) break;
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean).map((t) => t.replace(/s$/, ""));
    const scored = products
      .map((p) => {
        const tags = Array.isArray(p.tags) ? p.tags.join(" ") : (p.tags ?? "");
        const title = p.title.toLowerCase();
        const hay = `${title} ${p.product_type ?? ""} ${tags}`.toLowerCase();
        let score = 0;
        let matched = 0;
        for (const t of terms) {
          if (title.includes(t)) { score += 3; matched++; }
          else if (hay.includes(t)) { score += 1; matched++; }
        }
        score += matched === terms.length ? 100 : 0;
        const variants = p.variants.filter((v) => v.available !== false);
        const v =
          variants
            .filter((x) => maxPrice == null || Number(x.price) <= maxPrice)
            .sort((a, b) => Number(a.price) - Number(b.price))[0] ?? null;
        return { p, v, score };
      })
      .filter((x) => x.score > 0 && x.v)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    return {
      store: host,
      totalProductsScanned: products.length,
      results: scored.map(({ p, v }) => ({
        title: p.title,
        price: v!.price,
        variantId: v!.id,
        image: p.images?.[0]?.src?.split("?")[0] ?? null,
        productUrl: `https://${host}/products/${p.handle}`,
      })),
    };
  },
});

function normalizeStore(storeUrl: string): string {
  const s = storeUrl.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!s) throw new Error("storeUrl is required");
  return s.toLowerCase();
}
