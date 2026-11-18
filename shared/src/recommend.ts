export type IdentifiedBy = "barcode" | "label-read" | "visual" | "manual";
export type Recommendation = "KEEP" | "REVIEW" | "RECYCLE";
export type ReviewReason = "no-serial" | "no-part-number" | "visual-only" | "no-lookup-match" | "needs-bench-test";

export const KEEP_MIN_USD = 30;
export const REVIEW_MIN_USD = 10;
export const HIGH_VALUE_USD = 100;

export interface VerificationInput {
  identifiedBy: IdentifiedBy;
  partNumber: string | null;
  partNumberRead: boolean;
  serial: string | null;
  lookupMatched: boolean;
}

export interface VerificationOutcome {
  verified: boolean;
  reviewReasons: ReviewReason[];
}

// Verified only when a part number was actually read (barcode or label text) and matched a lookup source
export function decideVerification(input: VerificationInput): VerificationOutcome {
  const reviewReasons: ReviewReason[] = [];
  if (!input.serial) reviewReasons.push("no-serial");
  if (input.identifiedBy === "visual") reviewReasons.push("visual-only");
  if (!input.partNumber) {
    reviewReasons.push("no-part-number", "needs-bench-test");
  } else if (!input.lookupMatched) {
    reviewReasons.push("no-lookup-match");
  }
  const numberWasRead = input.identifiedBy !== "visual" && input.partNumberRead;
  const verified = Boolean(input.partNumber) && numberWasRead && input.lookupMatched;
  return { verified, reviewReasons };
}

// Never recycle anything unverified; verified parts are scored by their top estimated price
export function recommend(verified: boolean, priceMax: number | null): Recommendation {
  if (!verified || priceMax === null) return "REVIEW";
  if (priceMax >= KEEP_MIN_USD) return "KEEP";
  if (priceMax >= REVIEW_MIN_USD) return "REVIEW";
  return "RECYCLE";
}

export function isHighValue(priceMax: number | null): boolean {
  return priceMax !== null && priceMax >= HIGH_VALUE_USD;
}
