import { z } from "zod";
import type { ActionFunctionArgs } from "react-router";
import { authorizeFeedbackExport } from "../lib/feedback-export.server";
import { advanceFeedbackStatus } from "../lib/feedback.server";
import {
  cloudflareEnv,
  jsonError,
  readBoundedJson,
} from "../lib/request.server";

const inputSchema = z
  .object({ ids: z.array(z.string().uuid()).min(1).max(100) })
  .strict();

export async function action({ request, context }: ActionFunctionArgs) {
  const env = cloudflareEnv(context);
  if (!(await authorizeFeedbackExport(request, env)))
    return jsonError("Not authorized.", 401);
  let input: z.infer<typeof inputSchema>;
  try {
    input = inputSchema.parse(await readBoundedJson(request, 10_000));
  } catch {
    return jsonError("Provide one to 100 feedback IDs.", 400);
  }
  const reported = await advanceFeedbackStatus(env.DB, input.ids, "reported");
  return Response.json({ ok: true, reported });
}
