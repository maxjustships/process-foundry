import { z } from "zod";

export const sourceRefSchema = z
  .object({
    sourceId: z.string().min(1).max(100),
    locator: z.string().min(1).max(200),
  })
  .strict();
export const nodeTypeSchema = z.enum([
  "startEvent",
  "endEvent",
  "task",
  "exclusiveGateway",
  "parallelGateway",
  "intermediateMessageEvent",
  "intermediateTimerEvent",
]);
export const processIrSchema = z
  .object({
    title: z.string().min(1).max(200),
    participants: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z][\w-]*$/u),
            name: z.string().min(1).max(120),
            lanes: z
              .array(
                z
                  .object({
                    id: z.string().regex(/^[a-zA-Z][\w-]*$/u),
                    name: z.string().min(1).max(120),
                  })
                  .strict(),
              )
              .max(12),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    nodes: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z][\w-]*$/u),
            type: nodeTypeSchema,
            name: z.string().max(200),
            participantId: z.string(),
            laneId: z.string().optional(),
            sourceRefs: z.array(sourceRefSchema).max(20),
            confidence: z.number().min(0).max(1),
            assumptions: z.array(z.string().min(1).max(300)).max(10),
          })
          .strict(),
      )
      .min(2)
      .max(120),
    flows: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z][\w-]*$/u),
            sourceId: z.string(),
            targetId: z.string(),
            condition: z.string().min(1).max(200).optional(),
            sourceRefs: z.array(sourceRefSchema).max(20),
          })
          .strict(),
      )
      .max(180),
    annotations: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z][\w-]*$/u),
            text: z.string().min(1).max(500),
            participantId: z.string(),
            laneId: z.string().optional(),
            attachedToId: z.string().optional(),
            sourceRefs: z.array(sourceRefSchema).max(20),
          })
          .strict(),
      )
      .max(40),
    questions: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-zA-Z][\w-]*$/u),
            text: z.string().min(1).max(500),
            relatedElementIds: z.array(z.string()).max(20),
            severity: z.enum(["blocking", "important", "minor"]),
          })
          .strict(),
      )
      .max(40),
  })
  .strict();

export type ProcessIR = z.infer<typeof processIrSchema>;
export type ValidationIssue = {
  code: string;
  message: string;
  elementId?: string;
};

const declaredConflictResolutionPattern =
  /\b(?:replaces?|replaced|overrides?|overridden|supersedes?|superseded|takes?\s+precedence|contradiction\s+(?:is\s+)?resolved)\b|(?:заменяет|заменил[аои]?|заменено|переопределяет|переопределено|отменяет|отменено|имеет\s+приоритет|противоречи[ея]\s+(?:разрешено|устранено))/iu;

function distinctSourceCount(
  sourceRefs: ProcessIR["nodes"][number]["sourceRefs"],
): number {
  return new Set(sourceRefs.map((sourceRef) => sourceRef.sourceId)).size;
}

