import { expect, test } from "@playwright/test";

test("login next action hydrates without changing URL serialization", async ({
  context,
  page,
  baseURL,
}) => {
  await context.addCookies([
    { name: "bpmn_locale", value: "en", url: baseURL! },
  ]);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  for (const path of ["/login?next=/projects", "/login?next=%2Fprojects"]) {
    await page.goto(path);
    await expect(page.getByLabel("Mnemonic phrase")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("form.stack-form")).toHaveAttribute(
      "action",
      "/login?next=%2Fprojects",
    );
  }

  expect(errors).toEqual([]);
});

test("audio recorder hydrates from a stable server state", async ({ page }) => {
  const projectPageErrors: string[] = [];
  page.on("pageerror", (error) => {
    if (new URL(page.url()).pathname.startsWith("/projects/"))
      projectPageErrors.push(error.message);
  });

  await page.goto("/login?next=/projects");
  await page.getByRole("button", { name: /switch to english/i }).click();
  await page
    .getByLabel("Mnemonic phrase")
    .fill("test-only amber river compass");
  await page.getByRole("button", { name: "Open workspace" }).click();

  const title = `Hydration regression ${Date.now()}`;
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();

  const projectPath = new URL(page.url()).pathname;
  const serverMarkup = await page.evaluate(async (path) => {
    const response = await fetch(path);
    return response.text();
  }, projectPath);
  const requestButton = page.getByRole("button", {
    name: "Request microphone",
  });
  const startButton = page.getByRole("button", { name: "Start recording" });
  await expect(page.locator(".recorder-state")).toHaveText("idle");
  await expect(requestButton).toBeEnabled();
  await expect(startButton).toBeEnabled();

  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "MediaRecorder");
  });
  await page.reload();
  await expect(page.locator(".recorder-state")).toHaveText("unsupported");
  await expect(
    page.getByText(/This browser cannot record audio/),
  ).toBeVisible();

  await page.getByText("Delete project data").click();
  await page.getByLabel("I understand this cannot be undone.").check();
  await page
    .getByRole("button", { name: "Delete project and source data" })
    .click();
  await expect(page).toHaveURL(/\/projects$/);

  expect(projectPageErrors).toEqual([]);
  expect(serverMarkup).toContain("recorder-state checking");
  expect(serverMarkup).toMatch(
    /<button[^>]*disabled=""[^>]*>Request microphone<\/button>/u,
  );
  expect(serverMarkup).toMatch(
    /<button[^>]*disabled=""[^>]*>Start recording<\/button>/u,
  );
});
