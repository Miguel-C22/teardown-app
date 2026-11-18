import { isHighValue } from "@shared/recommend";
import { IDENTIFIED_BY_LABEL, REVIEW_REASON_LABEL, formatPrice, photoUrl, type UnitView } from "../api";

interface ComponentCardProps {
  unit: UnitView;
}

const SOURCE_DISCLAIMER: Record<string, string> = {
  ebay: "Price range from current eBay listings, not sold prices.",
  upcitemdb: "Price range from UPCitemdb recorded offers.",
  catalog: "Price range from the PoC starter catalog (illustrative estimate).",
};

export function ComponentCard({ unit }: ComponentCardProps) {
  const thumbnail = photoUrl(unit.photoPath);
  const highValue = isHighValue(unit.priceMax);
  return (
    <div className={`component-card${highValue ? " component-card-high" : ""}`} data-testid="component-card">
      <div className="component-card-header">
        <span className="component-card-title">{unit.verified ? "Identified" : "Needs review"}</span>
        <span className={`confidence-badge ${unit.verified ? "confidence-high" : "confidence-medium"}`}>
          via {IDENTIFIED_BY_LABEL[unit.identifiedBy]}
        </span>
      </div>

      <div className="component-identity">
        {thumbnail && <img className="component-thumb" src={thumbnail} alt="Label photo" />}
        <div className="component-meta">
          <strong className="component-name">{unit.description ?? `${unit.manufacturer ?? ""} ${unit.partType}`.trim()}</strong>
          <span className="component-detail muted">Part number: {unit.partNumber ?? "not read"}</span>
          <span className="component-detail muted">Serial: {unit.serial ?? "not read"}</span>
          {unit.evidence && <span className="component-detail muted evidence">Read: {unit.evidence}</span>}
        </div>
      </div>

      <div className="component-values">
        <div className="value-block">
          <span className="value-label">Estimated resale value</span>
          <span className="value-price">{formatPrice(unit.priceMin, unit.priceMax)}</span>
        </div>
        <div className="value-block">
          <span className="value-label">Recommendation</span>
          <span className={`recommendation recommendation-${unit.recommendation.toLowerCase()}`} data-testid="card-recommendation">
            {unit.recommendation}
          </span>
        </div>
      </div>

      {unit.reviewReasons.length > 0 && (
        <p className="component-disclaimer review-reasons">Review: {unit.reviewReasons.map((reason) => REVIEW_REASON_LABEL[reason]).join(", ")}</p>
      )}
      <p className="component-disclaimer muted">
        {unit.lookupSource ? SOURCE_DISCLAIMER[unit.lookupSource] ?? "" : "No price source matched this part yet."}
      </p>
    </div>
  );
}
