import { Form, useLocation } from "react-router";
import { t, type Locale } from "../lib/i18n";

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;

  return (
    <Form method="post" action="/language" className="language-switcher">
      <input type="hidden" name="returnTo" value={returnTo} />
      <fieldset>
        <legend className="sr-only">{t(locale, "language.label")}</legend>
        {(["ru", "en"] as const).map((choice) => {
          const current = choice === locale;
          return (
            <button
              key={choice}
              type="submit"
              name="locale"
              value={choice}
              aria-pressed={current}
              aria-label={t(
                locale,
                `language.${choice}.${current ? "current" : "switch"}`,
              )}
              disabled={current}
            >
              {choice.toUpperCase()}
            </button>
          );
        })}
      </fieldset>
    </Form>
  );
}
