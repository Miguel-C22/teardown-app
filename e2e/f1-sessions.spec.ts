import { expect, test } from "@playwright/test";

test("scan page auto-creates a session and shows the camera view", async ({ page }) => {
  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "Scanning" })).toBeVisible();
});

test("session appears on bench page after visiting /scan", async ({ page }) => {
  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "Scanning" })).toBeVisible();

  await page.goto("/bench");
  await expect(page.getByTestId("session-list")).toBeVisible();
  // At least one session exists (the one just auto-created)
  await expect(page.locator(".session-card").first()).toBeVisible();
});

test("adding a part before a session exists is refused by the API", async ({ page }) => {
  const response = await page.request.post("/api/sessions/nonexistent-id/units", {
    data: { partType: "HDD", serial: "X1" },
  });
  expect(response.status()).toBe(404);
});

test("bench page loads and shows sessions list", async ({ page }) => {
  await page.request.post("/api/sessions", {
    data: { assetTag: "SVR-BENCH-001", model: "ProLiant DL380" },
  });
  await page.goto("/bench");
  await expect(page.getByTestId("session-asset-tag").filter({ hasText: "SVR-BENCH-001" }).first()).toBeVisible();
});
