import { expect, type Page } from "@playwright/test";

// Starts a teardown by "scanning" the server tag through the dev feed, then lands on the scanning view
export async function startSession(page: Page, scanPath = "/scan?feed=1", assetTag = "SVR-E2E"): Promise<void> {
  await page.goto(scanPath);
  await expect(page.getByRole("heading", { name: "Scan the server" })).toBeVisible();
  await page.getByTestId("fake-tag-input").fill(assetTag);
  await page.getByTestId("inject-tag-btn").click();
  await expect(page.getByRole("heading", { name: "Scanning" })).toBeVisible();
}
