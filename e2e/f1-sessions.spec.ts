import { expect, test } from "@playwright/test";
import { startSession } from "./helpers";

test("scanning the service tag starts the teardown with no typing", async ({ page }) => {
  await startSession(page, "/scan?feed=1", "7XK2Q53");
  await expect(page.getByTestId("session-line")).toHaveText("7XK2Q53 · Model: detecting…");
});

test("component barcodes in view are not taken as the server tag", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await page.getByTestId("fake-tag-input").fill("M393A4K40CB2-CTD | CN0HW7NR7893153P0123A00 | 7XK2Q53");
  await page.getByTestId("inject-tag-btn").click();
  await expect(page.getByTestId("session-line")).toContainText("7XK2Q53");
});

test("only part numbers in view does not start a session", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await page.getByTestId("fake-tag-input").fill("ST4000NM0035 | 865414-B21");
  await page.getByTestId("inject-tag-btn").click();
  await expect(page.getByRole("alert")).toHaveText("No server tag in those codes");
  await expect(page.getByRole("heading", { name: "Scan the server" })).toBeVisible();
});

test("a server with no tag can still be started without typing", async ({ page }) => {
  await page.goto("/scan?feed=1");
  await page.getByTestId("start-untagged-btn").click();
  await expect(page.getByTestId("session-line")).toContainText("UNTAGGED-");
});

test("the first sweep fills in the server model", async ({ page }) => {
  await startSession(page, "/scan?feed=1", "SVR-MODEL-01");
  await page.getByTestId("ai-find-btn").click();
  await expect(page.getByTestId("session-line")).toHaveText("SVR-MODEL-01 · Dell PowerEdge R740");
});

test("rescan tag goes back to the start camera", async ({ page }) => {
  await startSession(page, "/scan?feed=1", "SVR-WRONG-01");
  await page.getByTestId("rescan-tag-btn").click();
  await expect(page.getByRole("heading", { name: "Scan the server" })).toBeVisible();
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
