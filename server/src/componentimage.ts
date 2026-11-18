interface WikiSummary {
  thumbnail?: { source?: string };
}

// Maps catalog partType values to Wikipedia article titles
const PART_TYPE_ARTICLE: Record<string, string> = {
  DIMM: "ECC_memory",
  HDD: "Hard_disk_drive",
  SSD: "Solid-state_drive",
  PSU: "Power_supply_unit_(computer)",
  GPU: "Video_card",
  NIC: "Network_interface_controller",
  CPU: "Central_processing_unit",
  RAID: "Disk_array_controller",
};

const cache = new Map<string, string | null>();

export async function getComponentImageUrl(partType: string): Promise<string | null> {
  const key = partType.toUpperCase();
  if (cache.has(key)) return cache.get(key)!;

  const article = PART_TYPE_ARTICLE[key];
  if (!article) { cache.set(key, null); return null; }

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(article)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "teardown-app/1.0 (server-component-identifier)" },
    signal: AbortSignal.timeout(2500),
  });

  if (!response.ok) { cache.set(key, null); return null; }

  const data = (await response.json()) as WikiSummary;
  const imageUrl = data.thumbnail?.source ?? null;
  cache.set(key, imageUrl);
  return imageUrl;
}
