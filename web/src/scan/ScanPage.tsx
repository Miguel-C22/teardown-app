import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CATEGORY_LABEL } from "@shared/partCategory";
import type { RemainingRow } from "@shared/remaining";
import { formatPrice, getJson, type SessionInfo, type SessionSummary, type UnitView } from "../api";
import { CameraScanner } from "./CameraScanner";
import { StartScreen } from "./StartScreen";

// Gaps first so the tech sees what still needs scanning
function RemainingTray({ rows, units }: { rows: RemainingRow[]; units: UnitView[] }) {
  const totalValue = units.reduce((sum, unit) => sum + (unit.priceMax ?? 0), 0);
  const sorted = [...rows].sort((first, second) => (second.expected - second.found) - (first.expected - first.found));
  return (
    <section className="screen remaining-tray" data-testid="remaining-tray">
      <div className="tray-summary">
        <strong>{units.length} parts</strong>
        <span className="muted-inline">up to {formatPrice(null, totalValue)}</span>
      </div>
      {sorted.length > 0 && (
        <ul className="remaining-list">
          {sorted.map((row) => (
            <li
              key={row.category}
              className={`remaining-chip${row.found < row.expected ? " remaining-gap" : " remaining-done"}`}
              data-testid={`remaining-${row.category}`}
            >
              {CATEGORY_LABEL[row.category]} {row.found}/{row.expected || row.found}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ScanPage() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [units, setUnits] = useState<UnitView[]>([]);
  const [searchParams] = useSearchParams();

  const feedMode = import.meta.env.DEV ? searchParams.get("feed") ?? undefined : undefined;

  const refreshSummary = useCallback((sessionId: string) => {
    getJson<SessionSummary>(`/api/sessions/${sessionId}`).then(setSummary).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (session) refreshSummary(session.id);
  }, [session, refreshSummary]);

  const handleUnit = useCallback((unit: UnitView) => {
    // A unit whose serial was filled in comes back with the same id, so it replaces the old row
    setUnits((previous) => (previous.some((existing) => existing.id === unit.id)
      ? previous.map((existing) => (existing.id === unit.id ? unit : existing))
      : [unit, ...previous]));
    if (session) refreshSummary(session.id);
  }, [session, refreshSummary]);

  function rescanTag() {
    setSession(null);
    setSummary(null);
    setUnits([]);
  }

  if (!session) return <StartScreen onSessionCreated={setSession} feedMode={feedMode} />;

  // The model comes from the first sweep's chassis guess, so it is blank until then
  const currentModel = summary?.model || session.model;
  const modelText = currentModel || (summary && summary.sweepCount > 0 ? "Unknown model" : "Model: detecting…");

  return (
    <>
      <CameraScanner session={session} onUnit={handleUnit} onSessionUpdate={setSummary} feedMode={feedMode} modelText={modelText} onRescanTag={rescanTag} />
      <RemainingTray rows={summary?.remaining ?? []} units={summary?.units ?? units} />
      {units.length > 0 && (
        <section className="screen recent-units">
          <h2 className="recent-heading">Scanned ({units.length})</h2>
          <ul className="unit-list">
            {units.slice(0, 20).map((unit) => (
              <li key={unit.id} className={`unit-row unit-${unit.status}`}>
                <span className="unit-type">{unit.partType}</span>
                <span className="unit-serial">{unit.partNumber ? `${unit.partNumber} · ` : ""}{unit.serial ?? "(no serial)"}</span>
                <span className={`unit-badge recommendation-badge-${unit.recommendation.toLowerCase()}`}>{unit.recommendation}</span>
                <span className={`unit-badge unit-badge-${unit.status}`}>{unit.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
