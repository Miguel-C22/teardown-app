import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeCategory } from "../../shared/src/partCategory.js";
import { decideVerification, recommend, type IdentifiedBy } from "../../shared/src/recommend.js";
import { lookupPartNumber, type LookupSource, type PartLookup } from "./lookup.js";

const DESCRIPTION_SOURCES: LookupSource[] = ["ebay-description", "ai-estimate"];
import { photoDirectory, type NewUnit } from "./store.js";

export interface IdentifyInput {
  partType: string | null;
  serial: string | null;
  partNumber: string | null;
  partNumberRead: boolean;
  manufacturer: string | null;
  description: string | null;
  identifiedBy: IdentifiedBy;
  evidence: string | null;
  photoPath: string | null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

// Runs the lookup and the verification rule, giving a unit ready to store
export async function buildUnit(input: IdentifyInput, knownLookup?: PartLookup | null): Promise<{ unit: NewUnit; lookup: PartLookup | null }> {
  const partNumber = cleanText(input.partNumber);
  const serial = cleanText(input.serial)?.toUpperCase() ?? null;
  const lookup = knownLookup !== undefined ? knownLookup : partNumber ? await lookupPartNumber(partNumber) : null;
  // A price found from the AI's description is not a part-number match, so it can never verify a part
  const matchedByPartNumber = lookup !== null && !DESCRIPTION_SOURCES.includes(lookup.source);
  const verification = decideVerification({
    identifiedBy: input.identifiedBy,
    partNumber,
    partNumberRead: input.partNumberRead,
    serial,
    lookupMatched: matchedByPartNumber,
  });
  const requestedType = cleanText(input.partType);
  const partType = requestedType && requestedType.toUpperCase() !== "AUTO"
    ? normalizeCategory(requestedType)
    : normalizeCategory(lookup?.partType ?? null);
  return {
    lookup,
    unit: {
      partType,
      serial,
      partNumber,
      manufacturer: cleanText(input.manufacturer),
      description: lookup?.name ?? cleanText(input.description),
      identifiedBy: input.identifiedBy,
      evidence: cleanText(input.evidence),
      photoPath: input.photoPath,
      verified: verification.verified,
      reviewReasons: verification.reviewReasons,
      priceMin: lookup?.priceMin ?? null,
      priceMax: lookup?.priceMax ?? null,
      lookupSource: lookup?.source ?? null,
      imageUrl: lookup?.imageUrl ?? null,
      recommendation: recommend(verification.verified, lookup?.priceMax ?? null),
    },
  };
}

const MEDIA_EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Keeps the label photo next to the unit so a reviewer can check what was read; skipped where storage is read-only
export function savePhoto(imageBase64: string, mediaType: string): string | null {
  if (process.env.VERCEL) return null;
  mkdirSync(photoDirectory(), { recursive: true });
  const fileName = `${randomUUID()}.${MEDIA_EXTENSIONS[mediaType] ?? "jpg"}`;
  writeFileSync(path.join(photoDirectory(), fileName), Buffer.from(imageBase64, "base64"));
  return fileName;
}
