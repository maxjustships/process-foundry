import type { ProcessIR } from "./process-ir";
import { validateProcessIr } from "./process-ir";

export const COMPILER_VERSION = "subset-compiler/1";
export const LAYOUT_VERSION = "deterministic-ltr/4";

const HORIZONTAL_STEP = 160;
const MIN_LANE_HEIGHT = 180;
const LANE_VERTICAL_PADDING = 36;
const SLOT_GAP = 24;
const ANNOTATION_WIDTH = 220;
const ANNOTATION_HORIZONTAL_PADDING = 12;
const ANNOTATION_VERTICAL_PADDING = 12;
const ANNOTATION_APPROXIMATE_GLYPH_WIDTH = 7;
const ANNOTATION_LINE_HEIGHT = 18;
const ANNOTATION_RAIL_HORIZONTAL_GAP = 80;
const ANNOTATION_RAIL_COLUMN_GAP = 32;
const ANNOTATION_RAIL_VERTICAL_PADDING = 24;
const ANNOTATION_STACK_GAP = 24;
const ANNOTATION_GLYPH_BUDGET = Math.floor(
  (ANNOTATION_WIDTH - 2 * ANNOTATION_HORIZONTAL_PADDING) /
    ANNOTATION_APPROXIMATE_GLYPH_WIDTH,
);

const dimensions = {
  startEvent: [36, 36],
  endEvent: [36, 36],
  task: [120, 72],
  exclusiveGateway: [50, 50],
  parallelGateway: [50, 50],
  intermediateMessageEvent: [36, 36],
  intermediateTimerEvent: [36, 36],
} as const;
const tags = {
  startEvent: "startEvent",
  endEvent: "endEvent",
  task: "task",
  exclusiveGateway: "exclusiveGateway",
  parallelGateway: "parallelGateway",
  intermediateMessageEvent: "intermediateCatchEvent",
  intermediateTimerEvent: "intermediateCatchEvent",
} as const;
const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

function wrappedAnnotationLineCount(text: string): number {
  let lineCount = 0;
  const explicitLines = text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");

  for (const explicitLine of explicitLines) {
    const words = explicitLine.trim().split(/\s+/u).filter(Boolean);
    if (!words.length) {
      lineCount += 1;
      continue;
    }

    let occupiedGlyphs = 0;
    for (const word of words) {
      const wordGlyphs = Array.from(word).length;
      if (wordGlyphs > ANNOTATION_GLYPH_BUDGET) {
        if (occupiedGlyphs) {
          lineCount += 1;
        }
        lineCount += Math.floor(wordGlyphs / ANNOTATION_GLYPH_BUDGET);
        occupiedGlyphs = wordGlyphs % ANNOTATION_GLYPH_BUDGET;
        continue;
      }

      if (!occupiedGlyphs) occupiedGlyphs = wordGlyphs;
      else if (occupiedGlyphs + 1 + wordGlyphs <= ANNOTATION_GLYPH_BUDGET)
        occupiedGlyphs += 1 + wordGlyphs;
      else {
        lineCount += 1;
        occupiedGlyphs = wordGlyphs;
      }
    }
    if (occupiedGlyphs) lineCount += 1;
  }

  return lineCount;
}

function annotationHeight(text: string): number {
  return (
    wrappedAnnotationLineCount(text) * ANNOTATION_LINE_HEIGHT +
    2 * ANNOTATION_VERTICAL_PADDING
  );
}

