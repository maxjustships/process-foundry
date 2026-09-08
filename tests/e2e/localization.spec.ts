import { expect, test } from "@playwright/test";

test("SSR locale switch persists from Russian login into the authenticated workspace", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          Promise.reject(
            new DOMException("Denied for test", "NotAllowedError"),
          ),
      },
    });
  });

  await page.route("http://evil.example/**", async (route) => {
    await route.fulfill({ status: 200, body: "external redirect reached" });
  });

  await page.goto("/login?next=%2F%5Cevil.example%2Fsteal&locale_probe=1");
  const loginUrl = page.url();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page).toHaveTitle("Вход · Process Foundry");
  await expect(
    page.getByRole("heading", { name: "Введите общую фразу" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /русский.*выбран/i }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /switch to english/i }).click();
  await expect(page).toHaveURL(loginUrl);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByLabel("Mnemonic phrase")).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  await page
    .getByLabel("Mnemonic phrase")
    .fill("test-only amber river compass");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:5199/");

  const missingProjectUrl = "/projects/00000000-0000-4000-8000-000000000000";
  await page.goto(missingProjectUrl);
  await expect(page.getByText("Project was not found.")).toBeVisible();
  await page.getByRole("button", { name: /switch to russian/i }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:5199${missingProjectUrl}`);
  await expect(page.getByText("Проект не найден.")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page.goto("/projects");
  await page.getByRole("button", { name: /switch to english/i }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  const title = `Locale coverage ${Date.now()}`;
  await page.getByLabel("Project title").fill(title);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  const projectUrl = page.url();

  await page.getByRole("button", { name: /switch to russian/i }).click();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(
    page.getByRole("button", { name: "Запросить доступ к микрофону" }),
  ).toBeVisible();
  await expect(page.getByText("Удалить данные проекта")).toBeVisible();
  await page
    .getByRole("button", { name: "Запросить доступ к микрофону" })
    .click();
  await expect(page.getByText(/Доступ к микрофону запрещён/)).toBeVisible();

  const picker = page.getByLabel("Выбрать аудио, изображения или таблицы");
  await picker.setInputFiles({
    name: "unsupported.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await page.getByRole("button", { name: "Подтвердить 1 файл" }).click();
  await expect(page.getByText(/Используйте изображения JPEG/)).toBeVisible();
  consoleErrors.length = 0;

  await page
    .getByLabel("Описание процесса")
    .fill("Сотрудник получает заявку, проверяет её и завершает обработку.");
  await page.getByRole("button", { name: "Подтвердить текст" }).click();
  const localizationSource = page.getByRole("checkbox", {
    name: "Использовать «Описание процесса из буфера» для генерации",
    exact: true,
  });
  await expect(localizationSource).toBeVisible();
  await localizationSource.check();
  await page.getByRole("button", { name: "Создать версию 1" }).click();
  await expect(page.getByText("Диаграмма готова к проверке")).toBeVisible({
    timeout: 45_000,
  });
  await expect(page.locator(".bpmn-canvas .djs-container")).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText("Кто отвечает за проверку полноты информации?"),
  ).toBeVisible();
  await expect(
    page.getByText("Ответственную роль должен подтвердить проверяющий."),
  ).toBeVisible();
  await expect(
    page.locator(".bpmn-canvas .djs-label", { hasText: "Проверить заявку" }),
  ).toBeVisible();
  await expect(page.getByText("Review request", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.locator('.djs-palette [title="Создать задачу"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сохранить новую версию" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Экспорт BPMN" }),
  ).toBeVisible();
  await expect(page.getByLabel("Оценка результата")).toBeVisible();
  await expect(page.getByLabel("Отзыв")).toBeVisible();
  await expect(
    page
      .locator(".review-item.source-ref p", {
        hasText: "Описание процесса из буфера",
      })
      .first(),
  ).toBeVisible();
  await expect(
    page.locator(".review-item.source-ref p", {
      hasText: "Pasted process description",
    }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "4 из 5" }).click();
  await page
    .getByLabel("Отзыв")
    .fill("Вопросы помогают проверить ответственного за этап.");
  await page.getByRole("button", { name: "Сохранить отзыв" }).click();
  await expect(page.getByText(/Отзыв сохранён · ID/)).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page.getByRole("link", { name: "Телеметрия" }).click();
  await expect(
    page.getByRole("heading", { name: "Семантическая хронология" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(
    page.getByRole("button", { name: "Сохранить новую версию" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /switch to english/i }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("button", { name: "Save new version" }),
  ).toBeVisible();
  await expect(page.getByLabel("Result rating")).toBeVisible();
  await expect(
    page.locator(".confirmed-sources strong", {
      hasText: "Pasted process description",
    }),
  ).toBeVisible();
  await expect(page.getByText("Delete project data")).toBeVisible();

  await page.getByRole("button", { name: /switch to russian/i }).click();
  await page.getByText("Удалить данные проекта").click();
  await page.getByLabel("Я понимаю, что это действие нельзя отменить.").check();
  await page
    .getByRole("button", { name: "Удалить проект и исходные материалы" })
    .click();
  await expect(page).toHaveURL(/\/projects$/);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});
