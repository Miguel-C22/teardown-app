// A read is trusted only after it comes back the same way twice in a short time, which filters out one-off misreads
export const READS_TO_CONFIRM = 2;
export const CONFIRM_WINDOW_MS = 2_000;

export interface ReadSighting {
  key: string;
  count: number;
  firstSeenAt: number;
  confirmed: boolean;
}

export type SightingLog = Map<string, ReadSighting>;

export function createSightingLog(): SightingLog {
  return new Map();
}

// Notes one sighting of a read; returns true exactly once, the moment it reaches the confirmation count
export function confirmRead(log: SightingLog, key: string, now: number, readsNeeded = READS_TO_CONFIRM, windowMs = CONFIRM_WINDOW_MS): boolean {
  for (const [storedKey, sighting] of log) {
    if (now - sighting.firstSeenAt > windowMs && !sighting.confirmed) log.delete(storedKey);
  }
  const existing = log.get(key);
  if (existing?.confirmed) {
    // Forget a confirmed read after a while so the same label can be checked again later (the server dedupes repeats)
    if (now - existing.firstSeenAt > windowMs * 5) log.delete(key);
    return false;
  }
  const sighting = existing ?? { key, count: 0, firstSeenAt: now, confirmed: false };
  sighting.count += 1;
  log.set(key, sighting);
  if (sighting.count >= readsNeeded) {
    sighting.confirmed = true;
    return true;
  }
  return false;
}
