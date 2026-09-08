import { compileProcessIr } from "../../domain/bpmn-compiler";
import type { ProcessIR } from "../../domain/process-ir";

type DemoSource = {
  id: string;
  kind: "text" | "audio" | "image" | "xlsx";
  name: string;
  detail: string;
  excerpt: string;
};

type DemoVersion = {
  id: string;
  number: number;
  label: string;
  createdAt: string;
  ir: ProcessIR;
  bpmnXml: string;
};

export type DemoProject = {
  fictional: true;
  title: string;
  summary: string;
  sources: DemoSource[];
  versions: DemoVersion[];
};

const sourceIds = {
  notes: "source_returns_policy",
  audio: "source_operations_interview",
  image: "source_return_request",
  table: "source_resolution_matrix",
} as const;

const sourceRef = (sourceId: string, locator: string) => [
  { sourceId, locator },
];

const sources: DemoSource[] = [
  {
    id: sourceIds.notes,
    kind: "text",
    name: "Returns policy notes",
    detail: "Policy text, six confirmed clauses",
    excerpt:
      "Returns are accepted within 30 days when the order and item condition can be verified.",
  },
  {
    id: sourceIds.audio,
    kind: "audio",
    name: "Operations interview.m4a",
    detail: "Recorded interview, 08:42",
    excerpt:
      "Customer care verifies the order before fulfillment inspects the returned item. Finance owns refund approval.",
  },
  {
    id: sourceIds.image,
    kind: "image",
    name: "Return request.png",
    detail: "Customer portal capture",
    excerpt:
      "The request records the order number, preferred resolution, return reason, and reported item condition.",
  },
  {
    id: sourceIds.table,
    kind: "xlsx",
    name: "Resolution matrix.xlsx",
    detail: "Approval and inventory rules",
    excerpt:
      "Refunds follow finance approval levels. Replacements require available stock and a confirmed delivery address.",
  },
];

