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

test("the scan screen has only Find with AI and Done as buttons; the rest is under Settings", async ({ page }) => {
  await startSession(page);
  await expect(page.getByTestId("ai-find-btn")).toContainText("Find with AI");
  await expect(page.getByTestId("done-btn")).toBeVisible();
  await expect(page.getByTestId("scan-guidance")).toBeVisible();
  await expect(page.getByTestId("part-type-select")).toBeHidden();
  await page.getByTestId("settings-btn").click();
  await expect(page.getByTestId("part-type-select")).toBeVisible();
});

test("Find with AI lists parts in view, records legible ones and shows what's left", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("ai-find-btn").click();

  await expect(page.getByTestId("scan-feedback")).toContainText("AI found 6 new parts (6 so far). 1 recorded, 5 to add.");
  await expect(page.getByTestId("sweep-part")).toHaveCount(6);
  await expect(page.getByTestId("remaining-DIMM")).toHaveText("DIMMs 0/12");
  await expect(page.getByTestId("remaining-PSU")).toHaveText("PSUs 1/2");
  await expect(page.getByTestId("remaining-CPU")).toHaveText("CPUs 0/2");
  await expect(page.getByTestId("remaining-COOLING")).toHaveText("Cooling 0/8");
});

test("each AI-found part shows what the AI thinks it is, even with no readable part number", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("ai-find-btn").click();
  await expect(page.getByTestId("sweep-part-description")).toHaveText([
    "PSU · Dell · 0HW7NR",
    "DIMM · Samsung · M393A4K40CB2-CTD",
    "CPU · Intel · Xeon Scalable under heatsink",
    "RAID · Dell · PERC mini mono controller",
    "COOLING · Dell · 2U CPU heatsink",
    "COOLING · Dell · hot-swap fan module",
  ]);
  await expect(page.getByTestId("sweep-part").nth(2)).toContainText("not recorded yet");
  await expect(page.getByTestId("sweep-part").nth(2).getByTestId("sweep-part-price")).toHaveText(" · $40–$120 (AI estimate)");
});

test("Add records an AI-found part from its appearance with a price, for review", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("ai-find-btn").click();
  const cpuRow = page.getByTestId("sweep-part").filter({ hasText: "Xeon Scalable under heatsink" });
  await cpuRow.getByTestId("sweep-add-btn").click();

  await expect(cpuRow).toContainText("added");
  const card = page.getByTestId("component-card").first();
  await expect(card.getByTestId("card-recommendation")).toHaveText("REVIEW");
  await expect(card).toContainText("Intel Xeon Gold 6130");
  await expect(card).toContainText("$40–$120");
  await expect(card).toContainText("Rough AI estimate from the part's appearance");
  await expect(page.getByTestId("remaining-CPU")).toHaveText("CPUs 1/2");
});

test("Add on a part whose part number the AI read fills in the checklist", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("ai-find-btn").click();
  await page.getByTestId("sweep-part").filter({ hasText: "M393A4K40CB2-CTD" }).getByTestId("sweep-add-btn").click();

  const newestCard = page.getByTestId("component-card").first();
  await expect(newestCard).toContainText("M393A4K40CB2-CTD");
  await expect(newestCard).toContainText("via AI label read");
  await expect(page.getByTestId("remaining-DIMM")).toHaveText("DIMMs 1/12");
});

test("Add all records every AI-found part that is still waiting", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("ai-find-btn").click();
  await page.getByTestId("ai-add-all-btn").click();
  await expect(page.getByTestId("sweep-add-btn")).toHaveCount(0);
  await expect(page.locator(".recent-units .unit-row")).toHaveCount(6);
});

test("an AI-found part with nothing readable is flagged for a bench test", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("ai-find-btn").click();
  await page.getByTestId("sweep-part").filter({ hasText: "PERC mini mono" }).getByTestId("sweep-add-btn").click();

  const card = page.getByTestId("component-card").first();
  await expect(card).toContainText("Needs review");
  await expect(card).toContainText("needs bench test");
  await expect(card.getByTestId("card-recommendation")).toHaveText("REVIEW");
});

test("a CPU cooler with no label is identified by its look and priced", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("mock-fixture").selectOption("cooler");
  await page.getByTestId("ai-find-btn").click();
  await page.getByTestId("sweep-add-btn").click();

  const card = page.getByTestId("component-card");
  await expect(card).toContainText("SilverStone XE02-SP5B 2U SP5 CPU cooler");
  await expect(card).toContainText("$40–$70");
  await expect(card.getByTestId("card-recommendation")).toHaveText("REVIEW");
  await expect(card.getByTestId("family-note")).toHaveText("Family only, not the exact SKU");
  await expect(page.locator(".recent-units .unit-type").first()).toHaveText("COOLING");
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

test("Remove takes a wrong read out of the session and the checklist", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("ai-find-btn").click();
  await expect(page.getByTestId("remaining-PSU")).toHaveText("PSUs 1/2");
  await page.getByTestId("fake-scan-input").fill("ST4000NM0035 | ZC1ABC23");
  await page.getByTestId("inject-scan-btn").click();
  await expect(page.locator(".recent-units .unit-row")).toHaveCount(2);

  await page.getByTestId("component-card").first().getByTestId("card-remove-btn").click();
  await expect(page.getByTestId("scan-feedback")).toContainText("Removed HDD ZC1ABC23");
  await expect(page.locator(".recent-units .unit-row")).toHaveCount(1);
  await expect(page.getByTestId("component-card")).toHaveCount(1);
});

test("Done shows what was recorded and what is still missing, then Next server starts over", async ({ page }) => {
  await startSession(page);
  await page.getByTestId("ai-find-btn").click();
  await expect(page.getByTestId("sweep-part")).toHaveCount(6);
  await page.getByTestId("done-btn").click();

  await expect(page.getByTestId("done-summary")).toContainText("1 part ·");
  await expect(page.getByTestId("done-gaps")).toContainText("12 DIMMs");
  await page.getByTestId("next-server-btn").click();
  await expect(page.getByTestId("fake-tag-input")).toBeVisible();
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
  await page.getByTestId("ai-find-btn").click();
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
