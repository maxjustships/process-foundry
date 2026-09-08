import { expect, test, type Page } from "@playwright/test";

async function useEnglish(page: Page) {
  await page.getByRole("button", { name: /switch to english/i }).click();
}

async function signIn(page: Page) {
  await page
    .getByLabel("Mnemonic phrase")
    .fill("test-only amber river compass");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page).toHaveURL(/\/projects$/u);
}

test("private desktop surfaces share the approved product language", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_440, height: 1_000 });
  await page.goto("/login");
  await useEnglish(page);

  const loginIntro = page.locator(".login-intro");
  const loginPanel = page.locator(".login-panel");
  await expect(loginIntro).toBeVisible();
  await expect(loginPanel).toBeVisible();
  expect(
    await loginIntro.evaluate((node) => getComputedStyle(node).fontFamily),
  ).toContain("Geist");
  expect(
    await loginIntro.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toBe("oklch(0.15 0.026 255)");

  await page.getByLabel("Mnemonic phrase").fill("not the shared phrase");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Sign-in was not accepted. Check the phrase and try again.",
  );
  await signIn(page);

  await expect(
    page.getByRole("heading", { name: "Recent work" }),
  ).toBeVisible();
  const topbar = page.locator(".topbar");
  expect((await topbar.boundingBox())?.height).toBeLessThanOrEqual(72);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  const title = `Presentation desktop ${Date.now()}`;
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  const source = page.locator(".source-rail");
  const diagram = page.locator(".diagram-column");
  const review = page.locator(".review-rail");
  const [sourceBox, diagramBox, reviewBox] = await Promise.all([
    source.boundingBox(),
    diagram.boundingBox(),
    review.boundingBox(),
  ]);
  expect(sourceBox).not.toBeNull();
  expect(diagramBox).not.toBeNull();
  expect(reviewBox).not.toBeNull();
  expect(sourceBox!.width).toBeLessThanOrEqual(280);
  expect(diagramBox!.width).toBeGreaterThanOrEqual(850);
  expect(reviewBox!.width).toBeLessThanOrEqual(300);
  expect(diagramBox!.x).toBe(sourceBox!.x + sourceBox!.width);
  expect(reviewBox!.x).toBe(diagramBox!.x + diagramBox!.width);
  expect(diagramBox!.height).toBe(936);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("private mobile surfaces prioritize the active task without overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await useEnglish(page);

  await expect(
    page.getByRole("button", { name: "Open workspace" }),
  ).toBeInViewport({
    ratio: 1,
  });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Recent work" }),
  ).toBeVisible();

  const title = `Presentation mobile ${Date.now()}`;
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  for (const selector of [
    ".workspace-topbar",
    ".source-rail",
    ".diagram-column",
    ".review-rail",
  ]) {
    const box = await page.locator(selector).boundingBox();
    expect(box, `${selector} should have a layout box`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});
