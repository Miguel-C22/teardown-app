import { useEffect, useRef, useState, type FormEvent } from "react";
import { postJson, type SessionInfo } from "../api";
import { decodeFrame, initZxing } from "./zxing";

interface StartScreenProps {
  onSessionCreated: (session: SessionInfo) => void;
}

const COMMON_MODELS = [
  "PowerEdge R640", "PowerEdge R740", "PowerEdge R740xd", "PowerEdge R650", "PowerEdge R750", "PowerEdge R630", "PowerEdge R730",
  "ProLiant DL360 Gen9", "ProLiant DL360 Gen10", "ProLiant DL380 Gen9", "ProLiant DL380 Gen10", "ThinkSystem SR650", "Supermicro 1029U",
];

// One-shot barcode reader for the server's service tag or serial
function TagScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => { onCodeRef.current = onCode; }, [onCode]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: number | null = null;
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
        if (codes.length > 0) {
          onCodeRef.current(codes[0].text);
          return;
        }
      }
      timer = window.setTimeout(() => void readFrame(), 150);
    }

    initZxing()
      .then(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }))
      .then(async (mediaStream) => {
        stream = mediaStream;
        if (stopped || !videoRef.current) return;
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play();
        void readFrame();
      })
      .catch(() => setScanError("Camera unavailable. Type the tag instead."));

    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="tag-scanner">
      {scanError ? <p className="form-error">{scanError}</p> : <video ref={videoRef} className="camera-video" autoPlay playsInline muted />}
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
    </div>
  );
}

export function StartScreen({ onSessionCreated }: StartScreenProps) {
  const [assetTag, setAssetTag] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanningTag, setScanningTag] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      onSessionCreated(await postJson<SessionInfo>("/api/sessions", { assetTag, model }));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to start session");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="screen">
      <a href="/" className="back">← Home</a>
      <p className="eyebrow">New teardown</p>
      <h1>Start Session</h1>
      <p className="muted">Scan or type the server's service tag, then pick its model. Every part found belongs to this server.</p>
      <form className="start-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">Service tag or serial</span>
          <span className="field-row">
            <input
              className="field-input"
              type="text"
              value={assetTag}
              onChange={(event) => setAssetTag(event.target.value)}
              placeholder="e.g. 7XK2Q53"
              required
              autoFocus
              data-testid="asset-tag-input"
            />
            <button type="button" className="btn-secondary" onClick={() => setScanningTag(true)} data-testid="scan-tag-btn">Scan</button>
          </span>
        </label>
        {scanningTag && (
          <TagScanner
            onCode={(code) => { setAssetTag(code); setScanningTag(false); }}
            onClose={() => setScanningTag(false)}
          />
        )}
        <label className="field">
          <span className="field-label">Model</span>
          <input
            className="field-input"
            type="text"
            list="server-models"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="PowerEdge R740"
            required
            data-testid="model-input"
          />
          <datalist id="server-models">
            {COMMON_MODELS.map((modelName) => <option key={modelName} value={modelName} />)}
          </datalist>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn-primary" type="submit" disabled={submitting} data-testid="start-session-btn">
          {submitting ? "Starting…" : "Start scanning"}
        </button>
      </form>
    </main>
  );
}
