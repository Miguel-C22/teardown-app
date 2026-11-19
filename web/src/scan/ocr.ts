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

// Downloads the OCR engine in the background so the first "Read sticker" is quick
export function warmUpOcr(): void {
  void getOcrWorker().catch(() => undefined);
}

// Below this overall confidence (0–100) the text is too unsure to record anything from
export const MIN_OCR_CONFIDENCE = 60;

export async function readText(image: HTMLCanvasElement): Promise<string> {
  const ocrWorker = await getOcrWorker();
  const result = await ocrWorker.recognize(image);
  if ((result.data.confidence ?? 0) < MIN_OCR_CONFIDENCE) return "";
  return result.data.text ?? "";
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

// Copies a region of the video (or all of it) to a canvas, enlarged for small text
export function captureRegion(video: HTMLVideoElement, region: PixelBox | null, targetWidth = 1600): HTMLCanvasElement {
  const source = region ?? { x: 0, y: 0, width: video.videoWidth, height: video.videoHeight };
  const scale = Math.min(3, targetWidth / Math.max(1, source.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const context = canvas.getContext("2d")!;
  context.filter = "grayscale(1) contrast(1.4)";
  context.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}
