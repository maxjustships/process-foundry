import { z } from "zod";
import type { ActionFunctionArgs } from "react-router";
import {
  cloudflareEnv,
  jsonError,
  readBoundedJson,
  requireMutationOrigin,
  requireSession,
} from "../lib/request.server";
import { resolveLocale, t } from "../lib/i18n";

const inputSchema = z
  .object({
    projectId: z.string().uuid(),
    diagramVersionId: z.string().uuid().nullable(),
    jobId: z.string().uuid().nullable(),
    rating: z.number().int().min(1).max(5),
    text: z.string().trim().min(1).max(5000),
  })
  .strict();

export async function action({ request, context }: ActionFunctionArgs) {
  const session = await requireSession(request, context);
  requireMutationOrigin(request);
  let input: z.infer<typeof inputSchema>;
  try {
    input = inputSchema.parse(await readBoundedJson(request, 8_000));
  } catch {
    return jsonError(t(resolveLocale(request), "error.feedbackInput"), 400);
  }
  const env = cloudflareEnv(context);
  const job = input.jobId
    ? await env.DB.prepare(
        "SELECT model_name, prompt_version FROM jobs WHERE id = ? AND project_id = ?",
      )
        .bind(input.jobId, input.projectId)
        .first<{ model_name: string; prompt_version: string }>()
    : null;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO feedback_inbox (id, project_id, diagram_version_id, job_id, client_session_id, rating, text, lifecycle_status, app_version, model_name, prompt_version, schema_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, 'process-ir/1', ?)",
  )
    .bind(
      id,
      input.projectId,
      input.diagramVersionId,
      input.jobId,
      session.sid,
      input.rating,
      input.text,
      env.APP_VERSION,
      job?.model_name ?? null,
      job?.prompt_version ?? null,
      new Date().toISOString(),
    )
    .run();
  return Response.json({ ok: true, feedbackId: id }, { status: 201 });
}
