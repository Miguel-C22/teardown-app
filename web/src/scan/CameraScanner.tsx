import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { type ScanRecord, checkScan, COOLDOWN_MS } from "@shared/dedup";
import { groupCodesIntoLabels, type DecodedCode, type LabelGroup } from "@shared/labelGroup";
import { PART_CATEGORIES } from "@shared/partCategory";
import { isHighValue } from "@shared/recommend";
import {
  PRICE_SOURCE_LABEL, formatPrice, postJson, type CloseupResponse, type NewUnitRequest, type SessionInfo, type SessionSummary, type SweepPartView, type SweepResponse, type UnitView,
} from "../api";
import { ComponentCard } from "./ComponentCard";
import { captureStill, frameSignature, signatureDifference } from "./capture";
import { decodeFrame, initZxing } from "./zxing";

interface ScanFeedback {
  text: string;
  kind: "new" | "duplicate" | "cooldown" | "review" | "error";
}

interface CameraScannerProps {
  session: SessionInfo;
  onUnit: (unit: UnitView) => void;
  onSessionUpdate: (summary: SessionSummary) => void;
  modelText: string;
  onRescanTag: () => void;
  feedMode?: string;
}

const PART_TYPES = ["AUTO", ...PART_CATEGORIES];
const FRAME_INTERVAL_MS = 120;
// Signature differences (0 to 255) that mean "holding still" and "moved to a new view"
const STEADY_DIFFERENCE = 4;
const MOVED_DIFFERENCE = 18;
const STEADY_BEFORE_SWEEP_MS = 1_200;
const MIN_MS_BETWEEN_AUTO_SWEEPS = 10_000;
const MOCK_FIXTURES = ["default", "unreadable", "invented", "cooler"];

