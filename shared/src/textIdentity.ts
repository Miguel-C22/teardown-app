import type { PartCategory } from "./partCategory.js";

// What all the text on an item (sticker, faceplate, silkscreen) says about it, beyond part numbers and serials
export interface TextIdentity {
  brand: string | null;
  productName: string | null;
  category: PartCategory | null;
  // The strongest words for a resale search: the product name, else the brand plus the best part number
  searchQuery: string | null;
  // Every line read, cleaned up, kept as evidence on the part
  allText: string;
}

// Brand spellings as printed, mapped to one name; longer spellings first so "Hewlett Packard Enterprise" wins over "HP"
const BRANDS: Array<[RegExp, string]> = [
  [/\bHEWLETT[\s-]*PACKARD\s+ENTERPRISE\b|\bHPE\b/, "HPE"],
  [/\bHEWLETT[\s-]*PACKARD\b/, "HP"],
  [/\bWESTERN\s+DIGITAL\b|\bWDC\b/, "Western Digital"],
  [/\bSK\s*HYNIX\b|\bHYNIX\b/, "SK Hynix"],
  [/\bPALO\s+ALTO\b/, "Palo Alto Networks"],
  [/\bALLEN[\s-]*BRADLEY\b/, "Allen-Bradley"],
  [/\bPHOENIX\s+CONTACT\b/, "Phoenix Contact"],
  [/\bMEAN\s+WELL\b/, "Mean Well"],
  [/\bSCHNEIDER(\s+ELECTRIC)?\b/, "Schneider Electric"],
  [/\bSUPER\s*MICRO\b/, "Supermicro"],
  ...["Dell", "EMC", "Cisco", "Lenovo", "IBM", "Siemens", "Intel", "AMD", "NVIDIA", "Samsung", "Micron", "Kingston", "Seagate", "HGST",
    "Toshiba", "Kioxia", "Mellanox", "Broadcom", "LSI", "QLogic", "Emulex", "Juniper", "Arista", "Fortinet", "APC", "Eaton", "ABB", "Omron",
    "Delta", "Liteon", "Artesyn", "Murata", "Netgear", "Ubiquiti", "Aruba", "Brocade", "NetApp", "Chelsio", "Solarflare", "Vertiv", "Emerson",
    "Rockwell", "Huawei", "Fujitsu", "Hitachi", "Quanta", "Inspur", "Gigabyte", "ASUS", "Marvell", "ADATA", "SanDisk", "Crucial"]
    .map((brand): [RegExp, string] => [new RegExp(`\\b${brand.toUpperCase()}\\b`), brand]),
  [/\bHP\b/, "HP"],
];

interface ProductPattern {
  pattern: RegExp;
  brand: string;
  category: PartCategory | null;
  // Builds the printed name from the match, in a tidy form for display and search
  name: (match: RegExpExecArray) => string;
}

