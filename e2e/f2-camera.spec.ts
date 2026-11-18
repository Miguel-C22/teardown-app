import { expect, test } from "@playwright/test";

// All camera tests use ?feed= mode — no real camera required
test("scan page enters feed mode when ?feed= param is present (dev build)", async ({ page }) => {
  await page.goto("/scan");
  // Create a session first
  await page.getByTestId("asset-tag-input").fill("SVR-CAM-001");
  await page.getByTestId("model-input").fill("R740");
  await page.getByTestId("start-session-btn").click();
  await expect(page.getByRole("heading", { name: "Scanning" })).toBeVisible();

  // Navigate to same route with ?feed= param
  await page.goto("/scan?feed=1");
  await page.getByTestId("asset-tag-input").fill("SVR-CAM-002");
  await page.getByTestId("model-input").fill("R740");
  await page.getByTestId("start-session-btn").click();

  await expect(page.getByTestId("feed-mode")).toBeVisible();
  await expect(page.getByTestId("fake-scan-input")).toBeVisible();
});

test("injecting a barcode in feed mode records a unit and shows feedback", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await page.getByTestId("asset-tag-input").fill("SVR-CAM-003");
  await page.getByTestId("model-input").fill("R740");
  await page.getByTestId("start-session-btn").click();

  await page.getByTestId("fake-scan-input").fill("SERIAL-XYZ-001");
  await page.getByTestId("inject-scan-btn").click();

  await expect(page.getByTestId("scan-feedback")).toBeVisible();
  await expect(page.getByTestId("scan-feedback")).toContainText("Recorded");
});

test("injecting the same barcode twice returns duplicate feedback", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await page.getByTestId("asset-tag-input").fill("SVR-CAM-004");
  await page.getByTestId("model-input").fill("R740");
  await page.getByTestId("start-session-btn").click();

  await page.getByTestId("fake-scan-input").fill("SERIAL-DUP-001");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("scan-feedback")).toContainText("Recorded");

  // Inject the exact same serial again (cooldown would apply immediately after, so we wait)
  await page.waitForTimeout(3_500); // past the 3-second cooldown
  await page.getByTestId("fake-scan-input").fill("SERIAL-DUP-001");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("scan-feedback")).toContainText("Already recorded");
});

test("part type selector switches the active type", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await page.getByTestId("asset-tag-input").fill("SVR-CAM-005");
  await page.getByTestId("model-input").fill("R740");
  await page.getByTestId("start-session-btn").click();

  await page.getByTestId("part-type-PSU").click();
  // Inject a scan and verify the unit row shows PSU
  await page.getByTestId("fake-scan-input").fill("PSU-001");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.locator(".unit-type").first()).toHaveText("PSU");
});
