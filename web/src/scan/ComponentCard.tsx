export interface LookupResult {
  name: string;
  category: string;
  priceMin: number;
  priceMax: number;
  imageUrl: string | null;
  confidence: "high" | "medium" | "low";
  listingCount: number;
  recommendation: "KEEP" | "REVIEW" | "RECYCLE";
}

interface ComponentCardProps {
  result: LookupResult;
  serial: string;
}

const CONFIDENCE_LABEL: Record<LookupResult["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

export function ComponentCard({ result, serial }: ComponentCardProps) {
  return (
    <div className="component-card">
      <div className="component-card-header">
        <span className="component-card-title">Component identified</span>
        <span className={`confidence-badge confidence-${result.confidence}`}>
          ✓ {CONFIDENCE_LABEL[result.confidence]}
        </span>
      </div>

      <div className="component-identity">
        {result.imageUrl && (
          <img className="component-thumb" src={result.imageUrl} alt={result.name} />
        )}
        <div className="component-meta">
          <strong className="component-name">{result.name}</strong>
          <span className="component-detail muted">Example part: {serial}</span>
          <span className="component-detail muted">Category: {result.category}</span>
        </div>
      </div>

      <div className="component-values">
        <div className="value-block">
          <span className="value-label">Estimated resale value</span>
          <span className="value-price">${result.priceMin}–${result.priceMax}</span>
        </div>
        <div className="value-block">
          <span className="value-label">Recommendation</span>
          <span className={`recommendation recommendation-${result.recommendation.toLowerCase()}`}>
            {result.recommendation}
          </span>
        </div>
      </div>

      <p className="component-disclaimer muted">
        Illustrative values only, not live market data. Based on {result.listingCount} eBay listing{result.listingCount !== 1 ? "s" : ""}.
      </p>
    </div>
  );
}
