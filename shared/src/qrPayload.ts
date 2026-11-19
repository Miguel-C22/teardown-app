import { extractKeyedFields, type FieldHint, type LabelField } from "./labelText.js";

const RECORD_SEPARATOR = "\u001e";
const GROUP_SEPARATOR = "\u001d";
const END_OF_TRANSMISSION = "\u0004";

// ANSI MH10.8.2 data identifiers used on component labels; longer identifiers are listed first so "1P" wins over "P"
const DATA_IDENTIFIERS: Array<[string, FieldHint | null]> = [
  ["1P", "partNumber"], ["30P", "partNumber"], ["1S", "serial"], ["P", "partNumber"], ["S", "serial"], ["2P", "version"],
];

// GS1 application identifiers: 01 = GTIN, 21 = serial, 240 = additional product id
const GS1_IDENTIFIERS: Array<[string, FieldHint | null, number | null]> = [
  ["01", null, 14], ["21", "serial", null], ["240", "partNumber", null], ["241", "partNumber", null],
];

// Formats that carry several fields in one symbol; anything else is a plain 1D barcode
export function isTwoDimensionalFormat(format: string | null | undefined): boolean {
  return !!format && /QR|DATA\s*MATRIX|PDF\s*417|AZTEC|MAXI/i.test(format);
}

function parseAnsiEnvelope(text: string): LabelField[] | null {
  if (!text.startsWith("[)>")) return null;
  const body = text.slice(3).replace(new RegExp(`[${RECORD_SEPARATOR}${END_OF_TRANSMISSION}]`, "g"), GROUP_SEPARATOR);
  const fields: LabelField[] = [];
  for (const segment of body.split(GROUP_SEPARATOR).map((part) => part.trim()).filter(Boolean)) {
    // The envelope's format header ("06") is not a field
    if (/^\d{2}$/.test(segment)) continue;
    const identifier = DATA_IDENTIFIERS.find(([prefix]) => segment.startsWith(prefix));
    if (!identifier) continue;
    const value = segment.slice(identifier[0].length).trim();
    if (value) fields.push({ text: value.toUpperCase(), hint: identifier[1] });
  }
  return fields;
}

// GS1 written with brackets, e.g. "(01)00888182123456(21)ABC123(240)1CH164-302"
function parseBracketedGs1(text: string): LabelField[] | null {
  if (!/^\(\d{2,4}\)/.test(text)) return null;
  const fields: LabelField[] = [];
  for (const match of text.matchAll(/\((\d{2,4})\)([^()]+)/g)) {
    const identifier = GS1_IDENTIFIERS.find(([code]) => code === match[1]);
    if (identifier) fields.push({ text: match[2].trim().toUpperCase(), hint: identifier[1] });
  }
  return fields;
}

// GS1 without brackets, fields ended by the group separator, e.g. "0100888182123456" + "21ABC123" + GS + "240..."
function parseRawGs1(text: string): LabelField[] | null {
  if (!/^01\d{14}/.test(text)) return null;
  const fields: LabelField[] = [];
  let remaining = text;
  while (remaining.length) {
    const identifier = GS1_IDENTIFIERS.find(([code]) => remaining.startsWith(code));
    if (!identifier) break;
    const [code, hint, fixedLength] = identifier;
    const afterCode = remaining.slice(code.length);
    const separatorIndex = afterCode.indexOf(GROUP_SEPARATOR);
    const valueLength = fixedLength ?? (separatorIndex === -1 ? afterCode.length : separatorIndex);
    fields.push({ text: afterCode.slice(0, valueLength).toUpperCase(), hint });
    remaining = afterCode.slice(valueLength).replace(new RegExp(`^${GROUP_SEPARATOR}`), "");
  }
  return fields.length ? fields : null;
}

// Splits a QR, DataMatrix or PDF417 payload into separate fields; an empty list means nothing usable was found
export function parseTwoDimensionalPayload(rawText: string): LabelField[] {
  const text = rawText.trim();
  if (!text) return [];
  // Links are handled by the server-tag picker; a link is never a part's serial
  if (/^https?:\/\//i.test(text)) return [];

  const structured = parseAnsiEnvelope(text) ?? parseBracketedGs1(text) ?? parseRawGs1(text);
  if (structured) return structured.filter((field) => field.hint !== null || field.text.length >= 4);

  const keyed = extractKeyedFields(text);
  if (keyed.length) return keyed;

  const pieces = text.split(/[\r\n;,|\t]+|\s+/).map((piece) => piece.trim()).filter(Boolean);
  // A long single value with no structure is a vendor tracking code, not something we can price or dedupe on
  if (pieces.length === 1 && pieces[0].length > 30) return [];
  return pieces.map((piece) => ({ text: piece.toUpperCase(), hint: null }));
}
