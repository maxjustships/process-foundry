import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";

async function downloadBytes(page: Page, buttonName: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: buttonName }).click();
  const download = await pending;
  const path = await download.path();
  expect(path).not.toBeNull();
  return {
    download,
    bytes: await readFile(path!),
  } satisfies { download: Download; bytes: Buffer };
}

function taskX(xml: string): number {
  const shape = xml.match(
    /<bpmndi:BPMNShape[^>]+bpmnElement="task_review"[\s\S]*?<dc:Bounds[^>]+x="([\d.]+)"/u,
  );
  expect(shape?.[1]).toBeTruthy();
  return Number(shape![1]);
}

test("exports BPMN, SVG, and high-resolution PNG from the live edited canvas", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    Object.defineProperty(window, "__revokedExportUrls", {
      configurable: true,
      value: 0,
      writable: true,
    });
    URL.revokeObjectURL = (url: string) => {
      (
        window as Window & { __revokedExportUrls: number }
      ).__revokedExportUrls += 1;
      original(url);
    };
  });
  await page.goto("/login?next=/projects");
  await page.getByRole("button", { name: /switch to english/i }).click();
  await page
    .getByLabel("Mnemonic phrase")
    .fill("test-only amber river compass");
  await page.getByRole("button", { name: "Open workspace" }).click();
  const title = `Live export ${Date.now()}`;
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await page
    .getByRole("textbox", { name: "Process description" })
    .fill("A clerk receives, reviews, and completes a request.");
  await page.getByRole("button", { name: "Confirm text" }).click();
  await page.getByRole("checkbox", { name: /for generation/ }).check();
  await page.getByRole("button", { name: "Generate version 1" }).click();
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible({
    timeout: 45_000,
  });

  const projectId = new URL(page.url()).pathname.split("/").at(-1);
  const baseline = await page.evaluate(async (id) => {
    const response = await fetch(`/api/projects/${id}/export`);
    return response.text();
  }, projectId);
  const task = page
    .locator('[data-element-id="task_review"] .djs-visual')
    .first();
  const box = await task.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 36,
    box!.y + box!.height / 2 + 18,
    {
      steps: 6,
    },
  );
  await page.mouse.up();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeEnabled();

  const bpmn = await downloadBytes(page, "Export BPMN");
  const svg = await downloadBytes(page, "Export SVG");
  const png = await downloadBytes(page, "Export high-resolution PNG");
  const expectedBase = title.toLowerCase().replaceAll(" ", "-");
  expect(bpmn.download.suggestedFilename()).toBe(`${expectedBase}-v1.bpmn`);
  expect(svg.download.suggestedFilename()).toBe(`${expectedBase}-v1.svg`);
  expect(png.download.suggestedFilename()).toBe(`${expectedBase}-v1.png`);

  const liveXml = bpmn.bytes.toString("utf8");
  expect(liveXml).toContain('bpmnElement="task_review"');
  expect(taskX(liveXml)).not.toBe(taskX(baseline));
  expect(svg.bytes.toString("utf8")).toMatch(/^<svg[\s>]/u);
  expect(png.bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.bytes.readUInt32BE(16)).toBeGreaterThan(1000);
  expect(png.bytes.readUInt32BE(20)).toBeGreaterThan(500);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __revokedExportUrls: number })
            .__revokedExportUrls,
      ),
    )
    .toBeGreaterThanOrEqual(4);
});
