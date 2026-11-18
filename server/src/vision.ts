import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { CloseupResultSchema, SweepResultSchema, type CloseupResult, type SweepResult } from "../../shared/src/visionSchema.js";

// gpt-6.2-sol is OpenAI's everyday vision model; set OPENAI_VISION_MODEL=gpt-6.2-astra for the flagship
const DEFAULT_VISION_MODEL = "gpt-6.2-sol";
// gpt-6.2-sol standard prices in USD per million tokens (astra is 8 / 40); reasoning tokens bill as output
const DEFAULT_INPUT_USD_PER_MILLION = 2;
const DEFAULT_OUTPUT_USD_PER_MILLION = 10;

export function visionModel(): string {
  return process.env.OPENAI_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL;
}

function priceFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FIXTURE_DIRECTORY = path.join(projectRoot, "fixtures", "vision");

export type VisionMode = "mock" | "live";

export interface VisionCallUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface VisionResponse<Result> {
  result: Result;
  usage: VisionCallUsage;
  mode: VisionMode;
}

export class VisionError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

export function visionMode(): VisionMode {
  const configured = process.env.VISION_MODE;
  if (configured === "live" || configured === "mock") return configured;
  return process.env.OPENAI_API_KEY ? "live" : "mock";
}

const SHARED_RULES = `Copy printed text exactly as printed, character for character.
Set readFromImage to true only when every character of that text is legible in this image.
Never complete, correct or guess a part number or serial; if it is partly hidden, blurred or cut off, set readFromImage to false.
Label kinds: partNumber covers OEM spare numbers, Dell DP/N, HPE spare or option numbers and manufacturer part numbers; serial covers serial numbers, Dell PPIDs and HPE CT numbers.
Ignore customer asset tags and anything that is not part of the component.
Many parts have no sticker, so identify them from what you can see: chip markings, heatsink stamps, connectors, slot type, PCB layout and logos.
searchQuery is the most specific product name you can justify from the image, for searching resale listings; it is not a part number and never counts as one.
estimatedPriceUsd is a rough used resale range for that product; keep it wide when unsure and null when you cannot tell the product.`;

const SWEEP_SYSTEM = `You inspect photos of opened rack servers during teardown and find every component worth reselling.
List each visible DIMM, CPU (a CPU under a heatsink counts as a CPU), HDD, SSD or NVMe drive (category SSD), PSU, NIC, RAID or HBA controller (category RAID), GPU, and other add-in card or boot module (category OTHER).
Skip fans, cables, blanks, heatsinks on their own and empty slots.
For each part give a bounding box in fractions of the image size (x and y are the top-left corner).
Set needsCloseUp to true when its exact part number or serial is not fully legible.
countsByCategory counts every instance you can see, including ones without readable labels, for example 12 populated DIMM slots means DIMM 12.
${SHARED_RULES}`;

const CLOSEUP_SYSTEM = `You read one server component's label, chip markings, PCB silkscreen or engraved model number from a close-up photo taken during teardown.
Return the part number and serial only if they are printed in the image; otherwise return null for them.
If nothing is legible, set readable to false and still give the category, manufacturer and familyGuess you can tell from the component's shape, connectors and chips.
${SHARED_RULES}`;

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new VisionError("OPENAI_API_KEY is not set on the server", 503);
  openaiClient ??= new OpenAI();
  return openaiClient;
}

function costOf(inputTokens: number, outputTokens: number): number {
  const inputPrice = priceFromEnv("OPENAI_INPUT_USD_PER_MILLION", DEFAULT_INPUT_USD_PER_MILLION);
  const outputPrice = priceFromEnv("OPENAI_OUTPUT_USD_PER_MILLION", DEFAULT_OUTPUT_USD_PER_MILLION);
  return (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
}

// A refusal comes back as a refusal content part instead of output text
function wasRefused(response: OpenAI.Responses.Response): boolean {
  return response.output.some((item) => item.type === "message" && item.content.some((part) => part.type === "refusal"));
}

function loadFixture<Result>(kind: "sweep" | "closeup", fixtureName: string | undefined, schema: { parse: (value: unknown) => Result }): VisionResponse<Result> {
  const safeName = fixtureName && /^[a-z0-9-]+$/.test(fixtureName) ? fixtureName : "default";
  const fixturePath = path.join(FIXTURE_DIRECTORY, `${kind}-${safeName}.json`);
  let fixtureText: string;
  try {
    fixtureText = readFileSync(fixturePath, "utf8");
  } catch {
    throw new VisionError(`no mock fixture ${kind}-${safeName}.json`, 400);
  }
  return { result: schema.parse(JSON.parse(fixtureText)), usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, mode: "mock" };
}

async function callVisionModel<Result>(
  systemPrompt: string,
  userText: string,
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
  schema: typeof SweepResultSchema | typeof CloseupResultSchema,
  schemaName: string,
): Promise<VisionResponse<Result>> {
  const client = getClient();
  try {
    const response = await client.responses.parse({
      model: visionModel(),
      instructions: systemPrompt,
      reasoning: { effort: "low" },
      max_output_tokens: 16000,
      store: false,
      input: [{
        role: "user",
        content: [
          { type: "input_image", image_url: `data:${mediaType};base64,${imageBase64}`, detail: "high" },
          { type: "input_text", text: userText },
        ],
      }],
      text: { format: zodTextFormat(schema, schemaName) },
    });
    if (wasRefused(response)) throw new VisionError("the vision model declined this image", 422);
    if (response.status === "incomplete" || !response.output_parsed) throw new VisionError("the vision model returned no usable reading", 502);
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    return {
      result: response.output_parsed as Result,
      usage: { inputTokens, outputTokens, costUsd: costOf(inputTokens, outputTokens) },
      mode: "live",
    };
  } catch (callError) {
    if (callError instanceof VisionError) throw callError;
    if (callError instanceof OpenAI.RateLimitError) throw new VisionError("vision rate limit reached, try again shortly", 429);
    if (callError instanceof OpenAI.AuthenticationError) throw new VisionError("the OpenAI API key was rejected", 503);
    if (callError instanceof OpenAI.APIConnectionError) throw new VisionError("could not reach the vision service", 503);
    if (callError instanceof OpenAI.APIError) throw new VisionError(`vision service error ${callError.status ?? ""}`.trim(), 502);
    throw callError;
  }
}

export interface VisionRequest {
  imageBase64: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  serverModel: string | null;
  fixture?: string;
}

export async function analyzeSweep(request: VisionRequest): Promise<VisionResponse<SweepResult>> {
  if (visionMode() === "mock") return loadFixture("sweep", request.fixture, SweepResultSchema);
  const serverLine = request.serverModel ? `The server is a ${request.serverModel}.` : "The server model is unknown.";
  return callVisionModel<SweepResult>(SWEEP_SYSTEM, `${serverLine} List every resellable component in this photo.`, request.imageBase64, request.mediaType, SweepResultSchema, "sweep_result");
}

export async function analyzeCloseup(request: VisionRequest & { categoryHint: string | null }): Promise<VisionResponse<CloseupResult>> {
  if (visionMode() === "mock") return loadFixture("closeup", request.fixture, CloseupResultSchema);
  const serverLine = request.serverModel ? `It came out of a ${request.serverModel}.` : "";
  const hintLine = request.categoryHint ? `The technician thinks it is a ${request.categoryHint}.` : "";
  return callVisionModel<CloseupResult>(CLOSEUP_SYSTEM, `${serverLine} ${hintLine} Read this component.`.trim(), request.imageBase64, request.mediaType, CloseupResultSchema, "closeup_result");
}
