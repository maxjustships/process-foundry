import { expect, test } from "@playwright/test";

function silentWav(seconds = 1): Buffer {
  const sampleRate = 8000;
  const samples = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

test("private mocked journey from login through verified deletion", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  let routePageErrors: string[] = [];
  page.on("pageerror", (error) => {
    const pathname = new URL(page.url()).pathname;
    if (pathname === "/" || pathname.startsWith("/projects/"))
      routePageErrors.push(error.message);
  });
  const expectNoRoutePageErrors = (route: string) => {
    expect(routePageErrors, `Unexpected pageerror on ${route}`).toEqual([]);
    routePageErrors = [];
  };
  await context.addInitScript(() => {
    let permissionRequests = 0;
    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      state: RecordingState = "inactive";
      mimeType: string;
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: ((event: Event) => void) | null = null;

      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        this.mimeType = options?.mimeType ?? "audio/webm";
      }

      start() {
        this.state = "recording";
      }

      pause() {
        this.state = "paused";
      }

      resume() {
        this.state = "recording";
      }

      stop() {
        this.ondataavailable?.(
          new BlobEvent("dataavailable", {
            data: new Blob(["synthetic browser audio"], {
              type: this.mimeType,
            }),
          }),
        );
        this.state = "inactive";
        this.onstop?.(new Event("stop"));
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => {
          permissionRequests += 1;
          if (permissionRequests === 1)
            return Promise.reject(
              new DOMException("Denied for test", "NotAllowedError"),
            );
          return Promise.resolve({
            getTracks: () => [{ stop: () => undefined }],
          });
        },
      },
    });
  });

  await page.goto("/login?next=/projects");
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: /switch to english/i }).click();
  await page
    .getByLabel("Mnemonic phrase")
    .fill("test-only amber river compass");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Recent work" }),
  ).toBeVisible();
  expectNoRoutePageErrors("/projects");

  const title = `E2E invoice process ${Date.now()}`;
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  expectNoRoutePageErrors("/projects/:projectId");

  await page.getByRole("button", { name: "Request microphone" }).click();
  await expect(page.getByText(/Microphone access was denied/)).toBeVisible();
  await page.getByRole("button", { name: "Request microphone" }).click();
  await expect(page.getByText("ready", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Start recording" }).click();
  await page.getByRole("button", { name: "Stop" }).click();
  const recordingUploaded = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/sources") &&
      new URL(response.url()).searchParams.get("kind") === "audio",
  );
  await page.getByRole("button", { name: "Confirm and upload" }).click();
  expect((await recordingUploaded).ok()).toBe(true);

  const browserRecording = page.getByRole("checkbox", {
    name: "Use Browser recording.webm for generation",
  });
  await expect(browserRecording).toBeVisible();
  await expect(browserRecording).toBeChecked();
  await expect(
    page.getByRole("button", { name: "Generate version 1" }),
  ).toBeInViewport({ ratio: 1 });

  await page
    .getByLabel("Process description")
    .fill(
      "A clerk receives an invoice, checks it, approves complete invoices, and marks the request complete.",
    );
  await page.getByRole("button", { name: "Confirm text" }).click();
  await expect(
    page.getByText("Pasted process description", { exact: true }),
  ).toBeVisible();

  const picker = page.getByLabel("Choose audio, images, or tables");
  await picker.setInputFiles({
    name: "unsupported.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await page.getByRole("button", { name: "Confirm 1 file" }).click();
  await expect(page.getByText(/Use JPEG, PNG, WebP/)).toBeVisible();

  await picker.setInputFiles([
    { name: "interview.wav", mimeType: "audio/wav", buffer: silentWav() },
    {
      name: "sketch.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    },
  ]);
  await page.getByRole("button", { name: "Confirm 2 files" }).click();
  await expect(page.getByText("interview.wav")).toBeVisible();
  await expect(page.getByText("sketch.png")).toBeVisible();

  const generationSources = page.getByRole("checkbox", {
    name: /for generation/,
  });
  for (let index = 0; index < (await generationSources.count()); index += 1)
    await generationSources.nth(index).check();
  const generationStarted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/generate"),
  );
  await page.getByRole("button", { name: "Generate version 1" }).click();
  expect((await generationStarted).ok()).toBe(true);
  await page.reload();
  await expect(
    page.getByText(/Currently|Diagram ready for review/),
  ).toBeVisible();
  await expect(page.getByText("Diagram ready for review")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible({
    timeout: 20_000,
  });

  const task = page
    .locator('[data-element-id="task_review"] .djs-visual')
    .first();
  const box = await task.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 35,
      box.y + box.height / 2 + 15,
      { steps: 5 },
    );
    await page.mouse.up();
  }
  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/versions") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save new version" }).click();
  expect((await saveResponse).ok()).toBe(true);
  await expect(page.getByText(/Version \d+ saved/)).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export BPMN" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.bpmn$/);

  await page.getByRole("button", { name: "4 out of 5" }).click();
  await page
    .getByLabel("Feedback")
    .fill(
      "The review question was useful; the owner still needs confirmation.",
    );
  const feedbackSubmittedBatch = page.waitForResponse((response) => {
    if (
      !response.ok() ||
      response.request().method() !== "POST" ||
      new URL(response.url()).pathname !== "/api/events/batch"
    )
      return false;

    try {
      const body: unknown = response.request().postDataJSON();
      if (typeof body !== "object" || body === null || !("events" in body))
        return false;

      const { events } = body as { events?: unknown };
      return (
        Array.isArray(events) &&
        events.some((event: unknown) => {
          if (typeof event !== "object" || event === null) return false;

          const candidate = event as Record<string, unknown>;
          return (
            "event_type" in candidate &&
            candidate.event_type === "feedback.submitted"
          );
        })
      );
    } catch {
      return false;
    }
  });
  await page.getByRole("button", { name: "Save feedback" }).click();
  await expect(page.getByText(/Feedback saved · ID/)).toBeVisible();
  expect((await feedbackSubmittedBatch).ok()).toBe(true);
  expectNoRoutePageErrors("/projects/:projectId");

  await page.getByRole("link", { name: "Telemetry" }).click();
  await expect(
    page.getByRole("heading", { name: "Semantic timeline" }),
  ).toBeVisible();
  await expect(page.getByText("feedback.submitted").first()).toBeVisible();
  await page.goto("/projects");
  await page.getByText(title, { exact: true }).click();
  expectNoRoutePageErrors("/projects and /projects/:projectId");

  await page.getByText("Delete project data").click();
  await page.getByLabel("I understand this cannot be undone.").check();
  await page
    .getByRole("button", { name: "Delete project and source data" })
    .click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  expectNoRoutePageErrors("/projects");
});
