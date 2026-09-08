import type { ActionFunctionArgs } from "react-router";
import { cancelGenerationWorkflow } from "../lib/generation-cancellation.server";
import {
  cloudflareEnv,
  jsonError,
  requireMutationOrigin,
  requireSession,
} from "../lib/request.server";
import { resolveLocale, t } from "../lib/i18n";

export async function action({ request, context, params }: ActionFunctionArgs) {
  await requireSession(request, context);
  requireMutationOrigin(request);
  const env = cloudflareEnv(context);
  const locale = resolveLocale(request);
  const jobId = params.jobId ?? "";
  const owned = await env.DB.prepare(
    "SELECT jobs.id FROM jobs JOIN projects ON projects.id = jobs.project_id WHERE jobs.id = ? AND projects.status = 'active'",
  )
    .bind(jobId)
    .first<{ id: string }>();
  if (!owned) return jsonError(t(locale, "error.jobNotFound"), 404);
  try {
    const result = await cancelGenerationWorkflow(
      env.DB,
      env.GENERATION_WORKFLOW,
      jobId,
    );
    return Response.json({ ok: true, job: result });
  } catch {
    return Response.json(
      {
        ok: false,
        error: {
          code: "workflow_cancel_failed",
          stage: "cancelling",
          message: t(locale, "error.cancelFailed"),
        },
      },
      { status: 503 },
    );
  }
}