function topologicalLevels(ir: ProcessIR): Map<string, number> {
  const orderedNodeIds = ir.nodes
    .map((node) => node.id)
    .sort((a, b) => a.localeCompare(b));
  const orderedFlows = [...ir.flows].sort(
    (a, b) => a.targetId.localeCompare(b.targetId) || a.id.localeCompare(b.id),
  );
  const outgoing = new Map(orderedNodeIds.map((id) => [id, [] as string[]]));
  for (const flow of orderedFlows)
    outgoing.get(flow.sourceId)!.push(flow.targetId);

  // Collapse cycles before ranking. Longest-path relaxation on the raw graph
  // lets every back edge increase its component again on every pass.
  let nextIndex = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const components: string[][] = [];
  const visit = (nodeId: string) => {
    const index = nextIndex++;
    indexes.set(nodeId, index);
    lowLinks.set(nodeId, index);
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const targetId of outgoing.get(nodeId)!) {
      if (!indexes.has(targetId)) {
        visit(targetId);
        lowLinks.set(
          nodeId,
          Math.min(lowLinks.get(nodeId)!, lowLinks.get(targetId)!),
        );
      } else if (onStack.has(targetId)) {
        lowLinks.set(
          nodeId,
          Math.min(lowLinks.get(nodeId)!, indexes.get(targetId)!),
        );
      }
    }

    if (lowLinks.get(nodeId) !== indexes.get(nodeId)) return;
    const component: string[] = [];
    let memberId: string;
    do {
      memberId = stack.pop()!;
      onStack.delete(memberId);
      component.push(memberId);
    } while (memberId !== nodeId);
    component.sort((a, b) => a.localeCompare(b));
    components.push(component);
  };
  for (const nodeId of orderedNodeIds) if (!indexes.has(nodeId)) visit(nodeId);
  components.sort((a, b) => a[0]!.localeCompare(b[0]!));

  const componentByNode = new Map<string, number>();
  components.forEach((component, componentId) => {
    for (const nodeId of component) componentByNode.set(nodeId, componentId);
  });

  // Enter an SCC through its boundary node, then follow stable internal edges.
  // This reserves one x rank per member without pretending the back edge is a
  // forward dependency.
  const orderedMembers = components.map((component, componentId) => {
    const entryIds = new Set(
      orderedFlows
        .filter(
          (flow) =>
            componentByNode.get(flow.targetId) === componentId &&
            componentByNode.get(flow.sourceId) !== componentId,
        )
        .map((flow) => flow.targetId),
    );
    const startIds = new Set(
      ir.nodes
        .filter(
          (node) =>
            node.type === "startEvent" &&
            componentByNode.get(node.id) === componentId,
        )
        .map((node) => node.id),
    );
    const seeds = [
      ...component.filter((id) => entryIds.has(id)),
      ...component.filter((id) => startIds.has(id) && !entryIds.has(id)),
      ...component.filter((id) => !entryIds.has(id) && !startIds.has(id)),
    ];
    const result: string[] = [];
    const seen = new Set<string>();
    const walk = (nodeId: string) => {
      if (seen.has(nodeId)) return;
      seen.add(nodeId);
      result.push(nodeId);
      for (const targetId of outgoing.get(nodeId)!)
        if (componentByNode.get(targetId) === componentId) walk(targetId);
    };
    for (const seed of seeds) walk(seed);
    return result;
  });

  const successors = components.map(() => new Set<number>());
  const indegrees = components.map(() => 0);
  for (const flow of orderedFlows) {
    const source = componentByNode.get(flow.sourceId)!;
    const target = componentByNode.get(flow.targetId)!;
    if (source === target || successors[source]!.has(target)) continue;
    successors[source]!.add(target);
    indegrees[target]! += 1;
  }

  const componentLevels: number[] = components.map((component) =>
    component.some(
      (id) => ir.nodes.find((node) => node.id === id)!.type === "startEvent",
    )
      ? 0
      : 1,
  );
  const compareComponents = (a: number, b: number) =>
    components[a]![0]!.localeCompare(components[b]![0]!);
  const ready = components
    .map((_, componentId) => componentId)
    .filter((componentId) => indegrees[componentId] === 0)
    .sort(compareComponents);
  while (ready.length) {
    const componentId = ready.shift()!;
    const nextLevel =
      componentLevels[componentId]! + orderedMembers[componentId]!.length;
    for (const successorId of [...successors[componentId]!].sort(
      compareComponents,
    )) {
      componentLevels[successorId] = Math.max(
        componentLevels[successorId]!,
        nextLevel,
      );
      indegrees[successorId]! -= 1;
      if (indegrees[successorId] === 0) {
        ready.push(successorId);
        ready.sort(compareComponents);
      }
    }
  }

  const levels = new Map<string, number>();
  orderedMembers.forEach((members, componentId) => {
    members.forEach((nodeId, offset) => {
      levels.set(nodeId, componentLevels[componentId]! + offset);
    });
  });
  return levels;
}

