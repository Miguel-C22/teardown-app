// Part categories shared by barcodes, vision results, units and the "what's left" checklist
export const PART_CATEGORIES = [
  "DIMM", "CPU", "HDD", "SSD", "PSU", "NIC", "RAID", "GPU", "COOLING", "BOARD", "CHASSIS", "NETWORK", "OPTIC", "OTHER",
] as const;

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
  COOLING: "Cooling",
  BOARD: "Boards",
  CHASSIS: "Chassis parts",
  NETWORK: "Network gear",
  OPTIC: "Optics",
  OTHER: "Other",
};

// Words the AI or a tech may use for a part, mapped to the group it is counted under
const CATEGORY_ALIASES: Record<string, PartCategory> = {
  NVME: "SSD",
  HBA: "RAID",
  HEATSINK: "COOLING",
  COOLER: "COOLING",
  FAN: "COOLING",
  MOTHERBOARD: "BOARD",
  RISER: "BOARD",
  BACKPLANE: "BOARD",
  MEZZANINE: "BOARD",
  RAIL: "CHASSIS",
  RAILS: "CHASSIS",
  BEZEL: "CHASSIS",
  CADDY: "CHASSIS",
  TRAY: "CHASSIS",
  SWITCH: "NETWORK",
  ROUTER: "NETWORK",
  FIREWALL: "NETWORK",
  LINECARD: "NETWORK",
  SUPERVISOR: "NETWORK",
  TRANSCEIVER: "OPTIC",
  SFP: "OPTIC",
  QSFP: "OPTIC",
  OPTICS: "OPTIC",
};

export function normalizeCategory(value: string | null | undefined): PartCategory {
  const upper = (value ?? "").trim().toUpperCase();
  if ((PART_CATEGORIES as readonly string[]).includes(upper)) return upper as PartCategory;
  return CATEGORY_ALIASES[upper] ?? "OTHER";
}
