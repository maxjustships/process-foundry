import { expect, test } from "@playwright/test";

test("confirmed question evidence persists and is applied only by explicit rebuild", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/login?next=/projects");
  await page.getByRole("button", { name: /switch to english/i }).click();
  await page
    .getByLabel("Mnemonic phrase")
    .fill("test-only amber river compass");
  await page.getByRole("button", { name: "Open workspace" }).click();

  const title = `Clarification workflow ${Date.now()}`;
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await page
    .getByRole("textbox", { name: "Process description", exact: true })
    .fill("A clerk receives a request, checks it, and completes it.");
  await page.getByRole("button", { name: "Confirm text" }).click();
  const baseSource = page.getByRole("checkbox", {
    name: "Use Pasted process description for generation",
    exact: true,
  });
  await expect(baseSource).toBeVisible();
  await baseSource.check();
  await page.getByRole("button", { name: "Generate version 1" }).click();
  await expect(page.getByText("Diagram ready for review")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible({
    timeout: 20_000,
  });

  const versionSelect = page.getByLabel("Version");
  await expect(versionSelect.locator("option")).toHaveCount(1);
  const canvasUndo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(canvasUndo).toBeDisabled();
  const answer = page.getByLabel("Confirmed answer");
  await answer.fill("Finance lead draft");
  const beforeNativeUndo = await answer.inputValue();
  await answer.press("ControlOrMeta+z");
  await expect.poll(() => answer.inputValue()).not.toBe(beforeNativeUndo);
  await expect(canvasUndo).toBeDisabled();
  await answer.fill("The finance lead owns the completeness review.");

  const answerResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/questions/question_owner/answer") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Confirm answer" }).click();
  const response = await answerResponse;
  expect(response.status()).toBe(201);
  expect(await response.json()).toEqual({
    ok: true,
    created: true,
    status: "answered",
  });
  await expect(page.getByText("Answered — not yet applied")).toBeVisible();
  await expect(answer).toHaveValue(
    "The finance lead owns the completeness review.",
  );
  await expect(answer).toHaveAttribute("readonly", "");
  await expect(versionSelect.locator("option")).toHaveCount(1);
  await expect(
    page.getByRole("checkbox", {
      name: "Use Confirmed question answer for generation",
    }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("group", { name: "Generation approach" })
      .getByRole("radio", { name: "Refine current diagram" }),
  ).toBeChecked();
  await expect(
    page.getByRole("region", { name: "Generation preflight" }),
  ).toContainText("1 clarification");
  const nextVersion = page.getByRole("region", {
    name: "Generation preflight",
  });
  await expect(nextVersion).toContainText("Auto-applied answers");
  await expect(nextVersion).toContainText(
    "The finance lead owns the completeness review.",
  );
  const approach = page.getByRole("group", { name: "Generation approach" });
  await approach
    .getByRole("radio", { name: "Create alternative diagram" })
    .check();
  await expect(nextVersion).toContainText(
    "No confirmed answers will be applied",
  );
  await expect(nextVersion).not.toContainText(
    "The finance lead owns the completeness review.",
  );
  await approach.getByRole("radio", { name: "Refine current diagram" }).check();

  const projectId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
  const firstVersionId = await versionSelect
    .locator("option")
    .getAttribute("value");
  expect(firstVersionId).not.toBeNull();
  const apiChecks = await page.evaluate(
    async ({ projectId, versionId }) => {
      async function post(path: string, answer: string) {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer }),
        });
        return { status: response.status, body: await response.json() };
      }
      const route = `/api/projects/${projectId}/versions/${versionId}/questions`;
      return {
        same: await post(
          `${route}/question_owner/answer`,
          "  The finance lead owns the completeness review.  ",
        ),
        different: await post(
          `${route}/question_owner/answer`,
          "A different private answer that must not be echoed.",
        ),
        unknownQuestion: await post(`${route}/unknown/answer`, "Confirmed"),
        unknownVersion: await post(
          `/api/projects/${projectId}/versions/unknown/questions/question_owner/answer`,
          "Confirmed",
        ),
        unknownProject: await post(
          `/api/projects/unknown/versions/${versionId}/questions/question_owner/answer`,
          "Confirmed",
        ),
        oversized: await post(
          `${route}/question_owner/answer`,
          "x".repeat(25_000),
        ),
      };
    },
    { projectId, versionId: firstVersionId ?? "" },
  );
  expect(apiChecks.same).toEqual({
    status: 200,
    body: { ok: true, created: false, status: "answered" },
  });
  expect(apiChecks.different.status).toBe(409);
  expect(apiChecks.unknownQuestion.status).toBe(404);
  expect(apiChecks.unknownVersion.status).toBe(404);
  expect(apiChecks.unknownProject.status).toBe(404);
  expect(apiChecks.oversized.status).toBe(413);
  expect(JSON.stringify(apiChecks)).not.toContain(
    "A different private answer that must not be echoed.",
  );

  await page.reload();
  await expect(page.getByText("Answered — not yet applied")).toBeVisible();
  await expect(page.getByLabel("Confirmed answer")).toHaveValue(
    "The finance lead owns the completeness review.",
  );
  await expect(page.getByLabel("Version").locator("option")).toHaveCount(1);

  await page
    .getByRole("textbox", { name: "Process description", exact: true })
    .fill(
      "[synthetic:changed-owner-question] The owner question changed for the next review.",
    );
  await page.getByRole("button", { name: "Confirm text" }).click();
  await expect(nextVersion).toContainText(/2 sources[\s\S]*1 clarification/);

  await page.getByRole("button", { name: "Generate version 2" }).click();
  await expect(page.getByText("Diagram ready for review")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.getByLabel("Version").locator("option")).toHaveCount(2, {
    timeout: 45_000,
  });
  await expect(
    page.getByText("Which role approves the completed review?"),
  ).toBeVisible();
  const currentAnswer = page.getByLabel("Confirmed answer");
  await expect(currentAnswer).toHaveValue("");
  await expect(currentAnswer).not.toHaveAttribute("readonly", "");
  await currentAnswer.fill("The operations director approves it.");
  await expect(
    page.getByRole("button", { name: "Confirm answer" }),
  ).toBeEnabled();
  const appliedHistory = page.getByRole("region", {
    name: "Applied clarification history",
  });
  await expect(appliedHistory).toContainText(
    "Who is accountable for checking whether the information is complete?",
  );
  await expect(appliedHistory).toContainText(
    "The finance lead owns the completeness review.",
  );
  await expect(appliedHistory).toContainText("Origin version 1");
  await expect(appliedHistory).toContainText("Applied in version 2");
  await expect(
    page.getByRole("button", { name: /Rebuild BPMN with/ }),
  ).toHaveCount(0);

  const oldVersionId = await page
    .getByLabel("Version")
    .locator("option")
    .filter({ hasText: "v1" })
    .getAttribute("value");
  const newVersionId = await page
    .getByLabel("Version")
    .locator("option")
    .filter({ hasText: "v2" })
    .getAttribute("value");
  expect(oldVersionId).not.toBeNull();
  expect(newVersionId).not.toBeNull();
  await page.getByLabel("Version").selectOption(newVersionId ?? "");
  await page.getByLabel("Version").selectOption(oldVersionId ?? "");
  await expect(page.getByLabel("Confirmed answer")).toHaveValue(
    "The finance lead owns the completeness review.",
  );
  await expect(page.getByLabel("Confirmed answer")).toHaveAttribute(
    "readonly",
    "",
  );

  await page.getByRole("button", { name: /switch to russian/i }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Подтверждённый ответ",
      exact: true,
    }),
  ).toHaveValue("The finance lead owns the completeness review.");
  await page.getByLabel("Версия").selectOption(newVersionId ?? "");
  await expect(
    page.getByRole("region", { name: "История применённых уточнений" }),
  ).toContainText("Применён в версии 2");
  await page.getByRole("button", { name: /switch to english/i }).click();
  await expect(page.getByText("Applied in version 2")).toBeVisible();
});
