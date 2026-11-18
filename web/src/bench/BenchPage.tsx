import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CATEGORY_LABEL } from "@shared/partCategory";
import {
  IDENTIFIED_BY_LABEL, REVIEW_REASON_LABEL, formatPrice, getJson, photoUrl, type SessionInfo, type SessionSummary, type UnitView,
} from "../api";

interface PartGroup {
  key: string;
  units: UnitView[];
  sample: UnitView;
}

// Identical parts (same part number and recommendation) collapse into one line with a quantity
function groupUnits(units: UnitView[]): PartGroup[] {
  const groups = new Map<string, UnitView[]>();
  for (const unit of units) {
    const key = unit.partNumber ? `${unit.partNumber}|${unit.recommendation}` : `single|${unit.id}`;
    groups.set(key, [...(groups.get(key) ?? []), unit]);
  }
  return [...groups.entries()]
    .map(([key, groupUnits]) => ({ key, units: groupUnits, sample: groupUnits[0] }))
    .sort((first, second) => (second.sample.priceMax ?? 0) * second.units.length - (first.sample.priceMax ?? 0) * first.units.length);
}

function SessionDetail({ detail }: { detail: SessionSummary }) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const totalValue = detail.units.reduce((sum, unit) => sum + (unit.priceMax ?? 0), 0);
  const counts = {
    keep: detail.units.filter((unit) => unit.recommendation === "KEEP").length,
    review: detail.units.filter((unit) => unit.recommendation === "REVIEW").length,
    recycle: detail.units.filter((unit) => unit.recommendation === "RECYCLE").length,
  };
  const verifiedCount = detail.units.filter((unit) => unit.verified).length;
  const gaps = detail.remaining.filter((row) => row.found < row.expected);

  return (
    <div className="session-detail" data-testid="session-detail">
      <dl className="summary-grid">
        <div><dt>Parts</dt><dd>{detail.units.length}</dd></div>
        <div><dt>Keep</dt><dd className="recommendation-keep">{counts.keep}</dd></div>
        <div><dt>Review</dt><dd className="recommendation-review">{counts.review}</dd></div>
        <div><dt>Recycle</dt><dd className="recommendation-recycle">{counts.recycle}</dd></div>
        <div><dt>Verified</dt><dd>{detail.units.length ? Math.round((verifiedCount / detail.units.length) * 100) : 0}%</dd></div>
        <div><dt>Est. value</dt><dd>up to ${totalValue}</dd></div>
        <div><dt>Vision calls</dt><dd data-testid="vision-calls">{detail.visionUsage.calls}</dd></div>
        <div><dt>Vision cost</dt><dd>${detail.visionUsage.costUsd.toFixed(3)}</dd></div>
      </dl>

      {gaps.length > 0 && (
        <p className="gap-warning" data-testid="gap-warning">
          Seen but not recorded: {gaps.map((row) => `${row.expected - row.found} ${CATEGORY_LABEL[row.category]}`).join(", ")}
        </p>
      )}

      <ul className="unit-list" data-testid="unit-list">
        {detail.units.length === 0 && <li className="muted" style={{ padding: "8px 0" }}>No units recorded.</li>}
        {groupUnits(detail.units).map((group) => (
          <li key={group.key} className="group-item">
            <button
              type="button"
              className={`unit-row group-row unit-${group.sample.status}`}
              onClick={() => setOpenGroup(openGroup === group.key ? null : group.key)}
              data-testid="unit-group"
            >
              <span className="unit-type">{group.sample.partType}</span>
              <span className="unit-serial">
                {group.sample.description ?? group.sample.partNumber ?? group.sample.serial ?? "(no serial)"}
                {group.sample.partNumber && group.sample.description ? ` · ${group.sample.partNumber}` : ""}
              </span>
              <span className="group-quantity" data-testid="group-quantity">×{group.units.length}</span>
              <span className="group-value">{formatPrice(group.sample.priceMin, group.sample.priceMax)}</span>
              <span className={`unit-badge recommendation-badge-${group.sample.recommendation.toLowerCase()}`}>{group.sample.recommendation}</span>
            </button>
            {openGroup === group.key && (
              <ul className="unit-detail-list">
                {group.units.map((unit) => {
                  const thumbnail = photoUrl(unit.photoPath);
                  return (
                    <li key={unit.id} className="unit-detail">
                      {thumbnail && <a href={thumbnail} target="_blank" rel="noreferrer"><img className="component-thumb" src={thumbnail} alt="Label photo" /></a>}
                      <div className="component-meta">
                        <span>Serial: <code>{unit.serial ?? "none"}</code></span>
                        <span>Found by {IDENTIFIED_BY_LABEL[unit.identifiedBy]}{unit.verified ? ", verified" : ""}{unit.lookupSource ? ` · price from ${unit.lookupSource}` : ""}</span>
                        {unit.evidence && <span className="evidence">Read: {unit.evidence}</span>}
                        {unit.reviewReasons.length > 0 && (
                          <span className="review-reasons">Review: {unit.reviewReasons.map((reason) => REVIEW_REASON_LABEL[reason]).join(", ")}</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BenchPage() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionSummary | null>(null);

  useEffect(() => {
    getJson<SessionInfo[]>("/api/sessions")
      .then((data) => setSessions(data))
      .catch(() => setError("Failed to load sessions"))
      .finally(() => setLoading(false));
  }, []);

  // Refresh the open session every few seconds so the bench follows the phone
  useEffect(() => {
    if (!expanded) return;
    const refresh = () => getJson<SessionSummary>(`/api/sessions/${expanded}`).then(setSessionDetail).catch(() => undefined);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [expanded]);

  async function downloadCsv(session: SessionInfo) {
    const response = await fetch(`/api/sessions/${session.id}/export.csv`);
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `teardown-${session.assetTag}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function toggleDetail(id: string) {
    setSessionDetail(null);
    setExpanded(expanded === id ? null : id);
  }

  return (
    <main className="screen screen-wide">
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
                <button className="btn-secondary" onClick={() => toggleDetail(session.id)} data-testid={`expand-session-${session.id}`}>
                  {expanded === session.id ? "Hide" : "View"}
                </button>
                <button className="btn-primary" onClick={() => void downloadCsv(session)} data-testid={`export-btn-${session.id}`}>
                  Export CSV
                </button>
              </div>
            </div>
            {expanded === session.id && sessionDetail?.id === session.id && <SessionDetail detail={sessionDetail} />}
          </li>
        ))}
      </ul>
    </main>
  );
}
