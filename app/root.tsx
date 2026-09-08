import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";

import type { Route } from "./+types/root";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { DEFAULT_LOCALE, resolveLocale, t } from "./lib/i18n";
import "./app.css";
import "./public.css";

export const links: Route.LinksFunction = () => [];

export function loader({ request }: LoaderFunctionArgs) {
  const pathname = new URL(request.url).pathname;
  return {
    locale: resolveLocale(request),
    publicSurface: pathname === "/" || pathname === "/demo",
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => {
  if (loaderData?.publicSurface)
    return [
      { title: "Process Foundry" },
      {
        name: "description",
        content:
          "Turn source evidence into an editable BPMN model with review context attached.",
      },
    ];
  const locale = loaderData?.locale ?? DEFAULT_LOCALE;
  return [
    { title: t(locale, "app.title") },
    { name: "description", content: t(locale, "app.description") },
  ];
};

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData<typeof loader>("root");
  const locale = data?.locale ?? DEFAULT_LOCALE;
  const publicSurface = data?.publicSurface ?? false;
  return (
    <html lang={publicSurface ? "en" : locale}>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        {publicSurface ? null : <LanguageSwitcher locale={locale} />}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

function routeResponseDetails(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return null;
  const error = (data as Record<string, unknown>).error;
  return typeof error === "string" ? error : null;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const data = useRouteLoaderData<typeof loader>("root");
  const locale = data?.publicSurface ? "en" : (data?.locale ?? DEFAULT_LOCALE);
  let message = t(locale, "error.oops");
  let details = t(locale, "error.unexpected");

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : t(locale, "error.title");
    const responseDetails = routeResponseDetails(error.data as unknown);
    details =
      responseDetails ||
      error.statusText ||
      (error.status === 404 ? t(locale, "error.notFound") : details);
  }

  return (
    <main className="diagram-empty">
      <h1>{message}</h1>
      <p>{details}</p>
    </main>
  );
}