// Product families printed on faceplates, bezels and labels; a match names the item without any part number
const PRODUCTS: ProductPattern[] = [
  { pattern: /\bPOWER\s?EDGE\s+([RTMC]\d{3,4}[A-Z]{0,3})\b/, brand: "Dell", category: "CHASSIS", name: (match) => `Dell PowerEdge ${match[1]}` },
  { pattern: /\bPRO\s?LIANT\s+((?:DL|ML|BL|XL)\d{2,3}[A-Z]?)\s*(GEN\s?\d{1,2}(?:\s?PLUS)?|G\d{1,2})?\b/, brand: "HPE", category: "CHASSIS",
    name: (match) => `HPE ProLiant ${match[1]}${match[2] ? ` ${match[2].replace(/\s+/g, "").replace(/^GEN/, "Gen").replace(/PLUS$/, " Plus")}` : ""}` },
  { pattern: /\bTHINK\s?SYSTEM\s+(SR|ST|SD|SN)(\d{3}[A-Z]?)(\s?V\d)?\b/, brand: "Lenovo", category: "CHASSIS", name: (match) => `Lenovo ThinkSystem ${match[1]}${match[2]}${match[3] ? ` ${match[3].trim()}` : ""}` },
  { pattern: /\bCATALYST\s+(\d{4}[A-Z]?(?:-[0-9A-Z]+)*)\b/, brand: "Cisco", category: "NETWORK", name: (match) => `Cisco Catalyst ${match[1]}` },
  { pattern: /\bNEXUS\s+(\d{4}[A-Z]?(?:-[0-9A-Z]+)*)\b/, brand: "Cisco", category: "NETWORK", name: (match) => `Cisco Nexus ${match[1]}` },
  { pattern: /\bPERC\s+(H\d{3}P?|S\d{3}|HBA\d{3})\b/, brand: "Dell", category: "RAID", name: (match) => `Dell PERC ${match[1]}` },
  { pattern: /\bSMART\s?ARRAY\s+(P\d{3}[A-Z]?(?:-[A-Z])?)\b/, brand: "HPE", category: "RAID", name: (match) => `HPE Smart Array ${match[1]}` },
  { pattern: /\bMEGARAID\s+(?:SAS\s+)?(\d{4}-\d{1,2}[IE])\b/, brand: "Broadcom", category: "RAID", name: (match) => `Broadcom MegaRAID ${match[1]}` },
  { pattern: /\bCONNECTX[\s-]?(\d{1,2})(\s?LX|\s?DX|\s?EN|\s?VPI)?\b/, brand: "Mellanox", category: "NIC", name: (match) => `Mellanox ConnectX-${match[1]}${match[2] ? ` ${match[2].trim()}` : ""}` },
  { pattern: /\bXEON\s*(?:\(R\))?\s*(GOLD|SILVER|PLATINUM|BRONZE)\s+(\d{4}[A-Z]?)\b/, brand: "Intel", category: "CPU",
    name: (match) => `Intel Xeon ${match[1].charAt(0)}${match[1].slice(1).toLowerCase()} ${match[2]}` },
  { pattern: /\bXEON\s*(?:\(R\))?\s*(?:CPU\s+)?(E[357]-\d{4}[A-Z]?)\s*(V\d)?\b/, brand: "Intel", category: "CPU", name: (match) => `Intel Xeon ${match[1]}${match[2] ? ` ${match[2].toLowerCase()}` : ""}` },
  { pattern: /\bEPYC\s+(\d{4}[A-Z]?)\b/, brand: "AMD", category: "CPU", name: (match) => `AMD EPYC ${match[1]}` },
  { pattern: /\b(TESLA|QUADRO)\s+([A-Z]?\d{1,4}[A-Z]?)\b/, brand: "NVIDIA", category: "GPU", name: (match) => `NVIDIA ${match[1].charAt(0)}${match[1].slice(1).toLowerCase()} ${match[2]}` },
  { pattern: /\bSITOP\s+((?:PSU|SMART|MODULAR|LITE|UPS)\s?\d{0,4}[A-Z]?)\b/, brand: "Siemens", category: "PSU", name: (match) => `Siemens SITOP ${match[1]}` },
  { pattern: /\bSIMATIC\s+(S7-\d{3,4}|ET\s?200[A-Z]{0,2}|HMI\s+[A-Z]{2,4}\s?\d{3,4})\b/, brand: "Siemens", category: "OTHER", name: (match) => `Siemens SIMATIC ${match[1]}` },
  { pattern: /\bSMART-UPS\s+(\d{3,4})\b/, brand: "APC", category: "PSU", name: (match) => `APC Smart-UPS ${match[1]}` },
  { pattern: /\b(EXOS|BARRACUDA|IRONWOLF|CONSTELLATION|SAVVIO|CHEETAH)\b(?:\s+(X\d{2}|7E\d{1,2}|PRO))?/, brand: "Seagate", category: "HDD",
    name: (match) => `Seagate ${match[1].charAt(0)}${match[1].slice(1).toLowerCase()}${match[2] ? ` ${match[2]}` : ""}` },
  { pattern: /\bULTRASTAR\s+([A-Z0-9]+)?/, brand: "Western Digital", category: "HDD", name: (match) => `WD Ultrastar${match[1] ? ` ${match[1]}` : ""}` },
];

// Removes OCR noise lines (symbols only, single characters) and squeezes spaces, so the kept text is readable
function cleanLines(rawText: string): string[] {
  return rawText.toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/[^A-Z0-9 \-/:.#+=()]/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line.replace(/[^A-Z0-9]/g, "").length >= 3);
}

export function identifyFromText(rawText: string, bestPartNumber: string | null = null): TextIdentity {
  const lines = cleanLines(rawText);
  const joined = lines.join(" ");
  let productName: string | null = null;
  let category: PartCategory | null = null;
  let brand = BRANDS.find(([pattern]) => pattern.test(joined))?.[1] ?? null;
  for (const product of PRODUCTS) {
    const match = product.pattern.exec(joined);
    if (!match) continue;
    productName = product.name(match);
    category = product.category;
    brand = product.brand;
    break;
  }
  const searchQuery = productName ?? (bestPartNumber ? [brand, bestPartNumber].filter(Boolean).join(" ") : null);
  return { brand, productName, category, searchQuery, allText: lines.join(" | ").slice(0, 600) };
}
