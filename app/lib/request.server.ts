import { redirect, type RouterContextProvider } from "react-router";
import {
  getRequiredSecret,
  readCookie,
  validateMutationOrigin,
  verifySession,
  type SessionPayload,
} from "./auth.server";
import { cloudflareContext } from "./cloudflare-context";
import { resolveLocale, t } from "./i18n";

export function cloudflareEnv(context: Readonly<RouterContextProvider>): Env {
  return context.get(cloudflareContext).env;
}

export async function requireSession(
  request: Request,
  context: Readonly<RouterContextProvider>,
): Promise<SessionPayload> {
  const env = cloudflareEnv(context);
  const session = await verifySession(
    readCookie(request, "bpmn_session"),
    getRequiredSecret(env, "SESSION_SIGNING_KEY"),
  );
  if (!session)
    throw redirect(
      `/login?next=${encodeURIComponent(
        `${new URL(request.url).pathname}${new URL(request.url).search}`,
      )}`,
    );
  return session;
}

export function requireMutationOrigin(request: Request): void {
  if (!validateMutationOrigin(request))
    throw new Response(t(resolveLocale(request), "error.mutationOrigin"), {
      status: 403,
    });
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ ok: false, error: message }, { status });
}

export async function readBoundedJson(
  request: Request,
  maximumBytes = 100_000,
): Promise<unknown> {
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > maximumBytes)
    throw new Response(t(resolveLocale(request), "error.requestLarge"), {
      status: 413,
    });
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maximumBytes)
    throw new Response(t(resolveLocale(request), "error.requestLarge"), {
      status: 413,
    });
  try {
    return JSON.parse(text);
  } catch {
    throw new Response(t(resolveLocale(request), "error.invalidJson"), {
      status: 400,
    });
  }
}
