import { afterEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import {
  buildProcessIrRepairInstruction,
  buildExtractionRequest,
  enforceBpmnOnlyModalityQuestion,
  extractProcess,
  MAX_EXTRACTION_OUTPUT_TOKENS,
  PROMPT_VERSION,
  ProviderError,
  TRANSCRIPTION_MODEL,
} from "../../ai/openai.server";
import { SIMPLE_PROCESS_IR } from "../fixtures/process-ir";
import { getMockProcessIr } from "../../ai/provider.server";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectEveryObjectPropertyRequired(schema: unknown, path = "$"): void {
  if (Array.isArray(schema)) {
    schema.forEach((value, index) =>
      expectEveryObjectPropertyRequired(value, `${path}[${index}]`),
    );
    return;
  }
  if (!isRecord(schema)) return;

  if (schema.type === "object" && isRecord(schema.properties))
    expect(schema.required, `${path}.required`).toEqual(
      Object.keys(schema.properties),
    );

  for (const [key, value] of Object.entries(schema))
    expectEveryObjectPropertyRequired(value, `${path}.${key}`);
}

function expectNullable(schema: unknown): void {
  expect(isRecord(schema)).toBe(true);
  if (!isRecord(schema)) return;
  expect(schema.type).toEqual(expect.arrayContaining(["string", "null"]));
}

function schemaAtPath(schema: unknown, path: string): Record<string, unknown> {
  let current = schema;
  let currentPath = "$";
  for (const property of path.split(".")) {
    expect(isRecord(current), currentPath).toBe(true);
    if (!isRecord(current))
      throw new TypeError(`Expected ${currentPath} to be an object`);
    current = current[property];
    currentPath += `.${property}`;
  }
  expect(isRecord(current), currentPath).toBe(true);
  if (!isRecord(current))
    throw new TypeError(`Expected ${currentPath} to be an object`);
  return current;
}

describe("direct OpenAI contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pins exact models, high reasoning, strict schema and store=false", () => {
    expect(TRANSCRIPTION_MODEL).toBe("gpt-transcribe");
    expect(PROMPT_VERSION).toBe("extract-process/4");
    const body = buildExtractionRequest(
      [{ kind: "text", text: "safe test fixture" }],
      "en",
      [],
    );
    expect(body.model).toBe("gpt-5.6-terra");
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.store).toBe(false);
    expect(MAX_EXTRACTION_OUTPUT_TOKENS).toBe(16_384);
    expect(body.max_output_tokens).toBe(MAX_EXTRACTION_OUTPUT_TOKENS);
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.type).toBe("json_schema");
  });

  it("instructs extraction and bounded repair about evidence-first graph invariants", async () => {
    const body = buildExtractionRequest([], "ru", []);
    const requestJson = JSON.stringify(body);
    expect(requestJson).toContain("laneId");
    expect(requestJson).toContain("Owner to confirm");
    expect(requestJson).toContain("explicit merge gateway");
    expect(requestJson).toContain("contradict");
    expect(requestJson).toContain("Russian");
    for (const field of [
      "title",
      "participant and lane names",
      "node names",
      "flow conditions",
      "annotations",
      "assumptions",
      "questions",
      "user-visible source locators",
    ])
      expect(requestJson).toContain(field);
    expect(requestJson).toContain("proper nouns");
    expect(requestJson).toContain("evidence identifiers");

    const repair = buildProcessIrRepairInstruction(
      [
        "missing_lane_assignment",
        "implicit_merge",
        "conflict_resolved_without_question",
      ],
      "ru",
    );
    expect(repair).toContain("missing_lane_assignment");
    expect(repair).toContain("explicit merge gateway");
    expect(repair).toContain("owner-to-confirm lane");
    expect(repair).toContain("without inventing semantics");
    expect(repair).toContain("Russian");

    const workflowSource = await readFile(
      new URL("../../workers/generation.ts", import.meta.url),
      "utf8",
    );
    expect(workflowSource).toContain("prompt_version: PROMPT_VERSION");
    expect(workflowSource).not.toContain('prompt_version: "extract-process/2"');
  });

  it("turns an explicit non-BPMN modality request into an evidence-backed question", () => {
    const ir = enforceBpmnOnlyModalityQuestion(
      structuredClone(SIMPLE_PROCESS_IR),
      [
        {
          kind: "text",
          text: "[source:synthetic_architecture]\nCreate a system data-flow diagram for these components.",
        },
      ],
      "en",
    );

    const question = ir.questions.find(
      (candidate) => candidate.id === "question_non_bpmn_modality",
    );
    expect(question).toMatchObject({
      id: "question_non_bpmn_modality",
      relatedElementIds: ["start"],
      severity: "important",
    });
    expect(question?.text).toContain("Which business process and handoffs");
    expect(ir).not.toHaveProperty("diagramType");
    const request = JSON.stringify(buildExtractionRequest([], "en", []));
    expect(request).toContain("BPMN 2.0 only");
    expect(request).toContain("architecture or data-flow");
  });

  it("keeps mock output and deterministic BPMN-only questions in the captured locale", () => {
    const mock = getMockProcessIr([], "ru");
    expect(mock).toMatchObject({
      title: "Проверенный процесс обработки заявки",
      participants: [
        {
          name: "Организация",
          lanes: [{ name: "Владелец процесса" }],
        },
      ],
    });
    expect(mock.nodes.map((node) => node.name)).toContain("Проверить заявку");
    expect(mock.flows.map((flow) => flow.condition).filter(Boolean)).toEqual([
      "да",
      "нет",
    ]);
    expect(mock.annotations[0]?.text).toBe(
      "Требуется подтверждение проверяющего",
    );
    expect(mock.nodes.flatMap((node) => node.assumptions)).toContain(
      "Ответственную роль должен подтвердить проверяющий.",
    );

    const bounded = enforceBpmnOnlyModalityQuestion(
      mock,
      [{ kind: "text", text: "Create an architecture diagram." }],
      "ru",
    );
    expect(bounded.questions.at(-1)?.text).toContain("Какой бизнес-процесс");
  });

  it("requires every provider object property and makes logical optionals nullable", () => {
    const schema = buildExtractionRequest([], "en", []).text.format.schema;

    expectEveryObjectPropertyRequired(schema);
    expectNullable(
      schemaAtPath(schema, "properties.nodes.items.properties.laneId"),
    );
    expectNullable(
      schemaAtPath(schema, "properties.flows.items.properties.condition"),
    );
    expectNullable(
      schemaAtPath(schema, "properties.annotations.items.properties.laneId"),
    );
    expectNullable(
      schemaAtPath(
        schema,
        "properties.annotations.items.properties.attachedToId",
      ),
    );
  });

  it("pins exact eligible source IDs on every sourceRef path without request leakage", () => {
    const exactIds = ["source:Alpha/09", " source-bytes-preserved "];
    const firstSchema = buildExtractionRequest([], "en", exactIds).text.format
      .schema;
    const sourceIdPaths = [
      "properties.nodes.items.properties.sourceRefs.items.properties.sourceId",
      "properties.flows.items.properties.sourceRefs.items.properties.sourceId",
      "properties.annotations.items.properties.sourceRefs.items.properties.sourceId",
    ];

    for (const path of sourceIdPaths)
      expect(schemaAtPath(firstSchema, path).enum).toEqual(exactIds);

    const secondSchema = buildExtractionRequest([], "en", ["source_second"])
      .text.format.schema;
    for (const path of sourceIdPaths) {
      expect(schemaAtPath(secondSchema, path).enum).toEqual(["source_second"]);
      expect(schemaAtPath(firstSchema, path).enum).toEqual(exactIds);
    }
  });

  it("uses identical immutable source eligibility for initial and repair requests", () => {
    const eligibleSourceIds = Object.freeze([
      "source_original",
      "source_refinement",
    ]);
    const initial = buildExtractionRequest(
      [{ kind: "text", text: "[source:source_refinement]\nEvidence" }],
      "en",
      eligibleSourceIds,
    );
    const repair = buildExtractionRequest(
      [
        { kind: "text", text: "[source:source_refinement]\nEvidence" },
        { kind: "text", text: "Synthetic repair instruction" },
      ],
      "en",
      eligibleSourceIds,
    );
    const sourceIdPath =
      "properties.nodes.items.properties.sourceRefs.items.properties.sourceId";

    expect(schemaAtPath(initial.text.format.schema, sourceIdPath).enum).toEqual(
      eligibleSourceIds,
    );
    expect(schemaAtPath(repair.text.format.schema, sourceIdPath).enum).toEqual(
      eligibleSourceIds,
    );
    expect(eligibleSourceIds).toEqual(["source_original", "source_refinement"]);
  });

  it("normalizes nullable provider fields to the domain optional shape", async () => {
    const providerPayload = {
      ...SIMPLE_PROCESS_IR,
      nodes: SIMPLE_PROCESS_IR.nodes.map((node) => ({
        ...node,
        laneId: null,
      })),
      flows: SIMPLE_PROCESS_IR.flows.map((flow) => ({
        ...flow,
        condition: null,
      })),
      annotations: [
        {
          id: "note_1",
          text: "Review note",
          participantId: "participant_main",
          laneId: null,
          attachedToId: null,
          sourceRefs: [],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "response_1",
            model: "gpt-5.6-terra",
            output_text: JSON.stringify(providerPayload),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const { ir } = await extractProcess("test-key", [], "en", ["source_text"]);

    expect(ir.nodes.every((node) => !("laneId" in node))).toBe(true);
    expect(ir.flows.every((flow) => !("condition" in flow))).toBe(true);
    expect(ir.annotations).toEqual([
      {
        id: "note_1",
        text: "Review note",
        participantId: "participant_main",
        sourceRefs: [],
      },
    ]);
  });

  it("accepts a completed response with structured output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "response_completed",
            model: "gpt-5.6-terra",
            status: "completed",
            output_text: JSON.stringify(SIMPLE_PROCESS_IR),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    await expect(
      extractProcess("test-key", [], "en", ["source_text"]),
    ).resolves.toMatchObject({
      ir: SIMPLE_PROCESS_IR,
      metadata: {
        responseId: "response_completed",
        returnedModel: "gpt-5.6-terra",
      },
    });
  });

  it.each([
    {
      collection: "nodes",
      rejectedId: "source_opaque-A",
      buildPayload: () => {
        const ir = structuredClone(SIMPLE_PROCESS_IR);
        ir.nodes[0]!.sourceRefs = [
          { sourceId: "source_opaque-A", locator: "synthetic node" },
        ];
        return ir;
      },
    },
    {
      collection: "flows",
      rejectedId: "source_unlisted",
      buildPayload: () => {
        const ir = structuredClone(SIMPLE_PROCESS_IR);
        ir.flows[0]!.sourceRefs = [
          { sourceId: "source_unlisted", locator: "synthetic flow" },
        ];
        return ir;
      },
    },
    {
      collection: "annotations",
      rejectedId: "source_opaque-a9",
      buildPayload: () => {
        const ir = structuredClone(SIMPLE_PROCESS_IR);
        ir.annotations = [
          {
            id: "annotation_integrity",
            text: "Synthetic annotation",
            participantId: "participant_main",
            sourceRefs: [
              {
                sourceId: "source_opaque-a9",
                locator: "synthetic annotation",
              },
            ],
          },
        ];
        return ir;
      },
    },
  ])(
    "rejects a structurally valid $collection reference outside exact eligibility",
    async ({ rejectedId, buildPayload }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              id: "response_bad_reference",
              model: "gpt-5.6-terra",
              status: "completed",
              output_text: JSON.stringify(buildPayload()),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );

      const rejection = extractProcess("test-key", [], "en", [
        "source_opaque-A9",
        "source_text",
      ]);
      await expect(rejection).rejects.toMatchObject({
        code: "provider_unknown_source_reference",
        message:
          "The extraction provider returned an unknown source reference.",
        retryable: false,
      } satisfies Partial<ProviderError>);
      await expect(rejection).rejects.not.toThrow(rejectedId);
    },
  );

  it.each(["incomplete", "failed", "cancelled", "in_progress"])(
    "rejects a %s response even when its output is parseable",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              id: `response_${status}`,
              model: "gpt-5.6-terra",
              status,
              ...(status === "incomplete"
                ? { incomplete_details: { reason: "max_output_tokens" } }
                : {}),
              output_text: JSON.stringify(SIMPLE_PROCESS_IR),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
      );

      await expect(
        extractProcess("test-key", [], "en", []),
      ).rejects.toMatchObject({
        code: "provider_response_not_completed",
        message: "The extraction provider did not complete the response.",
      } satisfies Partial<ProviderError>);
    },
  );

  it.each([
    {
      name: "a completed refusal",
      envelope: {
        id: "response_refusal",
        model: "gpt-5.6-terra",
        status: "completed",
        output: [
          {
            content: [
              { type: "refusal", refusal: "sensitive provider refusal" },
            ],
          },
        ],
      },
    },
    {
      name: "a completed response without output",
      envelope: {
        id: "response_missing",
        model: "gpt-5.6-terra",
        status: "completed",
      },
    },
  ])(
    "reports $name without exposing provider content",
    async ({ envelope }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(JSON.stringify(envelope), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      );

      await expect(
        extractProcess("test-key", [], "en", []),
      ).rejects.toMatchObject({
        code: "provider_missing_output",
        message: "The extraction provider returned no structured output.",
      } satisfies Partial<ProviderError>);
    },
  );

  it("reports provider HTTP errors without exposing their body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"secret":"sensitive provider body"}', { status: 500 }),
        ),
    );

    await expect(
      extractProcess("test-key", [], "en", []),
    ).rejects.toMatchObject({
      code: "openai_extraction_500",
      message: "Process extraction could not be completed.",
      retryable: true,
    } satisfies Partial<ProviderError>);
  });
});
