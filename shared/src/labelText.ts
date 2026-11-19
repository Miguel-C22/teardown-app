import { classifyCode } from "./barcodeClassify.js";

// What a printed prefix says a value is; it overrides the pattern guess because the label states it outright
export type FieldHint = "partNumber" | "serial" | "version";

export interface LabelField {
  text: string;
  hint: FieldHint | null;
}

const PREFIX_HINTS: Array<[RegExp, FieldHint]> = [
  [/^(S\/?N|SER(IAL)?(\s*(NO|NUMBER|#))?|SERIAL\s*NUMBER|CT)$/, "serial"],
  [/^(MFR|MFG)\s*P\/?N$|^(ORDER|ORD|ART(ICLE)?|CAT(ALOG)?|PRODUCT)\.?\s*(NO|NUMBER|#)$|^(TYPE|REF)$/, "partNumber"],
  [/^(P\/?N|PID|PART(\s*(NO|NUMBER|#))?|MODEL(\s*(NO|NUMBER))?|MDL|M\/?N|DP\/?N|SPARE(\s*(PN|P\/N))?|OPT(ION)?(\s*(PN|P\/N))?|FRU(\s*(PN|P\/N))?|SKU|PRODUCT\s*ID|MPN)$/, "partNumber"],
  [/^(VID|VER(SION)?|REV)$/, "version"],
];

// Prefixes that also label everyday words ("Type: DDR4"), so their value must look like a real number to count
const WEAK_PREFIXES = /^(TYPE|REF)$/;

// Finds "KEY: VALUE" pairs in label text, e.g. "PID: WS-C3850-48P-S VID: V02 SN: FOC1234X0YZ" or "Order No.: 6EP3346-7SB00-3AX0"
const KEY_VALUE = /\b((?:MFR|MFG)\s*P\/?N|(?:ORDER|ORD|ART(?:ICLE)?|CAT(?:ALOG)?|PRODUCT)\.?\s*(?:NO|NUMBER|#)|TYPE|REF|S\/?N|SERIAL(?:\s*(?:NO|NUMBER|#))?|CT|P\/?N|PID|PART(?:\s*(?:NO|NUMBER|#))?|MODEL(?:\s*(?:NO|NUMBER))?|MDL|M\/?N|DP\/?N|SPARE(?:\s*(?:PN|P\/N))?|OPT(?:ION)?(?:\s*(?:PN|P\/N))?|FRU(?:\s*(?:PN|P\/N))?|SKU|PRODUCT\s*ID|MPN|VID|VER(?:SION)?|REV)\s*[:#=.]{0,2}\s*([A-Z0-9][A-Z0-9\-/.+=]{1,40})/g;

function hintForPrefix(prefix: string): FieldHint | null {
  const normalized = prefix.replace(/\s+/g, " ").trim();
  return PREFIX_HINTS.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function cleanValue(value: string): string {
  return value.replace(/[.,;:]+$/, "");
}

// Values printed after a known prefix, in the order they appear
export function extractKeyedFields(rawText: string): LabelField[] {
  const text = rawText.toUpperCase();
  const fields: LabelField[] = [];
  for (const match of text.matchAll(KEY_VALUE)) {
    const value = cleanValue(match[2]);
    if (value.length < 2) continue;
    const prefix = match[1].replace(/\s+/g, " ").trim();
    if (WEAK_PREFIXES.test(prefix) && (value.length < 5 || !/\d/.test(value))) continue;
    fields.push({ text: value, hint: hintForPrefix(prefix) });
  }
  return fields;
}

// Reads part numbers and serials out of OCR text: keyed values first, then unkeyed tokens with a known manufacturer pattern
export function extractLabelFields(rawText: string): LabelField[] {
  const keyed = extractKeyedFields(rawText);
  const keyedTexts = new Set(keyed.map((field) => field.text));
  const unkeyed = rawText.toUpperCase()
    .split(/[\s,;|]+/)
    .map(cleanValue)
    .filter((token) => token.length >= 5 && !keyedTexts.has(token))
    .filter((token) => {
      const kind = classifyCode(token).kind;
      // A bare token is trusted only when it matches a specific format; a generic serial-looking word is OCR noise
      return kind === "partNumber" || kind === "ppid";
    })
    .map((token): LabelField => ({ text: token, hint: null }));
  const unique = new Map<string, LabelField>();
  for (const field of [...keyed, ...unkeyed]) if (!unique.has(field.text)) unique.set(field.text, field);
  return [...unique.values()];
}
