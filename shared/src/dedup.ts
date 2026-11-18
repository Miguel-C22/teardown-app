export interface ScanRecord {
  serial: string;
  scannedAt: number; // ms timestamp
}

export type ScanOutcome = "new" | "cooldown" | "duplicate";

export const COOLDOWN_MS = 3_000;

export function checkScan(
  recentScans: ScanRecord[],
  serial: string,
  nowMs: number,
  cooldownMs: number = COOLDOWN_MS
): ScanOutcome {
  const inCooldown = recentScans.some(
    (record) => record.serial === serial && nowMs - record.scannedAt < cooldownMs
  );
  if (inCooldown) return "cooldown";

  const alreadySeen = recentScans.some((record) => record.serial === serial);
  if (alreadySeen) return "duplicate";

  return "new";
}
