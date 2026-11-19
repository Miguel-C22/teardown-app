import type { DecodedCode } from "@shared/labelGroup";
import type { DecodeRequest, DecodeResponse } from "./decodeWorker";

// Frames are shrunk to this long edge for the fast pass; most label barcodes still read at this size
export const FAST_DECODE_EDGE = 1280;

let worker: Worker | null = null;
let nextRequestId = 1;
const pending = new Map<number, (codes: DecodedCode[]) => void>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./decodeWorker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<DecodeResponse>) => {
    const resolve = pending.get(event.data.requestId);
    pending.delete(event.data.requestId);
    resolve?.(event.data.codes.map((code) => ({ text: code.text, format: code.format, box: code.box })));
  };
  return worker;
}

// Starts the decoder worker early so the first frame doesn't wait for the WASM download
export async function initZxing(): Promise<void> {
  getWorker();
}

// Decodes every barcode in the frame on the worker; tryHarder is slower and kept for the occasional full-size pass
export function decodeFrame(imageData: ImageData, tryHarder = false): Promise<DecodedCode[]> {
  const requestId = nextRequestId++;
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    getWorker().postMessage({ requestId, imageData, tryHarder } satisfies DecodeRequest, [imageData.data.buffer]);
  });
}

// Draws the video into the canvas at most maxEdge on its long side and returns the pixels plus the scale used
export function grabFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement, maxEdge: number): { imageData: ImageData; scale: number } {
  const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return { imageData: context.getImageData(0, 0, canvas.width, canvas.height), scale };
}

// Puts boxes found on a shrunken frame back into full video coordinates
export function scaleCodes(codes: DecodedCode[], scale: number): DecodedCode[] {
  if (scale === 1) return codes;
  return codes.map((code) => ({
    ...code,
    box: { x: code.box.x / scale, y: code.box.y / scale, width: code.box.width / scale, height: code.box.height / scale },
  }));
}
