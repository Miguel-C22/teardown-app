import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { StartScreen } from "./StartScreen";
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

  if (!session) {
    return <StartScreen onSessionCreated={setSession} />;
  }

  return (
    <>
      <CameraScanner
        sessionId={session.id}
        assetTag={session.assetTag}
        onUnit={(unit) => setUnits((prev) => [unit, ...prev])}
        feedMode={feedMode}
      />
      {units.length > 0 && (
        <section className="screen recent-units">
          <h2 className="recent-heading">Recent scans</h2>
          <ul className="unit-list">
            {units.slice(0, 10).map((unit, index) => (
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
