import { expect, type Page, test } from "@playwright/test";

async function expectReadableFirstSourceTitle(page: Page) {
  const title = page.locator(".demo-source-list summary strong").first();
  await expect(title).toBeVisible();
  const box = await title.boundingBox();

  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(80);
  expect(box!.width).toBeGreaterThan(box!.height * 2);
}

async function expectContainedByViewport(page: Page, selector: string) {
  const elements = page.locator(selector);
  const count = await elements.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const box = await elements.nth(index).boundingBox();
    expect(
      box,
      `${selector}[${index}] should have a layout box`,
    ).not.toBeNull();
    expect(
      box!.x,
      `${selector}[${index}] starts offscreen`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      box!.x + box!.width,
      `${selector}[${index}] extends past the viewport`,
    ).toBeLessThanOrEqual(390);
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  expect(baseURL).toBeDefined();
  await context.addCookies([
    { name: "bpmn_locale", value: "en", url: baseURL! },
  ]);
});

test("public sign-in enters the workspace", async ({ page }) => {
  await page.goto("/");
  const signIn = page.locator(".public-sign-in");
  await expect(signIn).toHaveAttribute("href", "/login?next=/projects");
  await signIn.click();
  await page
    .getByLabel("Mnemonic phrase")
    .fill("test-only amber river compass");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page).toHaveURL(/\/projects$/u);
});

test("successful bare login defaults to the workspace", async ({ page }) => {
  await page.goto("/login");
  await page
    .getByLabel("Mnemonic phrase")
    .fill("test-only amber river compass");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page).toHaveURL(/\/projects$/u);
});

test("landing command keeps a manual-copy fallback", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("Clipboard unavailable")),
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Copy command" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Clipboard access failed. Select the command to copy it manually.",
  );
  await expect(
    page.getByText(
      "bash -o pipefail -c 'curl -fsSL https://github.com/maxjustships/process-foundry/releases/latest/download/install.sh | bash'",
    ),
  ).toHaveCSS("user-select", "text");
});

