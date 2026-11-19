/// <reference lib="webworker" />
// Decodes barcodes off the main thread so the camera view and buttons never stall while a frame is being read
import { readBarcodesFromImageData, setZXingModuleOverrides } from "zxing-wasm/reader";

// WASM binary is served from web/public/zxing_reader.wasm (copied from node_modules at setup)
setZXingModuleOverrides({ locateFile: () => "/zxing_reader.wasm" });

// The symbologies found on server parts; skipping the rest makes each frame faster
const LABEL_FORMATS = ["Code128", "Code39", "Code93", "DataMatrix", "QRCode", "PDF417", "EAN13", "UPCA", "ITF"] as const;

export interface DecodeRequest {
  requestId: number;
  imageData: ImageData;
  tryHarder: boolean;
}

export interface DecodedResult {
  text: string;
  format: string;
  box: { x: number; y: number; width: number; height: number };
}

export interface DecodeResponse {
  requestId: number;
  codes: DecodedResult[];
  error?: string;
}

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { requestId, imageData, tryHarder } = event.data;
  try {
    const results = await readBarcodesFromImageData(imageData, {
      formats: [...LABEL_FORMATS], tryHarder, tryRotate: tryHarder, tryInvert: tryHarder, maxNumberOfSymbols: 24,
    });
    const codes = results
      .filter((result) => result.isValid && result.text.trim())
      .map((result): DecodedResult => {
        const corners = [result.position.topLeft, result.position.topRight, result.position.bottomLeft, result.position.bottomRight];
        const left = Math.min(...corners.map((corner) => corner.x));
        const top = Math.min(...corners.map((corner) => corner.y));
        const right = Math.max(...corners.map((corner) => corner.x));
        const bottom = Math.max(...corners.map((corner) => corner.y));
        return { text: result.text.trim(), format: String(result.format), box: { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) } };
      });
    (self as DedicatedWorkerGlobalScope).postMessage({ requestId, codes } satisfies DecodeResponse);
  } catch (decodeError) {
    (self as DedicatedWorkerGlobalScope).postMessage({ requestId, codes: [], error: String(decodeError) } satisfies DecodeResponse);
  }
};
