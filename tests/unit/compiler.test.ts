import { describe, expect, it } from "vitest";
import { BpmnModdle } from "bpmn-moddle";
import { compileProcessIr, LAYOUT_VERSION } from "../../domain/bpmn-compiler";
import type { ProcessIR } from "../../domain/process-ir";
import {
  CYCLIC_PURCHASE_APPROVAL_IR,
  EVIDENCE_FIRST_RETURN_PROCESS_IR,
  SIMPLE_PROCESS_IR,
} from "../fixtures/process-ir";

type Bounds = { x: number; y: number; width: number; height: number };

function shapeBounds(xml: string, elementId: string): Bounds {
  const shape = xml.match(
    new RegExp(
      `<bpmndi:BPMNShape[^>]+bpmnElement="${elementId}"[^>]*><dc:Bounds x="([\\d.]+)" y="([\\d.]+)" width="([\\d.]+)" height="([\\d.]+)"/>`,
    ),
  );
  expect(shape, `missing BPMN-DI bounds for ${elementId}`).not.toBeNull();
  const [, x, y, width, height] = shape!;
  return {
    x: Number(x),
    y: Number(y),
    width: Number(width),
    height: Number(height),
  };
}

function positiveAreaIntersection(first: Bounds, second: Bounds): boolean {
  return (
    Math.min(first.x + first.width, second.x + second.width) >
      Math.max(first.x, second.x) &&
    Math.min(first.y + first.height, second.y + second.height) >
      Math.max(first.y, second.y)
  );
}

function expectCollisionFreeAndContained(ir: ProcessIR, xml: string): void {
  const nodeBounds = new Map(
    ir.nodes.map((node) => [node.id, shapeBounds(xml, node.id)]),
  );
  for (const [index, node] of ir.nodes.entries())
    for (const other of ir.nodes.slice(index + 1))
      expect(
        positiveAreaIntersection(
          nodeBounds.get(node.id)!,
          nodeBounds.get(other.id)!,
        ),
        `${node.id} overlaps ${other.id}`,
      ).toBe(false);

  for (const node of ir.nodes) {
    expect(node.laneId, `${node.id} must have a lane`).toBeTruthy();
    const lane = shapeBounds(xml, node.laneId!);
    const nodeBox = nodeBounds.get(node.id)!;
    expect(nodeBox.x).toBeGreaterThanOrEqual(lane.x);
    expect(nodeBox.y).toBeGreaterThanOrEqual(lane.y);
    expect(nodeBox.x + nodeBox.width).toBeLessThanOrEqual(lane.x + lane.width);
    expect(nodeBox.y + nodeBox.height).toBeLessThanOrEqual(
      lane.y + lane.height,
    );
  }
}