function buildIr(reviewed: boolean): ProcessIR {
  const ref = {
    notes: sourceRef(sourceIds.notes, "clauses 1-6"),
    audio: sourceRef(sourceIds.audio, "06:10-07:25"),
    image: sourceRef(sourceIds.image, "request fields"),
    table: sourceRef(sourceIds.table, "Resolution rules sheet"),
  };
  const node = (
    id: string,
    type: ProcessIR["nodes"][number]["type"],
    name: string,
    laneId: string,
    sourceRefs: ProcessIR["nodes"][number]["sourceRefs"],
    confidence = 0.94,
    assumptions: string[] = [],
  ): ProcessIR["nodes"][number] => ({
    id,
    type,
    name,
    participantId: "participant_retail_operations",
    laneId,
    sourceRefs,
    confidence,
    assumptions,
  });

  return {
    title: "Return review and resolution",
    participants: [
      {
        id: "participant_retail_operations",
        name: "Retail operations",
        lanes: [
          { id: "lane_customer_care", name: "Customer care" },
          { id: "lane_fulfillment", name: "Fulfillment" },
          { id: "lane_finance", name: "Finance" },
        ],
      },
    ],
    nodes: [
      node(
        "return_submitted",
        "startEvent",
        "Return submitted",
        "lane_customer_care",
        ref.image,
        0.99,
      ),
      node(
        "review_request",
        "task",
        "Review request details",
        "lane_customer_care",
        [...ref.image, ...ref.notes],
      ),
      node(
        "policy_check",
        "exclusiveGateway",
        "Policy requirements met?",
        "lane_customer_care",
        ref.notes,
      ),
      node(
        "explain_decision",
        "task",
        "Explain decision",
        "lane_customer_care",
        ref.notes,
      ),
      node(
        "request_closed",
        "endEvent",
        "Request closed",
        "lane_customer_care",
        ref.notes,
        0.98,
      ),
      node(
        "verify_order",
        "task",
        "Verify order and payment",
        "lane_customer_care",
        [...ref.image, ...ref.audio],
      ),
      node(
        "inspect_item",
        "task",
        "Inspect returned item",
        "lane_fulfillment",
        ref.audio,
      ),
      node(
        "choose_resolution",
        "exclusiveGateway",
        "Choose resolution",
        "lane_customer_care",
        [...ref.notes, ...ref.table],
        reviewed ? 0.93 : 0.78,
      ),
      node(
        "approve_refund",
        "task",
        "Approve and issue refund",
        "lane_finance",
        ref.table,
        reviewed ? 0.95 : 0.72,
        reviewed
          ? []
          : [
              "Refunds above the local threshold require a second finance approver.",
            ],
      ),
      node(
        "ship_replacement",
        "task",
        "Reserve and ship replacement",
        "lane_fulfillment",
        [...ref.table, ...ref.notes],
        0.86,
        reviewed
          ? [
              "Replacement stock is held for 24 hours while the resolution is confirmed.",
            ]
          : [],
      ),
      node(
        "confirm_resolution",
        "exclusiveGateway",
        "Resolution completed",
        "lane_customer_care",
        ref.audio,
      ),
      node(
        "return_completed",
        "endEvent",
        "Customer notified",
        "lane_customer_care",
        ref.notes,
        0.98,
      ),
    ],
    flows: [
      {
        id: "flow_submit_review",
        sourceId: "return_submitted",
        targetId: "review_request",
        sourceRefs: ref.image,
      },
      {
        id: "flow_review_policy",
        sourceId: "review_request",
        targetId: "policy_check",
        sourceRefs: ref.notes,
      },
      {
        id: "flow_policy_decline",
        sourceId: "policy_check",
        targetId: "explain_decision",
        condition: "Not eligible",
        sourceRefs: ref.notes,
      },
      {
        id: "flow_decline_close",
        sourceId: "explain_decision",
        targetId: "request_closed",
        sourceRefs: ref.notes,
      },
      {
        id: "flow_policy_verify",
        sourceId: "policy_check",
        targetId: "verify_order",
        condition: "Eligible",
        sourceRefs: ref.notes,
      },
      {
        id: "flow_verify_inspect",
        sourceId: "verify_order",
        targetId: "inspect_item",
        sourceRefs: ref.audio,
      },
      {
        id: "flow_inspect_resolution",
        sourceId: "inspect_item",
        targetId: "choose_resolution",
        sourceRefs: ref.audio,
      },
      {
        id: "flow_resolution_refund",
        sourceId: "choose_resolution",
        targetId: "approve_refund",
        condition: "Refund",
        sourceRefs: ref.table,
      },
      {
        id: "flow_resolution_replacement",
        sourceId: "choose_resolution",
        targetId: "ship_replacement",
        condition: "Replacement",
        sourceRefs: ref.table,
      },
      {
        id: "flow_refund_confirm",
        sourceId: "approve_refund",
        targetId: "confirm_resolution",
        sourceRefs: ref.table,
      },
      {
        id: "flow_replacement_confirm",
        sourceId: "ship_replacement",
        targetId: "confirm_resolution",
        sourceRefs: ref.table,
      },
      {
        id: "flow_confirm_complete",
        sourceId: "confirm_resolution",
        targetId: "return_completed",
        sourceRefs: ref.audio,
      },
    ],
    annotations: [],
    questions: [
      {
        id: "question_exception_owner",
        text: "Who approves returns that meet policy but fail the standard condition check?",
        relatedElementIds: ["choose_resolution"],
        severity: "important",
      },
      {
        id: "question_customer_channel",
        text: "Which customer channel should carry the final resolution notice?",
        relatedElementIds: ["confirm_resolution"],
        severity: "minor",
      },
      ...(!reviewed
        ? [
            {
              id: "question_refund_threshold",
              text: "What amount requires a second finance approver?",
              relatedElementIds: ["approve_refund"],
              severity: "important" as const,
            },
          ]
        : []),
    ],
  };
}

const versions = [true, false].map((reviewed): DemoVersion => {
  const ir = buildIr(reviewed);
  return {
    id: reviewed ? "reviewed-resolution" : "initial-process-model",
    number: reviewed ? 2 : 1,
    label: reviewed ? "Reviewed resolution path" : "Initial process model",
    createdAt: reviewed
      ? "2026-08-18T14:30:00.000Z"
      : "2026-08-18T13:55:00.000Z",
    ir,
    bpmnXml: compileProcessIr(ir),
  };
});

export const demoProject: DemoProject = {
  fictional: true,
  title: "Return review and resolution",
  summary: "From customer request to refund or replacement",
  sources,
  versions,
};
