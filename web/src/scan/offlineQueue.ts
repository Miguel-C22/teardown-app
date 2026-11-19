import type { NewUnitRequest } from "../api";

// Saves that couldn't reach the server, kept on the phone per session until they can be sent
const STORAGE_PREFIX = "teardown-pending-units:";

function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

export function readPending(sessionId: string): NewUnitRequest[] {
  try {
    const stored = window.localStorage.getItem(storageKey(sessionId));
    return stored ? (JSON.parse(stored) as NewUnitRequest[]) : [];
  } catch {
    return [];
  }
}

function writePending(sessionId: string, pending: NewUnitRequest[]): void {
  try {
    if (pending.length) window.localStorage.setItem(storageKey(sessionId), JSON.stringify(pending));
    else window.localStorage.removeItem(storageKey(sessionId));
  } catch {
    // Private mode or full storage: the queue then lives only as long as the page
  }
}

const memoryQueues = new Map<string, NewUnitRequest[]>();

export function enqueuePending(sessionId: string, request: NewUnitRequest): number {
  const pending = [...(memoryQueues.get(sessionId) ?? readPending(sessionId)), request];
  memoryQueues.set(sessionId, pending);
  writePending(sessionId, pending);
  return pending.length;
}

// Sends queued saves in order and stops at the first one that still can't get through
export async function flushPending(sessionId: string, send: (request: NewUnitRequest) => Promise<"sent" | "offline">): Promise<number> {
  let pending = memoryQueues.get(sessionId) ?? readPending(sessionId);
  while (pending.length) {
    if ((await send(pending[0])) === "offline") break;
    pending = pending.slice(1);
    memoryQueues.set(sessionId, pending);
    writePending(sessionId, pending);
  }
  return pending.length;
}

export function pendingCount(sessionId: string): number {
  return (memoryQueues.get(sessionId) ?? readPending(sessionId)).length;
}