test("public landing leads to an isolated interactive demo", async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.setViewportSize({ width: 1_440, height: 1_000 });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /turn process evidence into a BPMN model your team can challenge/i,
    }),
  ).toBeVisible();
  const titleLineMetrics = await page
    .locator("#landing-title > span")
    .evaluateAll((lines) =>
      lines.map((line) => {
        const styles = getComputedStyle(line);
        return {
          height: line.getBoundingClientRect().height,
          lineHeight: Number.parseFloat(styles.lineHeight),
        };
      }),
    );
  expect(titleLineMetrics).toHaveLength(2);
  for (const metric of titleLineMetrics)
    expect(metric.height).toBeLessThanOrEqual(metric.lineHeight * 1.2);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(".landing-proof .djs-container")).toHaveCount(0);
  await expect(page.locator(".landing-method li")).toHaveCount(4);
  const primaryAction = page.getByRole("button", {
    name: "Copy command",
  });
  const actionBox = await primaryAction.boundingBox();
  expect(actionBox).not.toBeNull();
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(1_000);
  await primaryAction.click();
  await expect(page.getByRole("status")).toHaveText(
    "Command copied to clipboard.",
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "bash -o pipefail -c 'curl -fsSL https://github.com/maxjustships/process-foundry/releases/latest/download/install.sh | bash'",
  );
  const proofBox = await page.locator(".landing-proof img").boundingBox();
  expect(proofBox).not.toBeNull();
  expect(proofBox!.width).toBeGreaterThan(1_000);
  const demoLinkBox = await page
    .getByRole("link", { name: /interactive demo/i })
    .boundingBox();
  expect(demoLinkBox).not.toBeNull();
  expect(demoLinkBox!.width).toBeGreaterThan(180);
  expect(consoleErrors).toEqual([]);
  await page.getByRole("link", { name: /interactive demo/i }).click();
  await expect(page).toHaveURL(/\/demo$/u);
  await expect(
    page.getByRole("heading", {
      name: /return review and resolution/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Select a model element, then inspect its linked evidence."),
  ).toBeVisible();
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible({
    timeout: 20_000,
  });
  await expectReadableFirstSourceTitle(page);
  const canvasBox = await page.locator(".demo-canvas-column").boundingBox();
  const demoRailBox = await page.locator(".demo-project-rail").boundingBox();
  const commandBarBox = await page.locator(".demo-command-bar").boundingBox();
  const sourceTextBox = await page
    .locator(".demo-source-list summary > span:last-of-type")
    .first()
    .boundingBox();
  const renderedLabels = page.locator(".bpmn-canvas .djs-label");
  await expect(renderedLabels.first()).toBeVisible();
  const hasNontrivialVisibleLabel = await renderedLabels.evaluateAll(
    (labels) => {
      const viewport = labels[0]
        ?.closest(".bpmn-canvas")
        ?.getBoundingClientRect();
      if (!viewport) return false;

      return labels.some((label) => {
        const box = label.getBoundingClientRect();
        const intersectsViewport =
          box.right > viewport.left &&
          box.left < viewport.right &&
          box.bottom > viewport.top &&
          box.top < viewport.bottom;
        return intersectsViewport && box.width > 20 && box.height > 8;
      });
    },
  );

  expect(canvasBox).not.toBeNull();
  expect(demoRailBox).not.toBeNull();
  expect(commandBarBox).not.toBeNull();
  expect(canvasBox!.width).toBeGreaterThanOrEqual(950);
  expect(canvasBox!.height).toBeGreaterThanOrEqual(680);
  expect(demoRailBox!.height).toBe(canvasBox!.height);
  expect(commandBarBox!.height).toBeLessThan(130);
  expect(canvasBox!.y).toBeLessThan(220);
  expect(sourceTextBox).not.toBeNull();
  expect(sourceTextBox!.width).toBeGreaterThanOrEqual(160);
  expect(hasNontrivialVisibleLabel).toBe(true);
  const palette = page.locator(".demo-canvas-column .djs-palette");
  const taskLabelBox = await page
    .locator(
      '.demo-canvas-column .djs-element[data-element-id="review_request"] .djs-label',
    )
    .boundingBox();
  await expect(palette).toBeHidden();
  expect(
    await palette.evaluate((element) => getComputedStyle(element).display),
  ).toBe("none");
  expect(taskLabelBox).not.toBeNull();
  expect(taskLabelBox!.height).toBeGreaterThan(9);

  await page.locator('.djs-element[data-element-id="policy_check"]').click();
  await expect(page.locator(".demo-selection-context strong")).toHaveText(
    "Policy requirements met?",
  );
  await expect(page.locator(".demo-source-list details.is-linked")).toHaveCount(
    1,
  );
  await page
    .locator(".demo-source-list details")
    .nth(1)
    .locator("summary")
    .click();
  await expect(
    page.locator(".demo-source-list details").nth(1),
  ).toHaveAttribute("open", "");
  await page.getByLabel(/version/i).selectOption({ index: 1 });
  await expect(page.locator(".demo-version-note strong")).toHaveText(
    "Initial process model",
  );
  await page.getByRole("button", { name: /fit diagram/i }).click();
  await page.getByRole("button", { name: /zoom in/i }).click();
  await page.getByRole("button", { name: /zoom out/i }).click();
  await page.getByRole("button", { name: /expand diagram/i }).click();
  await expect(page.locator(".canvas-shell")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page.getByRole("button", { name: /collapse diagram/i }).click();
  await page.getByRole("button", { name: /reset model/i }).click();
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible();

  const requests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) requests.push(url.pathname);
  });
  await page.reload();
  expect(requests).toEqual([]);
});

