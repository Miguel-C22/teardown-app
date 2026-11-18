import type { DecodedCode } from "@shared/labelGroup";

// WASM binary is served from web/public/zxing_reader.wasm (copied from node_modules at setup)
const ZXING_WASM_URL = "/zxing_reader.wasm";

interface ZxingPoint {
  x: number;
  y: number;
}

interface ZxingResult {
  text: string;
  isValid: boolean;
  position: { topLeft: ZxingPoint; topRight: ZxingPoint; bottomLeft: ZxingPoint; bottomRight: ZxingPoint };
}

type ReadBarcodes = (imageData: ImageData, options?: Record<string, unknown>) => Promise<ZxingResult[]>;

let readBarcodes: ReadBarcodes | null = null;
let loading: Promise<void> | null = null;

export function initZxing(): Promise<void> {
  loading ??= import("zxing-wasm/reader").then(({ readBarcodesFromImageData, setZXingModuleOverrides }) => {
    setZXingModuleOverrides({ locateFile: () => ZXING_WASM_URL });
    readBarcodes = readBarcodesFromImageData as unknown as ReadBarcodes;
  });
  return loading;
}

// Decodes every barcode in the frame; tryHarder and several codes per frame suit dense server labels
export async function decodeFrame(imageData: ImageData): Promise<DecodedCode[]> {
  if (!readBarcodes) return [];
  const results = await readBarcodes(imageData, { tryHarder: true, maxNumberOfSymbols: 24 });
  return results
    .filter((result) => result.isValid && result.text.trim())
    .map((result) => {
      const corners = [result.position.topLeft, result.position.topRight, result.position.bottomLeft, result.position.bottomRight];
      const left = Math.min(...corners.map((corner) => corner.x));
      const top = Math.min(...corners.map((corner) => corner.y));
      const right = Math.max(...corners.map((corner) => corner.x));
      const bottom = Math.max(...corners.map((corner) => corner.y));
      return { text: result.text.trim(), box: { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) } };
    });
}
