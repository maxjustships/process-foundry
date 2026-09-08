import { describe, expect, it } from "vitest";
import {
  processIrSchema,
  validateProcessIr,
  type ProcessIR,
} from "../../domain/process-ir";
import { getMockProcessIr } from "../../ai/provider.server";
import {
  EVIDENCE_FIRST_RETURN_PROCESS_IR,
  SIMPLE_PROCESS_IR,
} from "../fixtures/process-ir";

function cloneIr(ir: ProcessIR): ProcessIR {
  return structuredClone(ir);
}

function issueCodes(ir: ProcessIR): string[] {
  return validateProcessIr(ir).map((issue) => issue.code);
}

describe("ProcessIR", () => {
  it("accepts the supported subset and resolved references", () => {
    expect(processIrSchema.parse(SIMPLE_PROCESS_IR).title).toBe(
      "Invoice approval",
    );
    expect(validateProcessIr(SIMPLE_PROCESS_IR)).toEqual([]);
  });

  it("keeps the deterministic generation mock valid", () => {
    expect(validateProcessIr(getMockProcessIr([]))).toEqual([]);
  });

  it("rejects dangling references, orphan nodes, and unsupported constructs", () => {
    const broken = structuredClone(SIMPLE_PROCESS_IR);
    broken.flows[0]!.targetId = "missing";
    expect(validateProcessIr(broken).map((issue) => issue.code)).toContain(
      "dangling_flow_target",
    );
    expect(() =>
      processIrSchema.parse({
        ...SIMPLE_PROCESS_IR,
        nodes: [{ ...SIMPLE_PROCESS_IR.nodes[0], type: "serviceTask" }],
      }),
    ).toThrow();
  });

  it("requires a question for low-confidence gateways", () => {
    const broken = structuredClone(SIMPLE_PROCESS_IR);
    broken.nodes[1]!.confidence = 0.35;
    broken.questions = [];
    expect(validateProcessIr(broken).map((issue) => issue.code)).toContain(
      "missing_ambiguity_question",
    );
  });

  it("rejects sequence flows and annotations that cross participant pools", () => {
    const broken = structuredClone(SIMPLE_PROCESS_IR);
    broken.participants.push({
      id: "participant_vendor",
      name: "Vendor",
      lanes: [{ id: "lane_vendor", name: "Vendor" }],
    });
    broken.nodes.push({
      id: "vendor_end",
      type: "endEvent",
      name: "Vendor complete",
      participantId: "participant_vendor",
      laneId: "lane_vendor",
      sourceRefs: [],
      confidence: 1,
      assumptions: [],
    });
    broken.flows[2]!.targetId = "vendor_end";
    broken.annotations.push({
      id: "annotation_cross",
      text: "Cross pool",
      participantId: "participant_vendor",
      laneId: "lane_vendor",
      attachedToId: "approve",
      sourceRefs: [],
    });
    const codes = validateProcessIr(broken).map((issue) => issue.code);
    expect(codes).toContain("cross_pool_sequence_flow");
    expect(codes).toContain("cross_pool_annotation");
  });

  it("requires every flow node in a participant with lanes to have a valid lane", () => {
    const broken = cloneIr(EVIDENCE_FIRST_RETURN_PROCESS_IR);
    delete broken.nodes.find((node) => node.id === "manual_review")!.laneId;
    expect(issueCodes(broken)).toContain("missing_lane_assignment");
  });

  it("rejects gateways that neither split nor merge", () => {
    const broken = cloneIr(SIMPLE_PROCESS_IR);
    broken.flows = broken.flows.filter((flow) => flow.id !== "flow_4");
    broken.nodes = broken.nodes.filter((node) => node.id !== "rejected");
    expect(issueCodes(broken)).toContain("meaningless_gateway");
  });

  it("requires split gateways to target distinct nodes", () => {
    const broken = cloneIr(EVIDENCE_FIRST_RETURN_PROCESS_IR);
    broken.flows.find((flow) => flow.id === "flow_05")!.targetId =
      "reject_return";
    expect(issueCodes(broken)).toContain("duplicate_gateway_target");
  });

  it("requires an explicit gateway before reconverging branches", () => {
    const broken = cloneIr(EVIDENCE_FIRST_RETURN_PROCESS_IR);
    broken.flows.push({
      id: "flow_implicit_refund_merge",
      sourceId: "finance_approval",
      targetId: "issue_refund",
      sourceRefs: [],
    });
    expect(issueCodes(broken)).toContain("implicit_merge");
  });

  it("requires nonempty distinct conditions on exclusive split branches", () => {
    const missing = cloneIr(EVIDENCE_FIRST_RETURN_PROCESS_IR);
    missing.flows.find((flow) => flow.id === "flow_04")!.condition = "   ";
    expect(issueCodes(missing)).toContain("missing_gateway_condition");

    const duplicate = cloneIr(EVIDENCE_FIRST_RETURN_PROCESS_IR);
    duplicate.flows.find((flow) => flow.id === "flow_05")!.condition = "Нет";
    expect(issueCodes(duplicate)).toContain("duplicate_gateway_condition");
  });

  it("rejects invented conditions on parallel split branches", () => {
    const broken = cloneIr(EVIDENCE_FIRST_RETURN_PROCESS_IR);
    broken.nodes.find((node) => node.id === "eligibility_split")!.type =
      "parallelGateway";
    expect(issueCodes(broken)).toContain("parallel_gateway_condition");
  });

  it("requires a related question for declared source-conflict resolution", () => {
    const annotationConflict = cloneIr(EVIDENCE_FIRST_RETURN_PROCESS_IR);
    annotationConflict.questions = annotationConflict.questions.filter(
      (question) => question.id !== "question_refund_sla",
    );
    annotationConflict.annotations[0]!.text =
      "5 рабочих дней заменяет 3 рабочих дня.";
    expect(issueCodes(annotationConflict)).toContain(
      "conflict_resolved_without_question",
    );

    annotationConflict.questions.push({
      id: "question_declared_conflict",
      text: "Какой срок подтверждён источниками?",
      relatedElementIds: ["annotation_refund_sla_conflict"],
      severity: "blocking",
    });
    expect(issueCodes(annotationConflict)).not.toContain(
      "conflict_resolved_without_question",
    );

    const assumptionConflict = cloneIr(EVIDENCE_FIRST_RETURN_PROCESS_IR);
    assumptionConflict.questions = assumptionConflict.questions.filter(
      (question) => question.id !== "question_refund_sla",
    );
    assumptionConflict.nodes.find(
      (node) => node.id === "issue_refund",
    )!.assumptions = ["5 working days overrides 3 working days."];
    expect(issueCodes(assumptionConflict)).toContain(
      "conflict_resolved_without_question",
    );
  });
});
