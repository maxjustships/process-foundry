import { z } from "zod";
import type { LoaderFunctionArgs } from "react-router";
import { authorizeFeedbackExport } from "../lib/feedback-export.server";
import { cloudflareEnv, jsonError } from "../lib/request.server";

const statusSchema = z.enum([
  "new",
  "reported",
  "reviewed",
  "accepted",
  "declined",
]);

function decodeCursor(
  value: string | null,
): { createdAt: string; id: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    ) as { createdAt?: unknown; id?: unknown };
    return typeof parsed.createdAt === "string" && typeof parsed.id === "string"
      ? { createdAt: parsed.createdAt, id: parsed.id }
      : null;
  } catch {
    return null;
  }
}

function encodeCursor(createdAt: string, id: string): string {
  return btoa(JSON.stringify({ createdAt, id }))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = cloudflareEnv(context);
  if (!(await authorizeFeedbackExport(request, env)))
    return jsonError("Not authorized.", 401);
  const url = new URL(request.url);
  const status = statusSchema.safeParse(
    url.searchParams.get("status") ?? "new",
  );
  if (!status.success) return jsonError("Feedback status is not valid.", 400);
  const cursor = decodeCursor(url.searchParams.get("after"));
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 50), 1),
    100,
  );
  const result = cursor
    ? await env.DB.prepare(
        "SELECT id, project_id, diagram_version_id, job_id, rating, text, lifecycle_status, app_version, model_name, prompt_version, schema_version, created_at FROM feedback_inbox WHERE lifecycle_status = ? AND (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at, id LIMIT ?",
      )
        .bind(
          status.data,
          cursor.createdAt,
          cursor.createdAt,
          cursor.id,
          limit + 1,
        )
        .all<Record<string, string | number | null>>()
    : await env.DB.prepare(
        "SELECT id, project_id, diagram_version_id, job_id, rating, text, lifecycle_status, app_version, model_name, prompt_version, schema_version, created_at FROM feedback_inbox WHERE lifecycle_status = ? ORDER BY created_at, id LIMIT ?",
      )
        .bind(status.data, limit + 1)
        .all<Record<string, string | number | null>>();
  const items = result.results.slice(0, limit);
  const tail = items.at(-1);
  return Response.json(
    {
      items,
      next_cursor:
        result.results.length > limit && tail
          ? encodeCursor(String(tail.created_at), String(tail.id))
          : null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
