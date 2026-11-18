import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { pickServerTag } from "@shared/barcodeClassify";
import { postJson, type SessionInfo } from "../api";
import { decodeFrame, initZxing } from "./zxing";

interface StartScreenProps {
  onSessionCreated: (session: SessionInfo) => void;
  feedMode?: string;
}

// Frames in a row that must agree on the tag before a session starts, so a half-read code can't start one
const FRAMES_TO_CONFIRM = 2;

// Live camera that keeps reading until the server's own tag is in view
function TagCamera({ onTag }: { onTag: (tag: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onTagRef = useRef(onTag);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => { onTagRef.current = onTag; }, [onTag]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: number | null = null;
    let lastTag: string | null = null;
    let matchingFrames = 0;
    const canvas = document.createElement("canvas");

    async function readFrame() {
      const video = videoRef.current;
      if (stopped) return;
      if (video && video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(video, 0, 0);
        const codes = await decodeFrame(context.getImageData(0, 0, canvas.width, canvas.height)).catch(() => []);
        const tag = pickServerTag(codes.map((code) => code.text));
        matchingFrames = tag && tag === lastTag ? matchingFrames + 1 : tag ? 1 : 0;
        lastTag = tag;
        if (tag && matchingFrames >= FRAMES_TO_CONFIRM) {
          onTagRef.current(tag);
          return;
        }
      }
      timer = window.setTimeout(() => void readFrame(), 150);
    }

    initZxing()
      .then(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } } }))
      .then(async (mediaStream) => {
        stream = mediaStream;
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
        void readFrame();
      })
      .catch(() => setCameraError("Camera unavailable. Allow camera access, or start without a tag below."));

    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  if (cameraError) return <p className="form-error camera-error">{cameraError}</p>;
  return (
    <div className="camera-wrap tag-camera">
      <video ref={videoRef} className="camera-video" autoPlay playsInline muted />
    </div>
  );
}

export function StartScreen({ onSessionCreated, feedMode }: StartScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typedTag, setTypedTag] = useState("");
  const [fakeCodes, setFakeCodes] = useState("");
  const startedRef = useRef(false);

  const startSession = useCallback(async (assetTag: string) => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStarting(assetTag);
    setError(null);
    navigator.vibrate?.(80);
    try {
      onSessionCreated(await postJson<SessionInfo>("/api/sessions", { assetTag }));
    } catch (startError) {
      startedRef.current = false;
      setStarting(null);
      setError(startError instanceof Error ? startError.message : "Failed to start session");
    }
  }, [onSessionCreated]);

  function handleFakeScan(event: FormEvent) {
    event.preventDefault();
    const tag = pickServerTag(fakeCodes.split("|").map((code) => code.trim()).filter(Boolean));
    if (tag) void startSession(tag);
    else setError("No server tag in those codes");
  }

  function handleTypedTag(event: FormEvent) {
    event.preventDefault();
    if (typedTag.trim()) void startSession(typedTag.trim().toUpperCase());
  }

  return (
    <main className="screen">
      <a href="/" className="back">← Home</a>
      <p className="eyebrow">New teardown</p>
      <h1>Scan the server</h1>
      <p className="muted" data-testid="start-prompt">
        {starting ? `Starting ${starting}…` : "Point at the server's service tag. Scanning starts as soon as it's read."}
      </p>

      {!starting && (feedMode ? (
        <form className="feed-mode feed-form" onSubmit={handleFakeScan} data-testid="tag-feed">
          <input
            className="field-input"
            type="text"
            value={fakeCodes}
            onChange={(event) => setFakeCodes(event.target.value)}
            placeholder="Codes in view, separated by |"
            data-testid="fake-tag-input"
          />
          <button className="btn-primary" type="submit" data-testid="inject-tag-btn">Inject scan</button>
        </form>
      ) : (
        <TagCamera onTag={(tag) => void startSession(tag)} />
      ))}

      {error && <p className="form-error" role="alert">{error}</p>}

      {!starting && (
        <div className="start-fallbacks">
          <button type="button" className="btn-link" onClick={() => void startSession(`UNTAGGED-${Date.now().toString(36).toUpperCase()}`)} data-testid="start-untagged-btn">
            No tag? Start without one
          </button>
          {!typing && <button type="button" className="btn-link" onClick={() => setTyping(true)} data-testid="type-tag-btn">Type it</button>}
        </div>
      )}
      {typing && !starting && (
        <form className="field-row" onSubmit={handleTypedTag}>
          <input className="field-input" type="text" value={typedTag} onChange={(event) => setTypedTag(event.target.value)} placeholder="Service tag" autoFocus data-testid="asset-tag-input" />
          <button className="btn-primary" type="submit" data-testid="start-session-btn">Start</button>
        </form>
      )}
    </main>
  );
}