export function validateProcessIr(input: ProcessIR): ValidationIssue[] {
  const parsed = processIrSchema.safeParse(input);
  if (!parsed.success)
    return parsed.error.issues.map((issue) => ({
      code: "schema",
      message: issue.message,
    }));
  const ir = parsed.data;
  const issues: ValidationIssue[] = [];
  const ids = [
    ...ir.participants.map((item) => item.id),
    ...ir.participants.flatMap((item) => item.lanes.map((lane) => lane.id)),
    ...ir.nodes.map((item) => item.id),
    ...ir.flows.map((item) => item.id),
    ...ir.annotations.map((item) => item.id),
    ...ir.questions.map((item) => item.id),
  ];
  if (new Set(ids).size !== ids.length)
    issues.push({
      code: "duplicate_id",
      message: "Every IR identifier must be unique.",
    });
  const nodes = new Map(ir.nodes.map((node) => [node.id, node]));
  const participants = new Map(
    ir.participants.map((participant) => [participant.id, participant]),
  );
  for (const node of ir.nodes) {
    const participant = participants.get(node.participantId);
    if (!participant)
      issues.push({
        code: "dangling_participant",
        message: "Node participant does not exist.",
        elementId: node.id,
      });
    if (participant?.lanes.length && !node.laneId)
      issues.push({
        code: "missing_lane_assignment",
        message: "Every flow node in a participant with lanes needs a lane.",
        elementId: node.id,
      });
    else if (
      node.laneId &&
      !participant?.lanes.some((lane) => lane.id === node.laneId)
    )
      issues.push({
        code: "dangling_lane",
        message: "Node lane does not exist in its participant.",
        elementId: node.id,
      });
  }
  for (const flow of ir.flows) {
    if (!nodes.has(flow.sourceId))
      issues.push({
        code: "dangling_flow_source",
        message: "Flow source does not exist.",
        elementId: flow.id,
      });
    if (!nodes.has(flow.targetId))
      issues.push({
        code: "dangling_flow_target",
        message: "Flow target does not exist.",
        elementId: flow.id,
      });
    const source = nodes.get(flow.sourceId);
    const target = nodes.get(flow.targetId);
    if (source && target && source.participantId !== target.participantId)
      issues.push({
        code: "cross_pool_sequence_flow",
        message:
          "Sequence flows cannot cross participant pools in the supported subset.",
        elementId: flow.id,
      });
  }
  for (const annotation of ir.annotations) {
    const participant = participants.get(annotation.participantId);
    if (!participant)
      issues.push({
        code: "dangling_annotation_participant",
        message: "Annotation participant does not exist.",
        elementId: annotation.id,
      });
    if (
      annotation.laneId &&
      !participant?.lanes.some((lane) => lane.id === annotation.laneId)
    )
      issues.push({
        code: "dangling_annotation_lane",
        message: "Annotation lane does not exist.",
        elementId: annotation.id,
      });
    if (annotation.attachedToId && !nodes.has(annotation.attachedToId))
      issues.push({
        code: "dangling_annotation_target",
        message: "Annotation target does not exist.",
        elementId: annotation.id,
      });
    if (
      annotation.attachedToId &&
      nodes.get(annotation.attachedToId)?.participantId !==
        annotation.participantId
    )
      issues.push({
        code: "cross_pool_annotation",
        message: "An annotation must remain in its participant pool.",
        elementId: annotation.id,
      });
  }
  if (!ir.nodes.some((node) => node.type === "startEvent"))
    issues.push({
      code: "missing_start",
      message: "At least one start event is required.",
    });
  if (!ir.nodes.some((node) => node.type === "endEvent"))
    issues.push({
      code: "missing_end",
      message: "At least one end event is required.",
    });
  const incomingByNode = new Map(
    ir.nodes.map((node) => [node.id, [] as ProcessIR["flows"]]),
  );
  const outgoingByNode = new Map(
    ir.nodes.map((node) => [node.id, [] as ProcessIR["flows"]]),
  );
  for (const flow of ir.flows) {
    incomingByNode.get(flow.targetId)?.push(flow);
    outgoingByNode.get(flow.sourceId)?.push(flow);
  }
  for (const node of ir.nodes) {
    const incomingFlows = incomingByNode.get(node.id)!;
    const outgoingFlows = outgoingByNode.get(node.id)!;
    const incoming = incomingFlows.length;
    const outgoing = outgoingFlows.length;
    if (
      (node.type !== "startEvent" && incoming === 0) ||
      (node.type !== "endEvent" && outgoing === 0)
    )
      issues.push({
        code: "orphan_node",
        message: "Node is disconnected from the process.",
        elementId: node.id,
      });
    if (
      node.type.endsWith("Gateway") &&
      node.confidence < 0.6 &&
      !ir.questions.some((question) =>
        question.relatedElementIds.includes(node.id),
      )
    )
      issues.push({
        code: "missing_ambiguity_question",
        message: "A low-confidence gateway requires a review question.",
        elementId: node.id,
      });
    if (node.type.startsWith("intermediate") && node.sourceRefs.length === 0)
      issues.push({
        code: "event_without_evidence",
        message: "Message and timer events require evidence.",
        elementId: node.id,
      });
    const isGateway = node.type.endsWith("Gateway");
    if (isGateway && incoming <= 1 && outgoing <= 1)
      issues.push({
        code: "meaningless_gateway",
        message: "A gateway must explicitly split or merge process branches.",
        elementId: node.id,
      });
    if (!isGateway && incoming > 1)
      issues.push({
        code: "implicit_merge",
        message:
          "Reconverging branches require an explicit exclusive or parallel merge gateway.",
        elementId: node.id,
      });
    if (isGateway && outgoing >= 2) {
      const targetIds = outgoingFlows.map((flow) => flow.targetId);
      if (new Set(targetIds).size !== targetIds.length)
        issues.push({
          code: "duplicate_gateway_target",
          message: "Every split branch must target a distinct flow node.",
          elementId: node.id,
        });
    }
    if (node.type === "exclusiveGateway" && outgoing >= 2) {
      const normalizedConditions = outgoingFlows.map((flow) =>
        flow.condition?.trim().toLocaleLowerCase("en-US"),
      );
      for (const [index, condition] of normalizedConditions.entries())
        if (!condition)
          issues.push({
            code: "missing_gateway_condition",
            message: "Every exclusive split branch needs a condition label.",
            elementId: outgoingFlows[index]!.id,
          });
      const presentConditions = normalizedConditions.filter(
        (condition): condition is string => Boolean(condition),
      );
      if (new Set(presentConditions).size !== presentConditions.length)
        issues.push({
          code: "duplicate_gateway_condition",
          message: "Exclusive split condition labels must be distinct.",
          elementId: node.id,
        });
    }
    if (
      node.type === "parallelGateway" &&
      outgoing >= 2 &&
      outgoingFlows.some((flow) => Boolean(flow.condition?.trim()))
    )
      issues.push({
        code: "parallel_gateway_condition",
        message: "Parallel split branches cannot have condition labels.",
        elementId: node.id,
      });
  }
  const questionTargetIds = new Set([
    ...ir.nodes.map((node) => node.id),
    ...ir.flows.map((flow) => flow.id),
    ...ir.annotations.map((annotation) => annotation.id),
  ]);
  for (const question of ir.questions)
    for (const id of question.relatedElementIds)
      if (!questionTargetIds.has(id))
        issues.push({
          code: "dangling_question_reference",
          message: "Question element does not exist.",
          elementId: question.id,
        });
  const hasRelatedQuestion = (elementIds: string[]) =>
    ir.questions.some((question) =>
      question.relatedElementIds.some((id) => elementIds.includes(id)),
    );
  for (const node of ir.nodes)
    if (
      distinctSourceCount(node.sourceRefs) > 1 &&
      node.assumptions.some((assumption) =>
        declaredConflictResolutionPattern.test(assumption),
      ) &&
      !hasRelatedQuestion([node.id])
    )
      issues.push({
        code: "conflict_resolved_without_question",
        message:
          "A declared multi-source conflict resolution requires a related review question.",
        elementId: node.id,
      });
  for (const annotation of ir.annotations)
    if (
      annotation.attachedToId &&
      distinctSourceCount(annotation.sourceRefs) > 1 &&
      declaredConflictResolutionPattern.test(annotation.text) &&
      !hasRelatedQuestion([annotation.id, annotation.attachedToId])
    )
      issues.push({
        code: "conflict_resolved_without_question",
        message:
          "A declared multi-source conflict resolution requires a related review question.",
        elementId: annotation.id,
      });
  return issues;
}

export const processIrJsonSchema = z.toJSONSchema(processIrSchema, {
  target: "draft-07",
});
