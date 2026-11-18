export interface EbayResult {
  name: string;
  category: string;
  priceMin: number;
  priceMax: number;
  imageUrl: string | null;
  confidence: "high" | "medium" | "low";
  listingCount: number;
}

interface TokenCache {
  token: string;
  expiresAt: number;
}

let _tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string | null> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  if (_tokenCache && Date.now() < _tokenCache.expiresAt) return _tokenCache.token;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });

  if (!response.ok) return null;
  const data = await response.json() as { access_token: string; expires_in: number };
  _tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return _tokenCache.token;
}

interface EbayItemSummary {
  title: string;
  price?: { value: string };
  thumbnailImages?: Array<{ imageUrl: string }>;
  categories?: Array<{ categoryName: string }>;
}

export async function lookupPart(query: string): Promise<EbayResult | null> {
  const token = await getAccessToken();
  if (!token) return null;

  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=5&filter=conditionIds:{3000|4000|5000}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
  });

  if (!response.ok) return null;

  const data = await response.json() as { itemSummaries?: EbayItemSummary[]; total?: number };
  const items = data.itemSummaries ?? [];
  if (items.length === 0) return null;

  const prices = items
    .map((item) => parseFloat(item.price?.value ?? "0"))
    .filter((price) => price > 0);

  if (prices.length === 0) return null;

  const priceMin = Math.min(...prices);
  const priceMax = Math.max(...prices);
  const firstItem = items[0];
  const category = firstItem.categories?.[0]?.categoryName ?? "Server component";
  const imageUrl = firstItem.thumbnailImages?.[0]?.imageUrl ?? null;

  const count = items.length;
  const confidence: EbayResult["confidence"] = count >= 5 ? "high" : count >= 2 ? "medium" : "low";

  return {
    name: firstItem.title,
    category,
    priceMin: Math.round(priceMin),
    priceMax: Math.round(priceMax),
    imageUrl,
    confidence,
    listingCount: count,
  };
}
