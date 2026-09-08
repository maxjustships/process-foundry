import type { LoaderFunctionArgs } from "react-router";
import { cloudflareEnv, requireSession } from "../lib/request.server";
import { resolveLocale, t } from "../lib/i18n";

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  await requireSession(request, context);
  const env = cloudflareEnv(context);
  const row = await env.DB.prepare(
    "SELECT v.bpmn_xml, p.title FROM diagram_versions v JOIN projects p ON p.id = v.project_id WHERE v.project_id = ? ORDER BY v.version_number DESC LIMIT 1",
  )
    .bind(params.projectId ?? "")
    .first<{ bpmn_xml: string; title: string }>();
  if (!row)
    throw new Response(t(resolveLocale(request), "error.noExport"), {
      status: 404,
    });
  const filename = `${
    row.title
      .replace(/[^a-zA-Z0-9_-]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 80) || "process"
  }.bpmn`;
  return new Response(row.bpmn_xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
