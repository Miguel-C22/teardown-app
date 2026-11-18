interface UpcItem {
  title?: string;
  brand?: string;
  model?: string;
  category?: string;
  images?: string[];
  lowest_recorded_price?: number;
  highest_recorded_price?: number;
  offers?: Array<{ price?: string | number }>;
}

interface UpcApiResponse {
  code?: string;
  total?: number;
  items?: UpcItem[];
}

export interface UpcResult {
  name: string;
  category: string;
  priceMin: number;
  priceMax: number;
  imageUrl: string | null;
  confidence: "high" | "medium" | "low";
  listingCount: number;
}

export async function lookupUpc(query: string): Promise<UpcResult | null> {
  if (!query) return null;

  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "teardown-app/1.0" },
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) return null;

  const data = (await response.json()) as UpcApiResponse;
  if (!data.items || data.items.length === 0) return null;

  const item = data.items[0];
  const offers = item.offers ?? [];
  const prices = offers
    .map((o) => parseFloat(String(o.price ?? "")))
    .filter((p) => !isNaN(p) && p > 0);

  // Fall back to historical recorded prices when no live offers have prices
  const priceMin = prices.length > 0
    ? Math.min(...prices)
    : (item.lowest_recorded_price ?? 5);
  const priceMax = prices.length > 0
    ? Math.max(...prices)
    : (item.highest_recorded_price ?? 20);

  const name =
    item.title ??
    [item.brand, item.model].filter(Boolean).join(" ") ??
    "Unknown product";

  return {
    name,
    category: item.category ?? "General",
    priceMin: Math.round(priceMin),
    priceMax: Math.round(priceMax),
    imageUrl: item.images?.[0] ?? null,
    confidence: prices.length >= 3 ? "high" : prices.length > 0 ? "medium" : "low",
    listingCount: offers.length,
  };
}
