import { z } from "zod";
import {
  processIrJsonSchema,
  processIrSchema,
  type ProcessIR,
} from "../domain/process-ir";
import type { OutputLocale } from "../domain/output-locale";

export const TRANSCRIPTION_MODEL = "gpt-transcribe" as const;
export const EXTRACTION_MODEL = "gpt-5.6-terra" as const;
export const REASONING_LEVEL = "high" as const;
export const MAX_EXTRACTION_OUTPUT_TOKENS = 16_384;
export const PROMPT_VERSION = "extract-process/4" as const;
export const SCHEMA_VERSION = "process-ir/1" as const;

export type ExtractionInput =
  { kind: "text"; text: string } | { kind: "image"; dataUrl: string };

const SYSTEM_PROMPT = `Extract only evidence-supported business process semantics into the supplied ProcessIR schema. The product output is BPMN 2.0 only: model business process steps, decisions, events, participants, and handoffs. If evidence explicitly requests an architecture or data-flow diagram, do not claim to produce that modality; add a blocking or important question asking which business process and handoffs the BPMN should represent. Use only the supported node types. Never invent missing roles, decisions, message events, or timers.

Every flow node in a participant that has lanes must have a laneId referencing one of those lanes. If the evidence does not identify an owner, create an explicit "Owner to confirm" or "Требуется уточнить владельца" lane, assign the node to it, and add a blocking owner question.

Model gateway structure explicitly. Every split must have distinct target nodes. Exclusive split branches need nonempty, distinct condition labels; parallel split branches have no conditions. Reconverging branches must pass through an explicit merge gateway before their common task; never hide a merge as multiple incoming flows on a task or event.

Keep contradictory source facts visible and surface the conflict as a blocking or important question, not as a replacement assumption. Never state that one fact replaces, overrides, or supersedes another unless a source explicitly says it supersedes; even then retain the facts and question for review. Record other ambiguity as questions and any interpretation as assumptions. Source references must use the opaque source labels supplied in the input. Return JSON only.`;

export function buildProcessIrRepairInstruction(
  issueCodes: readonly string[],
  outputLocale: OutputLocale,
): string {
  return `Repair the ProcessIR once without inventing semantics. Resolve only these deterministic invariant codes: ${issueCodes.join(", ")}. Assign every flow node to an existing lane; when ownership is unsupported, use an explicit owner-to-confirm lane and a blocking question. Give exclusive split branches distinct targets and nonempty distinct conditions, remove conditions from parallel splits, and use an explicit merge gateway before every reconverging task or event. Keep all conflicting source facts visible and add a related blocking or important question instead of silently promoting a replacement or override assumption. Keep every user-facing ProcessIR string in ${outputLocale === "ru" ? "Russian" : "English"}; evidence identifiers and proper nouns may remain exact.`;
}

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function makeNullable(schema: JsonObject): JsonObject {
  const type = schema.type;
  const nullableType =
    typeof type === "string"
      ? [type, "null"]
      : isUnknownArray(type) && !type.includes("null")
        ? [...type, "null"]
        : type;
  const nullableEnum =
    isUnknownArray(schema.enum) && !schema.enum.includes(null)
      ? [...schema.enum, null]
      : schema.enum;

  if (nullableType !== undefined)
    return {
      ...schema,
      type: nullableType,
      ...(nullableEnum === undefined ? {} : { enum: nullableEnum }),
    };
  return { anyOf: [schema, { type: "null" }] };
}

function toStrictProviderJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toStrictProviderJsonSchema);
  if (!isJsonObject(value)) return value;

  const transformed = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "properties" ? child : toStrictProviderJsonSchema(child),
    ]),
  );
  if (value.type !== "object" || !isJsonObject(value.properties))
    return transformed;

  const required = new Set(
    Array.isArray(value.required)
      ? value.required.filter(
          (property): property is string => typeof property === "string",
        )
      : [],
  );
  const properties = Object.fromEntries(
    Object.entries(value.properties).map(([name, propertySchema]) => {
      const strictProperty = toStrictProviderJsonSchema(propertySchema);
      return [
        name,
        required.has(name) || !isJsonObject(strictProperty)
          ? strictProperty
          : makeNullable(strictProperty),
      ];
    }),
  );
  return { ...transformed, properties, required: Object.keys(properties) };
}

