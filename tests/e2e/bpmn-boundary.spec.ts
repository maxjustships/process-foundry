import { expect, test } from "@playwright/test";

test("explicit architecture evidence becomes a BPMN clarification instead of another modality", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/login?next=/projects");
  await page.getByRole("button", { name: /switch to english/i }).click();
  await page
    .getByLabel("Mnemonic phrase")
    .fill("test-only amber river compass");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByLabel("Project title").fill(`BPMN boundary ${Date.now()}`);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByText(
      "BPMN only: describe process steps and handoffs. Requests for architecture or data-flow views become review questions.",
    ),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Process description" })
    .fill(
      "Create a system data-flow diagram. A clerk receives a request, reviews it, and completes it.",
    );
  await page.getByRole("button", { name: "Confirm text" }).click();
  await page.getByRole("checkbox", { name: /for generation/ }).check();
  await page.getByRole("button", { name: "Generate version 1" }).click();

  await expect(
    page.getByText(
      "The evidence requests another diagram modality. Which business process and handoffs should the BPMN represent?",
    ),
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible();
  await expect(page.getByText(/DFD output/i)).toHaveCount(0);
  await page.getByRole("button", { name: /switch to russian/i }).click();
  await expect(
    page.getByText(
      "Только BPMN: опишите этапы процесса и передачу работы. Запросы архитектурных схем или потоков данных станут вопросами для проверки.",
    ),
  ).toBeVisible();
});
