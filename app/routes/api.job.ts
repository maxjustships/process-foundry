import type { LoaderFunctionArgs } from "react-router";
import {
  cloudflareEnv,
  jsonError,
  requireSession,
} from "../lib/request.server";
import { resolveLocale, t } from "../lib/i18n";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  await requireSession(request, context);
  const job = await cloudflareEnv(context)
    .DB.prepare(
      "SELECT id, project_id, status, error_code, error_safe_message, updated_at FROM jobs WHERE id = ?",
    )
    .bind(params.jobId ?? "")
    .first();
  return job
    ? Response.json({ ok: true, job })
    : jsonError(t(resolveLocale(request), "error.jobNotFound"), 404);
}
