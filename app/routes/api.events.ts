import type { ActionFunctionArgs } from "react-router";
import { storeTelemetry } from "../lib/repository.server";
import { parseTelemetryBatch } from "../lib/telemetry";
import {
  cloudflareEnv,
  jsonError,
  readBoundedJson,
  requireMutationOrigin,
  requireSession,
} from "../lib/request.server";
import { resolveLocale, t } from "../lib/i18n";

export async function action({ request, context }: ActionFunctionArgs) {
  await requireSession(request, context);
  requireMutationOrigin(request);
  try {
    const batch = parseTelemetryBatch(await readBoundedJson(request, 100_000));
    await storeTelemetry(cloudflareEnv(context).DB, batch);
    return Response.json({ ok: true, accepted: batch.events.length });
  } catch {
    return jsonError(t(resolveLocale(request), "error.telemetryBatch"), 400);
  }
}
