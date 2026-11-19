// Minimal shape of a found part that walk mode needs to tell repeats from new parts
export interface WalkablePart {
  index: number;
  category: string;
  serial: string | null;
  partNumber: string | null;
  searchQuery?: string | null;
  familyGuess?: string | null;
}

export interface WalkMergeResult<Part extends WalkablePart> {
  // Every distinct part seen on this walk, oldest first, each with a unique index
  parts: Part[];
  // The indexes of this frame's parts in the merged list, used to match the next frame
  frameIndexes: number[];
  addedCount: number;
}

function nameOf(part: WalkablePart): string {
  return `${part.category}|${(part.partNumber ?? part.searchQuery ?? part.familyGuess ?? "").trim().toUpperCase()}`;
}

// Merges one walk-mode frame into the parts already seen: a serial match is always the same part; an unlabelled part
// with the same category and name as one in the previous frame is that part seen again, since consecutive frames overlap
export function mergeWalkFrame<Part extends WalkablePart>(
  seenParts: Part[],
  previousFrameIndexes: number[],
  frameParts: Part[],
): WalkMergeResult<Part> {
  const merged = [...seenParts];
  let nextIndex = merged.reduce((highest, part) => Math.max(highest, part.index), -1) + 1;
  // Each part in the previous frame can stand in for only one part in this frame, so 4 DIMMs stay 4, and a fifth is new
  const unclaimedPrevious = new Set(previousFrameIndexes);
  const frameIndexes: number[] = [];
  let addedCount = 0;

  for (const framePart of frameParts) {
    const bySerial = framePart.serial ? merged.find((seen) => seen.serial === framePart.serial) : undefined;
    const byOverlap = bySerial ? undefined : merged.find((seen) => unclaimedPrevious.has(seen.index) && !seen.serial && nameOf(seen) === nameOf(framePart));
    const match = bySerial ?? byOverlap;
    if (match) {
      unclaimedPrevious.delete(match.index);
      // Keep what was learned first, but take a serial or part number this frame managed to read
      const updated = { ...match, serial: match.serial ?? framePart.serial, partNumber: match.partNumber ?? framePart.partNumber };
      merged[merged.indexOf(match)] = updated;
      frameIndexes.push(match.index);
      continue;
    }
    const added = { ...framePart, index: nextIndex++ };
    merged.push(added);
    frameIndexes.push(added.index);
    addedCount++;
  }
  return { parts: merged, frameIndexes, addedCount };
}
