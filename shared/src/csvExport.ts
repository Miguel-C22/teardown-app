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
}

const COLUMNS = ["sessionId", "assetTag", "model", "partType", "serial", "status", "quantity", "scannedAt"];

function escapeCell(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function buildCsv(session: CsvSession, units: CsvUnit[]): string {
  const rows = [COLUMNS.join(",")];
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
    ].map(escapeCell);
    rows.push(row.join(","));
  }
  return rows.join("\n") + "\n";
}
