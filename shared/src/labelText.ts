import { classifyCode } from "./barcodeClassify.js";

// What a printed prefix says a value is; it overrides the pattern guess because the label states it outright
export type FieldHint = "partNumber" | "serial" | "version";

export interface LabelField {
  text: string;
  hint: FieldHint | null;
}

const PREFIX_HINTS: Array<[RegExp, FieldHint]> = [
  [/^(S\/?N|SER(IAL)?(\s*(NO|NUMBER|#))?|SERIAL\s*NUMBER|CT)$/, "serial"],
  [/^(P\/?N|PID|PART(\s*(NO|NUMBER|#))?|MODEL(\s*(NO|NUMBER))?|MDL|M\/?N|DP\/?N|SPARE(\s*(PN|P\/N))?|OPT(ION)?(\s*(PN|P\/N))?|FRU(\s*(PN|P\/N))?|SKU|PRODUCT\s*ID|MPN)$/, "partNumber"],
  [/^(VID|VER(SION)?|REV)$/, "version"],
];

// Finds "KEY: VALUE" pairs in label text, e.g. "PID: WS-C3850-48P-S VID: V02 SN: FOC1234X0YZ"
const KEY_VALUE = /\b(S\/?N|SERIAL(?:\s*(?:NO|NUMBER|#))?|CT|P\/?N|PID|PART(?:\s*(?:NO|NUMBER|#))?|MODEL(?:\s*(?:NO|NUMBER))?|MDL|M\/?N|DP\/?N|SPARE(?:\s*(?:PN|P\/N))?|OPT(?:ION)?(?:\s*(?:PN|P\/N))?|FRU(?:\s*(?:PN|P\/N))?|SKU|PRODUCT\s*ID|MPN|VID|VER(?:SION)?|REV)\s*[:#=.]?\s*([A-Z0-9][A-Z0-9\-/.+=]{1,40})/g;

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
    fields.push({ text: value, hint: hintForPrefix(match[1]) });
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
