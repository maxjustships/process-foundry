import type { ActionFunctionArgs } from "react-router";
import { retryJobSnapshot } from "../lib/repository.server";
import {
  cloudflareEnv,
  jsonError,
  requireMutationOrigin,
  requireSession,
} from "../lib/request.server";
import { resolveLocale, t } from "../lib/i18n";
import { startGenerationWorkflowOrCompensate } from "../lib/generation-start.server";

export async function action({ request, context, params }: ActionFunctionArgs) {
  await requireSession(request, context);
  requireMutationOrigin(request);
  const env = cloudflareEnv(context);
  const locale = resolveLocale(request);
  const jobId = params.jobId ?? "";
  const owned = await env.DB.prepare(
    "SELECT jobs.id, jobs.project_id FROM jobs JOIN projects ON projects.id = jobs.project_id WHERE jobs.id = ? AND projects.status = 'active'",
  )
    .bind(jobId)
    .first<{ id: string; project_id: string }>();
  if (!owned) return jsonError(t(locale, "error.jobNotFound"), 404);
  const retried = await retryJobSnapshot(env.DB, jobId);
  if (!retried.changed && !["queued"].includes(retried.status))
    return jsonError(t(locale, "error.retryUnavailable"), 409);
  if (
    retried.changed &&
    !(await startGenerationWorkflowOrCompensate(
      env.DB,
      env.GENERATION_WORKFLOW,
      {
        jobId,
        projectId: owned.project_id,
        workflowInstanceId: retried.workflowInstanceId,
      },
    ))
  )
    return jsonError(t(locale, "error.generationStart"), 503);
  return Response.json(
    { ok: true, created: retried.changed, jobId, status: retried.status },
    { status: retried.changed ? 202 : 200 },
  );
}
