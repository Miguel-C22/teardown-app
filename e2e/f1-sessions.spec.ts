import { expect, test } from "@playwright/test";
import { startSession } from "./helpers";

test("scan page asks for the parent server, then shows the scanning view with it", async ({ page }) => {
  await startSession(page, "/scan?feed=1", "SVR-START-001", "ProLiant DL380 Gen10");
  await expect(page.getByTestId("session-line")).toHaveText("SVR-START-001 · ProLiant DL380 Gen10");
});

test("start screen refuses to start without a service tag", async ({ page }) => {
  await page.goto("/scan");
  await page.getByTestId("model-input").fill("PowerEdge R640");
  await page.getByTestId("start-session-btn").click();
  await expect(page.getByRole("heading", { name: "Start Session" })).toBeVisible();
});

test("session appears on bench page after starting one on /scan", async ({ page }) => {
  await startSession(page, "/scan?feed=1", "SVR-BENCH-START");

  await page.goto("/bench");
  await expect(page.getByTestId("session-list")).toBeVisible();
  await expect(page.getByTestId("session-asset-tag").filter({ hasText: "SVR-BENCH-START" }).first()).toBeVisible();
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
