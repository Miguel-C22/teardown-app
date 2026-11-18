// Manual accuracy check: runs the real vision API over fixtures/photos and compares with the expected answers
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { normalizeCategory } from "../shared/src/partCategory.js";
import { isNumberReadFromImage } from "../shared/src/visionSchema.js";

interface PhotoCase {
  image: string;
  kind: "closeup" | "sweep";
  serverModel?: string;
  expected: { partNumber?: string; serial?: string; category?: string; counts?: Record<string, number> };
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const photoDirectory = path.join(projectRoot, "fixtures", "photos");
const envFilePath = path.join(projectRoot, ".env");
if (existsSync(envFilePath)) {
  for (const [name, value] of Object.entries(parseEnv(readFileSync(envFilePath, "utf8")))) {
    if (process.env[name] === undefined && value !== undefined) process.env[name] = value;
  }
}
process.env.VISION_MODE = "live";

const { analyzeCloseup, analyzeSweep } = await import("../server/src/vision.js");

function normalizeNumber(value: string | null | undefined): string {
  return (value ?? "").replace(/[\s-]/g, "").toUpperCase();
}

function mediaTypeOf(fileName: string): "image/jpeg" | "image/png" | "image/webp" {
  if (fileName.endsWith(".png")) return "image/png";
  if (fileName.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

const caseFiles = existsSync(photoDirectory) ? readdirSync(photoDirectory).filter((fileName) => fileName.endsWith(".json")) : [];
if (caseFiles.length === 0) {
  console.log(`No cases found. Add photos plus a matching .json per photo to ${photoDirectory} (see fixtures/photos/README.md).`);
  process.exit(0);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set (put it in .env). This script calls the real API and costs money.");
  process.exit(1);
}

let closeupCases = 0;
let partNumberCorrect = 0;
let wrongButTrusted = 0;
let serialCorrect = 0;
let categoryCorrect = 0;
let countErrorTotal = 0;
let countCategories = 0;
let totalCost = 0;

for (const caseFile of caseFiles) {
  const photoCase = JSON.parse(readFileSync(path.join(photoDirectory, caseFile), "utf8")) as PhotoCase;
  const imageBase64 = readFileSync(path.join(photoDirectory, photoCase.image)).toString("base64");
  const request = { imageBase64, mediaType: mediaTypeOf(photoCase.image), serverModel: photoCase.serverModel ?? null };
  try {
    if (photoCase.kind === "sweep") {
      const sweep = await analyzeSweep(request);
      totalCost += sweep.usage.costUsd;
      const found: Record<string, number> = {};
      for (const categoryCount of sweep.result.countsByCategory) {
        const category = normalizeCategory(categoryCount.category);
        found[category] = (found[category] ?? 0) + categoryCount.count;
      }
      const rows = Object.entries(photoCase.expected.counts ?? {}).map(([category, expectedCount]) => {
        const foundCount = found[normalizeCategory(category)] ?? 0;
        countErrorTotal += Math.abs(foundCount - expectedCount);
        countCategories += 1;
        return `${category} ${foundCount}/${expectedCount}`;
      });
      console.log(`SWEEP   ${photoCase.image}: ${rows.join(", ")}  ($${sweep.usage.costUsd.toFixed(4)})`);
      continue;
    }

    const closeup = await analyzeCloseup({ ...request, categoryHint: null });
    totalCost += closeup.usage.costUsd;
    closeupCases += 1;
    const reading = closeup.result;
    const trusted = isNumberReadFromImage(reading.partNumber, reading.printedText);
    const partNumberMatches = normalizeNumber(reading.partNumber) === normalizeNumber(photoCase.expected.partNumber);
    const serialMatches = !photoCase.expected.serial || normalizeNumber(reading.serial) === normalizeNumber(photoCase.expected.serial);
    const categoryMatches = !photoCase.expected.category || normalizeCategory(photoCase.expected.category) === reading.category;
    if (photoCase.expected.partNumber && partNumberMatches) partNumberCorrect += 1;
    if (photoCase.expected.partNumber && trusted && !partNumberMatches) wrongButTrusted += 1;
    if (serialMatches) serialCorrect += 1;
    if (categoryMatches) categoryCorrect += 1;
    const verdict = partNumberMatches ? "OK  " : trusted ? "WRONG" : "MISS";
    console.log(`${verdict}   ${photoCase.image}: read ${reading.partNumber ?? "-"} (expected ${photoCase.expected.partNumber ?? "-"}), serial ${serialMatches ? "ok" : "wrong"}, category ${reading.category}  ($${closeup.usage.costUsd.toFixed(4)})`);
  } catch (caseError) {
    console.log(`ERROR  ${photoCase.image}: ${caseError instanceof Error ? caseError.message : String(caseError)}`);
  }
}

console.log("\nSummary");
if (closeupCases) {
  console.log(`  Close-ups: ${closeupCases}, part number correct ${partNumberCorrect}, serial correct ${serialCorrect}, category correct ${categoryCorrect}`);
  console.log(`  Wrong part number marked as read (must be 0): ${wrongButTrusted}`);
}
if (countCategories) console.log(`  Sweep count error: ${(countErrorTotal / countCategories).toFixed(2)} parts per category on average`);
console.log(`  Total vision cost: $${totalCost.toFixed(4)}`);
