import { expect, test } from "@playwright/test";
import { startSession } from "./helpers";

test("a label with a part number and serial is recorded as one valued unit", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("fake-scan-input").fill("ST4000NM0035 | ZC1ABC23");
  await page.getByTestId("inject-scan-btn").click();

  await expect(page.getByTestId("scan-feedback")).toContainText("Recorded: HDD ZC1ABC23");
  await expect(page.getByTestId("component-card")).toContainText("Seagate Exos 4TB Enterprise HDD");
  await expect(page.getByTestId("card-recommendation")).toHaveText("KEEP");
  await expect(page.locator(".unit-row")).toHaveCount(1);
});

test("a Dell PPID alone gives both the part number and the serial", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("fake-scan-input").fill("CN0HW7NR7893153P0123A00");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("component-card")).toContainText("Dell 1100W Platinum PSU");
  await expect(page.locator(".unit-type").first()).toHaveText("PSU");
});

test("sweep lists parts in view, records legible ones and shows what's left", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("sweep-btn").click();

  await expect(page.getByTestId("scan-feedback")).toContainText("Found 6 parts");
  await expect(page.getByTestId("scan-feedback")).toContainText("1 recorded, 5 not read yet");
  await expect(page.getByTestId("sweep-part")).toHaveCount(6);
  await expect(page.getByTestId("remaining-DIMM")).toHaveText("DIMMs 0/12");
  await expect(page.getByTestId("remaining-PSU")).toHaveText("PSUs 1/2");
  await expect(page.getByTestId("remaining-CPU")).toHaveText("CPUs 0/2");
  await expect(page.getByTestId("remaining-COOLING")).toHaveText("Cooling 0/8");
});

test("each found part shows what the AI thinks it is, even with no readable part number", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("sweep-btn").click();
  await expect(page.getByTestId("sweep-part-description")).toHaveText([
    "PSU · Dell · 0HW7NR",
    "DIMM · Samsung · M393A4K40CB2-CTD",
    "CPU · Intel · Xeon Scalable under heatsink",
    "RAID · Dell · PERC mini mono controller",
    "COOLING · Dell · 2U CPU heatsink",
    "COOLING · Dell · hot-swap fan module",
  ]);
  await expect(page.getByTestId("sweep-part").nth(2)).toContainText("seen: not read yet");
  await expect(page.getByTestId("sweep-part").nth(2).getByTestId("sweep-part-price")).toHaveText(" · $40–$120 (AI estimate)");
});

test("add by look records a part from its appearance with a price, for review", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("sweep-btn").click();
  const cpuRow = page.getByTestId("sweep-part").filter({ hasText: "Xeon Scalable under heatsink" });
  await cpuRow.getByTestId("sweep-add-btn").click();

  await expect(cpuRow).toContainText("added");
  // The PSU recorded by the sweep has a card too; the newest card is first
  const card = page.getByTestId("component-card").first();
  await expect(card.getByTestId("card-recommendation")).toHaveText("REVIEW");
  await expect(card).toContainText("Intel Xeon Gold 6130");
  await expect(card).toContainText("$40–$120");
  await expect(card).toContainText("Rough AI estimate from the part's appearance");
  await expect(page.getByTestId("remaining-CPU")).toHaveText("CPUs 1/2");
});

test("a drive label read in two goes ends up as one drive with its serial", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("fake-scan-input").fill("ST2000DM001");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.locator(".recent-units .unit-row")).toHaveCount(1);

  await page.getByTestId("fake-scan-input").fill("Z1E41HH0 | ST2000DM001 | 1CH164-302 | 13395");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("scan-feedback")).toContainText("now has serial Z1E41HH0");
  await expect(page.locator(".recent-units .unit-row")).toHaveCount(1);
  await expect(page.locator(".recent-units .unit-row")).toContainText("ST2000DM001 · Z1E41HH0");
});