test("public routes stay usable on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Copy command" }),
  ).toBeVisible();
  const landingMethodItems = page.locator(".landing-method li");
  await expect(landingMethodItems).toHaveCount(4);
  await expectContainedByViewport(page, ".landing-method li");
  const proofViewport = page.locator(".landing-proof-viewport");
  const proofImage = proofViewport.locator("img");
  const proofViewportBox = await proofViewport.boundingBox();
  const proofImageBox = await proofImage.boundingBox();
  expect(proofViewportBox).not.toBeNull();
  expect(proofImageBox).not.toBeNull();
  expect(proofViewportBox!.height).toBeGreaterThanOrEqual(400);
  expect(proofViewportBox!.x + proofViewportBox!.width).toBeLessThanOrEqual(
    390,
  );
  expect(proofImageBox!.width).toBeGreaterThanOrEqual(760);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => {
      const footer = document.querySelector(".public-footer");
      if (!footer) return Number.POSITIVE_INFINITY;
      return (
        document.documentElement.scrollHeight -
        footer.getBoundingClientRect().bottom
      );
    }),
  ).toBeLessThanOrEqual(1);
  await expectContainedByViewport(page, ".landing-why-reasons > p");
  await page.goto("/demo");
  await expect(
    page.getByRole("heading", { name: /return review and resolution/i }),
  ).toBeVisible();
  await expect(
    page.locator(".demo-canvas-column .bpmn-canvas .djs-container"),
  ).toBeVisible({ timeout: 20_000 });
  const toolbarTitleBox = await page
    .locator(".demo-project-identity h1")
    .boundingBox();
  const toolbarSummaryBox = await page
    .locator(".demo-project-identity p")
    .boundingBox();
  expect(toolbarTitleBox).not.toBeNull();
  expect(toolbarSummaryBox).not.toBeNull();
  expect(toolbarSummaryBox!.y).toBeGreaterThanOrEqual(
    toolbarTitleBox!.y + toolbarTitleBox!.height,
  );
  await expectReadableFirstSourceTitle(page);
  const reference = page.locator(".demo-reference").first();
  const referenceText = reference.locator("p");
  await expect(reference).toBeVisible();
  expect(
    await reference.evaluate((element) => getComputedStyle(element).display),
  ).toBe("block");
  const referenceBox = await reference.boundingBox();
  const referenceTextBox = await referenceText.boundingBox();
  expect(referenceBox).not.toBeNull();
  expect(referenceTextBox).not.toBeNull();
  expect(referenceBox!.width).toBeGreaterThanOrEqual(330);
  expect(Math.abs(referenceTextBox!.width - referenceBox!.width)).toBeLessThan(
    1,
  );
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expectContainedByViewport(
    page,
    ".demo-command-bar, .demo-project-identity, .demo-command-actions, .demo-command-actions > label, .demo-command-actions > button, .demo-grid, .demo-canvas-column, .demo-canvas-column .canvas-shell, .demo-canvas-column .canvas-shell > header, .demo-canvas-column .editor-header-controls, .demo-canvas-column .editor-toolbar, .demo-canvas-column .editor-actions, .demo-canvas-column .export-actions, .demo-project-rail, .demo-sources, .demo-review, .demo-review-item, .demo-reference",
  );
  const touchTargets = page.locator(
    ".demo-canvas-column .editor-control, .demo-canvas-column .export-actions button",
  );
  for (let index = 0; index < (await touchTargets.count()); index += 1) {
    const box = await touchTargets.nth(index).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  const mobileCanvasBox = await page
    .locator(".demo-canvas-column .bpmn-canvas")
    .boundingBox();
  const mobileTaskLabel = page.locator(
    '.demo-canvas-column .djs-element[data-element-id="review_request"] .djs-label',
  );
  const mobileStartShape = page.locator(
    '.demo-canvas-column .djs-element[data-element-id="return_submitted"] .djs-visual',
  );
  const mobileStartLabel = page.locator(
    '.demo-canvas-column .djs-element[data-element-id="return_submitted_label"] .djs-label',
  );
  const mobileFirstTaskShape = page.locator(
    '.demo-canvas-column .djs-element[data-element-id="review_request"] .djs-visual',
  );
  const mobileTaskLabelBox = await mobileTaskLabel.boundingBox();
  const mobileStartShapeBox = await mobileStartShape.boundingBox();
  const mobileStartLabelBox = await mobileStartLabel.boundingBox();
  const mobileFirstTaskShapeBox = await mobileFirstTaskShape.boundingBox();
  expect(mobileCanvasBox).not.toBeNull();
  expect(mobileTaskLabelBox).not.toBeNull();
  expect(mobileStartShapeBox).not.toBeNull();
  expect(mobileStartLabelBox).not.toBeNull();
  expect(mobileFirstTaskShapeBox).not.toBeNull();
  expect(mobileCanvasBox!.x).toBeGreaterThanOrEqual(0);
  expect(mobileCanvasBox!.width).toBe(390);
  expect(mobileCanvasBox!.height).toBeGreaterThan(200);
  for (const shapeBox of [mobileStartShapeBox!, mobileFirstTaskShapeBox!]) {
    expect(shapeBox.x).toBeGreaterThanOrEqual(mobileCanvasBox!.x);
    expect(shapeBox.x + shapeBox.width).toBeLessThanOrEqual(
      mobileCanvasBox!.x + mobileCanvasBox!.width,
    );
    expect(shapeBox.y).toBeGreaterThanOrEqual(mobileCanvasBox!.y);
    expect(shapeBox.y + shapeBox.height).toBeLessThanOrEqual(
      mobileCanvasBox!.y + mobileCanvasBox!.height,
    );
  }
  await expect(mobileStartLabel).toContainText("Return submitted");
  expect(mobileStartLabelBox!.x).toBeGreaterThanOrEqual(mobileCanvasBox!.x);
  expect(
    mobileStartLabelBox!.x + mobileStartLabelBox!.width,
  ).toBeLessThanOrEqual(mobileCanvasBox!.x + mobileCanvasBox!.width);
  expect(mobileStartLabelBox!.width).toBeGreaterThanOrEqual(75);
  expect(mobileStartLabelBox!.height).toBeGreaterThanOrEqual(18);
  expect(mobileTaskLabelBox!.x).toBeGreaterThanOrEqual(mobileCanvasBox!.x);
  expect(mobileTaskLabelBox!.x + mobileTaskLabelBox!.width).toBeLessThanOrEqual(
    mobileCanvasBox!.x + mobileCanvasBox!.width,
  );
  expect(mobileTaskLabelBox!.width).toBeGreaterThanOrEqual(75);
  expect(mobileTaskLabelBox!.height).toBeGreaterThanOrEqual(22);
  await expect(page.locator(".bpmn-canvas .djs-shape")).toHaveCount(26);
  await page.locator('.djs-element[data-element-id="review_request"]').click();
  await expect(page.locator(".demo-selection-context strong")).toHaveText(
    "Review request details",
  );
  await expect(page.locator(".demo-source-list details.is-linked")).toHaveCount(
    2,
  );
  const diagramViewport = page.locator(".djs-container .viewport");
  const transformBeforePan = await diagramViewport.getAttribute("transform");
  await page.mouse.move(
    mobileCanvasBox!.x + mobileCanvasBox!.width / 2,
    mobileCanvasBox!.y + mobileCanvasBox!.height / 2,
  );
  await page.mouse.wheel(45, 35);
  const transformAfterPan = await diagramViewport.getAttribute("transform");
  expect(transformAfterPan).not.toBe(transformBeforePan);
  await page.getByRole("button", { name: /zoom in/i }).click();
  expect(await diagramViewport.getAttribute("transform")).not.toBe(
    transformAfterPan,
  );
  await page.getByRole("button", { name: /fit diagram/i }).click();
  const fittedFirstShape = await page
    .locator('.djs-element[data-element-id="return_submitted"]')
    .boundingBox();
  const fittedLastShape = await page
    .locator('.djs-element[data-element-id="return_completed"]')
    .boundingBox();
  expect(fittedFirstShape).not.toBeNull();
  expect(fittedLastShape).not.toBeNull();
  expect(fittedFirstShape!.x).toBeGreaterThanOrEqual(mobileCanvasBox!.x);
  expect(fittedFirstShape!.y).toBeGreaterThanOrEqual(mobileCanvasBox!.y);
  expect(fittedLastShape!.x + fittedLastShape!.width).toBeLessThanOrEqual(
    mobileCanvasBox!.x + mobileCanvasBox!.width,
  );
  expect(fittedLastShape!.y + fittedLastShape!.height).toBeLessThanOrEqual(
    mobileCanvasBox!.y + mobileCanvasBox!.height,
  );
  expect(
    await page.evaluate(
      () =>
        window.innerWidth === 390 &&
        document.documentElement.clientWidth === 390 &&
        document.documentElement.scrollWidth === 390,
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 240, height: 812 });
  await expectReadableFirstSourceTitle(page);
});

