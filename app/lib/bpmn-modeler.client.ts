import Modeler from "bpmn-js/lib/Modeler";
import { russianBpmnTranslateModule } from "./bpmn-i18n";
import type { Locale } from "./i18n";

export function createBpmnModeler(
  container: HTMLElement,
  locale: Locale,
): Modeler {
  return new Modeler({
    container,
    additionalModules: locale === "ru" ? [russianBpmnTranslateModule] : [],
  });
}
