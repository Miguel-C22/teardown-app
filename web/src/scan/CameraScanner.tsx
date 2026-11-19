import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { classifyCode } from "@shared/barcodeClassify";
import { type ScanRecord, checkScan, COOLDOWN_MS } from "@shared/dedup";
import { groupCodesIntoLabels, type DecodedCode, type LabelGroup } from "@shared/labelGroup";
import { CATEGORY_LABEL, PART_CATEGORIES } from "@shared/partCategory";
import { confirmRead, createSightingLog } from "@shared/readConfirm";
import { isHighValue, type IdentifiedBy } from "@shared/recommend";
import { mergeWalkFrame } from "@shared/walkMerge";
import {
  OfflineError, PRICE_SOURCE_LABEL, formatPrice, postJson, type NewUnitRequest, type SessionInfo, type SessionSummary, type SweepPartView,
  type SweepResponse, type UnitView,
} from "../api";
import { ComponentCard } from "./ComponentCard";
import { SWEEP_STILL_EDGE, captureStill, frameSignature, signatureDifference } from "./capture";
import { enqueuePending, flushPending, pendingCount } from "./offlineQueue";
import { captureRegion, centreRegion, ocrTextToCodes, readText, warmUpOcr } from "./ocr";
import { FAST_DECODE_EDGE, decodeFrame, grabFrame, initZxing, scaleCodes } from "./zxing";

interface ScanFeedback {
  text: string;
  kind: "new" | "duplicate" | "cooldown" | "review" | "error";
}

