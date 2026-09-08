import type { ActionFunctionArgs } from "react-router";
import { deleteProjectWithWorkflow } from "../lib/project-deletion.server";
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
  if (!params.projectId)
    return jsonError(t(resolveLocale(request), "error.projectNotFound"), 404);
  const env = cloudflareEnv(context);
  const receipt = await deleteProjectWithWorkflow(
    env.DB,
    env.SOURCES,
    env.GENERATION_WORKFLOW,
    params.projectId,
  );
  return Response.json({ ok: true, receipt });
}
