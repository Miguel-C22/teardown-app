import type { PartCategory } from "./partCategory.js";

export type CodeKind = "partNumber" | "ppid" | "serial" | "macAddress" | "wwn" | "upc" | "version" | "unknown";

export interface ClassifiedCode {
  text: string;
  kind: CodeKind;
  partNumber: string | null;
  manufacturerHint: string | null;
  categoryHint: PartCategory | null;
}

interface PartNumberPattern {
  pattern: RegExp;
  manufacturer: string;
  category: PartCategory | null;
}

// Manufacturer part-number formats that show up on server component labels
const PART_NUMBER_PATTERNS: PartNumberPattern[] = [
  { pattern: /^M3[89]3[ABL][0-9A-Z]{6,}/, manufacturer: "Samsung", category: "DIMM" },
  { pattern: /^HMA[A0-9][0-9A-Z]{6,}/, manufacturer: "SK Hynix", category: "DIMM" },
  { pattern: /^HMCG[0-9A-Z]{6,}/, manufacturer: "SK Hynix", category: "DIMM" },
  { pattern: /^MTA\d{1,2}[A-Z]{3}\d/, manufacturer: "Micron", category: "DIMM" },
  { pattern: /^KSM\d{2}[RE]/, manufacturer: "Kingston", category: "DIMM" },
  { pattern: /^ST\d{3,5}[A-Z]{2}\d{3,4}/, manufacturer: "Seagate", category: "HDD" },
  { pattern: /^HU[SHCE]\d{3}[0-9A-Z]{4,}/, manufacturer: "HGST", category: "HDD" },
  { pattern: /^WUH?S\d{5,}/, manufacturer: "Western Digital", category: "HDD" },
  { pattern: /^WD\d{3,5}[A-Z]{4}/, manufacturer: "Western Digital", category: "HDD" },
  { pattern: /^(AL1[345]|MG0\d|AL15)[A-Z]{2,4}\d{3}/, manufacturer: "Toshiba", category: "HDD" },
  { pattern: /^PX0\d[A-Z]{2,4}\d{3}/, manufacturer: "Toshiba", category: "SSD" },
  { pattern: /^MZ[7QWIP-][0-9A-Z]{6,}/, manufacturer: "Samsung", category: "SSD" },
  { pattern: /^SSD[SP][CE]\d[A-Z]{2}\d/, manufacturer: "Intel", category: "SSD" },
  { pattern: /^MTFD[A-Z]{3}\d/, manufacturer: "Micron", category: "SSD" },
  { pattern: /^MCX\d{3,4}[A-Z]/, manufacturer: "Mellanox", category: "NIC" },
  { pattern: /^(E10G\d{2}[A-Z]|X5[24]0[A-Z0-9]{2,}|X710[A-Z0-9]{2,}|XXV710[A-Z0-9]*|I350T\d)/, manufacturer: "Intel", category: "NIC" },
  { pattern: /^BCM95\d{3}/, manufacturer: "Broadcom", category: "NIC" },
  { pattern: /^(9[2-6]\d\d-\d{1,2}[ie])/i, manufacturer: "Broadcom/LSI", category: "RAID" },
  { pattern: /^900-\d[A-Z0-9]{3,}/, manufacturer: "NVIDIA", category: "GPU" },
  // Intel sSpec, laser-marked on the CPU lid (SR3B9 = Xeon Gold 6130)
  { pattern: /^S[RL][0-9A-Z]{3}$/, manufacturer: "Intel", category: "CPU" },
  // Cisco product IDs (PIDs): transceivers, power supplies, then switches, routers and their modules
  { pattern: /^(GLC|SFP|QSFP|CVR|XFP|CFP|DWDM|ONS-S[EI])-[0-9A-Z][0-9A-Z+=/.-]*$/, manufacturer: "Cisco", category: "OPTIC" },
  { pattern: /^(PWR|C9K-PWR|NXA-PAC|NXA-PDC|N9K-PAC|N2200-PAC)-[0-9A-Z][0-9A-Z=/.-]*$/, manufacturer: "Cisco", category: "PSU" },
  { pattern: /^UCS-(MR|ML|MKD)-[0-9A-Z][0-9A-Z=/.-]*$/, manufacturer: "Cisco", category: "DIMM" },
  { pattern: /^UCS-(HD|SD|HY|NVMEH?)[0-9A-Z][0-9A-Z=/.-]*$/, manufacturer: "Cisco", category: null },
  { pattern: /^(WS-C\d{4}[A-Z]?|WS-X\d{4}|C9\d{3}[A-Z]?|C1\d{3}[A-Z]?|N[2-9]K|ASR\d{1,4}|AIR|IE|CBS\d{3}|SG\d{3}|NIM|SM-X|EHWIC|HWIC)-[0-9A-Z][0-9A-Z=/.+-]*$/, manufacturer: "Cisco", category: "NETWORK" },
  { pattern: /^(CISCO\d{3,4}|ISR\d{3,4})[0-9A-Z=/.-]*$/, manufacturer: "Cisco", category: "NETWORK" },
  { pattern: /^UCS[CBX]?-[0-9A-Z][0-9A-Z=/.-]*$/, manufacturer: "Cisco", category: null },
];

