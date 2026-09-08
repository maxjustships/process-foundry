import { BpmnModdle } from "bpmn-moddle";
import type { ActionFunctionArgs } from "react-router";
import { saveDiagramVersion } from "../lib/repository.server";
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
  const locale = resolveLocale(request);
  const projectId = params.projectId;
  if (!projectId) return jsonError(t(locale, "error.projectNotFound"), 404);
  const length = Number(request.headers.get("Content-Length") ?? 0);
  if (length > 2_000_000) return jsonError(t(locale, "error.bpmnSize"), 413);
  const xml = await request.text();
  if (new TextEncoder().encode(xml).byteLength > 2_000_000)
    return jsonError(t(locale, "error.bpmnSize"), 413);
  try {
    const parsed = await new BpmnModdle().fromXML(xml);
    if (parsed.warnings.length)
      return jsonError(t(locale, "error.bpmnWarnings"), 400);
  } catch {
    return jsonError(t(locale, "error.bpmnParse"), 400);
  }
  const version = await saveDiagramVersion(
    cloudflareEnv(context).DB,
    projectId,
    null,
    xml,
    null,
    "human",
  );
  return Response.json(
    { ok: true, versionId: version.id, versionNumber: version.version_number },
    { status: 201 },
  );
}
