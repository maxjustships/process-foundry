import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  dictionaries,
  displaySourceName,
  localeCookie,
  resolveLocale,
  safeReturnTarget,
} from "../../app/lib/i18n";
import { formatDisplayDate } from "../../app/lib/display-date";

describe("locale resolution", () => {
  it("defaults to Russian when no preference cookie exists", () => {
    expect(resolveLocale(new Request("http://localhost/"))).toBe("ru");
    expect(DEFAULT_LOCALE).toBe("ru");
  });

  it.each(["en", "ru"] as const)(
    "accepts the %s preference cookie",
    (locale) => {
      expect(
        resolveLocale(
          new Request("https://example.test/", {
            headers: { Cookie: `bpmn_locale=${locale}` },
          }),
        ),
      ).toBe(locale);
    },
  );

  it("falls back to Russian for an invalid preference cookie", () => {
    expect(
      resolveLocale(
        new Request("https://example.test/", {
          headers: { Cookie: "bpmn_locale=de" },
        }),
      ),
    ).toBe("ru");
  });

  it("sets a first-party HttpOnly Lax cookie and only uses Secure on HTTPS", () => {
    const local = localeCookie("en", new Request("http://127.0.0.1:5199/"));
    const production = localeCookie("ru", new Request("https://example.test/"));

    expect(local).toContain("bpmn_locale=en");
    expect(local).toContain("Path=/");
    expect(local).toContain("SameSite=Lax");
    expect(local).toContain("HttpOnly");
    expect(local).toContain("Max-Age=");
    expect(local).not.toContain("Secure");
    expect(production).toContain("Secure");
  });
});

describe("language return targets", () => {
  it.each([
    ["/", "/"],
    ["/login?next=%2Fprojects%2F123", "/login?next=%2Fprojects%2F123"],
    [
      "/projects/123?version=2&view=review",
      "/projects/123?version=2&view=review",
    ],
  ])("keeps safe relative path/query %s", (target, expected) => {
    expect(safeReturnTarget(target)).toBe(expected);
  });

  it.each([
    "https://evil.example/steal",
    "//evil.example/steal",
    "/\\evil.example/steal",
    "javascript:alert(1)",
    "projects/123",
    "/projects/123#fragment",
    "/projects/123\nLocation:https://evil.example",
  ])("rejects malicious or external return target %s", (target) => {
    expect(safeReturnTarget(target)).toBe("/");
  });
});

describe("localized presentation", () => {
  it("provides complete question clarification controls and states", () => {
    expect(dictionaries.en).toMatchObject({
      "question.answerLabel": "Confirmed answer",
      "question.answerPlaceholder": "Enter the confirmed answer",
      "question.confirm": "Confirm answer",
      "question.confirming": "Confirming…",
      "question.status.open": "Open",
      "question.status.answered": "Answered — not yet applied",
      "question.status.applied": "Applied in version {number}",
      "question.rebuild.one": "Rebuild BPMN with {count} clarification",
      "question.rebuild.many": "Rebuild BPMN with {count} clarifications",
    });
    expect(dictionaries.ru).toMatchObject({
      "question.answerLabel": "Подтверждённый ответ",
      "question.answerPlaceholder": "Введите подтверждённый ответ",
      "question.confirm": "Подтвердить ответ",
      "question.confirming": "Подтверждаем…",
      "question.status.open": "Открыт",
      "question.status.answered": "Есть ответ — ещё не применён",
      "question.status.applied": "Применён в версии {number}",
      "question.rebuild.one": "Пересобрать BPMN с {count} уточнением",
      "question.rebuild.many": "Пересобрать BPMN с {count} уточнениями",
    });
  });

  it("provides complete localized editor history and viewport controls", () => {
    expect(dictionaries.en).toMatchObject({
      "editor.undo": "Undo",
      "editor.redo": "Redo",
      "editor.fit": "Fit diagram",
      "editor.zoomOut": "Zoom out",
      "editor.zoomIn": "Zoom in",
      "editor.expand": "Expand diagram",
      "editor.collapse": "Collapse diagram",
      "editor.historyBaselineImported":
        "Version loaded. Undo and redo history were reset; this import is the new baseline.",
      "editor.historyBaselineSaved":
        "Version {number} saved. Undo and redo history were reset; the saved version is the new baseline.",
    });
    expect(dictionaries.ru).toMatchObject({
      "editor.undo": "Отменить",
      "editor.redo": "Повторить",
      "editor.fit": "Вписать диаграмму",
      "editor.zoomOut": "Уменьшить масштаб",
      "editor.zoomIn": "Увеличить масштаб",
      "editor.expand": "Развернуть диаграмму",
      "editor.collapse": "Свернуть диаграмму",
      "editor.historyBaselineImported":
        "Версия загружена. История отмены и повтора сброшена; этот импорт — новая точка отсчёта.",
      "editor.historyBaselineSaved":
        "Версия {number} сохранена. История отмены и повтора сброшена; сохранённая версия — новая точка отсчёта.",
    });
  });

  it("localizes built-in source names without changing uploaded filenames", () => {
    expect(displaySourceName("en", "text", "Описание процесса из буфера")).toBe(
      "Pasted process description",
    );
    expect(displaySourceName("ru", "correction", "Reviewer correction")).toBe(
      "Уточнение проверяющего",
    );
    expect(
      displaySourceName("ru", "correction", "Confirmed question answer"),
    ).toBe("Подтверждённый ответ на вопрос");
    expect(displaySourceName("en", "audio", "Запись из браузера.webm")).toBe(
      "Browser recording.webm",
    );
    expect(displaySourceName("ru", "image", "interview-board.png")).toBe(
      "interview-board.png",
    );
  });

  it("formats deterministic UTC dates in locale-specific month/order", () => {
    const timestamp = "2024-01-02T03:04:00.000Z";
    expect(formatDisplayDate(timestamp, "ru")).toBe(
      "02 янв. 2024 г., 03:04 UTC",
    );
    expect(formatDisplayDate(timestamp, "en")).toBe("02 Jan 2024, 03:04 UTC");
  });

  it("keeps every defined message key complete in both dictionaries", () => {
    const englishKeys = Object.keys(dictionaries.en).sort();
    const russianKeys = Object.keys(dictionaries.ru).sort();

    expect(russianKeys).toEqual(englishKeys);
    expect(englishKeys.length).toBeGreaterThan(100);
    for (const locale of ["ru", "en"] as const)
      for (const key of englishKeys)
        expect(
          dictionaries[locale][key as keyof typeof dictionaries.en],
        ).not.toBe("");
  });
});
