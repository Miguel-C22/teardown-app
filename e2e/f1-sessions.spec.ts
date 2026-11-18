import { expect, test } from "@playwright/test";

test("scan page shows start-session form", async ({ page }) => {
  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "Start Session" })).toBeVisible();
  await expect(page.getByTestId("asset-tag-input")).toBeVisible();
  await expect(page.getByTestId("model-input")).toBeVisible();
  await expect(page.getByTestId("start-session-btn")).toBeVisible();
});

test("creating a session navigates to scanning view", async ({ page }) => {
  await page.goto("/scan");
  await page.getByTestId("asset-tag-input").fill("SVR-E2E-001");
  await page.getByTestId("model-input").fill("PowerEdge R740");
  await page.getByTestId("start-session-btn").click();
  await expect(page.getByRole("heading", { name: "Scanning" })).toBeVisible();
  await expect(page.getByText("SVR-E2E-001")).toBeVisible();
});

test("start form requires both fields", async ({ page }) => {
  await page.goto("/scan");
  await page.getByTestId("start-session-btn").click();
  // Browser validation keeps us on the start screen
  await expect(page.getByRole("heading", { name: "Start Session" })).toBeVisible();
});

test("session appears on bench page after creation", async ({ page }) => {
  // Create session via API so it persists across page navigations
  const response = await page.request.post("/api/sessions", {
    data: { assetTag: "SVR-BENCH-001", model: "ProLiant DL380" },
  });
  expect(response.ok()).toBeTruthy();

  await page.goto("/bench");
  await expect(page.getByTestId("session-asset-tag").filter({ hasText: "SVR-BENCH-001" }).first()).toBeVisible();
});
