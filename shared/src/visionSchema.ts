import { z } from "zod";
import { PART_CATEGORIES } from "./partCategory.js";

export const PrintedTextSchema = z.object({
  text: z.string().describe("Characters copied exactly as printed. Never complete or correct a partly visible number."),
  kind: z.enum(["partNumber", "serial", "model", "manufacturer", "capacity", "other"]),
  readFromImage: z.boolean().describe("true only if every character was legible in this image"),
});

export const NormalizedBoxSchema = z.object({
  x: z.number().describe("left edge, 0 to 1 of image width"),
  y: z.number().describe("top edge, 0 to 1 of image height"),
  width: z.number().describe("0 to 1 of image width"),
  height: z.number().describe("0 to 1 of image height"),
});

export const DetectedPartSchema = z.object({
  category: z.enum(PART_CATEGORIES),
  box: NormalizedBoxSchema,
  manufacturer: z.string().nullable(),
  familyGuess: z.string().nullable().describe("e.g. '32GB DDR4 RDIMM' or '2.5in SAS SSD', from appearance"),
  printedText: z.array(PrintedTextSchema),
  confidence: z.enum(["high", "medium", "low"]),
  needsCloseUp: z.boolean().describe("true when the exact part number or serial is not fully legible"),
});

export const CategoryCountSchema = z.object({
  category: z.enum(PART_CATEGORIES),
  count: z.number().int(),
});

export const SweepResultSchema = z.object({
  chassisModelGuess: z.string().nullable(),
  parts: z.array(DetectedPartSchema),
  countsByCategory: z.array(CategoryCountSchema).describe("How many of each category are visible, including ones without readable labels"),
});

export const CloseupResultSchema = z.object({
  readable: z.boolean().describe("false when no label, marking or engraving could be read"),
  category: z.enum(PART_CATEGORIES),
  manufacturer: z.string().nullable(),
  partNumber: z.string().nullable().describe("Only if read from the image; otherwise null"),
  serial: z.string().nullable().describe("Only if read from the image; otherwise null"),
  model: z.string().nullable(),
  familyGuess: z.string().nullable(),
  printedText: z.array(PrintedTextSchema),
  confidence: z.enum(["high", "medium", "low"]),
});

export type PrintedText = z.infer<typeof PrintedTextSchema>;
export type NormalizedBox = z.infer<typeof NormalizedBoxSchema>;
export type DetectedPart = z.infer<typeof DetectedPartSchema>;
export type SweepResult = z.infer<typeof SweepResultSchema>;
export type CloseupResult = z.infer<typeof CloseupResultSchema>;

// A number is trusted only if the model reports it as read from the image and it appears in printedText
export function isNumberReadFromImage(number: string | null, printedText: PrintedText[]): boolean {
  if (!number) return false;
  const wanted = number.replace(/[\s-]/g, "").toUpperCase();
  return printedText.some(
    (printed) => printed.readFromImage && printed.text.replace(/[\s-]/g, "").toUpperCase().includes(wanted)
  );
}

// The part number in a sweep reading, but only when it was legible in the image
export function readPartNumber(part: DetectedPart): string | null {
  return part.printedText.find((printed) => printed.kind === "partNumber" && printed.readFromImage)?.text.trim() ?? null;
}

export function readSerial(part: DetectedPart): string | null {
  return part.printedText.find((printed) => printed.kind === "serial" && printed.readFromImage)?.text.trim() ?? null;
}
