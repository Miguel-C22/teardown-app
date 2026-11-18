import { lookupCatalog } from "../../shared/src/catalog.js";
import { recommend } from "../../shared/src/recommend.js";
import { getComponentImageUrl } from "./componentimage.js";
import { lookupPart } from "./ebay.js";
import { lookupUpc } from "./upcitemdb.js";

export type LookupSource = "ebay" | "upcitemdb" | "catalog";

export interface PartLookup {
  query: string;
  name: string;
  category: string;
  partType: string | null;
  priceMin: number;
  priceMax: number;
  imageUrl: string | null;
  confidence: "high" | "medium" | "low";
  listingCount: number;
  source: LookupSource;
  recommendation: ReturnType<typeof recommend>;
}

const SOURCE_TIMEOUT_MS = 5_000;
// Catalog prefixes shorter than this only name a product family, so the price range is broad
const SPECIFIC_PREFIX_LENGTH = 8;

function withTimeout<Value>(promise: Promise<Value>, timeoutMs: number): Promise<Value | null> {
  return Promise.race([
    promise.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

// Looks up a part number (never a serial): eBay if configured, UPCitemdb for UPC/EAN codes, then the starter catalog
export async function lookupPartNumber(rawQuery: string): Promise<PartLookup | null> {
  const query = rawQuery.trim();
  if (!query) return null;

  const withRecommendation = (found: Omit<PartLookup, "recommendation" | "query">): PartLookup => ({
    ...found,
    query,
    recommendation: recommend(true, found.priceMax),
  });

  if (process.env.EBAY_CLIENT_ID) {
    const ebayResult = await withTimeout(lookupPart(query), SOURCE_TIMEOUT_MS);
    if (ebayResult) return withRecommendation({ ...ebayResult, partType: null, source: "ebay" });
  }

  if (/^\d{12,13}$/.test(query)) {
    const upcResult = await withTimeout(lookupUpc(query), SOURCE_TIMEOUT_MS);
    if (upcResult) return withRecommendation({ ...upcResult, partType: null, source: "upcitemdb" });
  }

  const catalogEntry = lookupCatalog(query);
  if (!catalogEntry) return null;
  const imageUrl = process.env.VISION_MODE === "mock" ? null : await withTimeout(getComponentImageUrl(catalogEntry.partType), 2_500);
  return withRecommendation({
    name: catalogEntry.name,
    category: catalogEntry.category,
    partType: catalogEntry.partType,
    priceMin: catalogEntry.priceMin,
    priceMax: catalogEntry.priceMax,
    imageUrl,
    confidence: catalogEntry.prefix.length >= SPECIFIC_PREFIX_LENGTH ? "medium" : "low",
    listingCount: 0,
    source: "catalog",
  });
}