interface CameraScannerProps {
  session: SessionInfo;
  summary: SessionSummary | null;
  onUnit: (unit: UnitView) => void;
  onUnitRemoved: (unitId: string) => void;
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
// Sticker text is read in the background every couple of seconds while the phone moves, skipping only fast sweeps (too blurry)
const MIN_MS_BETWEEN_OCR = 2_000;
const QUIET_AFTER_BARCODE_MS = 1_000;
// Signature difference above which the frame is too blurred to read text
const TOO_FAST_FOR_TEXT = 30;
// Two empty text reads while held still on one spot mean the free steps can't read it, so Find with AI is suggested
const EMPTY_OCR_READS_BEFORE_AI_HINT = 2;
// Sticker text has to read the same way twice; OCR runs every few seconds, so its window is longer than for barcodes
const OCR_CONFIRM_WINDOW_MS = 12_000;
const MOCK_FIXTURES = ["default", "next-area", "cooler", "unreadable", "invented"];
// After this many fast passes with nothing found, one slower full-size pass looks for small or far-away barcodes
const FAST_PASSES_BEFORE_FULL_PASS = 4;
const RAW_CODES_SHOWN = 12;
const PENDING_RETRY_MS = 5_000;

const GUIDANCE = {
  point: "Move over the parts. Barcodes and labels are read as you go",
  reading: "Move over the parts. Reading label text…",
  checking: "Found label text, checking it once more…",
  unreadable: "Couldn't read this spot. Move closer or add light, or use Find with AI",
} as const;

interface RawCode {
  text: string;
  source: string;
}

function vibrate(pattern: number | number[]): void {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}

// A label is identified by what it carries; the same key read twice within a moment confirms it
function labelKey(label: LabelGroup): string {
  return `${label.partNumber ?? ""}|${label.serial ?? ""}`;
}

// What the AI saw, in plain words: "DIMM · Samsung · 32GB DDR4 RDIMM"
function partDescription(part: SweepPartView): string {
  const name = part.partNumber ?? part.familyGuess ?? "unidentified";
  return [part.category, part.manufacturer, name].filter(Boolean).join(" · ");
}

function partColor(part: SweepPartView): string {
  if (part.unitId || (part.partNumber && part.lookup)) return "#2f9d5f";
  if (part.needsCloseUp || !part.partNumber) return "#e0ab52";
  return "#9aa7ae";
}

export function CameraScanner({ session, summary, onUnit, onUnitRemoved, onSessionUpdate, feedMode, modelText, onRescanTag }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const recentScansRef = useRef<ScanRecord[]>([]);
  const aiPartsRef = useRef<SweepPartView[]>([]);
  const aiFrameIndexesRef = useRef<number[]>([]);
  const busyRef = useRef(false);
  const feedbackTimerRef = useRef<number | null>(null);
  const barcodeSightingsRef = useRef(createSightingLog());
  const ocrSightingsRef = useRef(createSightingLog());
  // Serials whose sticker text was already read for a missing part number
  const ocrTriedSerialsRef = useRef(new Set<string>());
  const guidanceRef = useRef<string>(GUIDANCE.point);

  const [partType, setPartType] = useState("AUTO");
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [guidance, setGuidance] = useState<string>(GUIDANCE.point);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [fakeScanInput, setFakeScanInput] = useState("");
  const [mockFixture, setMockFixture] = useState("default");
  // Every part found stays on screen, newest first, until the tech taps Clear
  const [resultCards, setResultCards] = useState<UnitView[]>([]);
  const [aiParts, setAiParts] = useState<SweepPartView[]>([]);
  const [pendingRepeat, setPendingRepeat] = useState<LabelGroup | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  // Set when the free steps couldn't read the current view, so the AI button stands out
  const [aiSuggested, setAiSuggested] = useState(false);
  const [aiCostUsd, setAiCostUsd] = useState(0);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  // What the decoder and OCR actually saw, so misreads can be reported with the exact text
  const [showRawCodes, setShowRawCodes] = useState(false);
  const [rawCodes, setRawCodes] = useState<RawCode[]>([]);
  const showRawCodesRef = useRef(false);
  const [pendingSaves, setPendingSaves] = useState(() => pendingCount(session.id));
  const [doneOpen, setDoneOpen] = useState(false);

  const isFeedMode = feedMode !== undefined && import.meta.env.DEV;

  useEffect(() => { aiPartsRef.current = aiParts; }, [aiParts]);
  useEffect(() => { showRawCodesRef.current = showRawCodes; }, [showRawCodes]);
  useEffect(() => { if (summary) setAiCostUsd(summary.visionUsage.costUsd); }, [summary]);

  const updateGuidance = useCallback((text: string) => {
    if (guidanceRef.current === text) return;
    guidanceRef.current = text;
    setGuidance(text);
  }, []);

  const noteRawCodes = useCallback((entries: RawCode[]) => {
    if (!showRawCodesRef.current || !entries.length) return;
    setRawCodes((previous) => {
      const merged = [...entries, ...previous.filter((old) => !entries.some((entry) => entry.text === old.text))];
      return merged.slice(0, RAW_CODES_SHOWN);
    });
  }, []);

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
      // No signal: keep the read on the phone and send it when the connection is back
      if (saveError instanceof OfflineError) {
        setPendingSaves(enqueuePending(session.id, request));
        showFeedback("No connection: saved on the phone, will sync", "review");
        return null;
      }
      showFeedback(saveError instanceof Error ? saveError.message : "Could not save", "error");
      return null;
    }
  }, [session.id, announceUnit, showFeedback]);

  // Retries queued saves every few seconds and as soon as the phone reports it is back online
  useEffect(() => {
    let flushing = false;
    const flush = async () => {
      if (flushing || pendingCount(session.id) === 0) return;
      flushing = true;
      const remaining = await flushPending(session.id, async (request) => {
        try {
          const unit = await postJson<UnitView>(`/api/sessions/${session.id}/units`, request);
          announceUnit(unit, unit.duplicate === true);
          return "sent";
        } catch (retryError) {
          // A server rejection won't fix itself, so it is dropped rather than retried forever
          return retryError instanceof OfflineError ? "offline" : "sent";
        }
      });
      setPendingSaves(remaining);
      flushing = false;
    };
    void flush();
    const timer = window.setInterval(() => void flush(), PENDING_RETRY_MS);
    window.addEventListener("online", flush);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", flush);
    };
  }, [session.id, announceUnit]);

  const labelRequest = useCallback((label: LabelGroup, identifiedBy: IdentifiedBy = "barcode"): NewUnitRequest => ({
    partType: partType !== "AUTO" ? partType : label.categoryHint ?? "AUTO",
    serial: label.serial,
    partNumber: label.partNumber,
    manufacturer: label.manufacturerHint,
    identifiedBy,
    evidence: label.codes.map((code) => code.text).join(" | "),
  }), [partType]);

  // A label with a serial is one unit; a part-number-only label asks before adding a second identical part
  const processLabel = useCallback(async (label: LabelGroup, identifiedBy: IdentifiedBy = "barcode") => {
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
    setAiSuggested(false);
    // Instant on-phone confirmation; the price and recommendation follow when the server answers
    vibrate(30);
    showFeedback(`Read: ${[label.categoryHint, label.partNumber, label.serial].filter(Boolean).join(" ")}`, "new");
    await saveUnit(labelRequest(label, identifiedBy));
  }, [labelRequest, saveUnit, showFeedback]);

  // Sticker text becomes a part only once two separate reads agree; returns how the read went
  const handleOcrText = useCallback(async (text: string, requireConfirmation: boolean): Promise<"recorded" | "checking" | "nothing"> => {
    noteRawCodes(text.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => ({ text: line, source: "OCR" })));
    const labels = groupCodesIntoLabels(ocrTextToCodes(text));
    if (!labels.length) return "nothing";
    let recorded = false;
    for (const label of labels) {
      if (requireConfirmation && !confirmRead(ocrSightingsRef.current, labelKey(label), Date.now(), 2, OCR_CONFIRM_WINDOW_MS)) continue;
      await processLabel(label, "ocr");
      recorded = true;
    }
    return recorded ? "recorded" : "checking";
  }, [noteRawCodes, processLabel]);

  // Find with AI: one look at the current view; results build up across presses without repeats
  const findWithAi = useCallback(async () => {
    if (busyRef.current) return;
    const still = isFeedMode ? null : videoRef.current ? captureStill(videoRef.current, SWEEP_STILL_EDGE) : null;
    if (!isFeedMode && !still) return;
    busyRef.current = true;
    setAiBusy(true);
    try {
      const sweep = await postJson<SweepResponse>(`/api/sessions/${session.id}/vision/sweep`, {
        image: still?.base64, mediaType: still?.mediaType, fixture: isFeedMode ? mockFixture : undefined,
      });
      const merged = mergeWalkFrame(aiPartsRef.current, aiFrameIndexesRef.current, sweep.parts);
      aiFrameIndexesRef.current = merged.frameIndexes;
      aiPartsRef.current = merged.parts;
      setAiParts(merged.parts);
      setAiSuggested(false);
      onSessionUpdate(sweep.session);
      setAiCostUsd(sweep.session.visionUsage.costUsd);
      // Parts whose part number and serial the AI read in full are recorded by the server straight away
      const recordedNow = sweep.parts.filter((part) => part.unitId && !part.duplicate);
      for (const part of recordedNow) {
        const unit = sweep.session.units.find((sessionUnit) => sessionUnit.id === part.unitId);
        if (unit) announceUnit(unit, false);
      }
      if (sweep.parts.some((part) => isHighValue(part.lookup?.priceMax ?? null))) vibrate([80, 60, 80]);
      const waiting = merged.parts.filter((part) => !part.unitId).length;
      showFeedback(sweep.parts.length
        ? `AI found ${merged.addedCount} new part${merged.addedCount === 1 ? "" : "s"} (${merged.parts.length} so far). ${recordedNow.length} recorded, ${waiting} to add.`
        : "AI found no parts in this view", waiting ? "review" : "new");
    } catch (aiError) {
      showFeedback(aiError instanceof Error ? aiError.message : "AI request failed", "error");
    } finally {
      busyRef.current = false;
      setAiBusy(false);
    }
  }, [isFeedMode, mockFixture, session.id, onSessionUpdate, announceUnit, showFeedback]);

  // Latest callbacks for the frame loop, which lives outside React's render cycle
  const processLabelRef = useRef(processLabel);
  const saveUnitRef = useRef(saveUnit);
  const labelRequestRef = useRef(labelRequest);
  const noteRawCodesRef = useRef(noteRawCodes);
  const handleOcrTextRef = useRef(handleOcrText);
  useEffect(() => { processLabelRef.current = processLabel; }, [processLabel]);
  useEffect(() => { saveUnitRef.current = saveUnit; }, [saveUnit]);
  useEffect(() => { labelRequestRef.current = labelRequest; }, [labelRequest]);
  useEffect(() => { noteRawCodesRef.current = noteRawCodes; }, [noteRawCodes]);
  useEffect(() => { handleOcrTextRef.current = handleOcrText; }, [handleOcrText]);

  useEffect(() => {
    if (feedMode !== undefined) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: number | null = null;
    const workCanvas = document.createElement("canvas");
    const signatureCanvas = document.createElement("canvas");
    let previousSignature: Uint8ClampedArray | null = null;
    let steadySince: number | null = null;
    let emptyFastPasses = 0;
    let lastBarcodeAt = 0;
    // Background sticker reading; a spot held still that reads empty twice is left alone until the phone moves
    let ocrRunning = false;
    let lastOcrAt = 0;
    let spotGivenUp = false;
    let emptyReadsHeldStill = 0;

    function drawOverlay(codes: DecodedCode[], width: number, height: number) {
      const overlay = overlayRef.current;
      if (!overlay) return;
      overlay.width = width;
      overlay.height = height;
      const context = overlay.getContext("2d")!;
      context.clearRect(0, 0, width, height);
      context.lineWidth = Math.max(3, width / 300);
      context.strokeStyle = "#4cc3d6";
      for (const code of codes) context.strokeRect(code.box.x, code.box.y, code.box.width, code.box.height);
    }

    // Tier 1 without a tap: read the label text in view in the background, while the phone keeps moving
    function readStickerAutomatically(video: HTMLVideoElement, heldStill: boolean) {
      ocrRunning = true;
      lastOcrAt = Date.now();
      updateGuidance(GUIDANCE.reading);
      void readText(captureRegion(video, centreRegion(video, 0.85)))
        .then((text) => handleOcrTextRef.current(text, true))
        .then((outcome) => {
          if (outcome === "recorded") {
            emptyReadsHeldStill = 0;
            updateGuidance(GUIDANCE.point);
          } else if (outcome === "checking") {
            updateGuidance(GUIDANCE.checking);
          } else if (heldStill) {
            emptyReadsHeldStill += 1;
            if (emptyReadsHeldStill >= EMPTY_OCR_READS_BEFORE_AI_HINT) {
              spotGivenUp = true;
              setAiSuggested(true);
              updateGuidance(GUIDANCE.unreadable);
            }
          } else {
            updateGuidance(GUIDANCE.point);
          }
        })
        .catch(() => updateGuidance(GUIDANCE.point))
        .finally(() => { ocrRunning = false; });
    }

    async function processFrame() {
      const video = videoRef.current;
      if (stopped) return;
      if (video && video.videoWidth > 0) {
        const { videoWidth: width, videoHeight: height } = video;
        // Fast pass on a shrunken frame; every few empty passes, one full-size careful pass for small or distant codes
        const fullPass = emptyFastPasses >= FAST_PASSES_BEFORE_FULL_PASS;
        const frame = grabFrame(video, workCanvas, fullPass ? Math.max(width, height) : FAST_DECODE_EDGE);
        const codes = scaleCodes(await decodeFrame(frame.imageData, fullPass).catch(() => [] as DecodedCode[]), frame.scale);
        emptyFastPasses = codes.length || fullPass ? 0 : emptyFastPasses + 1;
        noteRawCodesRef.current(codes.map((code) => ({ text: code.text, source: code.format ?? "" })));

        const signature = frameSignature(workCanvas, signatureCanvas);
        const difference = signatureDifference(previousSignature, signature);
        previousSignature = signature;
        const now = Date.now();
        if (difference > MOVED_DIFFERENCE) {
          // A new spot: anything given up on before gets another chance
          steadySince = null;
          spotGivenUp = false;
          emptyReadsHeldStill = 0;
          if (!ocrRunning && guidanceRef.current === GUIDANCE.unreadable) updateGuidance(GUIDANCE.point);
        } else if (difference < STEADY_DIFFERENCE) {
          steadySince ??= now;
        }
        if (codes.length) lastBarcodeAt = now;

        // Label text is read in the background while moving; only a very fast sweep (blurred) or a barcode just read skips it
        const barcodeJustRead = now - lastBarcodeAt < QUIET_AFTER_BARCODE_MS;
        if (difference < TOO_FAST_FOR_TEXT && !barcodeJustRead && !spotGivenUp && !ocrRunning && now - lastOcrAt >= MIN_MS_BETWEEN_OCR) {
          readStickerAutomatically(video, steadySince !== null);
        }

        drawOverlay(codes, width, height);
        // A barcode counts only once two frames in a row read it the same way; saves run in the background
        for (const label of groupCodesIntoLabels(codes)) {
          if (!confirmRead(barcodeSightingsRef.current, labelKey(label), now)) continue;
          void processLabelRef.current(label);
          if (label.serial && !label.partNumber) readMissingPartNumber(video, label);
        }
      }
      timer = window.setTimeout(() => void processFrame(), FRAME_INTERVAL_MS);
    }

    // A label whose barcodes gave only a serial often prints the part number as text: read the area around it once
    function readMissingPartNumber(video: HTMLVideoElement, label: LabelGroup) {
      const serial = label.serial!;
      if (ocrTriedSerialsRef.current.has(serial)) return;
      ocrTriedSerialsRef.current.add(serial);
      const margin = Math.max(label.box.width, label.box.height) * 1.5;
      const region = {
        x: Math.max(0, label.box.x - margin), y: Math.max(0, label.box.y - margin),
        width: Math.min(video.videoWidth, label.box.width + margin * 2), height: Math.min(video.videoHeight, label.box.height + margin * 2),
      };
      void readText(captureRegion(video, region))
        .then((text) => {
          const partNumber = groupCodesIntoLabels(ocrTextToCodes(text)).find((ocrLabel) => ocrLabel.partNumber)?.partNumber;
          // Only a part number that matches a known manufacturer format is trusted from a single read
          if (!partNumber || classifyCode(partNumber).kind !== "partNumber") return;
          // The server fills the part number into the unit already recorded under this serial
          void saveUnitRef.current({ ...labelRequestRef.current(label, "ocr"), partNumber });
        })
        .catch(() => undefined);
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
        warmUpOcr();
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
  }, [feedMode, updateGuidance]);

  async function toggleTorch() {
    const track = trackRef.current;
    if (!track) return;
    const next = !torchOn;
    await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] }).catch(() => undefined);
    setTorchOn(next);
  }

  function aiPartRequest(part: SweepPartView): NewUnitRequest {
    return {
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
    };
  }

  async function addAiPart(part: SweepPartView) {
    const unit = await saveUnit(aiPartRequest(part));
    if (unit) {
      setAiParts((previous) => previous.map((listed) => (listed.index === part.index ? { ...listed, unitId: unit.id, duplicate: unit.duplicate === true } : listed)));
    }
  }

  async function addAllAiParts() {
    for (const part of aiPartsRef.current.filter((listed) => !listed.unitId)) await addAiPart(part);
  }

  async function removeUnit(unit: UnitView) {
    try {
      const response = await fetch(`/api/sessions/${session.id}/units/${unit.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not remove it");
      const body = await response.json() as { session: SessionSummary };
      setResultCards((previous) => previous.filter((card) => card.id !== unit.id));
      // The same label can be scanned again straight away after a wrong read is removed
      recentScansRef.current = recentScansRef.current.filter((record) => record.serial !== unit.serial && record.serial !== `part:${unit.partNumber}`);
      setAiParts((previous) => previous.map((listed) => (listed.unitId === unit.id ? { ...listed, unitId: null } : listed)));
      onUnitRemoved(unit.id);
      onSessionUpdate(body.session);
      showFeedback(`Removed ${unit.partType} ${unit.serial ?? unit.partNumber ?? ""}`.trim(), "review");
    } catch (removeError) {
      showFeedback(removeError instanceof Error ? removeError.message : "Could not remove it", "error");
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
    // "ocr:" feeds sticker text as if the phone had read it (already confirmed, as the test types it once)
    if (/^ocr:/i.test(text)) {
      const outcome = await handleOcrText(text.slice(4).replace(/\\n/g, "\n"), false);
      if (outcome === "nothing") {
        setAiSuggested(true);
        showFeedback(GUIDANCE.unreadable, "review");
      }
      return;
    }
    // Codes separated by | are treated as stacked on one label; "qr:" marks a code as a QR code
    const codes: DecodedCode[] = text.split(/\s*\|\s*/).map((codeText, index) => {
      const isQr = /^qr:/i.test(codeText);
      return { text: isQr ? codeText.slice(3).replace(/\\n/g, "\n") : codeText, format: isQr ? "QRCode" : "Code128", box: { x: 0, y: index * 30, width: 200, height: 24 } };
    });
    noteRawCodes(codes.map((code) => ({ text: code.text, source: code.format ?? "" })));
    const labels = groupCodesIntoLabels(codes);
    if (!labels.length) {
      showFeedback(`Not a part number or serial: ${text}`, "error");
      return;
    }
    for (const label of labels) await processLabel(label);
  }

  const gaps = (summary?.remaining ?? []).filter((row) => row.found < row.expected);
  const aiHighlighted = aiSuggested || gaps.length > 0;
  const totalValue = (summary?.units ?? []).reduce((sum, unit) => sum + (unit.priceMax ?? 0), 0);
  const waitingAiParts = aiParts.filter((part) => !part.unitId);

  return (
    <main className="screen screen-scan">
      <a href="/" className="back">← Home</a>
      <h1>Scanning</h1>
      <div className="session-header-row">
        <p className="session-line" data-testid="session-line">{session.assetTag} · {modelText}</p>
        <button type="button" className="btn-link" onClick={onRescanTag} data-testid="rescan-tag-btn">Wrong server? Rescan tag</button>
      </div>

      {isFeedMode ? (
        <div className="feed-mode" data-testid="feed-mode">
          <p className="muted">Test feed mode: inject barcodes (separate codes on one label with |, qr: for a QR code, ocr: for sticker text) or pick a mock AI reading.</p>
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
            Mock AI reading
            <select className="field-input" value={mockFixture} onChange={(event) => setMockFixture(event.target.value)} data-testid="mock-fixture">
              {MOCK_FIXTURES.map((fixtureName) => <option key={fixtureName} value={fixtureName}>{fixtureName}</option>)}
            </select>
          </label>
        </div>
      ) : (
        <div className="camera-wrap">
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

      <p className={`scan-guidance${guidance === GUIDANCE.unreadable ? " scan-guidance-warn" : ""}`} role="status" data-testid="scan-guidance">{guidance}</p>

      <div className="scan-actions">
        <button
          className={`${aiHighlighted ? "btn-primary" : "btn-secondary"} btn-large`}
          onClick={() => void findWithAi()}
          disabled={aiBusy}
          data-testid="ai-find-btn"
        >
          {aiBusy ? "AI is looking…" : "Find with AI"}
          <span className="ai-cost" data-testid="ai-cost"> · ${aiCostUsd.toFixed(2)} used</span>
        </button>
        <button className="btn-secondary btn-large" onClick={() => setDoneOpen(true)} data-testid="done-btn">Done</button>
      </div>

      <details className="scan-settings" data-testid="settings">
        <summary data-testid="settings-btn">⚙ Settings</summary>
        <label className="settings-row">
          Part type
          <select className="field-input" value={partType} onChange={(event) => setPartType(event.target.value)} data-testid="part-type-select">
            {PART_TYPES.map((type) => <option key={type} value={type}>{type === "AUTO" ? "Auto" : type}</option>)}
          </select>
        </label>
        {torchAvailable && (
          <button className="btn-secondary btn-small" onClick={() => void toggleTorch()} data-testid="torch-btn">{torchOn ? "Torch off" : "Torch on"}</button>
        )}
        <label className="toggle">
          <input type="checkbox" checked={showRawCodes} onChange={(event) => setShowRawCodes(event.target.checked)} data-testid="raw-codes-toggle" />
          Show raw codes
        </label>
      </details>

      {showRawCodes && (
        <section className="raw-codes" data-testid="raw-codes">
          <h2 className="recent-heading">Raw codes (newest first)</h2>
          {rawCodes.length === 0 ? <p className="muted-inline">Nothing read yet.</p> : (
            <ul className="raw-code-list">
              {rawCodes.map((rawCode) => (
                <li key={rawCode.text} data-testid="raw-code"><span className="raw-code-source">{rawCode.source}</span> <code>{rawCode.text}</code></li>
              ))}
            </ul>
          )}
        </section>
      )}

      {pendingSaves > 0 && (
        <p className="pending-badge" role="status" data-testid="pending-saves">{pendingSaves} waiting to sync</p>
      )}

      {feedback && (
        <div className={`scan-feedback scan-feedback-${feedback.kind}`} role="status" data-testid="scan-feedback">
          {feedback.text}
        </div>
      )}

      {doneOpen && (
        <section className="done-summary" data-testid="done-summary">
          <h2 className="recent-heading">Server {session.assetTag}</h2>
          <p><strong>{summary?.units.length ?? 0} part{summary?.units.length === 1 ? "" : "s"}</strong> · up to {formatPrice(null, totalValue)}</p>
          {gaps.length > 0
            ? <p className="gap-warning" data-testid="done-gaps">Still missing: {gaps.map((row) => `${row.expected - row.found} ${CATEGORY_LABEL[row.category]}`).join(", ")}</p>
            : <p className="muted-inline">Nothing missing from what was seen.</p>}
          <div className="row-actions">
            <button className="btn-primary" onClick={onRescanTag} data-testid="next-server-btn">Next server</button>
            <button className="btn-secondary" onClick={() => setDoneOpen(false)}>Keep scanning</button>
          </div>
        </section>
      )}

      {aiParts.length > 0 && (
        <section className="sweep-list" data-testid="sweep-list">
          <div className="result-cards-header">
            <h2 className="recent-heading">Found by AI ({aiParts.length})</h2>
            {waitingAiParts.length > 1 && (
              <button className="btn-secondary btn-small" onClick={() => void addAllAiParts()} data-testid="ai-add-all-btn">Add all ({waitingAiParts.length})</button>
            )}
          </div>
          <ul className="unit-list">
            {aiParts.map((part) => (
              <li key={part.index} className="unit-row sweep-row" data-testid="sweep-part">
                <span className="swatch" style={{ background: partColor(part) }} aria-hidden="true" />
                <span className="sweep-part-text">
                  <span className="sweep-part-name" data-testid="sweep-part-description">{partDescription(part)}</span>
                  <span className="muted-inline">
                    {part.unitId ? (part.duplicate ? "already recorded" : "added") : "not recorded yet"}
                    {part.lookup && (
                      <span data-testid="sweep-part-price"> · {formatPrice(part.lookup.priceMin, part.lookup.priceMax)} ({PRICE_SOURCE_LABEL[part.lookup.source] ?? part.lookup.source})</span>
                    )}
                  </span>
                </span>
                {!part.unitId && (
                  <button className="btn-secondary btn-small" onClick={() => void addAiPart(part)} data-testid="sweep-add-btn">Add</button>
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
          {resultCards.map((card) => <ComponentCard key={card.id} unit={card} onRemove={() => void removeUnit(card)} />)}
        </section>
      )}
    </main>
  );
}
