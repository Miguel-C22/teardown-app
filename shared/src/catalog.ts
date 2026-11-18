export interface CatalogEntry {
  prefix: string;
  name: string;
  category: string;
  partType: string;
  priceMin: number;
  priceMax: number;
}

// Sorted longest-prefix-first so the most specific match wins
export const CATALOG: CatalogEntry[] = [
  // ── Samsung DIMM ──────────────────────────────────────────────────────────
  { prefix: "M393A8G40MB2", name: "Samsung 64GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 80, priceMax: 150 },
  { prefix: "M393A4G40MB3", name: "Samsung 32GB DDR4-3200 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 35, priceMax: 65 },
  { prefix: "M393A4K40CB2", name: "Samsung 32GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 30, priceMax: 60 },
  { prefix: "M393A4K40BB2", name: "Samsung 32GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 25, priceMax: 55 },
  { prefix: "M393A2K43CB2", name: "Samsung 16GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 20, priceMax: 40 },
  { prefix: "M393A2K43BB1", name: "Samsung 16GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 15, priceMax: 35 },
  { prefix: "M393A1K43CB2", name: "Samsung 8GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 10, priceMax: 20 },
  { prefix: "M393B2G70QH0", name: "Samsung 16GB DDR3 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 10, priceMax: 25 },
  { prefix: "M393B1K70QH0", name: "Samsung 8GB DDR3 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 8, priceMax: 18 },
  { prefix: "M393A", name: "Samsung DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 20, priceMax: 80 },

  // ── SK Hynix DIMM ─────────────────────────────────────────────────────────
  { prefix: "HMAA8GR7AJR4N", name: "SK Hynix 64GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 70, priceMax: 130 },
  { prefix: "HMA84GR7AFR4N", name: "SK Hynix 32GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 25, priceMax: 55 },
  { prefix: "HMA84GR7MFR4N", name: "SK Hynix 32GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 25, priceMax: 50 },
  { prefix: "HMA82GR7AFR8N", name: "SK Hynix 16GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 15, priceMax: 35 },
  { prefix: "HMA81GR7CJR8N", name: "SK Hynix 8GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 8, priceMax: 18 },
  { prefix: "HMA", name: "SK Hynix Server DDR4 RDIMM", category: "Server memory", partType: "DIMM", priceMin: 15, priceMax: 60 },

  // ── Micron DIMM ───────────────────────────────────────────────────────────
  { prefix: "MTA36ASF8G72PZ", name: "Micron 64GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 70, priceMax: 140 },
  { prefix: "MTA36ASF4G72PZ", name: "Micron 32GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 25, priceMax: 55 },
  { prefix: "MTA18ASF2G72PZ", name: "Micron 16GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 15, priceMax: 35 },
  { prefix: "MTA9ASF1G72PZ", name: "Micron 8GB DDR4 ECC RDIMM", category: "Server memory", partType: "DIMM", priceMin: 8, priceMax: 18 },
  { prefix: "MTA36", name: "Micron Server DDR4 RDIMM", category: "Server memory", partType: "DIMM", priceMin: 20, priceMax: 80 },
  { prefix: "MTA18", name: "Micron Server DDR4 RDIMM", category: "Server memory", partType: "DIMM", priceMin: 10, priceMax: 40 },

  // ── Seagate HDD ───────────────────────────────────────────────────────────
  { prefix: "ST10000NM", name: "Seagate Exos 10TB Enterprise HDD", category: "Hard drive", partType: "HDD", priceMin: 60, priceMax: 110 },
  { prefix: "ST8000NM", name: "Seagate Exos 8TB Enterprise HDD", category: "Hard drive", partType: "HDD", priceMin: 50, priceMax: 95 },
  { prefix: "ST6000NM", name: "Seagate Exos 6TB Enterprise HDD", category: "Hard drive", partType: "HDD", priceMin: 40, priceMax: 80 },
  { prefix: "ST4000NM", name: "Seagate Exos 4TB Enterprise HDD", category: "Hard drive", partType: "HDD", priceMin: 35, priceMax: 70 },
  { prefix: "ST2000NM", name: "Seagate Exos 2TB Enterprise HDD", category: "Hard drive", partType: "HDD", priceMin: 25, priceMax: 55 },
  { prefix: "ST1200MM", name: "Seagate 1.2TB 10K SAS HDD", category: "Hard drive", partType: "HDD", priceMin: 20, priceMax: 45 },
  { prefix: "ST900MM", name: "Seagate 900GB 10K SAS HDD", category: "Hard drive", partType: "HDD", priceMin: 15, priceMax: 35 },
  { prefix: "ST600MP", name: "Seagate 600GB 15K SAS HDD", category: "Hard drive", partType: "HDD", priceMin: 20, priceMax: 50 },
  { prefix: "ST1000NM", name: "Seagate Exos 1TB Enterprise HDD", category: "Hard drive", partType: "HDD", priceMin: 20, priceMax: 45 },
  { prefix: "ST", name: "Seagate Hard Drive", category: "Hard drive", partType: "HDD", priceMin: 15, priceMax: 60 },

  // ── Western Digital / HGST HDD ────────────────────────────────────────────
  { prefix: "WUS721212ALE6L4", name: "WD Gold 12TB Enterprise HDD", category: "Hard drive", partType: "HDD", priceMin: 80, priceMax: 150 },
  { prefix: "WUS721010ALE6L4", name: "WD Gold 10TB Enterprise HDD", category: "Hard drive", partType: "HDD", priceMin: 65, priceMax: 120 },
  { prefix: "HUH721212ALN600", name: "HGST Ultrastar He12 12TB HDD", category: "Hard drive", partType: "HDD", priceMin: 70, priceMax: 130 },
  { prefix: "HUS726T6TALE6L4", name: "HGST Ultrastar 7K6 6TB HDD", category: "Hard drive", partType: "HDD", priceMin: 40, priceMax: 80 },
  { prefix: "HUS726020ALA610", name: "HGST Ultrastar 7K6000 2TB HDD", category: "Hard drive", partType: "HDD", priceMin: 20, priceMax: 45 },
  { prefix: "WD4000FYYZ", name: "WD Re 4TB Enterprise HDD", category: "Hard drive", partType: "HDD", priceMin: 40, priceMax: 80 },
  { prefix: "WD2000FYYZ", name: "WD Re 2TB Enterprise HDD", category: "Hard drive", partType: "HDD", priceMin: 25, priceMax: 55 },
  { prefix: "WD", name: "Western Digital Hard Drive", category: "Hard drive", partType: "HDD", priceMin: 20, priceMax: 80 },
  { prefix: "HUS", name: "HGST Ultrastar Hard Drive", category: "Hard drive", partType: "HDD", priceMin: 20, priceMax: 80 },

  // ── Samsung SSD ───────────────────────────────────────────────────────────
  { prefix: "MZ7L33T8HBLT", name: "Samsung PM9A3 3.84TB NVMe SSD", category: "SSD", partType: "SSD", priceMin: 300, priceMax: 550 },
  { prefix: "MZ7L31T9HBLT", name: "Samsung PM9A3 1.92TB NVMe SSD", category: "SSD", partType: "SSD", priceMin: 180, priceMax: 320 },
  { prefix: "MZ7LH960HAJR", name: "Samsung PM883 960GB SATA SSD", category: "SSD", partType: "SSD", priceMin: 100, priceMax: 180 },
  { prefix: "MZ7LH480HAJR", name: "Samsung PM883 480GB SATA SSD", category: "SSD", partType: "SSD", priceMin: 55, priceMax: 100 },
  { prefix: "MZ7KM960HMJP", name: "Samsung SM863 960GB SATA SSD", category: "SSD", partType: "SSD", priceMin: 80, priceMax: 160 },
  { prefix: "MZ7LM960HMJP", name: "Samsung PM863 960GB SATA SSD", category: "SSD", partType: "SSD", priceMin: 70, priceMax: 140 },
  { prefix: "MZ7", name: "Samsung Enterprise SSD", category: "SSD", partType: "SSD", priceMin: 50, priceMax: 200 },

  // ── Intel/Solidigm SSD ────────────────────────────────────────────────────
  { prefix: "SSDSC2KG019T8", name: "Intel D3-S4610 1.92TB SATA SSD", category: "SSD", partType: "SSD", priceMin: 150, priceMax: 280 },
  { prefix: "SSDSC2KG960G8", name: "Intel D3-S4610 960GB SATA SSD", category: "SSD", partType: "SSD", priceMin: 90, priceMax: 170 },
  { prefix: "SSDSC2BB960G7", name: "Intel S3520 960GB SATA SSD", category: "SSD", partType: "SSD", priceMin: 80, priceMax: 160 },
  { prefix: "SSDSC2BB480G7", name: "Intel S3520 480GB SATA SSD", category: "SSD", partType: "SSD", priceMin: 45, priceMax: 90 },
  { prefix: "SSDPE2KX", name: "Intel P4510 NVMe SSD", category: "SSD", partType: "SSD", priceMin: 150, priceMax: 400 },
  { prefix: "SSDSC2", name: "Intel Enterprise SATA SSD", category: "SSD", partType: "SSD", priceMin: 50, priceMax: 200 },

  // ── Micron SSD ────────────────────────────────────────────────────────────
  { prefix: "MTFDDAK3T8TDS", name: "Micron 5300 Pro 3.84TB SATA SSD", category: "SSD", partType: "SSD", priceMin: 280, priceMax: 500 },
  { prefix: "MTFDDAK1T9TDS", name: "Micron 5300 Pro 1.92TB SATA SSD", category: "SSD", partType: "SSD", priceMin: 150, priceMax: 280 },
  { prefix: "MTFDDAK960TDS", name: "Micron 5300 Pro 960GB SATA SSD", category: "SSD", partType: "SSD", priceMin: 90, priceMax: 170 },
  { prefix: "MTFDDAK480TDS", name: "Micron 5300 Pro 480GB SATA SSD", category: "SSD", partType: "SSD", priceMin: 50, priceMax: 95 },
  { prefix: "MTFDDAK", name: "Micron Enterprise SATA SSD", category: "SSD", partType: "SSD", priceMin: 50, priceMax: 300 },

  // ── Dell PSU ──────────────────────────────────────────────────────────────
  { prefix: "0HW7NR", name: "Dell 1100W Platinum PSU", category: "Power supply", partType: "PSU", priceMin: 40, priceMax: 80 },
  { prefix: "0G6W6C", name: "Dell 750W Platinum PSU", category: "Power supply", partType: "PSU", priceMin: 30, priceMax: 60 },
  { prefix: "0WGNF9", name: "Dell 750W Platinum PSU", category: "Power supply", partType: "PSU", priceMin: 25, priceMax: 55 },
  { prefix: "03KWGT", name: "Dell 750W PSU", category: "Power supply", partType: "PSU", priceMin: 25, priceMax: 55 },
  { prefix: "0Y8Y65", name: "Dell 495W PSU", category: "Power supply", partType: "PSU", priceMin: 20, priceMax: 45 },
  { prefix: "0N24MJ", name: "Dell 495W PSU", category: "Power supply", partType: "PSU", priceMin: 20, priceMax: 45 },

  // ── HPE PSU ───────────────────────────────────────────────────────────────
  { prefix: "865414-B21", name: "HPE 500W Flex Slot Platinum PSU", category: "Power supply", partType: "PSU", priceMin: 25, priceMax: 55 },
  { prefix: "720478-B21", name: "HPE 800W Flex Slot Platinum PSU", category: "Power supply", partType: "PSU", priceMin: 35, priceMax: 70 },
  { prefix: "684539-001", name: "HPE 1200W Platinum PSU", category: "Power supply", partType: "PSU", priceMin: 50, priceMax: 100 },
  { prefix: "656364-B21", name: "HPE 460W Common Slot Platinum PSU", category: "Power supply", partType: "PSU", priceMin: 20, priceMax: 45 },
  { prefix: "643954-201", name: "HPE 750W Common Slot Platinum PSU", category: "Power supply", partType: "PSU", priceMin: 30, priceMax: 60 },

  // ── NVIDIA GPU ────────────────────────────────────────────────────────────
  { prefix: "900-2G500", name: "NVIDIA Tesla V100 16GB GPU", category: "GPU accelerator", partType: "GPU", priceMin: 1500, priceMax: 3000 },
  { prefix: "900-2G402", name: "NVIDIA Tesla P4 8GB GPU", category: "GPU accelerator", partType: "GPU", priceMin: 200, priceMax: 400 },
  { prefix: "900-2G133", name: "NVIDIA Tesla M60 GPU", category: "GPU accelerator", partType: "GPU", priceMin: 300, priceMax: 600 },
  { prefix: "900-2G415", name: "NVIDIA Tesla P100 GPU", category: "GPU accelerator", partType: "GPU", priceMin: 400, priceMax: 900 },

  // ── Network cards ─────────────────────────────────────────────────────────
  { prefix: "MCX4121A", name: "Mellanox ConnectX-5 25GbE NIC", category: "Network adapter", partType: "NIC", priceMin: 100, priceMax: 200 },
  { prefix: "MCX312A", name: "Mellanox ConnectX-3 10GbE NIC", category: "Network adapter", partType: "NIC", priceMin: 25, priceMax: 60 },
  { prefix: "MCX311A", name: "Mellanox ConnectX-3 10GbE NIC", category: "Network adapter", partType: "NIC", priceMin: 20, priceMax: 50 },
  { prefix: "E10G42BTDA", name: "Intel X520-DA2 10GbE NIC", category: "Network adapter", partType: "NIC", priceMin: 80, priceMax: 150 },
  { prefix: "X550T2BLK", name: "Intel X550-T2 10GbE NIC", category: "Network adapter", partType: "NIC", priceMin: 180, priceMax: 320 },
].sort((a, b) => b.prefix.length - a.prefix.length); // longest prefix wins

export function lookupCatalog(query: string): CatalogEntry | null {
  const normalised = query.trim().toUpperCase();
  return CATALOG.find((entry) => normalised.startsWith(entry.prefix.toUpperCase())) ?? null;
}
