import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BPMN_IDENTITY_SAFE_KEYS,
  RU_BPMN_TRANSLATIONS,
  translateBpmn,
} from "../../app/lib/bpmn-i18n";

const root = new URL("../../node_modules/", import.meta.url);

function contents(path: string): string {
  return readFileSync(new URL(path, root), "utf8");
}

function installedUserFacingKeys(): Set<string> {
  const keys = new Set<string>();
  const translationSources = [
    "bpmn-js/lib/features/palette/PaletteProvider.js",
    "bpmn-js/lib/features/context-pad/ContextPadProvider.js",
    "bpmn-js/lib/features/popup-menu/ReplaceMenuProvider.js",
    "bpmn-js/lib/features/modeling-feedback/ModelingFeedback.js",
    "bpmn-js/lib/features/drilldown/DrilldownOverlayBehavior.js",
    "bpmn-js/lib/features/distribute-elements/DistributeElementsMenuProvider.js",
    "bpmn-js/lib/features/align-elements/AlignElementsContextPadProvider.js",
    "diagram-js/lib/features/search-pad/SearchPad.js",
  ];

  for (const path of translationSources) {
    const source = contents(path);
    for (const match of source.matchAll(
      /(?:translate|_translate)\(\s*['"]([^'"]+)['"]/gu,
    ))
      keys.add(match[1]!);
  }

  const popupEntries = contents(
    "bpmn-js/lib/features/popup-menu/PopupEntries.js",
  );
  for (const match of popupEntries.matchAll(/label:\s*'([^']+)'/gu))
    keys.add(match[1]!);

  const feedback = contents(
    "bpmn-js/lib/features/modeling-feedback/ModelingFeedback.js",
  );
  for (const match of feedback.matchAll(/ERR_MSG\s*=\s*'([^']+)'/gu))
    keys.add(match[1]!);

  for (const alignment of [
    "left",
    "center",
    "right",
    "top",
    "middle",
    "bottom",
  ])
    keys.add(`Align elements ${alignment}`);

  return keys;
}

describe("Russian bpmn-js translations", () => {
  it("translates representative palette, context-pad, tooltip, and replacement copy", () => {
    expect(translateBpmn("ru", "Create task")).toBe("Создать задачу");
    expect(translateBpmn("ru", "Append gateway")).toBe("Добавить шлюз");
    expect(translateBpmn("ru", "Delete")).toBe("Удалить");
    expect(translateBpmn("ru", "Search in diagram")).toBe("Поиск по диаграмме");
    expect(translateBpmn("ru", "Open {element}", { element: "Заказ" })).toBe(
      "Открыть Заказ",
    );
    expect(translateBpmn("en", "Create task")).toBe("Create task");
  });

  it("covers every user-facing key declared by the installed modeler", () => {
    const missing = [...installedUserFacingKeys()].filter(
      (key) =>
        !(key in RU_BPMN_TRANSLATIONS) && !BPMN_IDENTITY_SAFE_KEYS.has(key),
    );
    expect(missing).toEqual([]);
  });
});
