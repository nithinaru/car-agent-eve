import { defineTool } from "eve/tools";
import { z } from "zod";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

type Area = { AreaID: number; Hostname: string; Description: string; ShortDescription: string; Country: string };
let areasCache: Area[] | null = null;

const ALIASES: Record<string, string> = {
  "san francisco": "sfbay", sf: "sfbay", "bay area": "sfbay", oakland: "sfbay", "san jose": "sfbay",
  "new york": "newyork", nyc: "newyork", "new york city": "newyork", brooklyn: "newyork",
  la: "losangeles", "washington dc": "washingtondc", dc: "washingtondc", "las vegas": "lasvegas",
};

async function findArea(location: string): Promise<Area | undefined> {
  if (!areasCache) {
    const res = await fetch("https://reference.craigslist.org/Areas", { headers: { "user-agent": UA } });
    areasCache = res.ok ? ((await res.json()) as Area[]) : [];
  }
  const raw = location.toLowerCase().replace(/,.*$/, "").trim();
  const q = ALIASES[raw] ?? raw;
  const norm = (s: string) => s.toLowerCase();
  return (
    areasCache.find((a) => norm(a.Hostname) === q.replace(/\s+/g, "")) ??
    areasCache.find((a) => norm(a.ShortDescription) === q || norm(a.Description) === q) ??
    areasCache.find((a) => norm(a.Description).includes(q) || norm(a.ShortDescription).includes(q)) ??
    areasCache.find((a) => q.includes(norm(a.ShortDescription)))
  );
}

export default defineTool({
  description:
    "Search real used-car listings for sale on Craigslist near a location. Returns up to 8 listings with title, price, miles, location, url and photo. Call this before recommending any car; you may call it again with a different query for alternatives.",
  inputSchema: z.object({
    location: z.string().describe("City or metro, e.g. 'San Francisco', 'Seattle'"),
    query: z.string().optional().describe("Make/model keywords, e.g. 'toyota tacoma'. Omit for any car."),
    minPrice: z.number().optional(),
    maxPrice: z.number().optional(),
    maxMiles: z.number().optional().describe("Maximum odometer miles"),
  }),
  async execute({ location, query, minPrice, maxPrice, maxMiles }) {
    const area = await findArea(location);
    if (!area) return { error: `Couldn't find a Craigslist area for "${location}". Try a bigger nearby city.` };

    const filters = new URLSearchParams();
    if (query) filters.set("query", query);
    if (minPrice != null) filters.set("min_price", String(minPrice));
    if (maxPrice != null) filters.set("max_price", String(maxPrice));
    if (maxMiles != null) filters.set("max_auto_miles", String(maxMiles));

    const params = new URLSearchParams({ batch: `${area.AreaID}-0-360-0-0`, cc: area.Country || "US", lang: "en", searchPath: "cta" });
    for (const [k, v] of filters) params.set(k, v);

    const res = await fetch(`https://sapi.craigslist.org/web/v8/postings/search/full?${params}`, {
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (!res.ok) return { error: `Listing search failed (HTTP ${res.status}).` };
    const { data } = (await res.json()) as { data: any };
    const minId: number = data.decode.minPostingId;
    const locs: unknown[] = data.decode.locationDescriptions ?? [];

    const cars = (data.items as any[])
      .map((it) => {
        const tagged = (tag: number) => it.find((x: unknown) => Array.isArray(x) && x[0] === tag) as any[] | undefined;
        const img = tagged(4)?.[1] as string | undefined;
        const locIdx = Number(String(it[4]).split("~")[0].split(":").pop());
        return {
          title: String(it[it.length - 1]),
          price: typeof it[3] === "number" ? (it[3] as number) : null,
          miles: (tagged(9)?.[1] as number | undefined) ?? null,
          location: typeof locs[locIdx] === "string" ? (locs[locIdx] as string) : area.ShortDescription,
          url: `https://${area.Hostname}.craigslist.org/cto/d/${tagged(6)?.[1] ?? "listing"}/${minId + it[0]}.html`,
          image: img ? `https://images.craigslist.org/${img.replace(/^\d+:/, "")}_600x450.jpg` : null,
        };
      })
      .filter((c) => c.price != null && c.price >= 500 && (maxMiles == null || c.miles == null || c.miles <= maxMiles))
      .slice(0, 8);

    return {
      area: area.Description,
      totalResults: data.totalResultCount,
      searchUrl: `https://${area.Hostname}.craigslist.org/search/cta?${filters}`,
      cars,
    };
  },
});
