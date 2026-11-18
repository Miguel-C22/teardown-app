export interface CsvSession {
  id: string;
  assetTag: string;
  model: string;
}

export interface CsvUnit {
  partType: string;
  serial: string | null;
  status: string;
  scannedAt: string;
  partNumber?: string | null;
  manufacturer?: string | null;
  description?: string | null;
  identifiedBy?: string | null;
  verified?: boolean;
  priceMin?: number | null;
  priceMax?: number | null;
  lookupSource?: string | null;
  recommendation?: string | null;
  reviewReasons?: string[];
}

export const CSV_COLUMNS = [
  "sessionId", "assetTag", "model", "partType", "serial", "status", "quantity", "scannedAt",
  "partNumber", "manufacturer", "description", "identifiedBy", "verified",
  "priceMin", "priceMax", "lookupSource", "recommendation", "reviewReasons",
];

function escapeCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function optionalCell(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

// One row per physical unit; quantity is always 1 so a spreadsheet sum gives the count
export function buildCsv(session: CsvSession, units: CsvUnit[]): string {
  const rows = [CSV_COLUMNS.join(",")];
  for (const unit of units) {
    const row = [
      session.id,
      session.assetTag,
      session.model,
      unit.partType,
      unit.serial ?? "",
      unit.status,
      "1",
      unit.scannedAt,
      optionalCell(unit.partNumber),
      optionalCell(unit.manufacturer),
      optionalCell(unit.description),
      optionalCell(unit.identifiedBy),
      unit.verified === undefined ? "" : unit.verified ? "yes" : "no",
      optionalCell(unit.priceMin),
      optionalCell(unit.priceMax),
      optionalCell(unit.lookupSource),
      optionalCell(unit.recommendation),
      (unit.reviewReasons ?? []).join(" "),
    ].map(escapeCell);
    rows.push(row.join(","));
  }
  return rows.join("\n") + "\n";
}