// Cisco serials: three letters (factory), four digits (year and week), four characters, e.g. FOC1234X0YZ
const CISCO_SERIAL = /^[A-Z]{3}\d{4}[0-9A-Z]{4}$/;
// Cisco's hardware version, printed as VID: V02 next to the PID
const CISCO_VID = /^V\d{2}$/;

const DELL_PPID = /^([A-Z]{2})-?(0[0-9A-Z]{5})-?([0-9A-Z]{5})-?([0-9A-Z]{3})-?([0-9A-Z]{4})(?:-?([A-Z][0-9]{2}))?$/;
const DELL_PART_NUMBER = /^0[0-9A-Z]{5}$/;
const HPE_SPARE_OR_OPTION = /^\d{6}-[0-9A-Z]{3}$/;
const LENOVO_FRU = /^0[0-9][A-Z]{2}\d{3}$/;
// Seagate's own part number under the model, e.g. PN 1CH164-302
const SEAGATE_PART_NUMBER = /^\d[0-9A-Z]{2}\d{3}-\d{3}$/;
// Short number-only codes are date codes, firmware or site codes, never a unit serial
const SHORT_NUMBER_ONLY = /^\d{1,8}$/;
const MAC_WITH_SEPARATORS = /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/;
const BARE_HEX_12 = /^[0-9A-F]{12}$/;
const WWN = /^5[0-9A-F]{15}$/;
const UPC_OR_EAN = /^\d{12,13}$/;
const SERIAL_LIKE = /^[0-9A-Z][0-9A-Z-]{4,29}$/;

function hasLetterAndDigit(value: string): boolean {
  return /[A-Z]/.test(value) && /\d/.test(value);
}

function result(text: string, kind: CodeKind, partNumber: string | null, manufacturerHint: string | null, categoryHint: PartCategory | null): ClassifiedCode {
  return { text, kind, partNumber, manufacturerHint, categoryHint };
}

export function classifyCode(rawText: string): ClassifiedCode {
  const text = rawText.trim();
  const upper = text.toUpperCase();

  if (!text || text.length > 64 || /\s{2,}|^https?:/i.test(text)) return result(text, "unknown", null, null, null);

  const ppidMatch = DELL_PPID.exec(upper);
  if (ppidMatch && hasLetterAndDigit(ppidMatch[2])) return result(text, "ppid", ppidMatch[2], "Dell", null);

  if (HPE_SPARE_OR_OPTION.test(upper)) return result(text, "partNumber", upper, "HPE", null);
  if (DELL_PART_NUMBER.test(upper) && hasLetterAndDigit(upper)) return result(text, "partNumber", upper, "Dell", null);
  if (LENOVO_FRU.test(upper)) return result(text, "partNumber", upper, "Lenovo", null);
  if (SEAGATE_PART_NUMBER.test(upper)) return result(text, "partNumber", upper, "Seagate", null);
  if (SHORT_NUMBER_ONLY.test(upper)) return result(text, "unknown", null, null, null);
  if (CISCO_VID.test(upper)) return result(text, "version", null, "Cisco", null);

  for (const knownPattern of PART_NUMBER_PATTERNS) {
    if (knownPattern.pattern.test(upper)) return result(text, "partNumber", upper, knownPattern.manufacturer, knownPattern.category);
  }
  // After the part-number patterns, so an 11-character drive model is never taken for a Cisco serial
  if (CISCO_SERIAL.test(upper)) return result(text, "serial", null, "Cisco", null);

  if (MAC_WITH_SEPARATORS.test(upper)) return result(text, "macAddress", null, null, "NIC");
  if (WWN.test(upper)) return result(text, "wwn", null, null, null);
  if (UPC_OR_EAN.test(upper)) return result(text, "upc", upper, null, null);
  if (BARE_HEX_12.test(upper) && /[A-F]/.test(upper) && /\d/.test(upper) && !/[G-Z]/.test(upper)) {
    return result(text, "macAddress", null, null, "NIC");
  }
  if (SERIAL_LIKE.test(upper)) return result(text, "serial", null, null, null);

  return result(text, "unknown", null, null, null);
}

// The serial that identifies one physical unit: a PPID is unique per piece, so it counts as a serial
export function isUnitSerial(code: ClassifiedCode): boolean {
  return code.kind === "serial" || code.kind === "ppid";
}

const DELL_SERVICE_TAG = /^[0-9A-Z]{7}$/;

// A Dell QR code on the luggage tag is a link that ends in the service tag
function tagFromUrl(text: string): string | null {
  if (!/^https?:\/\//i.test(text)) return null;
  const lastSegment = text.split(/[/?#=]/).filter(Boolean).pop()?.toUpperCase() ?? "";
  return DELL_SERVICE_TAG.test(lastSegment) && hasLetterAndDigit(lastSegment) ? lastSegment : null;
}

// Picks the server's own tag from the codes in view, skipping component part numbers, PPIDs, MACs, WWNs and UPCs
export function pickServerTag(codeTexts: string[]): string | null {
  const candidates: string[] = [];
  for (const codeText of codeTexts) {
    const fromUrl = tagFromUrl(codeText.trim());
    if (fromUrl) {
      candidates.push(fromUrl);
      continue;
    }
    const classified = classifyCode(codeText);
    if (classified.kind === "serial") candidates.push(classified.text.toUpperCase());
  }
  const dellTag = candidates.find((candidate) => DELL_SERVICE_TAG.test(candidate) && hasLetterAndDigit(candidate));
  return dellTag ?? candidates[0] ?? null;
}
