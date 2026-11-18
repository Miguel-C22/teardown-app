import { lookupCatalog } from "../../shared/src/catalog.js";
import { recommend } from "../../shared/src/recommend.js";
import { getComponentImageUrl } from "./componentimage.js";
import { lookupPart } from "./ebay.js";
import { lookupUpc } from "./upcitemdb.js";

// ebay-description and ai-estimate price a part from what it looks like, never from a read part number
export type LookupSource = "ebay" | "upcitemdb" | "catalog" | "ebay-description" | "ai-estimate";

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

export interface DescriptionLookupInput {
  searchQuery: string | null;
  category: string;
  estimatedPriceUsd: { low: number; high: number } | null;
}

// Prices a part identified by appearance: eBay listings for the AI's product name, else the AI's own rough range
export async function lookupByDescription(input: DescriptionLookupInput): Promise<PartLookup | null> {
  const query = input.searchQuery?.trim() ?? "";
  const imageFor = async () => (process.env.VISION_MODE === "mock" ? null : await withTimeout(getComponentImageUrl(input.category), 2_500));

  if (query && process.env.EBAY_CLIENT_ID) {
    const ebayResult = await withTimeout(lookupPart(query), SOURCE_TIMEOUT_MS);
    if (ebayResult) {
      return {
        ...ebayResult, query, partType: input.category, confidence: "low", source: "ebay-description",
        imageUrl: ebayResult.imageUrl ?? await imageFor(), recommendation: recommend(false, ebayResult.priceMax),
      };
    }
  }

  const estimate = input.estimatedPriceUsd;
  if (!estimate || !(estimate.high > 0)) return null;
  const priceMin = Math.max(0, Math.round(Math.min(estimate.low, estimate.high)));
  const priceMax = Math.round(Math.max(estimate.low, estimate.high));
  return {
    query, name: query || input.category, category: input.category, partType: input.category,
    priceMin, priceMax, imageUrl: await imageFor(), confidence: "low", listingCount: 0, source: "ai-estimate",
    recommendation: recommend(false, priceMax),
  };
}
