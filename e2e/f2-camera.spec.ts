import { expect, test } from "@playwright/test";

test("scan page enters feed mode when ?feed= param is present (dev build)", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await expect(page.getByRole("heading", { name: "Scanning" })).toBeVisible();
  await expect(page.getByTestId("feed-mode")).toBeVisible();
  await expect(page.getByTestId("fake-scan-input")).toBeVisible();
});

test("injecting a barcode in feed mode records a unit and shows feedback", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await expect(page.getByTestId("feed-mode")).toBeVisible();

  await page.getByTestId("fake-scan-input").fill("SERIAL-XYZ-001");
  await page.getByTestId("inject-scan-btn").click();

  await expect(page.getByTestId("scan-feedback")).toBeVisible();
  await expect(page.getByTestId("scan-feedback")).toContainText("Recorded");
});

test("injecting the same barcode twice returns duplicate feedback", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await expect(page.getByTestId("feed-mode")).toBeVisible();

  await page.getByTestId("fake-scan-input").fill("SERIAL-DUP-001");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("scan-feedback")).toContainText("Recorded");

  await page.waitForTimeout(3_500);
  await page.getByTestId("fake-scan-input").fill("SERIAL-DUP-001");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("scan-feedback")).toContainText("Already recorded");
});

test("part type selector switches the active type", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await expect(page.getByTestId("feed-mode")).toBeVisible();

  await page.getByTestId("part-type-PSU").click();
  await page.getByTestId("fake-scan-input").fill("PSU-001");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.locator(".unit-type").first()).toHaveText("PSU");
});
