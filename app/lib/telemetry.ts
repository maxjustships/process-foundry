import { z } from "zod";

const safePayloadSchema = z
  .object({
    element_type: z
      .enum([
        "startEvent",
        "endEvent",
        "task",
        "exclusiveGateway",
        "parallelGateway",
        "intermediateMessageEvent",
        "intermediateTimerEvent",
        "sequenceFlow",
      ])
      .optional(),
    count: z.number().int().nonnegative().max(10000).optional(),
    stage: z
      .enum([
        "uploading",
        "queued",
        "transcribing",
        "extracting",
        "validating",
        "compiling",
        "ready",
        "failed",
      ])
      .optional(),
    result: z.enum(["success", "failure", "cancelled"]).optional(),
    error_class: z
      .string()
      .regex(/^[a-z0-9_.-]{1,80}$/u)
      .optional(),
    source_kind: z
      .enum(["text", "audio", "image", "correction", "csv", "docx", "xlsx"])
      .optional(),
    size_bucket: z.enum(["small", "medium", "large"]).optional(),
    duration_bucket: z.enum(["short", "medium", "long"]).optional(),
    mime_family: z.enum(["text", "audio", "image", "table"]).optional(),
    rating: z.number().int().min(1).max(5).optional(),
    lifecycle_status: z
      .enum(["new", "reported", "reviewed", "accepted", "declined"])
      .optional(),
    provider: z.literal("openai").optional(),
    model: z.enum(["gpt-transcribe", "gpt-5.6-terra"]).optional(),
    reasoning: z.literal("high").optional(),
    prompt_version: z
      .string()
      .regex(/^[a-z0-9/_.-]{1,80}$/u)
      .optional(),
    schema_version: z
      .string()
      .regex(/^[a-z0-9/_.-]{1,80}$/u)
      .optional(),
    compiler_version: z
      .string()
      .regex(/^[a-z0-9/_.-]{1,80}$/u)
      .optional(),
    layout_version: z
      .string()
      .regex(/^[a-z0-9/_.-]{1,80}$/u)
      .optional(),
    latency_ms: z.number().int().nonnegative().max(3_600_000).optional(),
    usage_input_tokens: z.number().int().nonnegative().optional(),
    usage_output_tokens: z.number().int().nonnegative().optional(),
    response_id: z
      .string()
      .regex(/^[a-zA-Z0-9_.:-]{1,160}$/u)
      .optional(),
    permission_state: z
      .enum(["granted", "denied", "prompt", "unsupported", "no-device"])
      .optional(),
    status: z
      .string()
      .regex(/^[a-z0-9_.-]{1,80}$/u)
      .optional(),
  })
  .strict();

const eventSchema = z
  .object({
    event_id: z.string().min(1).max(100),
    client_session_id: z.string().min(1).max(100),
    client_sequence: z.number().int().nonnegative(),
    occurred_at_client: z.string().datetime(),
    event_type: z.string().regex(/^[a-z][a-z0-9_.-]{1,80}$/u),
    route: z
      .string()
      .regex(/^\/[a-zA-Z0-9_:/.-]*$/u)
      .max(160),
    project_id: z.string().max(100).optional(),
    job_id: z.string().max(100).optional(),
    diagram_version_id: z.string().max(100).optional(),
    app_version: z.string().regex(/^[a-zA-Z0-9_.-]{1,40}$/u),
    safe_payload: safePayloadSchema,
  })
  .strict();

export const telemetryBatchSchema = z
  .object({ events: z.array(eventSchema).min(1).max(100) })
  .strict();
export type TelemetryBatch = z.infer<typeof telemetryBatchSchema>;
export function parseTelemetryBatch(input: unknown): TelemetryBatch {
  return telemetryBatchSchema.parse(input);
}
