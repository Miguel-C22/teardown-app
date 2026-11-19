import type { DecodedCode, PixelBox } from "@shared/labelGroup";
import { extractLabelFields } from "@shared/labelText";
import type { Worker as TesseractWorker } from "tesseract.js";

// Label text is upper-case letters, digits and a little punctuation; limiting the alphabet cuts misreads like O/0
const LABEL_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/:.#+= ";

let workerPromise: Promise<TesseractWorker> | null = null;

// Tesseract runs on the phone in its own worker: free, and no photo leaves the device
function getOcrWorker(): Promise<TesseractWorker> {
  workerPromise ??= (async () => {
    const { createWorker, PSM } = await import("tesseract.js");
    const ocrWorker = await createWorker("eng");
    await ocrWorker.setParameters({ tessedit_char_whitelist: LABEL_CHARACTERS, tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    return ocrWorker;
  })();
  workerPromise.catch(() => { workerPromise = null; });
  return workerPromise;
}

// PaddleOCR models and the runtime's WebAssembly come from the free jsDelivr CDN, pinned to the installed versions
const PADDLE_MODEL_BASE = "https://cdn.jsdelivr.net/npm/@gutenye/ocr-models@1.4.2/assets";
const ONNX_RUNTIME_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";
// PaddleOCR line scores run 0–1; lines below this are too unsure to use
const MIN_PADDLE_LINE_SCORE = 0.6;
// Longest edge fed to PaddleOCR: big enough for small label print, small enough to stay quick on a phone
const PADDLE_MAX_EDGE = 1280;

interface PaddleOcr {
  detect(image: { data: Uint8ClampedArray; width: number; height: number }): Promise<{ texts: Array<{ text: string; mean: number }> }>;
}

let paddlePromise: Promise<PaddleOcr> | null = null;
let paddleFailed = false;

// PaddleOCR is made for camera photos and reads small, angled and sideways text; it loads lazily (about 30 MB, cached after the first time)
function getPaddle(): Promise<PaddleOcr> {
  paddlePromise ??= (async () => {
    // Bundlers can't always serve the runtime's .wasm file correctly, so it is fetched from the CDN by its exact version
    const onnxRuntime = await import("onnxruntime-web/wasm");
    onnxRuntime.env.wasm.wasmPaths = ONNX_RUNTIME_BASE;
    const { default: Ocr } = await import("@gutenye/ocr-browser");
    return await Ocr.create({
      models: {
        detectionPath: `${PADDLE_MODEL_BASE}/ch_PP-OCRv4_det_infer.onnx`,
        recognitionPath: `${PADDLE_MODEL_BASE}/ch_PP-OCRv4_rec_infer.onnx`,
        dictionaryPath: `${PADDLE_MODEL_BASE}/ppocr_keys_v1.txt`,
      },
    }) as unknown as PaddleOcr;
  })();
  // If it can't load (no signal, old phone), Tesseract takes over for the rest of the session
  paddlePromise.catch(() => { paddleFailed = true; });
  return paddlePromise;
}

// True when PaddleOCR couldn't load and Tesseract is doing the reading (used by the tuning script)
export function needsRotatedReads(): boolean {
  return paddleFailed;
}

// Turns the picture a quarter turn so sideways text (e.g. "SITOP PSU8200" running up a front panel) lies level for the reader
function rotateCanvas(image: HTMLCanvasElement, rotateRadians: number): HTMLCanvasElement {
  if (!rotateRadians) return image;
  const rotated = document.createElement("canvas");
  rotated.width = image.height;
  rotated.height = image.width;
  const context = rotated.getContext("2d")!;
  context.translate(rotated.width / 2, rotated.height / 2);
  context.rotate(rotateRadians);
  context.drawImage(image, -image.width / 2, -image.height / 2);
  return rotated;
}

// Downloads the text reader in the background so it is ready by the time the phone reaches a label
export function warmUpOcr(): void {
  void getPaddle().catch(() => getOcrWorker()).catch(() => undefined);
}

// Scales a canvas so its long edge is maxEdge (small crops are enlarged up to 2x, which reads small print far better) and returns its pixels
function canvasPixels(image: HTMLCanvasElement, maxEdge: number) {
  const scale = Math.min(2, maxEdge / Math.max(image.width, image.height));
  const target = document.createElement("canvas");
  target.width = Math.round(image.width * scale);
  target.height = Math.round(image.height * scale);
  const context = target.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, target.width, target.height);
  const pixels = context.getImageData(0, 0, target.width, target.height);
  return { data: pixels.data, width: pixels.width, height: pixels.height };
}

// Every line PaddleOCR found with its score (0–1), before any filtering; used to tune the reader against real photos
export async function readAllLinesWithScores(image: HTMLCanvasElement, rotateRadians = 0): Promise<Array<{ text: string; score: number }>> {
  const result = await (await getPaddle()).detect(canvasPixels(rotateCanvas(image, rotateRadians), PADDLE_MAX_EDGE));
  return result.texts.map((line) => ({ text: line.text, score: Number(line.mean.toFixed(2)) }));
}

async function readTextWithPaddle(paddle: PaddleOcr, image: HTMLCanvasElement): Promise<string> {
  const result = await paddle.detect(canvasPixels(image, PADDLE_MAX_EDGE));
  return result.texts
    .filter((line) => line.mean >= MIN_PADDLE_LINE_SCORE)
    .map((line) => line.text.toUpperCase().replace(/[^A-Z0-9 \-/:.#+=()]/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// Words read with less confidence than this (0–100) are dropped; clear words are kept even when the rest of the view is noisy
export const MIN_WORD_CONFIDENCE = 60;

// Reads all text in the image: PaddleOCR when it has loaded, else Tesseract (judging each word on its own, turned by rotateRadians)
export async function readText(image: HTMLCanvasElement, rotateRadians = 0): Promise<string> {
  if (!paddleFailed) {
    try {
      return await readTextWithPaddle(await getPaddle(), rotateCanvas(image, rotateRadians));
    } catch {
      paddleFailed = true;
    }
  }
  return readTextWithTesseract(image, rotateRadians);
}

async function readTextWithTesseract(image: HTMLCanvasElement, rotateRadians: number): Promise<string> {
  const ocrWorker = await getOcrWorker();
  const result = await ocrWorker.recognize(image, { rotateRadians }, { text: true, blocks: true });
  const blocks = result.data.blocks;
  if (!blocks) return (result.data.confidence ?? 0) >= MIN_WORD_CONFIDENCE ? result.data.text ?? "" : "";
  const lines: string[] = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const clearWords = line.words.filter((word) => word.confidence >= MIN_WORD_CONFIDENCE).map((word) => word.text.trim()).filter(Boolean);
        if (clearWords.length) lines.push(clearWords.join(" "));
      }
    }
  }
  return lines.join("\n");
}

// The middle of the frame, where the tech points: smaller to read, and less stray text from neighbouring parts
export function centreRegion(video: HTMLVideoElement, fraction = 0.7): PixelBox {
  const width = video.videoWidth * fraction;
  const height = video.videoHeight * fraction;
  return { x: (video.videoWidth - width) / 2, y: (video.videoHeight - height) / 2, width, height };
}

// OCR fields become codes on one shared box, so label grouping treats them as one sticker
export function ocrTextToCodes(text: string, box: PixelBox = { x: 0, y: 0, width: 400, height: 200 }): DecodedCode[] {
  return extractLabelFields(text).map((field) => ({ text: field.text, box, hint: field.hint }));
}

// Below this average brightness (0–255) a view is a dark faceplate with light printing; between the two it is mixed
const DARK_VIEW_BRIGHTNESS = 100;
const LIGHT_VIEW_BRIGHTNESS = 150;

// Average brightness of a region, sampled small so it costs almost nothing
function averageBrightness(video: HTMLVideoElement, source: PixelBox): number {
  const sample = document.createElement("canvas");
  sample.width = 32;
  sample.height = 24;
  const context = sample.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
  let total = 0;
  for (let index = 0; index < pixels.length; index += 4) total += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
  return total / (pixels.length / 4);
}

// Text printed sideways (e.g. "SITOP PSU8200" running up a front panel) only reads once turned level, so reads cycle through all three
const READ_ROTATIONS = [0, Math.PI / 2, -Math.PI / 2];

export interface ReadPass {
  invert: boolean;
  rotateRadians: number;
}

// Which way to read this time: cycles straight / turned right / turned left; the reader wants dark letters on light, so dark views are
// flipped, and mixed views (a white sticker on a grey faceplate) alternate between normal and flipped after each full turn
export function nextReadPass(video: HTMLVideoElement, region: PixelBox | null, readCount: number): ReadPass {
  const rotateRadians = READ_ROTATIONS[readCount % READ_ROTATIONS.length];
  const brightness = averageBrightness(video, region ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight });
  if (brightness < DARK_VIEW_BRIGHTNESS) return { invert: true, rotateRadians };
  if (brightness > LIGHT_VIEW_BRIGHTNESS) return { invert: false, rotateRadians };
  return { invert: Math.floor(readCount / READ_ROTATIONS.length) % 2 === 1, rotateRadians };
}

// Straight read only, for the area right around a label (labels are read level)
export function shouldInvert(video: HTMLVideoElement, region: PixelBox | null): boolean {
  return averageBrightness(video, region ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight }) < DARK_VIEW_BRIGHTNESS;
}

// Copies a region of the video (or all of it) to a canvas, enlarged for small text, flipped to dark-on-light when asked
export function captureRegion(video: HTMLVideoElement, region: PixelBox | null, targetWidth = 1600, invert = false): HTMLCanvasElement {
  const source = region ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
  const scale = Math.min(3, targetWidth / Math.max(1, source.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const context = canvas.getContext("2d")!;
  context.filter = invert ? "grayscale(1) invert(1) contrast(1.4)" : "grayscale(1) contrast(1.4)";
  context.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}