function vibrate(pattern: number | number[]): void {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

function partTag(part: SweepPartView): string {
  const name = part.partNumber ?? part.familyGuess ?? part.category;
  const value = part.lookup ? ` · $${part.lookup.priceMax}` : "";
  return `${part.category} ${name}${value}`;
}

// What the AI saw, in plain words: "DIMM · Samsung · 32GB DDR4 RDIMM"
function partDescription(part: SweepPartView): string {
  const name = part.partNumber ?? part.familyGuess ?? "unidentified";
  return [part.category, part.manufacturer, name].filter(Boolean).join(" · ");
}

// Names up to three different parts so the tech knows what was found without reading the list
function sweepSummary(parts: SweepPartView[], recordedCount: number, unreadCount: number): string {
  const countByDescription = new Map<string, number>();
  for (const part of parts) {
    const description = [part.manufacturer, part.familyGuess ?? part.category].filter(Boolean).join(" ");
    countByDescription.set(description, (countByDescription.get(description) ?? 0) + 1);
  }
  const named = [...countByDescription.entries()].slice(0, 3).map(([description, count]) => (count > 1 ? `${count}× ${description}` : description));
  const more = countByDescription.size > 3 ? ", …" : "";
  return `Found ${parts.length} parts: ${named.join(", ")}${more}. ${recordedCount} recorded, ${unreadCount} not read yet.`;
}

function partColor(part: SweepPartView): string {
  if (part.unitId || (part.partNumber && part.lookup)) return "#2f9d5f";
  if (part.needsCloseUp || !part.partNumber) return "#e0ab52";
  return "#9aa7ae";
}

export function CameraScanner({ session, onUnit, onSessionUpdate, feedMode, modelText, onRescanTag }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const recentScansRef = useRef<ScanRecord[]>([]);
  const sweepPartsRef = useRef<SweepPartView[]>([]);
  const busyRef = useRef(false);
  const autoSweepRef = useRef(false);
  const feedbackTimerRef = useRef<number | null>(null);

  const [partType, setPartType] = useState("AUTO");
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [fakeScanInput, setFakeScanInput] = useState("");
  const [mockFixture, setMockFixture] = useState("default");
  // Every part found stays on screen, newest first, until the tech taps Clear
  const [resultCards, setResultCards] = useState<UnitView[]>([]);
  const [sweepParts, setSweepParts] = useState<SweepPartView[]>([]);
  // Boxes stop lining up once the camera moves, so they hide but the found-parts list stays
  const [boxesStale, setBoxesStale] = useState(false);
  const boxesStaleRef = useRef(false);
  const [closeupHint, setCloseupHint] = useState<string | null>(null);
  const [pendingRepeat, setPendingRepeat] = useState<LabelGroup | null>(null);
  const [busy, setBusy] = useState<"sweep" | "closeup" | null>(null);
  const [autoSweep, setAutoSweep] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const isFeedMode = feedMode !== undefined && import.meta.env.DEV;

  useEffect(() => { autoSweepRef.current = autoSweep; }, [autoSweep]);
  useEffect(() => { sweepPartsRef.current = sweepParts; }, [sweepParts]);

  const showFeedback = useCallback((text: string, kind: ScanFeedback["kind"]) => {
    setFeedback({ text, kind });
    if (feedbackTimerRef.current !== null) window.clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = window.setTimeout(() => setFeedback(null), 3_000);
  }, []);

  const announceUnit = useCallback((unit: UnitView, duplicate: boolean) => {
    if (duplicate) {
      vibrate(20);
      showFeedback("Already recorded", "duplicate");
      return;
    }
    onUnit(unit);
    // A unit filled in later keeps its id, so its card is updated in place
    setResultCards((previous) => (previous.some((card) => card.id === unit.id)
      ? previous.map((card) => (card.id === unit.id ? unit : card))
      : [unit, ...previous]));
    const value = unit.priceMax !== null ? ` · ${formatPrice(unit.priceMin, unit.priceMax)}` : "";
    if (unit.filledIn) {
      vibrate(60);
      showFeedback(`Updated: ${unit.partType} ${unit.partNumber ?? ""} now has serial ${unit.serial ?? "-"}`, "new");
    } else if (isHighValue(unit.priceMax)) {
      vibrate([80, 60, 80]);
      showFeedback(`High value: ${unit.description ?? unit.partType}${value}`, "new");
    } else if (unit.status === "review") {
      vibrate(60);
      showFeedback(`Review: ${unit.partType} (no serial)${unit.partNumber ? ` ${unit.partNumber}` : ""}`, "review");
    } else {
      vibrate(60);
      showFeedback(`Recorded: ${unit.partType} ${unit.serial ?? ""}${value}`, "new");
    }
  }, [onUnit, showFeedback]);

  const saveUnit = useCallback(async (request: NewUnitRequest): Promise<UnitView | null> => {
    try {
      const unit = await postJson<UnitView>(`/api/sessions/${session.id}/units`, request);
      announceUnit(unit, unit.duplicate === true);
      return unit;
    } catch (saveError) {
      showFeedback(saveError instanceof Error ? saveError.message : "Could not save", "error");
      return null;
    }
  }, [session.id, announceUnit, showFeedback]);

  const labelRequest = useCallback((label: LabelGroup): NewUnitRequest => ({
    partType: partType !== "AUTO" ? partType : label.categoryHint ?? "AUTO",
    serial: label.serial,
    partNumber: label.partNumber,
    manufacturer: label.manufacturerHint,
    identifiedBy: "barcode",
    evidence: label.codes.map((code) => code.text).join(" | "),
  }), [partType]);

  // A label with a serial is one unit; a part-number-only label asks before adding a second identical part
  const processLabel = useCallback(async (label: LabelGroup) => {
    const scanKey = label.serial ?? (label.partNumber ? `part:${label.partNumber}` : null);
    if (!scanKey) return;
    const now = Date.now();
    const outcome = checkScan(recentScansRef.current, scanKey, now, COOLDOWN_MS);
    if (outcome === "cooldown") return;
    if (outcome === "duplicate") {
      recentScansRef.current = [...recentScansRef.current.filter((record) => record.serial !== scanKey), { serial: scanKey, scannedAt: now }];
      if (label.serial) {
        showFeedback("Already recorded", "duplicate");
      } else {
        setPendingRepeat(label);
      }
      return;
    }
    recentScansRef.current = [...recentScansRef.current, { serial: scanKey, scannedAt: now }];
    await saveUnit(labelRequest(label));
  }, [labelRequest, saveUnit, showFeedback]);

  const runSweep = useCallback(async () => {
    if (busyRef.current) return;
    const still = isFeedMode ? null : videoRef.current ? captureStill(videoRef.current) : null;
    if (!isFeedMode && !still) return;
    busyRef.current = true;
    setBusy("sweep");
    try {
      const sweep = await postJson<SweepResponse>(`/api/sessions/${session.id}/vision/sweep`, {
        image: still?.base64, mediaType: still?.mediaType, fixture: isFeedMode ? mockFixture : undefined,
      });
      setSweepParts(sweep.parts);
      boxesStaleRef.current = false;
      setBoxesStale(false);
      onSessionUpdate(sweep.session);
      const newlyAdded = sweep.parts.filter((part) => part.unitId && !part.duplicate);
      const closeupCount = sweep.parts.filter((part) => !part.unitId && (part.needsCloseUp || !part.partNumber)).length;
      for (const part of newlyAdded) {
        const unit = sweep.session.units.find((sessionUnit) => sessionUnit.id === part.unitId);
        if (unit) onUnit(unit);
      }
      if (sweep.parts.some((part) => isHighValue(part.lookup?.priceMax ?? null))) vibrate([80, 60, 80]);
      showFeedback(sweep.parts.length ? sweepSummary(sweep.parts, newlyAdded.length, closeupCount) : "No parts found in this view", closeupCount ? "review" : "new");
    } catch (sweepError) {
      showFeedback(sweepError instanceof Error ? sweepError.message : "Sweep failed", "error");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, [isFeedMode, mockFixture, session.id, onSessionUpdate, onUnit, showFeedback]);

  const runCloseup = useCallback(async () => {
    if (busyRef.current) return;
    const still = isFeedMode ? null : videoRef.current ? captureStill(videoRef.current) : null;
    if (!isFeedMode && !still) return;
    busyRef.current = true;
    setBusy("closeup");
    try {
      const closeup = await postJson<CloseupResponse>(`/api/sessions/${session.id}/vision/closeup`, {
        image: still?.base64, mediaType: still?.mediaType, categoryHint: closeupHint ?? (partType !== "AUTO" ? partType : undefined),
        fixture: isFeedMode ? mockFixture : undefined,
      });
      onSessionUpdate(closeup.session);
      announceUnit(closeup.unit, closeup.duplicate);
      setCloseupHint(null);
    } catch (closeupError) {
      showFeedback(closeupError instanceof Error ? closeupError.message : "Label read failed", "error");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }, [isFeedMode, mockFixture, session.id, closeupHint, partType, onSessionUpdate, announceUnit, showFeedback]);

  // Latest callbacks for the frame loop, which lives outside React's render cycle
  const processLabelRef = useRef(processLabel);
  const runSweepRef = useRef(runSweep);
  useEffect(() => { processLabelRef.current = processLabel; }, [processLabel]);
  useEffect(() => { runSweepRef.current = runSweep; }, [runSweep]);

  useEffect(() => {
    if (feedMode !== undefined) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: number | null = null;
    const workCanvas = document.createElement("canvas");
    const signatureCanvas = document.createElement("canvas");
    let previousSignature: Uint8ClampedArray | null = null;
    let steadySince: number | null = null;
    let movedSinceSweep = true;
    let lastAutoSweepAt = 0;

    function drawOverlay(codes: DecodedCode[], width: number, height: number) {
      const overlay = overlayRef.current;
      if (!overlay) return;
      overlay.width = width;
      overlay.height = height;
      const context = overlay.getContext("2d")!;
      context.clearRect(0, 0, width, height);
      context.lineWidth = Math.max(3, width / 300);
      context.font = `600 ${Math.max(16, width / 45)}px system-ui, sans-serif`;
      for (const part of boxesStaleRef.current ? [] : sweepPartsRef.current) {
        const left = part.box.x * width;
        const top = part.box.y * height;
        const color = partColor(part);
        context.strokeStyle = color;
        context.strokeRect(left, top, part.box.width * width, part.box.height * height);
        const tag = partTag(part);
        const tagHeight = Math.max(22, width / 36);
        context.fillStyle = color;
        context.fillRect(left, Math.max(0, top - tagHeight), context.measureText(tag).width + 12, tagHeight);
        context.fillStyle = "#0b1114";
        context.fillText(tag, left + 6, Math.max(tagHeight - 6, top - 6));
      }
      context.strokeStyle = "#4cc3d6";
      for (const code of codes) context.strokeRect(code.box.x, code.box.y, code.box.width, code.box.height);
    }

    async function processFrame() {
      const video = videoRef.current;
      if (stopped) return;
      if (video && video.videoWidth > 0) {
        const { videoWidth: width, videoHeight: height } = video;
        workCanvas.width = width;
        workCanvas.height = height;
        const context = workCanvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(video, 0, 0, width, height);
        const codes = await decodeFrame(context.getImageData(0, 0, width, height)).catch(() => [] as DecodedCode[]);

        const signature = frameSignature(workCanvas, signatureCanvas);
        const difference = signatureDifference(previousSignature, signature);
        previousSignature = signature;
        const now = Date.now();
        if (difference > MOVED_DIFFERENCE) {
          movedSinceSweep = true;
          steadySince = null;
          if (sweepPartsRef.current.length && !boxesStaleRef.current) {
            boxesStaleRef.current = true;
            setBoxesStale(true);
          }
        } else if (difference < STEADY_DIFFERENCE) {
          steadySince ??= now;
        }
        if (autoSweepRef.current && movedSinceSweep && steadySince !== null && now - steadySince >= STEADY_BEFORE_SWEEP_MS
          && now - lastAutoSweepAt >= MIN_MS_BETWEEN_AUTO_SWEEPS && !busyRef.current) {
          movedSinceSweep = false;
          lastAutoSweepAt = now;
          void runSweepRef.current();
        }

        drawOverlay(codes, width, height);
        for (const label of groupCodesIntoLabels(codes)) await processLabelRef.current(label);
      }
      timer = window.setTimeout(() => void processFrame(), FRAME_INTERVAL_MS);
    }

    async function start() {
      try {
        await initZxing();
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (stopped) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        trackRef.current = track;
        const capabilities = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        setTorchAvailable(Boolean(capabilities.torch));
        void processFrame();
      } catch {
        setCameraError("Camera unavailable. Grant camera permission and reload.");
      }
    }

    void start();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      trackRef.current = null;
    };
  }, [feedMode]);

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }).catch(() => undefined);
    setTorchOn(next);
  }

  function startCloseup(part: SweepPartView) {
    setCloseupHint(part.category);
    showFeedback(`Close-up: point at the ${part.category} label, then tap Read label`, "review");
  }

  // Tapping a box on the camera view picks the smallest detected part under the finger
  function handleCameraTap(event: MouseEvent<HTMLDivElement>) {
    if (boxesStale) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const tapX = (event.clientX - bounds.left) / bounds.width;
    const tapY = (event.clientY - bounds.top) / bounds.height;
    const tapped = sweepParts
      .filter((part) => tapX >= part.box.x && tapX <= part.box.x + part.box.width && tapY >= part.box.y && tapY <= part.box.y + part.box.height)
      .sort((first, second) => first.box.width * first.box.height - second.box.width * second.box.height)[0];
    if (tapped) startCloseup(tapped);
  }

  async function addSweptPart(part: SweepPartView) {
    const unit = await saveUnit({
      partType: part.category,
      serial: part.serial,
      partNumber: part.partNumber,
      manufacturer: part.manufacturer,
      description: part.familyGuess,
      identifiedBy: part.partNumber ? "label-read" : "visual",
      partNumberRead: Boolean(part.partNumber),
      evidence: part.printedText.filter((printed) => printed.readFromImage).map((printed) => printed.text).join(" | ") || part.familyGuess,
      searchQuery: part.searchQuery,
      estimatedPriceUsd: part.estimatedPriceUsd,
    });
    if (unit) {
      setSweepParts((previous) => previous.map((listed) => (listed.index === part.index ? { ...listed, unitId: unit.id, duplicate: unit.duplicate === true } : listed)));
    }
  }

  async function confirmRepeat() {
    if (!pendingRepeat) return;
    const label = pendingRepeat;
    setPendingRepeat(null);
    await saveUnit(labelRequest(label));
  }

  async function handleFakeScan(event: FormEvent) {
    event.preventDefault();
    const text = fakeScanInput.trim();
    setFakeScanInput("");
    if (!text) {
      await saveUnit({ partType: partType !== "AUTO" ? partType : "OTHER", serial: null, identifiedBy: "barcode" });
      return;
    }
    // Codes separated by | are treated as stacked on one label
    const codes = text.split(/\s*\|\s*/).map((codeText, index) => ({ text: codeText, box: { x: 0, y: index * 30, width: 200, height: 24 } }));
    const labels = groupCodesIntoLabels(codes);
    if (!labels.length) {
      showFeedback(`Not a part number or serial: ${text}`, "error");
      return;
    }
    for (const label of labels) await processLabel(label);
  }

  return (
    <main className="screen screen-scan">
      <a href="/" className="back">← Home</a>
      <h1>Scanning</h1>
      <div className="session-header-row">
        <p className="session-line" data-testid="session-line">{session.assetTag} · {modelText}</p>
        <button type="button" className="btn-link" onClick={onRescanTag} data-testid="rescan-tag-btn">Wrong server? Rescan tag</button>
      </div>

      <div className="part-type-row" aria-label="Part type override">
        {PART_TYPES.map((type) => (
          <button
            key={type}
            className={`part-btn${partType === type ? " part-btn-active" : ""}`}
            onClick={() => setPartType(type)}
            data-testid={`part-type-${type}`}
          >
            {type === "AUTO" ? "Auto" : type}
          </button>
        ))}
      </div>

      {isFeedMode ? (
        <div className="feed-mode" data-testid="feed-mode">
          <p className="muted">Test feed mode: inject barcodes (separate codes on one label with |) or run a mock vision reading.</p>
          <form className="feed-form" onSubmit={handleFakeScan}>
            <input
              className="field-input"
              type="text"
              value={fakeScanInput}
              onChange={(event) => setFakeScanInput(event.target.value)}
              placeholder="Serial, part number, or blank for no-serial"
              data-testid="fake-scan-input"
            />
            <button className="btn-primary" type="submit" data-testid="inject-scan-btn">Inject scan</button>
          </form>
          <label className="feed-fixture">
            Mock reading
            <select className="field-input" value={mockFixture} onChange={(event) => setMockFixture(event.target.value)} data-testid="mock-fixture">
              {MOCK_FIXTURES.map((fixtureName) => <option key={fixtureName} value={fixtureName}>{fixtureName}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <div className="camera-wrap" onClick={handleCameraTap}>
          {cameraError ? (
            <p className="form-error camera-error">{cameraError}</p>
          ) : (
            <>
              <video ref={videoRef} className="camera-video" autoPlay playsInline muted />
              <canvas ref={overlayRef} className="camera-overlay" />
            </>
          )}
        </div>
      )}

      <div className="scan-actions">
        <button className="btn-primary" onClick={() => void runSweep()} disabled={busy !== null} data-testid="sweep-btn">
          {busy === "sweep" ? "Analyzing…" : "Analyze view"}
        </button>
        <button className="btn-secondary btn-large" onClick={() => void runCloseup()} disabled={busy !== null} data-testid="closeup-btn">
          {busy === "closeup" ? "Reading…" : closeupHint ? `Read ${closeupHint} label` : "Read label"}
        </button>
        {!isFeedMode && (
          <label className="toggle">
            <input type="checkbox" checked={autoSweep} onChange={(event) => setAutoSweep(event.target.checked)} data-testid="auto-sweep" />
            Auto-analyze when steady
          </label>
        )}
        {torchAvailable && (
          <button className="btn-secondary" onClick={() => void toggleTorch()} data-testid="torch-btn">{torchOn ? "Torch off" : "Torch on"}</button>
        )}
      </div>

      {feedback && (
        <div className={`scan-feedback scan-feedback-${feedback.kind}`} role="status" data-testid="scan-feedback">
          {feedback.text}
        </div>
      )}

      {sweepParts.length > 0 && (
        <section className="sweep-list" data-testid="sweep-list">
          <h2 className="recent-heading">Found in this view ({sweepParts.length})</h2>
          {boxesStale && !isFeedMode && <p className="muted-inline" data-testid="boxes-hidden">Camera moved: boxes hidden. Tap a part below.</p>}
          <ul className="unit-list">
            {sweepParts.map((part) => (
              <li key={part.index} className="unit-row sweep-row" data-testid="sweep-part">
                <span className="swatch" style={{ background: partColor(part) }} aria-hidden="true" />
                <span className="sweep-part-text">
                  <span className="sweep-part-name" data-testid="sweep-part-description">{partDescription(part)}</span>
                  <span className="muted-inline">
                    {part.unitId ? (part.duplicate ? "already recorded" : "added") : "seen: not read yet"}
                    {part.lookup && (
                      <span data-testid="sweep-part-price"> · {formatPrice(part.lookup.priceMin, part.lookup.priceMax)} ({PRICE_SOURCE_LABEL[part.lookup.source] ?? part.lookup.source})</span>
                    )}
                  </span>
                </span>
                {!part.unitId && (
                  <span className="row-actions">
                    <button className="btn-secondary btn-small" onClick={() => startCloseup(part)} data-testid="sweep-closeup-btn">Read label</button>
                    <button className="btn-secondary btn-small" onClick={() => void addSweptPart(part)} data-testid="sweep-add-btn">Add by look</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingRepeat && (
        <div className="repeat-prompt" data-testid="repeat-prompt">
          <span>{pendingRepeat.partNumber} again with no serial. Another identical part?</span>
          <button className="btn-primary" onClick={() => void confirmRepeat()} data-testid="repeat-add-btn">Add another</button>
          <button className="btn-secondary" onClick={() => setPendingRepeat(null)}>Same part</button>
        </div>
      )}

      {resultCards.length > 0 && (
        <section className="result-cards" data-testid="result-cards">
          <div className="result-cards-header">
            <h2 className="recent-heading">Results ({resultCards.length})</h2>
            <button type="button" className="btn-secondary btn-small" onClick={() => setResultCards([])} data-testid="clear-results-btn">Clear</button>
          </div>
          {resultCards.map((card) => <ComponentCard key={card.id} unit={card} />)}
        </section>
      )}
    </main>
  );
}