test("public routes remain English when the workspace locale is Russian", async ({
  context,
  page,
  baseURL,
}) => {
  expect(baseURL).toBeDefined();
  await context.addCookies([
    { name: "bpmn_locale", value: "ru", url: baseURL! },
  ]);

  for (const path of ["/", "/demo"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator(".language-switcher")).toHaveCount(0);
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toMatch(/[\u0400-\u04ff]/u);
    expect(visibleText).not.toMatch(
      /100% synthetic|no AI calls|sample data|synthetic project/iu,
    );
  }
});

test("real workspaces and mutations remain protected", async ({
  request,
  baseURL,
}) => {
  expect(baseURL).toBeDefined();

  const protectedPages = [
    "/projects",
    "/projects/not-a-project",
    "/admin/telemetry",
  ];
  const protectedMutations = [
    "/api/projects/demo/sources",
    "/api/projects/demo/generate",
    "/api/projects/demo/versions",
    "/api/projects/demo/delete",
    "/api/jobs/demo/cancel",
    "/api/jobs/demo/retry",
    "/api/feedback",
    "/api/events/batch",
  ];

  for (const path of protectedPages) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe(
      `/login?next=${encodeURIComponent(path)}`,
    );
  }

  const origin = new URL(baseURL!).origin;
  for (const path of protectedMutations) {
    const response = await request.post(path, {
      headers: { Origin: origin },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe(
      `/login?next=${encodeURIComponent(path)}`,
    );
  }
});
