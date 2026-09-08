import { getRequiredSecret, timingSafeStringEqual } from "./auth.server";

export async function authorizeFeedbackExport(
  request: Request,
  env: Env,
): Promise<boolean> {
  const header = request.headers.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeStringEqual(
    token,
    getRequiredSecret(env, "FEEDBACK_EXPORT_TOKEN"),
  );
}
