import { expect, test, type Page } from "@playwright/test";

async function createGeneratedProject(page: Page) {
  await page.goto("/login?next=/projects");
  await page.getByRole("button", { name: /switch to english/i }).click();
  await page
    .getByLabel("Mnemonic phrase")
    .fill("test-only amber river compass");
  await page.getByRole("button", { name: "Open workspace" }).click();

  const title = `Editor history ${Date.now()}`;
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await page
    .getByLabel("Process description")
    .fill(
      "A clerk receives an invoice, checks it, approves it, and completes the request.",
    );
  await page.getByRole("button", { name: "Confirm text" }).click();
  await page.getByRole("checkbox", { name: /for generation/ }).check();
  await page.getByRole("button", { name: "Generate version 1" }).click();
  await expect(page.getByText("Diagram ready for review")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible({
    timeout: 20_000,
  });
}

async function dragTask(page: Page, deltaX = 36, deltaY = 18) {
  const task = page
    .locator('[data-element-id="task_review"] .djs-visual')
    .first();
  const box = await task.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + deltaX,
    box.y + box.height / 2 + deltaY,
    { steps: 5 },
  );
  await page.mouse.up();
}

async function diagramGeometry(page: Page) {
  return page.locator(".bpmn-canvas").evaluate((canvas) => {
    const canvasBounds = canvas.getBoundingClientRect();
    const paletteBounds = canvas
      .querySelector(".djs-palette")
      ?.getBoundingClientRect();
    const boundsFor = (id: string) => {
      const visual = canvas.querySelector(
        `[data-element-id="${id}"] .djs-visual`,
      );
      if (!visual) throw new Error(`Missing BPMN visual ${id}`);
      const bounds = visual.getBoundingClientRect();
      const paletteOverlap = paletteBounds
        ? Math.max(
            0,
            Math.min(bounds.right, paletteBounds.right) -
              Math.max(bounds.left, paletteBounds.left),
          ) *
          Math.max(
            0,
            Math.min(bounds.bottom, paletteBounds.bottom) -
              Math.max(bounds.top, paletteBounds.top),
          )
        : 0;
      return {
        id,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        fullyVisible:
          bounds.left >= canvasBounds.left &&
          bounds.top >= canvasBounds.top &&
          bounds.right <= canvasBounds.right &&
          bounds.bottom <= canvasBounds.bottom,
        paletteOverlap,
      };
    };

    return {
      canvas: {
        x: canvasBounds.x,
        y: canvasBounds.y,
        width: canvasBounds.width,
        height: canvasBounds.height,
      },
      start: boundsFor("start_received"),
      flowNodes: [
        "start_received",
        "task_review",
        "gateway_complete",
        "task_process",
        "end_incomplete",
        "end_complete",
      ].map(boundsFor),
    };
  });
}

test("fit and first zoom keep generated flow nodes clear and visible", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1_440, height: 1_000 });
  await createGeneratedProject(page);

  await page.getByRole("button", { name: "Fit diagram", exact: true }).click();
  const desktopFit = await diagramGeometry(page);
  expect(desktopFit.start.fullyVisible).toBe(true);
  expect(desktopFit.start.paletteOverlap).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Expand diagram", exact: true })
    .click();
  await page.getByRole("button", { name: "Fit diagram", exact: true }).click();
  const mobileFit = await diagramGeometry(page);
  expect(mobileFit.start.fullyVisible).toBe(true);
  expect(mobileFit.start.paletteOverlap).toBe(0);

  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  const mobileZoomed = await diagramGeometry(page);
  expect(mobileZoomed.start.paletteOverlap).toBe(0);
  expect(mobileZoomed.flowNodes.some((node) => node.fullyVisible)).toBe(true);
});

