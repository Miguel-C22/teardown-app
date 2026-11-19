import type { PartCategory } from "./partCategory.js";

// What a part number says about itself, worked out from the manufacturer's naming rules with no lookup
export interface DecodedPart {
  name: string;
  manufacturer: string;
  category: PartCategory;
}

// Module depth digit in Samsung and SK Hynix DDR4 names: each step is gigawords x 64 data bits, i.e. 8 GB per G
const DEPTH_TO_GB: Record<string, number> = { "1": 8, "2": 16, "4": 32, "8": 64, A: 128 };

const SAMSUNG_MODULE_TYPE: Record<string, string> = { "393": "RDIMM", "386": "LRDIMM", "391": "ECC UDIMM", "378": "UDIMM", "471": "SODIMM" };
const SAMSUNG_DDR4_SPEED: Record<string, number> = { CPB: 2133, CRC: 2400, CTD: 2666, CVF: 2933, CWE: 3200 };
const HYNIX_DDR4_SPEED: Record<string, number> = { TF: 2133, UH: 2400, VK: 2666, WM: 2933, XN: 3200 };
const MICRON_DDR4_SPEED: Record<string, number> = { "2G1": 2133, "2G3": 2400, "2G6": 2666, "2G9": 2933, "3G2": 3200 };
const MICRON_MODULE_TYPE: Record<string, string> = { P: "RDIMM", L: "LRDIMM", A: "ECC UDIMM" };

// Seagate model letters after the capacity: the product family
const SEAGATE_FAMILY: Record<string, string> = {
  DM: "BarraCuda", NM: "Exos", VN: "IronWolf", NE: "IronWolf Pro", VX: "SkyHawk", MM: "Enterprise Performance", LM: "BarraCuda 2.5in",
};

// Intel sSpec codes laser-marked on the CPU lid; a starter table that grows as new ones are confirmed
const INTEL_SSPEC: Record<string, string> = {
  SR3B9: "Intel Xeon Gold 6130",
  SR2N3: "Intel Xeon E5-2680 v4",
  SR1XP: "Intel Xeon E5-2680 v3",
  SR0KH: "Intel Xeon E5-2670",
};

function capacityText(gigabytes: number): string {
  return gigabytes >= 1000 && gigabytes % 1000 === 0 ? `${gigabytes / 1000}TB` : gigabytes >= 1000 ? `${(gigabytes / 1000).toFixed(1)}TB` : `${gigabytes}GB`;
}

function decodeSamsungDimm(partNumber: string): DecodedPart | null {
  const match = /^M(393|386|391|378|471)A([1248A])[A-Z0-9]{3}[0-9A-Z]*-([A-Z]{3})/.exec(partNumber);
  if (!match) return null;
  const gigabytes = DEPTH_TO_GB[match[2]];
  const speed = SAMSUNG_DDR4_SPEED[match[3]];
  const speedText = speed ? `-${speed}` : "";
  return { name: `Samsung ${gigabytes}GB DDR4${speedText} ${SAMSUNG_MODULE_TYPE[match[1]]}`, manufacturer: "Samsung", category: "DIMM" };
}

function decodeHynixDimm(partNumber: string): DecodedPart | null {
  const match = /^HMA([A-Z0-9])([1248A])G([RLU])7[A-Z0-9]*-([A-Z]{2})/.exec(partNumber);
  // Only the common HMA8x naming is decoded; other prefixes (HMAA…) use a different capacity scheme, so no guess is made
  if (!match || match[1] !== "8" || !DEPTH_TO_GB[match[2]]) return null;
  const gigabytes = DEPTH_TO_GB[match[2]];
  const moduleType = match[3] === "R" ? "RDIMM" : match[3] === "L" ? "LRDIMM" : "ECC UDIMM";
  const speed = HYNIX_DDR4_SPEED[match[4]];
  return { name: `SK Hynix ${gigabytes}GB DDR4${speed ? `-${speed}` : ""} ${moduleType}`, manufacturer: "SK Hynix", category: "DIMM" };
}

function decodeMicronDimm(partNumber: string): DecodedPart | null {
  const match = /^MTA\d{1,2}ASF(\d+)(G|M)72([PLA])[A-Z]*-(\dG\d)/.exec(partNumber);
  if (!match) return null;
  const gigabytes = match[2] === "G" ? Number(match[1]) * 8 : (Number(match[1]) * 8) / 1024;
  const speed = MICRON_DDR4_SPEED[match[4]];
  return { name: `Micron ${gigabytes}GB DDR4${speed ? `-${speed}` : ""} ${MICRON_MODULE_TYPE[match[3]]}`, manufacturer: "Micron", category: "DIMM" };
}

function decodeSeagateDrive(partNumber: string): DecodedPart | null {
  const match = /^ST(\d{3,5})([A-Z]{2})\d{3,4}/.exec(partNumber);
  if (!match) return null;
  const family = SEAGATE_FAMILY[match[2]];
  const gigabytes = Number(match[1]);
  return { name: `Seagate ${family ? `${family} ` : ""}${capacityText(gigabytes)} drive`, manufacturer: "Seagate", category: "HDD" };
}

function decodeIntelSspec(partNumber: string): DecodedPart | null {
  const model = INTEL_SSPEC[partNumber];
  return model ? { name: model, manufacturer: "Intel", category: "CPU" } : null;
}

// Turns a read part number or marking into a plain name; null when no rule fits, so nothing is guessed
export function decodePartNumber(rawPartNumber: string | null | undefined): DecodedPart | null {
  const partNumber = (rawPartNumber ?? "").trim().toUpperCase();
  if (!partNumber) return null;
  return decodeSamsungDimm(partNumber) ?? decodeHynixDimm(partNumber) ?? decodeMicronDimm(partNumber)
    ?? decodeSeagateDrive(partNumber) ?? decodeIntelSspec(partNumber);
}
