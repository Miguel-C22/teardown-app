import { expect, test } from "@playwright/test";
import { startSession } from "./helpers";

test("a QR code next to the barcodes never replaces the barcode serial", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("fake-scan-input").fill("ST4000NM0035 | ZC1ABC23 | qr:XQ77TRACK9921");
  await page.getByTestId("inject-scan-btn").click();

  await expect(page.getByTestId("scan-feedback")).toContainText("Recorded: HDD ZC1ABC23");
  await expect(page.locator(".recent-units .unit-row")).toHaveCount(1);
  await expect(page.locator(".recent-units .unit-row")).toContainText("ZC1ABC23");
});

test("a Cisco QR code with PID, VID and SN records the optic", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("fake-scan-input").fill("qr:PID: GLC-SX-MMD VID: V01 SN: AGM1234ABCD");
  await page.getByTestId("inject-scan-btn").click();

  await expect(page.locator(".recent-units .unit-row")).toHaveCount(1);
  await expect(page.locator(".recent-units .unit-type").first()).toHaveText("OPTIC");
  await expect(page.locator(".recent-units .unit-row")).toContainText("GLC-SX-MMD · AGM1234ABCD");
});

test("sticker text read on the phone records the part with no AI call", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("fake-scan-input").fill("ocr:Seagate Exos\\nMODEL: ST4000NM0035\\nS/N: ZC9OCR77\\nMade in Thailand");
  await page.getByTestId("inject-scan-btn").click();

  await expect(page.getByTestId("component-card").first()).toContainText("Seagate Exos 4TB Enterprise HDD");
  await expect(page.getByTestId("component-card").first()).toContainText("via sticker text");
  await expect(page.locator(".recent-units .unit-row")).toContainText("ST4000NM0035 · ZC9OCR77");
});

test("unreadable sticker text suggests Find with AI and highlights it", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("fake-scan-input").fill("ocr:smudged %%% ###");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("scan-feedback")).toContainText("use Find with AI");
  await expect(page.getByTestId("ai-find-btn")).toHaveClass(/btn-primary/);
  await expect(page.locator(".recent-units .unit-row")).toHaveCount(0);
});

test("sticker text and barcodes never call the AI", async ({ page }, testInfo) => {
  const assetTag = `SVR-FREE-${testInfo.project.name}-${Date.now().toString(36)}`.toUpperCase();
  await startSession(page, "/scan?feed=1", assetTag);
  await page.getByTestId("fake-scan-input").fill("ocr:MODEL: ST4000NM0035\\nS/N: ZC9FREE1");
  await page.getByTestId("inject-scan-btn").click();
  await page.getByTestId("fake-scan-input").fill("CN0HW7NR7893153P0123A00");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.locator(".recent-units .unit-row")).toHaveCount(2);
  await expect(page.getByTestId("ai-cost")).toContainText("$0.00 used");

  await page.goto("/bench");
  const card = page.locator(".session-card").filter({ hasText: assetTag });
  await card.getByRole("button", { name: "View" }).click();
  await expect(card.getByTestId("vision-calls")).toHaveText("0");
});

test("pressing Find with AI on several areas builds one list without repeats", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("ai-find-btn").click();
  await expect(page.getByTestId("sweep-part")).toHaveCount(6);
  // The same view again: every part matches one already seen
  await page.getByTestId("ai-find-btn").click();
  await expect(page.getByTestId("scan-feedback")).toContainText("AI found 0 new parts (6 so far)");
  await expect(page.getByTestId("sweep-part")).toHaveCount(6);

  // Moving on: the DIMM and fan still in view match, the second PSU (new serial) and the NIC are new
  await page.getByTestId("mock-fixture").selectOption("next-area");
  await page.getByTestId("ai-find-btn").click();
  await expect(page.getByTestId("scan-feedback")).toContainText("AI found 2 new parts (8 so far)");
  await expect(page.getByTestId("sweep-part")).toHaveCount(8);
});

test("a scan with no connection waits on the phone and syncs when the connection is back", async ({ page, context }) => {
  await startSession(page);
  await context.setOffline(true);
  await page.getByTestId("fake-scan-input").fill("ST4000NM0035 | ZC1OFF01");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("pending-saves")).toHaveText("1 waiting to sync");

  await context.setOffline(false);
  await expect(page.getByTestId("pending-saves")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator(".recent-units .unit-row")).toContainText("ZC1OFF01");
});

test("show raw codes lists exactly what was read", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("settings-btn").click();
  await page.getByTestId("raw-codes-toggle").check();
  await page.getByTestId("fake-scan-input").fill("ST4000NM0035 | qr:PID: C9300-24T SN: FOC2233X1AB");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("raw-code")).toHaveCount(2);
  await expect(page.getByTestId("raw-codes")).toContainText("QRCode");
});
