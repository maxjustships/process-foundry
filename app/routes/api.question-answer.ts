import { ZodError } from "zod";
import type { ActionFunctionArgs } from "react-router";
import { parseQuestionAnswer } from "../lib/clarifications";
import {
  ClarificationRequestError,
  confirmQuestionAnswer,
} from "../lib/repository.server";
import {
  cloudflareEnv,
  jsonError,
  readBoundedJson,
  requireMutationOrigin,
  requireSession,
} from "../lib/request.server";
import { resolveLocale, t } from "../lib/i18n";

export async function action({ request, context, params }: ActionFunctionArgs) {
  await requireSession(request, context);
  requireMutationOrigin(request);
  const locale = resolveLocale(request);
  if (
    request.headers.get("Content-Type")?.split(";", 1)[0].trim() !==
    "application/json"
  )
    return jsonError(t(locale, "error.questionAnswer"), 400);
  let answer: string;
  try {
    ({ answer } = parseQuestionAnswer(await readBoundedJson(request, 20_000)));
  } catch (error) {
    if (error instanceof Response)
      return jsonError(await error.text(), error.status);
    if (error instanceof ZodError)
      return jsonError(t(locale, "error.questionAnswer"), 400);
    throw error;
  }
  try {
    const env = cloudflareEnv(context);
    const result = await confirmQuestionAnswer(env.DB, env.SOURCES, {
      projectId: params.projectId ?? "",
      versionId: params.versionId ?? "",
      questionId: params.questionId ?? "",
      answer,
    });
    return Response.json(
      { ok: true, created: result.created, status: result.status },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof ClarificationRequestError) {
      if (error.code === "clarification_not_found")
        return jsonError(t(locale, "error.questionNotFound"), 404);
      if (error.code === "clarification_conflict")
        return jsonError(t(locale, "error.questionConflict"), 409);
      return jsonError(t(locale, "error.questionUnavailable"), 500);
    }
    throw error;
  }
}