describe("deterministic BPMN compiler", () => {
  it("uses the collision-free deterministic layout contract", () => {
    expect(LAYOUT_VERSION).toBe("deterministic-ltr/4");
  });

  it("produces byte-stable parseable BPMN XML with DI", async () => {
    const first = compileProcessIr(SIMPLE_PROCESS_IR);
    const second = compileProcessIr(structuredClone(SIMPLE_PROCESS_IR));
    expect(first).toBe(second);
    expect(first).toContain("bpmndi:BPMNDiagram");
    const parsed = await new BpmnModdle().fromXML(first);
    expect(parsed.warnings).toEqual([]);
  });

  it("compiles evidence annotations into editable BPMN artifacts", async () => {
    const ir = structuredClone(SIMPLE_PROCESS_IR);
    ir.annotations.push({
      id: "annotation_1",
      text: "Confirm approval owner",
      participantId: "participant_main",
      laneId: "lane_finance",
      attachedToId: "decision",
      sourceRefs: [{ sourceId: "source_text", locator: "paragraph 2" }],
    });
    const result = compileProcessIr(ir);
    expect(result).toContain('<bpmn:textAnnotation id="annotation_1">');
    expect(result).toContain('bpmnElement="association_annotation_1"');
    expect((await new BpmnModdle().fromXML(result)).warnings).toEqual([]);
  });

  it("keeps a multi-lane purchase rework cycle compact and readable", async () => {
    const first = compileProcessIr(CYCLIC_PURCHASE_APPROVAL_IR);
    const reordered = structuredClone(CYCLIC_PURCHASE_APPROVAL_IR);
    reordered.nodes.reverse();
    reordered.flows.reverse();
    const second = compileProcessIr(reordered);
    expect(first).toBe(second);
    expect((await new BpmnModdle().fromXML(first)).warnings).toEqual([]);

    const nodeBounds = new Map(
      CYCLIC_PURCHASE_APPROVAL_IR.nodes.map((node) => [
        node.id,
        shapeBounds(first, node.id),
      ]),
    );
    const xPositions = [...nodeBounds.values()].map((bounds) => bounds.x);
    const farRightCount = xPositions.filter(
      (x) => x === Math.max(...xPositions),
    ).length;
    expect(farRightCount).toBeLessThanOrEqual(2);
    expect(new Set(xPositions).size).toBeGreaterThanOrEqual(8);

    for (const participant of CYCLIC_PURCHASE_APPROVAL_IR.participants) {
      for (const lane of participant.lanes) {
        const sameLaneBounds = CYCLIC_PURCHASE_APPROVAL_IR.nodes
          .filter((node) => node.laneId === lane.id)
          .map((node) => nodeBounds.get(node.id)!)
          .sort((a, b) => a.x - b.x);
        for (let index = 1; index < sameLaneBounds.length; index++) {
          const previous = sameLaneBounds[index - 1]!;
          const current = sameLaneBounds[index]!;
          expect(current.x).toBeGreaterThanOrEqual(previous.x + previous.width);
        }
      }
    }

    const resubmit = nodeBounds.get("resubmit_request")!;
    const reviewMerge = nodeBounds.get("review_merge")!;
    expect(first).toContain(
      '<bpmn:sequenceFlow id="flow_resubmit_review" sourceRef="resubmit_request" targetRef="review_merge"',
    );
    expect(resubmit.x).toBeGreaterThan(reviewMerge.x);

    const pool = shapeBounds(first, "participant_company");
    // 800 px is the compiler floor; 2300 px permits this fixture's finite
    // stage span while excluding the old 2650 px cycle-inflated canvas.
    expect(pool.width).toBeGreaterThanOrEqual(800);
    expect(pool.width).toBeLessThanOrEqual(2300);
    expectCollisionFreeAndContained(CYCLIC_PURCHASE_APPROVAL_IR, first);
  });

  it("allocates stable same-rank slots for evidence-first return branches", async () => {
    const first = compileProcessIr(EVIDENCE_FIRST_RETURN_PROCESS_IR);
    const reordered = structuredClone(EVIDENCE_FIRST_RETURN_PROCESS_IR);
    reordered.nodes.reverse();
    reordered.flows.reverse();
    reordered.annotations.reverse();
    const second = compileProcessIr(reordered);

    expect(first).toBe(second);
    expect((await new BpmnModdle().fromXML(first)).warnings).toEqual([]);
    expectCollisionFreeAndContained(EVIDENCE_FIRST_RETURN_PROCESS_IR, first);

    const rejected = shapeBounds(first, "reject_return");
    const accepted = shapeBounds(first, "send_instructions");
    expect(rejected.x).toBe(accepted.x);
    expect(rejected.y).not.toBe(accepted.y);

    const pool = shapeBounds(first, "participant_returns");
    expect(pool.width).toBeGreaterThanOrEqual(800);
    expect(pool.width).toBeLessThanOrEqual(3000);
    expect(pool.height).toBeLessThanOrEqual(1500);
  });

  it("lays out evidence annotations in collision-free participant rails", async () => {
    const result = compileProcessIr(EVIDENCE_FIRST_RETURN_PROCESS_IR);
    const annotations = EVIDENCE_FIRST_RETURN_PROCESS_IR.annotations;
    const annotationBounds = new Map(
      annotations.map((annotation) => [
        annotation.id,
        shapeBounds(result, annotation.id),
      ]),
    );
    const nodeBounds = new Map(
      EVIDENCE_FIRST_RETURN_PROCESS_IR.nodes.map((node) => [
        node.id,
        shapeBounds(result, node.id),
      ]),
    );
    const pool = shapeBounds(result, "participant_returns");
    const rightmostNodeEdge = Math.max(
      ...[...nodeBounds.values()].map((box) => box.x + box.width),
    );

    expect(result).toContain('<bpmn:textAnnotation id="a_payment_term_10">');
    expect(result).toContain('bpmnElement="association_a_payment_term_10"');

    for (const [index, annotation] of annotations.entries()) {
      const box = annotationBounds.get(annotation.id)!;
      expect(
        box.y,
        `${annotation.id} starts above its pool`,
      ).toBeGreaterThanOrEqual(pool.y);
      expect(
        box.y + box.height,
        `${annotation.id} ends below its pool`,
      ).toBeLessThanOrEqual(pool.y + pool.height);
      expect(
        box.x,
        `${annotation.id} is not in the annotation rail`,
      ).toBeGreaterThan(rightmostNodeEdge);

      for (const other of annotations.slice(index + 1))
        expect(
          positiveAreaIntersection(box, annotationBounds.get(other.id)!),
          `${annotation.id} overlaps ${other.id}`,
        ).toBe(false);

      for (const node of EVIDENCE_FIRST_RETURN_PROCESS_IR.nodes)
        expect(
          positiveAreaIntersection(box, nodeBounds.get(node.id)!),
          `${annotation.id} overlaps ${node.id}`,
        ).toBe(false);
    }

    expect(annotationBounds.get("a_payment_term_10")).not.toEqual(
      annotationBounds.get("a_payment_term_5"),
    );
    expect(annotationBounds.get("a_payment_term_10")).toMatchObject({
      width: 220,
      height: 168,
    });
    expect(annotationBounds.get("a_payment_term_5")).toMatchObject({
      width: 220,
      height: 96,
    });
    expect(
      annotationBounds.get("annotation_multiline_long_token"),
    ).toMatchObject({
      width: 220,
      height: 150,
    });
    expect((await new BpmnModdle().fromXML(result)).warnings).toEqual([]);
  });

  it("opens another rail column and expands a virtual lane when needed", () => {
    const ir: ProcessIR = structuredClone(SIMPLE_PROCESS_IR);
    ir.participants[0]!.lanes = [];
    for (const node of ir.nodes) delete node.laneId;
    ir.annotations = ["a", "b"].map((suffix) => ({
      id: `annotation_tall_${suffix}`,
      text: suffix.repeat(400),
      participantId: "participant_main",
      attachedToId: "approve",
      sourceRefs: [{ sourceId: "source_text", locator: `tall ${suffix}` }],
    }));

    const result = compileProcessIr(ir);
    const pool = shapeBounds(result, "participant_main");
    const first = shapeBounds(result, "annotation_tall_a");
    const second = shapeBounds(result, "annotation_tall_b");

    expect(pool.height).toBe(342);
    expect(first.height).toBe(294);
    expect(first.y).toBeGreaterThanOrEqual(pool.y);
    expect(first.y + first.height).toBeLessThanOrEqual(pool.y + pool.height);
    expect(second.y).toBe(first.y);
    expect(second.x).toBeGreaterThan(first.x + first.width);
  });
});
