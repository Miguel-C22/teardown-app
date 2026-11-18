// Part categories shared by barcodes, vision results, units and the "what's left" checklist
export const PART_CATEGORIES = ["DIMM", "CPU", "HDD", "SSD", "PSU", "NIC", "RAID", "GPU", "OTHER"] as const;

export type PartCategory = (typeof PART_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<PartCategory, string> = {
  DIMM: "DIMMs",
  CPU: "CPUs",
  HDD: "Hard drives",
  SSD: "SSDs",
  PSU: "PSUs",
  NIC: "NICs",
  RAID: "RAID / HBA",
  GPU: "GPUs",
  OTHER: "Other",
};

export function normalizeCategory(value: string | null | undefined): PartCategory {
  const upper = (value ?? "").trim().toUpperCase();
  if ((PART_CATEGORIES as readonly string[]).includes(upper)) return upper as PartCategory;
  if (upper === "NVME") return "SSD";
  if (upper === "HBA") return "RAID";
  return "OTHER";
}
