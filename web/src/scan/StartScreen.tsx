import { useState, type FormEvent } from "react";

interface StartScreenProps {
  onSessionCreated: (session: { id: string; assetTag: string; model: string }) => void;
}

export function StartScreen({ onSessionCreated }: StartScreenProps) {
  const [assetTag, setAssetTag] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetTag, model }),
      });
      if (!response.ok) {
        const body = await response.json() as { error: string };
        throw new Error(body.error);
      }
      const session = await response.json() as { id: string; assetTag: string; model: string };
      onSessionCreated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start session");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="screen">
      <a href="/" className="back">← Home</a>
      <p className="eyebrow">New teardown</p>
      <h1>Start Session</h1>
      <form className="start-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">Asset tag</span>
          <input
            className="field-input"
            type="text"
            value={assetTag}
            onChange={(e) => setAssetTag(e.target.value)}
            placeholder="SVR-001"
            required
            autoFocus
            data-testid="asset-tag-input"
          />
        </label>
        <label className="field">
          <span className="field-label">Model</span>
          <input
            className="field-input"
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="PowerEdge R740"
            required
            data-testid="model-input"
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn-primary" type="submit" disabled={submitting} data-testid="start-session-btn">
          {submitting ? "Starting…" : "Start scanning"}
        </button>
      </form>
    </main>
  );
}
