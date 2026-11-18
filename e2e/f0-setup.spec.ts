import { expect, test, type Page } from "@playwright/test";

function collectConsoleErrors(page: Page): string[] {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (pageError) => consoleErrors.push(pageError.message));
  return consoleErrors;
}

test("app loads over HTTPS with the server healthy and no console errors", async ({ page, baseURL }) => {
  expect(baseURL).toMatch(/^https:/);
  const consoleErrors = collectConsoleErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Teardown Scanner" })).toBeVisible();
  await expect(page.getByTestId("server-status")).toHaveText("Server: ok");
  expect(consoleErrors).toEqual([]);
});

for (const route of [
  { path: "/scan", heading: "Scanning" },          // /scan auto-creates session and opens camera
  { path: "/bench", heading: "Sessions" },        // /bench shows sessions list (F10)
]) {
  test(`${route.path} route renders without console errors`, async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await page.goto(route.path);
    await expect(page.getByRole("heading", { name: route.heading })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
}
