import { useEffect, useRef, useState, useCallback } from "react";
import { type ScanRecord, checkScan, COOLDOWN_MS } from "@shared/dedup";
import { ComponentCard, type LookupResult } from "./ComponentCard";

// WASM binary is served from web/public/zxing_reader.wasm (copied from node_modules at setup)
const ZXING_WASM_URL = "/zxing_reader.wasm";

type ZxingResult = {
  text: string;
  isValid: boolean;
  position: {
    topLeft: { x: number; y: number };
    topRight: { x: number; y: number };
    bottomLeft: { x: number; y: number };
    bottomRight: { x: number; y: number };
  };
};

// Initialise ZXing WASM once at module level
let zxingReady = false;
let zxingReadBarcodesFromImageData: ((imageData: ImageData) => Promise<ZxingResult[]>) | null = null;

async function initZXing() {
  if (zxingReady) return;
  const { readBarcodesFromImageData, setZXingModuleOverrides } = await import("zxing-wasm/reader");
  setZXingModuleOverrides({ locateFile: () => ZXING_WASM_URL });
  zxingReadBarcodesFromImageData = readBarcodesFromImageData as (imageData: ImageData) => Promise<ZxingResult[]>;
  zxingReady = true;
}

export interface ScannedUnit {
  partType: string;
  serial: string | null;
  status: "ok" | "review";
}

interface ScanFeedback {
  text: string;
  kind: "new" | "duplicate" | "cooldown" | "review";
}

interface CameraScannerProps {
  sessionId: string;
  onUnit: (unit: ScannedUnit) => void;
  feedMode?: string; // ?feed= value in dev builds
}

const PART_TYPES = ["HDD", "SSD", "PSU", "DIMM", "GPU", "NIC", "OTHER"];

export function CameraScanner({ sessionId, onUnit, feedMode }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const scanRef = useRef<number | null>(null);
  const recentScansRef = useRef<ScanRecord[]>([]);
  const [partType, setPartType] = useState("HDD");
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [fakeScanInput, setFakeScanInput] = useState("");
  const [lookupResult, setLookupResult] = useState<{ result: LookupResult; serial: string } | null>(null);

  const showFeedback = useCallback((text: string, kind: ScanFeedback["kind"]) => {
    setFeedback({ text, kind });
    setTimeout(() => setFeedback(null), 2_500);
  }, []);

  const runLookup = useCallback((serial: string) => {
    fetch(`/api/lookup?q=${encodeURIComponent(serial)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data) setLookupResult({ result: data as LookupResult, serial }); })
      .catch(() => { /* lookup is best-effort, never block the scan flow */ });
  }, []);

  const processSerial = useCallback(async (serial: string | null) => {
    const now = Date.now();
    const normalised = serial?.trim() || null;

    if (normalised) {
      const outcome = checkScan(recentScansRef.current, normalised, now, COOLDOWN_MS);
      if (outcome === "cooldown") return;
      if (outcome === "duplicate") {
        showFeedback("Already recorded", "duplicate");
        return;
      }
      recentScansRef.current = [...recentScansRef.current, { serial: normalised, scannedAt: now }];
    }

    const response = await fetch(`/api/sessions/${sessionId}/units`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partType, serial: normalised }),
    });
    if (!response.ok) return;
    const unit = await response.json() as ScannedUnit;
    onUnit(unit);

    if (unit.status === "review") {
      showFeedback(`Review: ${partType} (no serial)`, "review");
    } else {
      showFeedback(`Recorded: ${partType} ${normalised ?? ""}`, "new");
      // Fire eBay lookup non-blocking — no serial means nothing to look up
      if (normalised) runLookup(normalised);
    }
  }, [sessionId, partType, onUnit, showFeedback, runLookup]);

  // Camera scanning loop (skipped in feed mode)
  useEffect(() => {
    if (feedMode !== undefined) return;
    let stream: MediaStream | null = null;

    async function start() {
      try {
        await initZXing();
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        scheduleFrame();
      } catch {
        setCameraError("Camera unavailable. Grant camera permission and reload.");
      }
    }

    function scheduleFrame() {
      scanRef.current = requestAnimationFrame(decodeFrame);
    }

    async function decodeFrame() {
      const video = videoRef.current;
      const overlay = overlayRef.current;
      if (!video || !overlay || !zxingReadBarcodesFromImageData) {
        scheduleFrame();
        return;
      }

      const { videoWidth: width, videoHeight: height } = video;
      if (width === 0 || height === 0) {
        scheduleFrame();
        return;
      }

      overlay.width = width;
      overlay.height = height;
      const ctx = overlay.getContext("2d")!;
      ctx.drawImage(video, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);

      const results = await zxingReadBarcodesFromImageData(imageData);
      ctx.clearRect(0, 0, width, height);

      for (const result of results) {
        if (!result.isValid) continue;
        const { topLeft, topRight, bottomRight, bottomLeft } = result.position;
        ctx.beginPath();
        ctx.moveTo(topLeft.x, topLeft.y);
        ctx.lineTo(topRight.x, topRight.y);
        ctx.lineTo(bottomRight.x, bottomRight.y);
        ctx.lineTo(bottomLeft.x, bottomLeft.y);
        ctx.closePath();
        ctx.strokeStyle = "#4cc3d6";
        ctx.lineWidth = 3;
        ctx.stroke();

        await processSerial(result.text);
      }

      // Throttle to ~10 fps for battery
      setTimeout(scheduleFrame, 100);
    }

    void start();

    return () => {
      if (scanRef.current !== null) cancelAnimationFrame(scanRef.current);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [feedMode, processSerial]);

  async function handleFakeScan(event: React.FormEvent) {
    event.preventDefault();
    // Empty string → no-serial (review) scan
    await processSerial(fakeScanInput || null);
    setFakeScanInput("");
  }

  const isDev = import.meta.env.DEV;

  return (
    <main className="screen screen-scan">
      <a href="/" className="back">← Home</a>
      <h1>Scanning</h1>

      <div className="part-type-row">
        {PART_TYPES.map((type) => (
          <button
            key={type}
            className={`part-btn${partType === type ? " part-btn-active" : ""}`}
            onClick={() => setPartType(type)}
            data-testid={`part-type-${type}`}
          >
            {type}
          </button>
        ))}
      </div>

      {feedMode !== undefined && isDev ? (
        <div className="feed-mode" data-testid="feed-mode">
          <p className="muted">Test feed mode — inject barcodes below.</p>
          <form className="feed-form" onSubmit={handleFakeScan}>
            <input
              className="field-input"
              type="text"
              value={fakeScanInput}
              onChange={(e) => setFakeScanInput(e.target.value)}
              placeholder="Serial or leave blank for no-serial"
              data-testid="fake-scan-input"
            />
            <button className="btn-primary" type="submit" data-testid="inject-scan-btn">
              Inject scan
            </button>
          </form>
        </div>
      ) : (
        <div className="camera-wrap">
          {cameraError ? (
            <p className="form-error">{cameraError}</p>
          ) : (
            <>
              <video ref={videoRef} className="camera-video" autoPlay playsInline muted />
              <canvas ref={overlayRef} className="camera-overlay" />
            </>
          )}
        </div>
      )}

      {feedback && (
        <div className={`scan-feedback scan-feedback-${feedback.kind}`} role="status" data-testid="scan-feedback">
          {feedback.text}
        </div>
      )}

      {lookupResult && (
        <div className="screen" style={{ paddingTop: 0 }}>
          <ComponentCard result={lookupResult.result} serial={lookupResult.serial} />
        </div>
      )}
    </main>
  );
}
