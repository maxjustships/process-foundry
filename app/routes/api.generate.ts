import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  createGenerationIntent,
  GenerationIntentError,
  getProject,
} from "../lib/repository.server";
import {
  cloudflareEnv,
  jsonError,
  readBoundedJson,
  requireMutationOrigin,
  requireSession,
} from "../lib/request.server";
import { resolveLocale, t } from "../lib/i18n";
import { startGenerationWorkflowOrCompensate } from "../lib/generation-start.server";

const generationIntentSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("refine"),
      baseVersionId: z.string().min(1).max(100),
      sourceIds: z.array(z.string().min(1).max(100)).min(1).max(50),
    })
    .strict(),
  z
    .object({
      mode: z.literal("alternative"),
      sourceIds: z.array(z.string().min(1).max(100)).min(1).max(50),
    })
    .strict(),
]);

export async function action({ request, context, params }: ActionFunctionArgs) {
  await requireSession(request, context);
  requireMutationOrigin(request);
  const env = cloudflareEnv(context);
  const locale = resolveLocale(request);
  const projectId = params.projectId;
  if (!projectId) return jsonError(t(locale, "error.projectNotFound"), 404);
  const project = await getProject(env.DB, projectId);
  if (!project) return jsonError(t(locale, "error.projectNotFound"), 404);
  const parsed = generationIntentSchema.safeParse(
    await readBoundedJson(request),
  );
  if (!parsed.success)
    return jsonError(t(locale, "error.generationIntent"), 400);
  let claim: Awaited<ReturnType<typeof createGenerationIntent>>;
  try {
    claim = await createGenerationIntent(
      env.DB,
      {
        projectId,
        ...parsed.data,
      },
      locale,
    );
  } catch (error) {
    if (error instanceof GenerationIntentError) {
      const key =
        error.code === "generation_base_stale"
          ? "error.generationBaseStale"
          : error.code === "generation_project_unavailable"
            ? "error.projectNotFound"
            : "error.generationIntent";
      return jsonError(t(locale, key), error.status);
    }
    throw error;
  }
  if (
    claim.created &&
    !(await startGenerationWorkflowOrCompensate(
      env.DB,
      env.GENERATION_WORKFLOW,
      {
        jobId: claim.jobId,
        projectId,
        workflowInstanceId: claim.workflowInstanceId,
      },
    ))
  )
    return jsonError(t(locale, "error.generationStart"), 503);
  return Response.json(
    { ok: true, created: claim.created, jobId: claim.jobId, status: "queued" },
    { status: claim.created ? 202 : 200 },
  );
}
