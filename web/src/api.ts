import type { IdentifiedBy, Recommendation, ReviewReason } from "@shared/recommend";
import type { RemainingRow } from "@shared/remaining";
import type { CloseupResult, DetectedPart } from "@shared/visionSchema";

export interface UnitView {
  id: string;
  sessionId: string;
  partType: string;
  serial: string | null;
  status: "ok" | "review";
  scannedAt: string;
  partNumber: string | null;
  manufacturer: string | null;
  description: string | null;
  identifiedBy: IdentifiedBy;
  evidence: string | null;
  photoPath: string | null;
  verified: boolean;
  reviewReasons: ReviewReason[];
  priceMin: number | null;
  priceMax: number | null;
  lookupSource: string | null;
  imageUrl: string | null;
  recommendation: Recommendation;
  duplicate?: boolean;
  filledIn?: boolean;
}

export interface SessionInfo {
  id: string;
  assetTag: string;
  model: string;
  createdAt: string;
}

export interface SessionSummary extends SessionInfo {
  units: UnitView[];
  remaining: RemainingRow[];
  sweepCount: number;
  visionUsage: { calls: number; inputTokens: number; outputTokens: number; costUsd: number };
}

export interface LookupView {
  name: string;
  category: string;
  priceMin: number;
  priceMax: number;
  imageUrl: string | null;
  confidence: "high" | "medium" | "low";
  listingCount: number;
  source: "ebay" | "upcitemdb" | "catalog" | "ebay-description" | "ai-estimate";
  recommendation: Recommendation;
}

export interface SweepPartView extends DetectedPart {
  index: number;
  partNumber: string | null;
  serial: string | null;
  lookup: LookupView | null;
  unitId: string | null;
  duplicate: boolean;
}

export interface SweepResponse {
  sweepId: string;
  mode: "mock" | "live";
  chassisModelGuess: string | null;
  parts: SweepPartView[];
  session: SessionSummary;
}

export interface CloseupResponse {
  unit: UnitView;
  duplicate: boolean;
  lookup: LookupView | null;
  reading: CloseupResult;
  mode: "mock" | "live";
  session: SessionSummary;
}

export interface NewUnitRequest {
  partType: string;
  serial: string | null;
  partNumber?: string | null;
  manufacturer?: string | null;
  description?: string | null;
  identifiedBy?: IdentifiedBy;
  evidence?: string | null;
  partNumberRead?: boolean;
  searchQuery?: string | null;
  estimatedPriceUsd?: { low: number; high: number } | null;
}

// Where a price came from, short enough for a list row
export const PRICE_SOURCE_LABEL: Record<string, string> = {
  ebay: "eBay",
  upcitemdb: "UPCitemdb",
  catalog: "catalog",
  "ebay-description": "eBay, by description",
  "ai-estimate": "AI estimate",
};

async function readJson<Body>(response: Response): Promise<Body> {
  const body = await response.json().catch(() => ({})) as Body & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Server error ${response.status}`);
  return body;
}

export async function postJson<Body>(url: string, payload: unknown): Promise<Body> {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  return readJson<Body>(response);
}

export async function getJson<Body>(url: string): Promise<Body> {
  return readJson<Body>(await fetch(url));
}

export function photoUrl(photoPath: string | null): string | null {
  return photoPath ? `/api/photos/${encodeURIComponent(photoPath)}` : null;
}

export function formatPrice(priceMin: number | null, priceMax: number | null): string {
  if (priceMax === null) return "no value yet";
  return priceMin !== null && priceMin !== priceMax ? `$${priceMin}–$${priceMax}` : `$${priceMax}`;
}

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  "no-serial": "no serial",
  "no-part-number": "no part number",
  "visual-only": "identified by appearance only",
  "no-lookup-match": "part number not in any price source",
  "needs-bench-test": "needs bench test",
};

export const IDENTIFIED_BY_LABEL: Record<IdentifiedBy, string> = {
  barcode: "barcode",
  "label-read": "label read",
  visual: "appearance",
  manual: "typed",
};
