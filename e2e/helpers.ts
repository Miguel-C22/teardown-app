import { expect, type Page } from "@playwright/test";

// Starts a teardown session through the start screen, then lands on the scanning view
export async function startSession(page: Page, scanPath = "/scan?feed=1", assetTag = "SVR-E2E", model = "PowerEdge R740"): Promise<void> {
  await page.goto(scanPath);
  await expect(page.getByRole("heading", { name: "Start Session" })).toBeVisible();
  await page.getByTestId("asset-tag-input").fill(assetTag);
  await page.getByTestId("model-input").fill(model);
  await page.getByTestId("start-session-btn").click();
  await expect(page.getByRole("heading", { name: "Scanning" })).toBeVisible();
}