test("close-up after a sweep reads the label and fills in the checklist", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("sweep-btn").click();
  await expect(page.getByTestId("sweep-part")).toHaveCount(6);

  await page.getByTestId("sweep-closeup-btn").first().click();
  await expect(page.getByTestId("closeup-btn")).toHaveText("Read DIMM label");
  await page.getByTestId("closeup-btn").click();

  const newestCard = page.getByTestId("component-card").first();
  await expect(newestCard).toContainText("M393A4K40CB2-CTD");
  await expect(newestCard).toContainText("via label read");
  await expect(page.getByTestId("remaining-DIMM")).toHaveText("DIMMs 1/12");
});

test("every result card stays on screen until Clear is tapped", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("fake-scan-input").fill("ST4000NM0035 | ZC1ABC23");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("component-card")).toHaveCount(1);
  await page.getByTestId("fake-scan-input").fill("CN0HW7NR7893153P0123A00");
  await page.getByTestId("inject-scan-btn").click();

  await expect(page.getByTestId("component-card")).toHaveCount(2);
  await expect(page.getByTestId("component-card").first()).toContainText("Dell 1100W Platinum PSU");
  await expect(page.getByTestId("component-card").last()).toContainText("Seagate Exos 4TB Enterprise HDD");

  await page.getByTestId("clear-results-btn").click();
  await expect(page.getByTestId("component-card")).toHaveCount(0);
  await expect(page.locator(".recent-units .unit-row")).toHaveCount(2);
});

test("a CPU cooler with no label is identified by its look and priced", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("mock-fixture").selectOption("cooler");
  await page.getByTestId("closeup-btn").click();

  const card = page.getByTestId("component-card");
  await expect(card).toContainText("SilverStone XE02-SP5B 2U SP5 CPU cooler");
  await expect(card).toContainText("$40–$70");
  await expect(card.getByTestId("card-recommendation")).toHaveText("REVIEW");
  await expect(page.locator(".recent-units .unit-type").first()).toHaveText("COOLING");
});

test("an unreadable part is recorded for review with a bench-test flag", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("mock-fixture").selectOption("unreadable");
  await page.getByTestId("closeup-btn").click();

  await expect(page.getByTestId("component-card")).toContainText("Needs review");
  await expect(page.getByTestId("component-card")).toContainText("needs bench test");
  await expect(page.getByTestId("card-recommendation")).toHaveText("REVIEW");
});

test("the same part number without a serial asks before adding a second part", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("fake-scan-input").fill("865414-B21");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("scan-feedback")).toContainText("Review");

  await page.waitForTimeout(3_500);
  await page.getByTestId("fake-scan-input").fill("865414-B21");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.getByTestId("repeat-prompt")).toBeVisible();
  await page.getByTestId("repeat-add-btn").click();
  await expect(page.locator(".unit-row")).toHaveCount(2);
});

test("bench groups identical parts with a quantity and shows gaps and vision calls", async ({ page }, testInfo) => {
  const assetTag = `SVR-GRP-${testInfo.project.name}-${Date.now().toString(36)}`.toUpperCase();
  await startSession(page, "/scan?feed=1", assetTag);
  await page.getByTestId("sweep-btn").click();
  await expect(page.getByTestId("sweep-part")).toHaveCount(6);
  for (const serial of ["S1AAA001", "S1AAA002", "S1AAA003"]) {
    await page.getByTestId("fake-scan-input").fill(`M393A4K40CB2-CTD | ${serial}`);
    await page.getByTestId("inject-scan-btn").click();
    await expect(page.getByTestId("scan-feedback")).toContainText(serial);
  }

  await page.goto("/bench");
  const card = page.locator(".session-card").filter({ hasText: assetTag });
  await card.getByRole("button", { name: "View" }).click();
  const dimmGroup = card.getByTestId("unit-group").filter({ hasText: "Samsung 32GB DDR4 ECC RDIMM" });
  await expect(dimmGroup.getByTestId("group-quantity")).toHaveText("×3");
  await expect(card.getByTestId("gap-warning")).toContainText("9 DIMMs");
  await expect(card.getByTestId("vision-calls")).toHaveText("1");
});
