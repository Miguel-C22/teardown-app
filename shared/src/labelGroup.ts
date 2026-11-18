import { classifyCode, isUnitSerial, type ClassifiedCode } from "./barcodeClassify.js";
import type { PartCategory } from "./partCategory.js";

export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DecodedCode {
  text: string;
  box: PixelBox;
}

export interface LabelGroup {
  codes: ClassifiedCode[];
  partNumber: string | null;
  serial: string | null;
  manufacturerHint: string | null;
  categoryHint: PartCategory | null;
  box: PixelBox;
}

// Codes closer than this fraction of the smaller box's longest side sit on the same label
export const SAME_LABEL_GAP_RATIO = 0.6;

function edgeGap(first: PixelBox, second: PixelBox): number {
  const horizontalGap = Math.max(0, Math.max(first.x, second.x) - Math.min(first.x + first.width, second.x + second.width));
  const verticalGap = Math.max(0, Math.max(first.y, second.y) - Math.min(first.y + first.height, second.y + second.height));
  return Math.hypot(horizontalGap, verticalGap);
}

function centerDistance(first: PixelBox, second: PixelBox): number {
  return Math.hypot(first.x + first.width / 2 - (second.x + second.width / 2), first.y + first.height / 2 - (second.y + second.height / 2));
}

function unionBox(boxes: PixelBox[]): PixelBox {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function buildGroup(members: Array<{ decoded: DecodedCode; classified: ClassifiedCode }>): LabelGroup {
  const classifiedCodes = members.map((member) => member.classified);
  const serialCode = classifiedCodes.find(isUnitSerial) ?? null;
  const partNumberCode = classifiedCodes.find((code) => code.kind === "partNumber")
    ?? classifiedCodes.find((code) => code.partNumber !== null)
    ?? null;
  return {
    codes: classifiedCodes,
    partNumber: partNumberCode?.partNumber ?? null,
    serial: serialCode ? serialCode.text.trim().toUpperCase() : null,
    manufacturerHint: classifiedCodes.find((code) => code.manufacturerHint)?.manufacturerHint ?? null,
    categoryHint: classifiedCodes.find((code) => code.categoryHint)?.categoryHint ?? null,
    box: unionBox(members.map((member) => member.decoded.box)),
  };
}

// Groups the barcodes decoded in one frame into labels, one label per physical part
export function groupCodesIntoLabels(decodedCodes: DecodedCode[], gapRatio: number = SAME_LABEL_GAP_RATIO): LabelGroup[] {
  // Same text twice at the same spot is one barcode read twice; same text elsewhere is a neighbouring identical part
  const uniqueCodes = decodedCodes.filter(
    (decoded, index) => decodedCodes.findIndex((other) => other.text === decoded.text && edgeGap(other.box, decoded.box) === 0) === index
  );
  const members = uniqueCodes
    .map((decoded) => ({ decoded, classified: classifyCode(decoded.text) }))
    .filter((member) => member.classified.kind !== "unknown");

  const parentIndex = members.map((_member, index) => index);
  const findRoot = (index: number): number => (parentIndex[index] === index ? index : (parentIndex[index] = findRoot(parentIndex[index])));

  for (let firstIndex = 0; firstIndex < members.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < members.length; secondIndex++) {
      const firstBox = members[firstIndex].decoded.box;
      const secondBox = members[secondIndex].decoded.box;
      const threshold = gapRatio * Math.min(Math.max(firstBox.width, firstBox.height), Math.max(secondBox.width, secondBox.height));
      if (edgeGap(firstBox, secondBox) <= threshold) parentIndex[findRoot(firstIndex)] = findRoot(secondIndex);
    }
  }

  const clusters = new Map<number, typeof members>();
  members.forEach((member, index) => {
    const root = findRoot(index);
    clusters.set(root, [...(clusters.get(root) ?? []), member]);
  });

  const labels: LabelGroup[] = [];
  for (const cluster of clusters.values()) {
    const serialMembers = cluster.filter((member) => isUnitSerial(member.classified));
    if (serialMembers.length <= 1) {
      labels.push(buildGroup(cluster));
      continue;
    }
    // Neighbouring identical labels merged: split so each serial keeps its nearest other codes
    const splitClusters = serialMembers.map((serialMember) => [serialMember]);
    for (const member of cluster) {
      if (serialMembers.includes(member)) continue;
      let nearestIndex = 0;
      serialMembers.forEach((serialMember, index) => {
        if (centerDistance(member.decoded.box, serialMember.decoded.box) < centerDistance(member.decoded.box, serialMembers[nearestIndex].decoded.box)) {
          nearestIndex = index;
        }
      });
      splitClusters[nearestIndex].push(member);
    }
    splitClusters.forEach((splitCluster) => labels.push(buildGroup(splitCluster)));
  }
  return labels;
}