const providerProcessIrJsonSchema =
  toStrictProviderJsonSchema(processIrJsonSchema);

const sourceIdSchemaPaths = [
  [
    "properties",
    "nodes",
    "items",
    "properties",
    "sourceRefs",
    "items",
    "properties",
    "sourceId",
  ],
  [
    "properties",
    "flows",
    "items",
    "properties",
    "sourceRefs",
    "items",
    "properties",
    "sourceId",
  ],
  [
    "properties",
    "annotations",
    "items",
    "properties",
    "sourceRefs",
    "items",
    "properties",
    "sourceId",
  ],
] as const;

function providerSchemaWithEligibleSourceIds(
  eligibleSourceIds: readonly string[],
): unknown {
  const schema = structuredClone(providerProcessIrJsonSchema);
  for (const path of sourceIdSchemaPaths) {
    let current = schema;
    for (const segment of path) {
      if (!isJsonObject(current))
        throw new Error("The ProcessIR provider schema is invalid.");
      current = current[segment];
    }
    if (!isJsonObject(current))
      throw new Error("The ProcessIR provider schema is invalid.");
    current.enum = [...eligibleSourceIds];
  }
  return schema;
}

function omitNullProperties(
  value: unknown,
  propertyNames: readonly string[],
): unknown {
  if (!isJsonObject(value)) return value;
  const normalized = { ...value };
  for (const propertyName of propertyNames)
    if (normalized[propertyName] === null) delete normalized[propertyName];
  return normalized;
}

function parseProviderProcessIr(outputText: string): ProcessIR {
  const input: unknown = JSON.parse(outputText);
  if (!isJsonObject(input)) return processIrSchema.parse(input);

  const normalized = {
    ...input,
    nodes: Array.isArray(input.nodes)
      ? input.nodes.map((node) => omitNullProperties(node, ["laneId"]))
      : input.nodes,
    flows: Array.isArray(input.flows)
      ? input.flows.map((flow) => omitNullProperties(flow, ["condition"]))
      : input.flows,
    annotations: Array.isArray(input.annotations)
      ? input.annotations.map((annotation) =>
          omitNullProperties(annotation, ["laneId", "attachedToId"]),
        )
      : input.annotations,
  };
  return processIrSchema.parse(normalized);
}

const nonBpmnModalityPattern =
  /\b(?:data[- ]flow|dfd|architecture diagram|system diagram)\b|(?:диаграмм\w*\s+поток\w*\s+данн\w*|архитектурн\w*\s+схем\w*|системн\w*\s+диаграмм\w*)/iu;

export function enforceBpmnOnlyModalityQuestion(
  ir: ProcessIR,
  inputs: readonly ExtractionInput[],
  outputLocale: OutputLocale,
): ProcessIR {
  const requested = inputs.some(
    (input) => input.kind === "text" && nonBpmnModalityPattern.test(input.text),
  );
  if (!requested) return ir;
  if (
    ir.questions.some(
      (question) => question.id === "question_non_bpmn_modality",
    )
  )
    return ir;
  const ids = new Set([
    ...ir.participants.map((participant) => participant.id),
    ...ir.participants.flatMap((participant) =>
      participant.lanes.map((lane) => lane.id),
    ),
    ...ir.nodes.map((node) => node.id),
    ...ir.flows.map((flow) => flow.id),
    ...ir.annotations.map((annotation) => annotation.id),
    ...ir.questions.map((question) => question.id),
  ]);
  let id = "question_non_bpmn_modality";
  let suffix = 2;
  while (ids.has(id)) {
    id = `question_non_bpmn_modality_${suffix}`;
    suffix += 1;
  }
  return {
    ...ir,
    questions: [
      ...ir.questions,
      {
        id,
        text:
          outputLocale === "ru"
            ? "Материалы запрашивают другой тип схемы. Какой бизнес-процесс и какие передачи работы должна показать BPMN?"
            : "The evidence requests another diagram modality. Which business process and handoffs should the BPMN represent?",
        relatedElementIds: [
          ir.nodes.find((node) => node.type === "startEvent")?.id ??
            ir.nodes[0]!.id,
        ],
        severity: "important",
      },
    ],
  };
}

