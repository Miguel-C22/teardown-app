import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CameraScanner, type ScannedUnit } from "./CameraScanner";

interface ActiveSession {
  id: string;
  assetTag: string;
  model: string;
}

export function ScanPage() {
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [units, setUnits] = useState<ScannedUnit[]>([]);
  const [searchParams] = useSearchParams();

  const feedMode = import.meta.env.DEV ? searchParams.get("feed") ?? undefined : undefined;

  useEffect(() => {
    const now = new Date();
    const label = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetTag: label, model: "Quick scan" }),
    })
      .then((r) => r.json())
      .then((s) => setSession(s as ActiveSession))
      .catch(() => {/* camera error shown by CameraScanner */});
  }, []);

  if (!session) {
    return (
      <main className="screen">
        <a href="/" className="back">← Home</a>
        <p className="muted">Starting camera…</p>
      </main>
    );
  }

  return (
    <>
      <CameraScanner
        sessionId={session.id}
        onUnit={(unit) => setUnits((prev) => [unit, ...prev])}
        feedMode={feedMode}
      />
      {units.length > 0 && (
        <section className="screen recent-units">
          <h2 className="recent-heading">Scanned ({units.length})</h2>
          <ul className="unit-list">
            {units.slice(0, 20).map((unit, index) => (
              <li key={index} className={`unit-row unit-${unit.status}`}>
                <span className="unit-type">{unit.partType}</span>
                <span className="unit-serial">{unit.serial ?? "(no serial)"}</span>
                <span className={`unit-badge unit-badge-${unit.status}`}>{unit.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
