import type { NewUnit, Unit } from "./store.js";

// What the bench PC read straight from a part; this is the most reliable identification there is
export interface HardwarePart {
  category: "HDD" | "SSD" | "DIMM";
  partNumber: string | null;
  serial: string;
  manufacturer: string | null;
  description: string;
  evidence: string;
}

// Seen by the bench PC but carrying no serial to match on, so they are reported back without becoming units
export interface HardwareSighting {
  category: "CPU" | "NIC" | "RAID" | "GPU";
  description: string;
}

export interface ParsedHardwareReport {
  pairingCode: string | null;
  parts: HardwarePart[];
  sightings: HardwareSighting[];
}

interface SmartctlJson {
  model_name?: string;
  model_family?: string;
  serial_number?: string;
  user_capacity?: { bytes?: number };
  rotation_rate?: number;
  device?: { protocol?: string; type?: string };
  power_on_time?: { hours?: number };
  smart_status?: { passed?: boolean };
  nvme_total_capacity?: number;
}

// dmidecode fills empty fields with placeholders; none of these identify anything
const PLACEHOLDER_VALUES = /^(not specified|unknown|none|no module installed|to be filled by o\.e\.m\.|default string|0+|n\/a|\s*)$/i;

function realValue(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed && !PLACEHOLDER_VALUES.test(trimmed) ? trimmed : null;
}

function capacityText(bytes: number | undefined): string {
  if (!bytes) return "";
  const gigabytes = bytes / 1e9;
  // Drives are sold in round decimal sizes, so 2000.4 GB reads as 2TB and 960.2 GB as 960GB
  return gigabytes >= 1000 ? `${parseFloat((gigabytes / 1000).toFixed(1))}TB` : `${Math.round(gigabytes)}GB`;
}

