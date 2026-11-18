// Longest edge sent to the vision model; larger photos cost more without reading labels better
export const MAX_STILL_EDGE = 1568;

export interface Still {
  base64: string;
  mediaType: "image/jpeg";
}

export function captureStill(video: HTMLVideoElement, maxEdge: number = MAX_STILL_EDGE): Still | null {
  const { videoWidth, videoHeight } = video;
  if (!videoWidth || !videoHeight) return null;
  const scale = Math.min(1, maxEdge / Math.max(videoWidth, videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(videoWidth * scale);
  canvas.height = Math.round(videoHeight * scale);
  canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/jpeg" };
}

const SIGNATURE_WIDTH = 32;
const SIGNATURE_HEIGHT = 24;

// A tiny grayscale thumbnail used to tell whether the camera is holding still
export function frameSignature(source: CanvasImageSource, signatureCanvas: HTMLCanvasElement): Uint8ClampedArray {
  signatureCanvas.width = SIGNATURE_WIDTH;
  signatureCanvas.height = SIGNATURE_HEIGHT;
  const context = signatureCanvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT);
  const pixels = context.getImageData(0, 0, SIGNATURE_WIDTH, SIGNATURE_HEIGHT).data;
  const gray = new Uint8ClampedArray(SIGNATURE_WIDTH * SIGNATURE_HEIGHT);
  for (let pixelIndex = 0; pixelIndex < gray.length; pixelIndex++) {
    gray[pixelIndex] = (pixels[pixelIndex * 4] + pixels[pixelIndex * 4 + 1] + pixels[pixelIndex * 4 + 2]) / 3;
  }
  return gray;
}

// Mean absolute brightness difference between two signatures, 0 to 255
export function signatureDifference(previous: Uint8ClampedArray | null, current: Uint8ClampedArray): number {
  if (!previous || previous.length !== current.length) return 255;
  let total = 0;
  for (let pixelIndex = 0; pixelIndex < current.length; pixelIndex++) total += Math.abs(previous[pixelIndex] - current[pixelIndex]);
  return total / current.length;
}