export function compileProcessIr(ir: ProcessIR): string {
  const issues = validateProcessIr(ir);
  if (issues.length)
    throw new Error(
      `ProcessIR failed validation: ${issues.map((issue) => issue.code).join(", ")}`,
    );
  const orderedNodes = [...ir.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const orderedFlows = [...ir.flows].sort((a, b) => a.id.localeCompare(b.id));
  const orderedAnnotations = [...ir.annotations].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const annotationDimensions = new Map(
    orderedAnnotations.map((annotation) => [
      annotation.id,
      {
        width: ANNOTATION_WIDTH,
        height: annotationHeight(annotation.text),
      },
    ]),
  );
  const levels = topologicalLevels(ir);
  const virtualLaneId = (participantId: string) =>
    `__participant_${participantId}`;
  const laneKeyForNode = (node: ProcessIR["nodes"][number]) =>
    node.laneId ?? virtualLaneId(node.participantId);
  const slotKey = (node: ProcessIR["nodes"][number]) =>
    `${node.participantId}\u0000${laneKeyForNode(node)}\u0000${levels.get(node.id) ?? 0}`;
  const slotBuckets = new Map<string, Array<ProcessIR["nodes"][number]>>();
  for (const node of orderedNodes) {
    const key = slotKey(node);
    const bucket = slotBuckets.get(key) ?? [];
    bucket.push(node);
    slotBuckets.set(key, bucket);
  }
  const laneContentHeights = new Map<string, number>();
  for (const bucket of slotBuckets.values()) {
    const contentHeight =
      bucket.reduce((total, node) => total + dimensions[node.type][1], 0) +
      Math.max(bucket.length - 1, 0) * SLOT_GAP;
    const laneKey = laneKeyForNode(bucket[0]!);
    laneContentHeights.set(
      laneKey,
      Math.max(laneContentHeights.get(laneKey) ?? 0, contentHeight),
    );
  }
  const participantLayout = new Map<string, { y: number; height: number }>();
  const laneLayout = new Map<string, { y: number; height: number }>();
  let nextParticipantY = 40;
  for (const participant of ir.participants) {
    const laneIds = participant.lanes.length
      ? participant.lanes.map((lane) => lane.id)
      : [virtualLaneId(participant.id)];
    let nextLaneY = nextParticipantY;
    for (const laneId of laneIds) {
      const height = Math.max(
        MIN_LANE_HEIGHT,
        (laneContentHeights.get(laneId) ?? 0) + 2 * LANE_VERTICAL_PADDING,
      );
      laneLayout.set(laneId, { y: nextLaneY, height });
      nextLaneY += height;
    }
    const tallestAnnotation = Math.max(
      0,
      ...orderedAnnotations
        .filter((annotation) => annotation.participantId === participant.id)
        .map((annotation) => annotationDimensions.get(annotation.id)!.height),
    );
    const minimumAnnotationHeight =
      tallestAnnotation + 2 * ANNOTATION_RAIL_VERTICAL_PADDING;
    const participantHeight = nextLaneY - nextParticipantY;
    if (participantHeight < minimumAnnotationHeight) {
      const finalLaneId = laneIds.at(-1)!;
      const finalLane = laneLayout.get(finalLaneId)!;
      const additionalHeight = minimumAnnotationHeight - participantHeight;
      finalLane.height += additionalHeight;
      nextLaneY += additionalHeight;
    }
    const height = nextLaneY - nextParticipantY;
    participantLayout.set(participant.id, { y: nextParticipantY, height });
    nextParticipantY += height + 40;
  }
  const nodeY = new Map<string, number>();
  for (const bucket of slotBuckets.values()) {
    const lane = laneLayout.get(laneKeyForNode(bucket[0]!))!;
    const contentHeight =
      bucket.reduce((total, node) => total + dimensions[node.type][1], 0) +
      Math.max(bucket.length - 1, 0) * SLOT_GAP;
    let nextY = lane.y + (lane.height - contentHeight) / 2;
    for (const node of bucket) {
      nodeY.set(node.id, nextY);
      nextY += dimensions[node.type][1] + SLOT_GAP;
    }
  }
  const bounds = new Map(
    orderedNodes.map((node) => {
      const [width, height] = dimensions[node.type];
      const x = 150 + (levels.get(node.id) ?? 0) * HORIZONTAL_STEP;
      const y = nodeY.get(node.id)!;
      return [node.id, { x, y, width, height }];
    }),
  );
  const annotationBounds = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  for (const participant of ir.participants) {
    const participantBox = participantLayout.get(participant.id)!;
    const participantAnnotations = orderedAnnotations
      .filter((annotation) => annotation.participantId === participant.id)
      .sort((first, second) => {
        const firstAttached = first.attachedToId
          ? bounds.get(first.attachedToId)
          : null;
        const secondAttached = second.attachedToId
          ? bounds.get(second.attachedToId)
          : null;
        const firstPreferredY = firstAttached
          ? firstAttached.y + firstAttached.height / 2
          : participantBox.y;
        const secondPreferredY = secondAttached
          ? secondAttached.y + secondAttached.height / 2
          : participantBox.y;
        return (
          firstPreferredY - secondPreferredY ||
          first.id.localeCompare(second.id)
        );
      });
    const participantNodeRight = Math.max(
      150,
      ...orderedNodes
        .filter((node) => node.participantId === participant.id)
        .map((node) => {
          const box = bounds.get(node.id)!;
          return box.x + box.width;
        }),
    );
    const railTop = participantBox.y + ANNOTATION_RAIL_VERTICAL_PADDING;
    const railBottom =
      participantBox.y +
      participantBox.height -
      ANNOTATION_RAIL_VERTICAL_PADDING;
    let railColumn = 0;
    let nextAnnotationY = railTop;

    for (const annotation of participantAnnotations) {
      const size = annotationDimensions.get(annotation.id)!;
      if (
        nextAnnotationY > railTop &&
        nextAnnotationY + size.height > railBottom
      ) {
        railColumn += 1;
        nextAnnotationY = railTop;
      }
      annotationBounds.set(annotation.id, {
        x:
          participantNodeRight +
          ANNOTATION_RAIL_HORIZONTAL_GAP +
          railColumn * (ANNOTATION_WIDTH + ANNOTATION_RAIL_COLUMN_GAP),
        y: nextAnnotationY,
        ...size,
      });
      nextAnnotationY += size.height + ANNOTATION_STACK_GAP;
    }
  }
  const nodeXml = (node: ProcessIR["nodes"][number]) => {
    const incoming = orderedFlows
      .filter((flow) => flow.targetId === node.id)
      .map((flow) => `<bpmn:incoming>${xml(flow.id)}</bpmn:incoming>`)
      .join("");
    const outgoing = orderedFlows
      .filter((flow) => flow.sourceId === node.id)
      .map((flow) => `<bpmn:outgoing>${xml(flow.id)}</bpmn:outgoing>`)
      .join("");
    const definition =
      node.type === "intermediateMessageEvent"
        ? `<bpmn:messageEventDefinition id="${xml(node.id)}_definition"/>`
        : node.type === "intermediateTimerEvent"
          ? `<bpmn:timerEventDefinition id="${xml(node.id)}_definition"/>`
          : "";
    return `<bpmn:${tags[node.type]} id="${xml(node.id)}" name="${xml(node.name)}">${incoming}${outgoing}${definition}</bpmn:${tags[node.type]}>`;
  };
  const processXml = ir.participants
    .map((participant) => {
      const participantNodes = orderedNodes.filter(
        (node) => node.participantId === participant.id,
      );
      const nodeIds = new Set(participantNodes.map((node) => node.id));
      const participantFlows = orderedFlows.filter((flow) =>
        nodeIds.has(flow.sourceId),
      );
      const laneXml = participant.lanes
        .map(
          (lane) =>
            `<bpmn:lane id="${xml(lane.id)}" name="${xml(lane.name)}">${participantNodes
              .filter((node) => node.laneId === lane.id)
              .map(
                (node) =>
                  `<bpmn:flowNodeRef>${xml(node.id)}</bpmn:flowNodeRef>`,
              )
              .join("")}</bpmn:lane>`,
        )
        .join("");
      const flowXml = participantFlows
        .map(
          (flow) =>
            `<bpmn:sequenceFlow id="${xml(flow.id)}" sourceRef="${xml(flow.sourceId)}" targetRef="${xml(flow.targetId)}"${flow.condition ? ` name="${xml(flow.condition)}"` : ""}/>`,
        )
        .join("");
      const annotations = orderedAnnotations.filter(
        (annotation) => annotation.participantId === participant.id,
      );
      const annotationXml = annotations
        .map(
          (annotation) =>
            `<bpmn:textAnnotation id="${xml(annotation.id)}"><bpmn:text>${xml(annotation.text)}</bpmn:text></bpmn:textAnnotation>`,
        )
        .join("");
      const associationXml = annotations
        .filter((annotation) => annotation.attachedToId)
        .map(
          (annotation) =>
            `<bpmn:association id="association_${xml(annotation.id)}" sourceRef="${xml(annotation.attachedToId!)}" targetRef="${xml(annotation.id)}"/>`,
        )
        .join("");
      return `<bpmn:process id="process_${xml(participant.id)}" name="${xml(ir.title)} — ${xml(participant.name)}" isExecutable="false">${participant.lanes.length ? `<bpmn:laneSet id="lane_set_${xml(participant.id)}">${laneXml}</bpmn:laneSet>` : ""}${participantNodes.map(nodeXml).join("")}${flowXml}${annotationXml}${associationXml}</bpmn:process>`;
    })
    .join("");
  const maxX =
    Math.max(
      ...[...bounds.values()].map((item) => item.x + item.width),
      ...[...annotationBounds.values()].map((item) => item.x + item.width),
      800,
    ) + 100;
  const shapes = orderedNodes
    .map((node) => {
      const box = bounds.get(node.id)!;
      return `<bpmndi:BPMNShape id="${xml(node.id)}_di" bpmnElement="${xml(node.id)}"><dc:Bounds x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/></bpmndi:BPMNShape>`;
    })
    .join("");
  const edges = orderedFlows
    .map((flow) => {
      const from = bounds.get(flow.sourceId)!;
      const to = bounds.get(flow.targetId)!;
      const x1 = from.x + from.width;
      const y1 = from.y + from.height / 2;
      const x2 = to.x;
      const y2 = to.y + to.height / 2;
      const middle = Math.round((x1 + x2) / 2);
      return `<bpmndi:BPMNEdge id="${xml(flow.id)}_di" bpmnElement="${xml(flow.id)}"><di:waypoint x="${x1}" y="${y1}"/><di:waypoint x="${middle}" y="${y1}"/><di:waypoint x="${middle}" y="${y2}"/><di:waypoint x="${x2}" y="${y2}"/></bpmndi:BPMNEdge>`;
    })
    .join("");
  const annotationShapes = orderedAnnotations
    .map((annotation) => {
      const box = annotationBounds.get(annotation.id)!;
      return `<bpmndi:BPMNShape id="${xml(annotation.id)}_di" bpmnElement="${xml(annotation.id)}"><dc:Bounds x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}"/></bpmndi:BPMNShape>`;
    })
    .join("");
  const associationEdges = orderedAnnotations
    .filter((annotation) => annotation.attachedToId)
    .map((annotation) => {
      const from = bounds.get(annotation.attachedToId!)!;
      const to = annotationBounds.get(annotation.id)!;
      return `<bpmndi:BPMNEdge id="association_${xml(annotation.id)}_di" bpmnElement="association_${xml(annotation.id)}"><di:waypoint x="${from.x + from.width}" y="${from.y + from.height / 2}"/><di:waypoint x="${to.x}" y="${to.y + to.height / 2}"/></bpmndi:BPMNEdge>`;
    })
    .join("");
  const poolShapes = ir.participants
    .map((participant) => {
      const box = participantLayout.get(participant.id)!;
      return `<bpmndi:BPMNShape id="${xml(participant.id)}_di" bpmnElement="${xml(participant.id)}" isHorizontal="true"><dc:Bounds x="30" y="${box.y}" width="${maxX}" height="${box.height}"/></bpmndi:BPMNShape>${participant.lanes
        .map((lane) => {
          const laneBox = laneLayout.get(lane.id)!;
          return `<bpmndi:BPMNShape id="${xml(lane.id)}_di" bpmnElement="${xml(lane.id)}" isHorizontal="true"><dc:Bounds x="60" y="${laneBox.y}" width="${maxX - 30}" height="${laneBox.height}"/></bpmndi:BPMNShape>`;
        })
        .join("")}`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="definitions_1" targetNamespace="https://bpmn-builder.local/schema/bpmn"><bpmn:collaboration id="collaboration_1">${ir.participants.map((participant) => `<bpmn:participant id="${xml(participant.id)}" name="${xml(participant.name)}" processRef="process_${xml(participant.id)}"/>`).join("")}</bpmn:collaboration>${processXml}<bpmndi:BPMNDiagram id="diagram_1"><bpmndi:BPMNPlane id="plane_1" bpmnElement="collaboration_1">${poolShapes}${shapes}${annotationShapes}${edges}${associationEdges}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
}
