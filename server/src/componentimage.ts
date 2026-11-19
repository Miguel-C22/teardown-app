import { CATEGORY_LABEL, normalizeCategory, type PartCategory } from "../../shared/src/partCategory.js";

// One simple shape per part type, drawn in a 64x64 box
const CATEGORY_SHAPE: Record<PartCategory, string> = {
  DIMM: `<rect x="4" y="22" width="56" height="16" rx="2"/><rect x="10" y="26" width="8" height="8" fill="#fff"/><rect x="22" y="26" width="8" height="8" fill="#fff"/><rect x="34" y="26" width="8" height="8" fill="#fff"/><rect x="46" y="26" width="8" height="8" fill="#fff"/>`,
  CPU: `<rect x="14" y="14" width="36" height="36" rx="3"/><rect x="22" y="22" width="20" height="20" fill="#fff"/>`,
  HDD: `<rect x="12" y="6" width="40" height="52" rx="4"/><circle cx="32" cy="28" r="13" fill="#fff"/><circle cx="32" cy="28" r="3"/>`,
  SSD: `<rect x="10" y="12" width="44" height="40" rx="4"/><rect x="16" y="20" width="32" height="6" fill="#fff"/>`,
  PSU: `<rect x="6" y="16" width="52" height="32" rx="3"/><circle cx="20" cy="32" r="9" fill="#fff"/><rect x="38" y="26" width="12" height="12" fill="#fff"/>`,
  NIC: `<rect x="6" y="18" width="44" height="26" rx="2"/><rect x="50" y="14" width="8" height="36"/><rect x="12" y="44" width="30" height="5"/>`,
  RAID: `<rect x="6" y="18" width="44" height="26" rx="2"/><rect x="14" y="24" width="14" height="14" fill="#fff"/><rect x="12" y="44" width="30" height="5"/>`,
  GPU: `<rect x="4" y="16" width="56" height="28" rx="3"/><circle cx="22" cy="30" r="9" fill="#fff"/><circle cx="44" cy="30" r="9" fill="#fff"/>`,
  COOLING: `<rect x="10" y="40" width="44" height="10"/><rect x="12" y="12" width="4" height="28"/><rect x="20" y="12" width="4" height="28"/><rect x="28" y="12" width="4" height="28"/><rect x="36" y="12" width="4" height="28"/><rect x="44" y="12" width="4" height="28"/>`,
  BOARD: `<rect x="6" y="8" width="52" height="48" rx="2"/><rect x="12" y="14" width="16" height="16" fill="#fff"/><rect x="34" y="14" width="4" height="36" fill="#fff"/><rect x="42" y="14" width="4" height="36" fill="#fff"/>`,
  CHASSIS: `<rect x="4" y="18" width="56" height="28" rx="2"/><rect x="10" y="24" width="20" height="16" fill="#fff"/><circle cx="50" cy="32" r="3" fill="#fff"/>`,
  NETWORK: `<rect x="4" y="20" width="56" height="24" rx="2"/><rect x="10" y="28" width="6" height="6" fill="#fff"/><rect x="19" y="28" width="6" height="6" fill="#fff"/><rect x="28" y="28" width="6" height="6" fill="#fff"/><rect x="37" y="28" width="6" height="6" fill="#fff"/><rect x="46" y="28" width="6" height="6" fill="#fff"/>`,
  OPTIC: `<rect x="8" y="24" width="40" height="16" rx="2"/><rect x="48" y="27" width="10" height="10"/><rect x="2" y="30" width="6" height="4"/>`,
  OTHER: `<rect x="14" y="14" width="36" height="36" rx="6"/><rect x="28" y="22" width="8" height="20" fill="#fff"/>`,
};

// A generic picture for the part type, drawn inline so no network call ever sits in the lookup
export function getComponentImageUrl(partType: string): string {
  const category = normalizeCategory(partType);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 80"><title>${CATEGORY_LABEL[category]}</title>`
    + `<rect width="64" height="80" fill="#eef2f3"/><g fill="#3d5560">${CATEGORY_SHAPE[category]}</g>`
    + `<text x="32" y="73" font-family="system-ui,sans-serif" font-size="8" text-anchor="middle" fill="#3d5560">${CATEGORY_LABEL[category]}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
