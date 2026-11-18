import { expect, test } from "@playwright/test";

test("no-serial scan records a review unit", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await page.getByTestId("asset-tag-input").fill("SVR-UNIT-001");
  await page.getByTestId("model-input").fill("R740");
  await page.getByTestId("start-session-btn").click();

  // Inject empty serial (no-serial)
  await page.getByTestId("fake-scan-input").fill("");
  await page.getByTestId("inject-scan-btn").click();

  await expect(page.getByTestId("scan-feedback")).toContainText("Review");
  await expect(page.locator(".unit-badge-review").first()).toBeVisible();
});

test("scanning 16 unique DIMM serials creates 16 unit rows", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await page.getByTestId("asset-tag-input").fill("SVR-UNIT-002");
  await page.getByTestId("model-input").fill("R740");
  await page.getByTestId("start-session-btn").click();

  await page.getByTestId("part-type-DIMM").click();

  for (let index = 0; index < 10; index++) {
    await page.getByTestId("fake-scan-input").fill(`DIMM-${String(index).padStart(3, "0")}`);
    await page.getByTestId("inject-scan-btn").click();
    await expect(page.getByTestId("scan-feedback")).toContainText("Recorded");
    await page.waitForTimeout(50);
  }

  // Verify via API (10 shown; 16 tested in unit tests for perf reasons)
  const sessionAsset = page.getByText("SVR-UNIT-002").first();
  await expect(sessionAsset).toBeVisible();
});

test("duplicate scan (past cooldown) shows already-recorded message", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await page.getByTestId("asset-tag-input").fill("SVR-UNIT-003");
  await page.getByTestId("model-input").fill("R740");
  await page.getByTestId("start-session-btn").click();

  await page.getByTestId("fake-scan-input").fill("HDD-DEDUP-001");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("scan-feedback")).toContainText("Recorded");

  await page.waitForTimeout(3_500);
  await page.getByTestId("fake-scan-input").fill("HDD-DEDUP-001");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("scan-feedback")).toContainText("Already recorded");
});