// The report is plain text in sections ("===SMARTCTL /dev/sda"), so the script needs nothing but bash and curl
function splitSections(reportText: string): Array<{ header: string; body: string }> {
  const sections: Array<{ header: string; body: string }> = [];
  let current: { header: string; lines: string[] } | null = null;
  for (const line of reportText.split(/\r?\n/)) {
    if (line.startsWith("===")) {
      if (current) sections.push({ header: current.header, body: current.lines.join("\n") });
      current = { header: line.slice(3).trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push({ header: current.header, body: current.lines.join("\n") });
  return sections;
}

function parseDrive(body: string): HardwarePart | null {
  let smart: SmartctlJson;
  try {
    smart = JSON.parse(body) as SmartctlJson;
  } catch {
    return null;
  }
  const serial = realValue(smart.serial_number);
  const model = realValue(smart.model_name);
  if (!serial || !model) return null;
  const isSolidState = smart.rotation_rate === 0 || /nvme/i.test(smart.device?.protocol ?? smart.device?.type ?? "");
  const capacity = capacityText(smart.user_capacity?.bytes ?? smart.nvme_total_capacity);
  const health = smart.smart_status?.passed === undefined ? "health unknown" : smart.smart_status.passed ? "SMART passed" : "SMART FAILED";
  const hours = smart.power_on_time?.hours !== undefined ? `${smart.power_on_time.hours} power-on hours` : null;
  return {
    category: isSolidState ? "SSD" : "HDD",
    partNumber: model.toUpperCase(),
    serial: serial.toUpperCase(),
    manufacturer: realValue(smart.model_family)?.split(" ")[0] ?? null,
    description: [model, capacity].filter(Boolean).join(" "),
    evidence: ["hardware: smartctl", health, hours].filter(Boolean).join(", "),
  };
}

// dmidecode prints one block per record, fields as "Key: Value" lines
function dmidecodeBlocks(body: string, recordTitle: string): Array<Record<string, string>> {
  return body.split(/\n\s*\n/)
    .filter((block) => block.includes(recordTitle))
    .map((block) => {
      const fields: Record<string, string> = {};
      for (const line of block.split("\n")) {
        const match = /^\s*([^:]+):\s*(.*)$/.exec(line);
        if (match) fields[match[1].trim()] = match[2].trim();
      }
      return fields;
    });
}

function parseMemory(body: string): HardwarePart[] {
  return dmidecodeBlocks(body, "Memory Device").flatMap((fields): HardwarePart[] => {
    const size = realValue(fields.Size);
    const serial = realValue(fields["Serial Number"]);
    if (!size || !serial) return [];
    const partNumber = realValue(fields["Part Number"])?.toUpperCase() ?? null;
    const speed = realValue(fields.Speed) ?? realValue(fields["Configured Memory Speed"]);
    const type = [realValue(fields.Type), realValue(fields["Type Detail"])?.includes("Registered") ? "RDIMM" : null].filter(Boolean).join(" ");
    return [{
      category: "DIMM",
      partNumber,
      serial: serial.toUpperCase(),
      manufacturer: realValue(fields.Manufacturer),
      description: [realValue(fields.Manufacturer), size.replace(/\s+/g, ""), type, speed].filter(Boolean).join(" "),
      evidence: `hardware: dmidecode, slot ${fields.Locator ?? "?"}`,
    }];
  });
}

function parseProcessors(body: string): HardwareSighting[] {
  return dmidecodeBlocks(body, "Processor Information")
    .filter((fields) => !/unpopulated/i.test(fields.Status ?? ""))
    .flatMap((fields) => {
      const version = realValue(fields.Version);
      return version ? [{ category: "CPU" as const, description: version.replace(/\s+/g, " ") }] : [];
    });
}

// lspci -vmm: one block per device with Class, Vendor and Device lines
function parsePciDevices(body: string): HardwareSighting[] {
  return body.split(/\n\s*\n/).flatMap((block): HardwareSighting[] => {
    const fields: Record<string, string> = {};
    for (const line of block.split("\n")) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex > 0) fields[line.slice(0, separatorIndex).trim()] = line.slice(separatorIndex + 1).trim();
    }
    const deviceClass = fields.Class ?? "";
    const description = [fields.Vendor, fields.Device].filter(Boolean).join(" ");
    if (/ethernet|network|infiniband/i.test(deviceClass)) return [{ category: "NIC", description }];
    if (/raid|sas|serial attached scsi/i.test(deviceClass)) return [{ category: "RAID", description }];
    if (/vga|3d controller|display/i.test(deviceClass) && !/matrox|aspeed/i.test(description)) return [{ category: "GPU", description }];
    return [];
  });
}

export function parseHardwareReport(reportText: string): ParsedHardwareReport {
  const parsed: ParsedHardwareReport = { pairingCode: null, parts: [], sightings: [] };
  for (const section of splitSections(reportText)) {
    const [kind, argument] = section.header.split(/\s+/, 2);
    if (kind === "PAIRING") parsed.pairingCode = (argument ?? "").trim() || null;
    if (kind === "SMARTCTL") {
      const drive = parseDrive(section.body);
      if (drive) parsed.parts.push(drive);
    }
    if (kind === "DMIDECODE-MEMORY") parsed.parts.push(...parseMemory(section.body));
    if (kind === "DMIDECODE-PROCESSOR") parsed.sightings.push(...parseProcessors(section.body));
    if (kind === "LSPCI") parsed.sightings.push(...parsePciDevices(section.body));
  }
  // The same drive can be listed twice (e.g. /dev/sda and a by-id path)
  parsed.parts = parsed.parts.filter((part, index, parts) => parts.findIndex((other) => other.serial === part.serial) === index);
  return parsed;
}

// The hardware's own identity replaces what the camera guessed, keeping the unit's id, time and photo
export function mergeHardwareIntoUnit(existing: Unit, fromHardware: NewUnit): Unit {
  return {
    ...fromHardware,
    id: existing.id,
    sessionId: existing.sessionId,
    scannedAt: existing.scannedAt,
    status: "ok",
    photoPath: existing.photoPath,
    imageUrl: fromHardware.imageUrl ?? existing.imageUrl,
    evidence: [fromHardware.evidence, existing.evidence ? `camera: ${existing.evidence}` : null].filter(Boolean).join(" | "),
  };
}
