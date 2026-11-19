import { classifyCode, isUnitSerial, type ClassifiedCode } from "./barcodeClassify.js";
import type { FieldHint } from "./labelText.js";
import type { PartCategory } from "./partCategory.js";
import { isTwoDimensionalFormat, parseLinearDataIdentifier, parseTwoDimensionalPayload } from "./qrPayload.js";

export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DecodedCode {
  text: string;
  box: PixelBox;
  // Barcode format from the decoder, e.g. "Code128" or "QRCode"; absent for typed or injected codes
  format?: string;
  // What a printed prefix or data identifier says this value is
  hint?: FieldHint | null;
  // True for a field split out of a QR, DataMatrix or PDF417 code
  fromTwoDimensional?: boolean;
}

// Replaces each 2D code with the fields inside it (a payload with nothing usable is dropped), and splits 1D codes that start with a data identifier
export function expandTwoDimensionalCodes(decodedCodes: DecodedCode[]): DecodedCode[] {
  return decodedCodes.flatMap((decoded) => {
    if (!isTwoDimensionalFormat(decoded.format)) {
      const fields = parseLinearDataIdentifier(decoded.text);
      return fields ? fields.map((field) => ({ ...decoded, text: field.text, hint: field.hint })) : [decoded];
    }
    return parseTwoDimensionalPayload(decoded.text).map((field) => ({ text: field.text, box: decoded.box, hint: field.hint, fromTwoDimensional: true }));
  });
}

// A printed prefix ("S/N", "PID") or data identifier outranks the pattern guess
function classifyWithHint(decoded: DecodedCode): ClassifiedCode {
  const classified = classifyCode(decoded.text);
  const upper = decoded.text.trim().toUpperCase();
  if (decoded.hint === "serial" && classified.kind !== "ppid" && /^[0-9A-Z][0-9A-Z-]{3,39}$/.test(upper)) {
    return { ...classified, kind: "serial", partNumber: null };
  }
  if (decoded.hint === "partNumber" && classified.kind !== "partNumber" && classified.kind !== "ppid") {
    return { ...classified, kind: "partNumber", partNumber: upper };
  }
  if (decoded.hint === "version") return { ...classified, kind: "version", partNumber: null };
  return classified;
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

type Member = { decoded: DecodedCode; classified: ClassifiedCode };

function buildGroup(unorderedMembers: Member[]): LabelGroup {
  // 1D barcodes come first so their serial and part number win over values found inside a QR code
  const members = [...unorderedMembers].sort((first, second) => Number(!!first.decoded.fromTwoDimensional) - Number(!!second.decoded.fromTwoDimensional));
  const classifiedCodes = members.map((member) => member.classified);
  const serialCode = classifiedCodes.find(isUnitSerial) ?? null;
  // A model number that names the product (ST2000DM001) prices better than a vendor-internal one (1CH164-302)
  const partNumberCode = classifiedCodes.find((code) => code.kind === "partNumber" && code.categoryHint !== null)
    ?? classifiedCodes.find((code) => code.kind === "partNumber")
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

const sameBox = (first: PixelBox, second: PixelBox) =>
  first.x === second.x && first.y === second.y && first.width === second.width && first.height === second.height;

// One QR code is one part: if its fields hold several serial-looking values, keep the labelled serial (or the first)
function keepOneSerialPerTwoDimensionalCode(cluster: Member[]): Member[] {
  const kept: Member[] = [];
  for (const member of cluster) {
    if (!member.decoded.fromTwoDimensional || !isUnitSerial(member.classified)) {
      kept.push(member);
      continue;
    }
    const siblings = cluster.filter((other) => other.decoded.fromTwoDimensional && isUnitSerial(other.classified) && sameBox(other.decoded.box, member.decoded.box));
    const chosen = siblings.find((other) => other.decoded.hint === "serial") ?? siblings[0];
    if (chosen === member) kept.push(member);
  }
  return kept;
}

// Groups the barcodes decoded in one frame into labels, one label per physical part
export function groupCodesIntoLabels(decodedCodes: DecodedCode[], gapRatio: number = SAME_LABEL_GAP_RATIO): LabelGroup[] {
  const expandedCodes = expandTwoDimensionalCodes(decodedCodes);
  const oneDimensionalTexts = new Set(expandedCodes.filter((decoded) => !decoded.fromTwoDimensional).map((decoded) => decoded.text.trim().toUpperCase()));
  // Same text twice at the same spot is one barcode read twice; same text elsewhere is a neighbouring identical part
  const uniqueCodes = expandedCodes
    .filter((decoded) => !decoded.fromTwoDimensional || !oneDimensionalTexts.has(decoded.text.trim().toUpperCase()))
    .filter((decoded, index, codes) => codes.findIndex((other) => other.text === decoded.text && edgeGap(other.box, decoded.box) === 0) === index);
  const members: Member[] = uniqueCodes
    .map((decoded) => ({ decoded, classified: classifyWithHint(decoded) }))
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

  const clusters = new Map<number, Member[]>();
  members.forEach((member, index) => {
    const root = findRoot(index);
    clusters.set(root, [...(clusters.get(root) ?? []), member]);
  });

  const labels: LabelGroup[] = [];
  for (const rawCluster of clusters.values()) {
    // When a label has a 1D serial barcode, a different serial inside its QR code is a tracking code, not a second part
    const hasOneDimensionalSerial = rawCluster.some((member) => !member.decoded.fromTwoDimensional && isUnitSerial(member.classified));
    const cluster = hasOneDimensionalSerial
      ? rawCluster.filter((member) => !(member.decoded.fromTwoDimensional && isUnitSerial(member.classified)))
      : keepOneSerialPerTwoDimensionalCode(rawCluster);
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