test("reliable history baselines and persistent expanded editor", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1_440, height: 1_000 });
  await createGeneratedProject(page);

  const diagramBox = await page.locator(".diagram-column").boundingBox();
  const canvasBox = await page.locator(".bpmn-canvas").boundingBox();
  expect(diagramBox).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  expect(diagramBox!.width).toBeGreaterThanOrEqual(850);
  expect(canvasBox!.height).toBeGreaterThanOrEqual(600);

  const undo = page.getByRole("button", { name: "Undo", exact: true });
  const redo = page.getByRole("button", { name: "Redo", exact: true });
  const save = page.getByRole("button", { name: "Save new version" });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await expect(save).toBeDisabled();
  await expect(
    page.getByText(
      "Version loaded. Undo and redo history were reset; this import is the new baseline.",
    ),
  ).toBeVisible();

  const modelerDom = page.locator(".bpmn-canvas .djs-container");
  await modelerDom.evaluate((node) => {
    node.setAttribute("data-persistence-probe", "same-modeler-dom");
  });
  const taskElement = page.locator('[data-element-id="task_review"]').first();
  const baselineTransform = await taskElement.getAttribute("transform");

  await page.getByRole("button", { name: "Expand diagram" }).click();
  const editor = page.getByRole("region", { name: "Editable BPMN diagram" });
  await expect(editor).toHaveClass(/is-expanded/);
  await expect
    .poll(() => page.locator("body").evaluate((body) => body.style.overflow))
    .toBe("hidden");
  await expect(
    page.getByRole("button", { name: "Collapse diagram" }),
  ).toBeVisible();
  expect(
    await editor.evaluate((node) => ({
      position: getComputedStyle(node).position,
      height: node.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
    })),
  ).toEqual({ position: "fixed", height: 1_000, viewportHeight: 1_000 });

  await dragTask(page);
  await expect(undo).toBeEnabled();
  await expect(save).toBeEnabled();
  const movedTransform = await taskElement.getAttribute("transform");
  expect(movedTransform).not.toBe(baselineTransform);

  await taskElement.dblclick();
  await expect(page.locator(".djs-direct-editing-content")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editor).toHaveClass(/is-expanded/);
  await page.keyboard.press("Escape");
  await expect(editor).not.toHaveClass(/is-expanded/);
  await expect
    .poll(() => page.locator("body").evaluate((body) => body.style.overflow))
    .toBe("");
  await expect(modelerDom).toHaveAttribute(
    "data-persistence-probe",
    "same-modeler-dom",
  );
  expect(await taskElement.getAttribute("transform")).toBe(movedTransform);

  const correction = page.getByLabel("Project-level correction");
  await correction.click();
  await page.keyboard.type("native input history");
  const inputBeforeUndo = await correction.inputValue();
  await correction.press("ControlOrMeta+z");
  await expect.poll(() => correction.inputValue()).not.toBe(inputBeforeUndo);
  await expect(undo).toBeEnabled();

  await undo.click();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await expect(save).toBeDisabled();
  await expect(page.getByText("Unsaved edits")).toHaveCount(0);
  await redo.click();
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
  await expect(save).toBeEnabled();

  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/versions") &&
      response.request().method() === "POST",
  );
  await save.click();
  expect((await saveResponse).ok()).toBe(true);
  await expect(
    page.getByText(
      /Version 2 saved\. Undo and redo history were reset; the saved version is the new baseline\./,
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await expect(save).toBeDisabled();

  const versionSelect = page.getByLabel("Version");
  await expect(versionSelect.locator("option")).toHaveCount(2);
  await dragTask(page, -28, 14);
  await expect(undo).toBeEnabled();
  const importedVersionId = await versionSelect
    .locator("option")
    .filter({ hasText: "v1" })
    .getAttribute("value");
  expect(importedVersionId).not.toBeNull();
  await versionSelect.selectOption(importedVersionId ?? "");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  await expect(save).toBeDisabled();
  await expect(
    page.getByText(
      "Version loaded. Undo and redo history were reset; this import is the new baseline.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: /switch to russian/i }).click();
  await expect(page.getByRole("button", { name: "Отменить" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Повторить" })).toBeDisabled();
  await expect(
    page.getByText(
      "Версия загружена. История отмены и повтора сброшена; этот импорт — новая точка отсчёта.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сохранить новую версию" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Экспорт BPMN" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /switch to english/i }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export BPMN" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.bpmn$/u);

  await page.setViewportSize({ width: 360, height: 740 });
  expect(
    await page
      .locator(".diagram-column")
      .evaluate((node) => getComputedStyle(node).order),
  ).toBe("1");
  expect(
    await page
      .locator(".source-rail")
      .evaluate((node) => getComputedStyle(node).order),
  ).toBe("2");
  await page.getByRole("button", { name: "Expand diagram" }).click();
  for (const name of [
    "Undo",
    "Redo",
    "Fit diagram",
    "Zoom out",
    "Zoom in",
    "Collapse diagram",
    "Save new version",
    "Export BPMN",
    "Export SVG",
    "Export high-resolution PNG",
  ])
    await expect(page.getByRole("button", { name })).toBeVisible();
  await page.getByRole("button", { name: "Collapse diagram" }).click();
  await expect(editor).not.toHaveClass(/is-expanded/);
});
