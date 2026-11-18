import { expect, test } from "@playwright/test";

test("bench page shows export CSV button for each session", async ({ page }) => {
  const response = await page.request.post("/api/sessions", {
    data: { assetTag: "SVR-EXP-001", model: "R740" },
  });
  const session = await response.json() as { id: string };

  await page.request.post(`/api/sessions/${session.id}/units`, {
    data: { partType: "HDD", serial: "WD-EXPORT-001" },
  });

  await page.goto("/bench");
  await expect(page.getByTestId(`export-btn-${session.id}`)).toBeVisible();
});

test("export CSV download includes correct headers and unit rows", async ({ page }) => {
  const sessResponse = await page.request.post("/api/sessions", {
    data: { assetTag: "SVR-EXP-002", model: "ProLiant" },
  });
  const session = await sessResponse.json() as { id: string };

  await page.request.post(`/api/sessions/${session.id}/units`, {
    data: { partType: "PSU", serial: "PSU-CSV-001" },
  });
  await page.request.post(`/api/sessions/${session.id}/units`, {
    data: { partType: "HDD", serial: "HDD-CSV-001" },
  });

  const csvResponse = await page.request.get(`/api/sessions/${session.id}/export.csv`);
  expect(csvResponse.ok()).toBeTruthy();

  const csv = await csvResponse.text();
  const lines = csv.trim().split("\n");
  expect(lines[0]).toBe("sessionId,assetTag,model,partType,serial,status,quantity,scannedAt");
  expect(lines).toHaveLength(3); // header + 2 units
  expect(csv).toContain("PSU-CSV-001");
  expect(csv).toContain("HDD-CSV-001");
});

test("review (no-serial) units appear in export with empty serial", async ({ page }) => {
  const sessResponse = await page.request.post("/api/sessions", {
    data: { assetTag: "SVR-EXP-003", model: "R630" },
  });
  const session = await sessResponse.json() as { id: string };

  await page.request.post(`/api/sessions/${session.id}/units`, {
    data: { partType: "DIMM", serial: null },
  });

  const csvResponse = await page.request.get(`/api/sessions/${session.id}/export.csv`);
  const csv = await csvResponse.text();
  expect(csv).toContain(",review,");
  expect(csv).toMatch(/DIMM,,review/);
});
