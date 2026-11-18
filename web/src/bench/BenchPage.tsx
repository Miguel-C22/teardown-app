import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface Session {
  id: string;
  assetTag: string;
  model: string;
  createdAt: string;
}

interface SessionWithUnits extends Session {
  units: Array<{ partType: string; serial: string | null; status: string }>;
}

export function BenchPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data) => { setSessions(data as Session[]); setLoading(false); })
      .catch(() => { setError("Failed to load sessions"); setLoading(false); });
  }, []);

  async function downloadCsv(session: Session) {
    const response = await fetch(`/api/sessions/${session.id}/export.csv`);
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `teardown-${session.assetTag}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function fetchSession(id: string): Promise<SessionWithUnits> {
    const r = await fetch(`/api/sessions/${id}`);
    return r.json() as Promise<SessionWithUnits>;
  }

  const [expanded, setExpanded] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionWithUnits | null>(null);

  async function toggleDetail(id: string) {
    if (expanded === id) {
      setExpanded(null);
      setSessionDetail(null);
      return;
    }
    setExpanded(id);
    const detail = await fetchSession(id);
    setSessionDetail(detail);
  }

  return (
    <main className="screen">
      <Link to="/" className="back">← Home</Link>
      <p className="eyebrow">Bench</p>
      <h1>Sessions</h1>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="form-error">{error}</p>}

      {!loading && sessions.length === 0 && (
        <p className="muted">No sessions yet. <Link to="/scan">Start a teardown</Link>.</p>
      )}

      <ul className="session-list" data-testid="session-list">
        {sessions.map((session) => (
          <li key={session.id} className="session-card">
            <div className="session-header">
              <div className="session-info">
                <strong className="session-asset" data-testid="session-asset-tag">{session.assetTag}</strong>
                <span className="session-model muted">{session.model}</span>
                <span className="session-date muted">{new Date(session.createdAt).toLocaleString()}</span>
              </div>
              <div className="session-actions">
                <button
                  className="btn-secondary"
                  onClick={() => void toggleDetail(session.id)}
                  data-testid={`expand-session-${session.id}`}
                >
                  {expanded === session.id ? "Hide" : "View"}
                </button>
                <button
                  className="btn-primary"
                  onClick={() => void downloadCsv(session)}
                  data-testid={`export-btn-${session.id}`}
                >
                  Export CSV
                </button>
              </div>
            </div>

            {expanded === session.id && sessionDetail?.id === session.id && (
              <ul className="unit-list" data-testid="unit-list">
                {sessionDetail.units.length === 0 && (
                  <li className="muted" style={{ padding: "8px 0" }}>No units recorded.</li>
                )}
                {sessionDetail.units.map((unit, index) => (
                  <li key={index} className={`unit-row unit-${unit.status}`}>
                    <span className="unit-type">{unit.partType}</span>
                    <span className="unit-serial">{unit.serial ?? "(no serial)"}</span>
                    <span className={`unit-badge unit-badge-${unit.status}`}>{unit.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
