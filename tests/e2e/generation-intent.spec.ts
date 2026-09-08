import { expect, test } from "@playwright/test";
import { MOCK_FIRST_ATTEMPT_DELAY_MARKER } from "../../workers/mock-workflow-delay";

async function loginAndCreateProject(page: import("@playwright/test").Page) {
  await page.goto("/login?next=/projects");
  await page.getByRole("button", { name: /switch to english/i }).click();
  await page
    .getByLabel("Mnemonic phrase")
    .fill("test-only amber river compass");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByLabel("Project title").fill(`Intent UI ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
}

async function addText(page: import("@playwright/test").Page, text: string) {
  await page
    .getByRole("textbox", { name: "Process description", exact: true })
    .fill(text);
  const uploadFinished = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/sources"),
  );
  await page.getByRole("button", { name: "Confirm text" }).click();
  expect((await uploadFinished).ok()).toBe(true);
}

test("preflight, preserved canvas, real cancel, retry snapshot, and provenance stay explicit", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAndCreateProject(page);
  await addText(page, "A clerk receives a request and completes it.");

  const firstGenerate = page.getByRole("button", {
    name: "Generate version 1",
  });
  const firstSource = page.getByRole("checkbox", {
    name: "Use Pasted process description for generation",
  });
  await expect(firstSource).toBeChecked();
  await expect(firstGenerate).toBeInViewport({ ratio: 1 });
  const preflight = page.getByRole("region", { name: "Generation preflight" });
  await expect(preflight).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Review generation details" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Generation approach" }),
  ).toHaveCount(0);
  await expect(firstGenerate).toHaveCount(1);
  await expect(preflight).toContainText("Version 1");
  await expect(preflight).toContainText("Alternative diagram");
  await expect(preflight).toContainText("No base version");
  await expect(preflight).toContainText("Pasted process description · text");
  await expect(preflight).toContainText("0 clarifications");
  await expect(preflight).toContainText("Earlier versions will be preserved");
  await expect(preflight).toContainText("Output remains BPMN 2.0");
  await firstGenerate.click();
  await expect(page.getByText("Diagram ready for review")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible();

  await addText(
    page,
    `${MOCK_FIRST_ATTEMPT_DELAY_MARKER} A reviewer checks the request before completion.`,
  );
  const secondGenerate = page.getByRole("button", {
    name: "Generate version 2",
  });
  const sourceChoices = page.getByRole("checkbox", { name: /for generation/ });
  await expect(sourceChoices).toHaveCount(2);
  await expect(sourceChoices.nth(1)).toBeChecked();
  await expect(secondGenerate).toBeInViewport({ ratio: 1 });
  await expect(preflight).toBeInViewport();
  await sourceChoices.nth(0).uncheck();
  const modeChoice = page.getByRole("group", {
    name: "Generation approach",
  });
  await expect(modeChoice).toBeVisible();
  await expect(
    modeChoice.getByRole("radio", { name: "Refine current diagram" }),
  ).toBeChecked();
  const refineChoice = modeChoice.getByRole("radio", {
    name: "Refine current diagram",
  });
  await sourceChoices.nth(1).focus();
  await page.keyboard.press("Tab");
  await expect(refineChoice).toBeFocused();
  expect(
    await refineChoice.evaluate((element) => element.matches(":focus-visible")),
  ).toBe(true);
  expect(
    await refineChoice.evaluate((element) => {
      const label = element.closest("label");
      if (!label) return null;
      const style = getComputedStyle(label);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    }),
  ).toEqual({ outlineStyle: "solid", outlineWidth: "3px" });
  const alternativeChoice = modeChoice.getByRole("radio", {
    name: "Create alternative diagram",
  });
  await refineChoice.press("ArrowDown");
  await expect(alternativeChoice).toBeChecked();
  await alternativeChoice.press("ArrowUp");
  await expect(refineChoice).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expect(preflight).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 720 });
  await modeChoice
    .getByRole("radio", { name: "Create alternative diagram" })
    .check();
  await expect(preflight).toContainText("Version 2");
  await expect(preflight).toContainText("Alternative diagram");
  await expect(preflight).toContainText("No base version");
  await expect(preflight).toContainText("0 clarifications");
  await expect(preflight).toContainText("1 source");
  await expect(preflight).not.toContainText("2 sources");
  const alternativeStarted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/generate"),
  );
  await secondGenerate.click();
  expect((await alternativeStarted).ok()).toBe(true);
  await page.reload();

  const progress = page.getByRole("status", { name: "Generation progress" });
  await expect(progress).toBeVisible();
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible();
  await page.getByRole("button", { name: "Cancel generation" }).click();
  await expect(page.getByText("Generation cancelled")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByLabel("Version").locator("option")).toHaveCount(1);
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible();

  await page.getByRole("button", { name: "Retry identical snapshot" }).click();
  await expect(page.getByText("Diagram ready for review")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByLabel("Version").locator("option")).toHaveCount(2);
  await expect(
    page.getByLabel("Version").locator("option:checked"),
  ).toContainText(/^v2/u);
  await expect(
    page
      .getByLabel("Version")
      .locator("option")
      .filter({
        hasText:
          /v2 · Alternative diagram · No base version · 1 source · Pasted process description · text · 0 clarifications/,
      }),
  ).toHaveCount(1);

  await modeChoice
    .getByRole("radio", { name: "Refine current diagram" })
    .check();
  await expect(preflight).toContainText("Refine current diagram");
  await expect(preflight).toContainText("Base version 2");
  await page.getByRole("button", { name: /switch to russian/i }).click();
  await expect(
    page.getByRole("region", { name: "Проверка перед генерацией" }),
  ).toContainText("Предыдущие версии сохранятся");
});

test("safe failure keeps the last diagram visible and retry reuses the snapshot", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loginAndCreateProject(page);
  await addText(page, "A clerk receives and completes a request.");
  await page.getByRole("checkbox", { name: /for generation/ }).check();
  await page.getByRole("button", { name: "Generate version 1" }).click();
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible({
    timeout: 45_000,
  });

  await addText(
    page,
    "[synthetic:fail-first-extraction] A reviewer checks the request.",
  );
  const choices = page.getByRole("checkbox", { name: /for generation/ });
  await choices.nth(0).uncheck();
  await choices.nth(1).check();
  await page
    .getByRole("group", { name: "Generation approach" })
    .getByRole("radio", { name: "Create alternative diagram" })
    .check();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.getByRole("button", { name: "Generate version 2" }).click();

  await expect(
    page.getByText("Generation stopped safely", { exact: false }),
  ).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByText(/code generation_failed/)).toBeVisible();
  await expect(page.getByText(/Failed at extracting/)).toBeVisible();
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible();
  await expect(page.getByLabel("Version").locator("option")).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: "Generation preflight" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /switch to russian/i }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page.getByRole("button", { name: "Повторить тот же набор" }).click();
  await expect(page.getByText("Диаграмма готова к проверке")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByLabel("Версия").locator("option")).toHaveCount(2);
  await expect(
    page.getByText(
      "Who is accountable for checking whether the information is complete?",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("The responsible role needs reviewer confirmation.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .locator(".bpmn-canvas")
      .getByText("Reviewer confirmation required", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Кто отвечает за проверку полноты информации?", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Ответственную роль должен подтвердить проверяющий.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page
      .locator(".bpmn-canvas")
      .getByText("Требуется подтверждение проверяющего", { exact: true }),
  ).toHaveCount(0);
});
