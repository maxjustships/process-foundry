import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import {
  getRequiredSecret,
  readCookie,
  signSession,
  verifyPhrase,
  verifySession,
} from "../lib/auth.server";
import { cloudflareEnv, requireMutationOrigin } from "../lib/request.server";
import { resolveLocale, safeReturnTarget, t } from "../lib/i18n";

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: t(loaderData?.locale ?? "ru", "login.metaTitle") },
];

async function throttleKey(request: Request): Promise<string> {
  const value = request.headers.get("CF-Connecting-IP") ?? "local";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const locale = resolveLocale(request);
  const requestedNext = new URL(request.url).searchParams.get("next");
  const formAction =
    requestedNext === null
      ? "/login"
      : `/login?next=${encodeURIComponent(requestedNext)}`;
  const env = cloudflareEnv(context);
  const session = await verifySession(
    readCookie(request, "bpmn_session"),
    getRequiredSecret(env, "SESSION_SIGNING_KEY"),
  );
  if (session) throw redirect("/projects");
  return { locale, formAction };
}

export async function action({ request, context }: ActionFunctionArgs) {
  requireMutationOrigin(request);
  const locale = resolveLocale(request);
  const env = cloudflareEnv(context);
  const key = await throttleKey(request);
  const throttle = await env.DB.prepare(
    "SELECT failure_count, blocked_until FROM auth_throttle WHERE key_hash = ?",
  )
    .bind(key)
    .first<{ failure_count: number; blocked_until: string | null }>();
  if (
    throttle?.blocked_until &&
    new Date(throttle.blocked_until).getTime() > Date.now()
  )
    return {
      error: t(locale, "login.blocked"),
    };
  const form = await request.formData();
  const phrase = form.get("phrase");
  const valid =
    typeof phrase === "string" &&
    (await verifyPhrase(
      phrase,
      getRequiredSecret(env, "AUTH_PHRASE_SALT"),
      getRequiredSecret(env, "AUTH_PHRASE_VERIFIER"),
    ));
  if (!valid) {
    const timestamp = new Date().toISOString();
    const failures = (throttle?.failure_count ?? 0) + 1;
    const blockedUntil =
      failures >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    await env.DB.prepare(
      "INSERT INTO auth_throttle (key_hash, failure_count, window_started_at, blocked_until) VALUES (?, ?, ?, ?) ON CONFLICT(key_hash) DO UPDATE SET failure_count = ?, blocked_until = ?",
    )
      .bind(key, failures, timestamp, blockedUntil, failures, blockedUntil)
      .run();
    return {
      error: t(locale, "login.invalid"),
    };
  }
  await env.DB.prepare("DELETE FROM auth_throttle WHERE key_hash = ?")
    .bind(key)
    .run();
  const session = await signSession(
    getRequiredSecret(env, "SESSION_SIGNING_KEY"),
  );
  const requestedNext = new URL(request.url).searchParams.get("next");
  const next =
    requestedNext === null ? "/projects" : safeReturnTarget(requestedNext);
  throw redirect(next, { headers: { "Set-Cookie": session.cookie } });
}

export default function Login() {
  const { locale, formAction } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  return (
    <main className="login-page">
      <section className="login-intro" aria-labelledby="login-title">
        <p className="eyebrow">{t(locale, "login.eyebrow")}</p>
        <h1 id="login-title">{t(locale, "login.hero")}</h1>
        <p>{t(locale, "login.summary")}</p>
        <div className="privacy-notice">
          <span>{t(locale, "login.boundaryTitle")}</span>{" "}
          {t(locale, "login.boundary")}
        </div>
      </section>
      <section className="login-panel">
        <div>
          <p className="step-marker">{t(locale, "login.step")}</p>
          <h2>{t(locale, "login.heading")}</h2>
          <p>{t(locale, "login.hint")}</p>
        </div>
        <Form method="post" action={formAction} className="stack-form">
          <label htmlFor="phrase">{t(locale, "login.phrase")}</label>
          <input
            id="phrase"
            name="phrase"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            aria-describedby={result?.error ? "login-error" : undefined}
          />
          {result?.error ? (
            <p id="login-error" className="form-error" role="alert">
              {result.error}
            </p>
          ) : null}
          <button
            className="button primary"
            type="submit"
            disabled={navigation.state !== "idle"}
          >
            {navigation.state === "submitting"
              ? t(locale, "login.checking")
              : t(locale, "login.open")}
          </button>
        </Form>
      </section>
    </main>
  );
}