export function buildExtractionRequest(
  inputs: ExtractionInput[],
  outputLocale: OutputLocale,
  eligibleSourceIds: readonly string[],
) {
  const content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string }
  > = [
    {
      type: "input_text",
      text: "Build a reviewable BPMN process from these anonymized sources:",
    },
  ];
  for (const input of inputs)
    content.push(
      input.kind === "text"
        ? { type: "input_text", text: input.text }
        : { type: "input_image", image_url: input.dataUrl },
    );
  return {
    model: EXTRACTION_MODEL,
    reasoning: { effort: REASONING_LEVEL },
    store: false,
    max_output_tokens: MAX_EXTRACTION_OUTPUT_TOKENS,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `${SYSTEM_PROMPT}\n\nWrite ALL user-facing ProcessIR strings in ${outputLocale === "ru" ? "Russian" : "English"}: title, participant and lane names, node names, flow conditions, annotations, assumptions, questions, and user-visible source locators. The evidence identifiers and proper nouns may remain exact.`,
          },
        ],
      },
      { role: "user", content },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "process_ir",
        schema: providerSchemaWithEligibleSourceIds(eligibleSourceIds),
        strict: true,
      },
    },
  };
}

const responsesEnvelope = z
  .object({
    id: z.string(),
    model: z.string(),
    status: z.string().optional(),
    incomplete_details: z
      .object({ reason: z.string().optional() })
      .passthrough()
      .nullable()
      .optional(),
    output_text: z.string().optional(),
    output: z
      .array(
        z
          .object({
            content: z
              .array(
                z
                  .object({ type: z.string(), text: z.string().optional() })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    usage: z
      .object({
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
        total_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function extractOutputText(
  response: z.infer<typeof responsesEnvelope>,
): string {
  if (response.output_text) return response.output_text;
  for (const item of response.output ?? [])
    for (const content of item.content ?? [])
      if (content.type === "output_text" && content.text) return content.text;
  throw new ProviderError(
    "provider_missing_output",
    "The extraction provider returned no structured output.",
  );
}

export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

export function assertEligibleSourceReferences(
  ir: ProcessIR,
  eligibleSourceIds: readonly string[],
): void {
  const eligible = new Set(eligibleSourceIds);
  for (const element of [...ir.nodes, ...ir.flows, ...ir.annotations])
    for (const sourceRef of element.sourceRefs)
      if (!eligible.has(sourceRef.sourceId))
        throw new ProviderError(
          "provider_unknown_source_reference",
          "The extraction provider returned an unknown source reference.",
        );
}

export async function transcribeAudio(
  apiKey: string,
  audio: Blob,
  filename: string,
): Promise<{ text: string; responseId: string | null }> {
  const form = new FormData();
  form.set("model", TRANSCRIPTION_MODEL);
  form.set("file", audio, filename);
  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    },
  );
  if (!response.ok)
    throw new ProviderError(
      `openai_transcription_${response.status}`,
      "Transcription could not be completed.",
      response.status === 429 || response.status >= 500,
    );
  const body = z
    .object({ text: z.string() })
    .passthrough()
    .parse(await response.json());
  return { text: body.text, responseId: response.headers.get("x-request-id") };
}

export async function extractProcess(
  apiKey: string,
  inputs: ExtractionInput[],
  outputLocale: OutputLocale,
  eligibleSourceIds: readonly string[],
): Promise<{
  ir: ProcessIR;
  metadata: {
    responseId: string;
    returnedModel: string;
    usage: Record<string, number>;
  };
}> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildExtractionRequest(inputs, outputLocale, eligibleSourceIds),
    ),
  });
  if (!response.ok)
    throw new ProviderError(
      `openai_extraction_${response.status}`,
      "Process extraction could not be completed.",
      response.status === 429 || response.status >= 500,
    );
  const envelope = responsesEnvelope.parse(await response.json());
  if (envelope.status !== undefined && envelope.status !== "completed")
    throw new ProviderError(
      "provider_response_not_completed",
      "The extraction provider did not complete the response.",
    );
  const ir = enforceBpmnOnlyModalityQuestion(
    parseProviderProcessIr(extractOutputText(envelope)),
    inputs,
    outputLocale,
  );
  assertEligibleSourceReferences(ir, eligibleSourceIds);
  const usage = Object.fromEntries(
    Object.entries(envelope.usage ?? {}).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
  return {
    ir,
    metadata: { responseId: envelope.id, returnedModel: envelope.model, usage },
  };
}
