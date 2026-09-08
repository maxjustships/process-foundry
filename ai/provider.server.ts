import {
  assertEligibleSourceReferences,
  buildProcessIrRepairInstruction,
  enforceBpmnOnlyModalityQuestion,
  extractProcess,
  PROMPT_VERSION,
  ProviderError,
  transcribeAudio,
} from "./openai.server";
import type { ProcessIR } from "../domain/process-ir";
import type { SourceRow } from "../app/lib/repository.server";
import type { OutputLocale } from "../domain/output-locale";

export {
  assertEligibleSourceReferences,
  buildProcessIrRepairInstruction,
  enforceBpmnOnlyModalityQuestion,
  extractProcess,
  PROMPT_VERSION,
  ProviderError,
  transcribeAudio,
};

export function getMockProcessIr(
  sources: SourceRow[],
  outputLocale: OutputLocale = "en",
): ProcessIR {
  const ru = outputLocale === "ru";
  const refs = sources.slice(0, 3).map((source) => ({
    sourceId: source.id,
    locator:
      source.type === "audio"
        ? ru
          ? "расшифровка"
          : "transcript"
        : ru
          ? "предоставленный материал"
          : "submitted source",
  }));
  return {
    title: ru
      ? "Проверенный процесс обработки заявки"
      : "Reviewed intake process",
    participants: [
      {
        id: "participant_main",
        name: ru ? "Организация" : "Organisation",
        lanes: [
          {
            id: "lane_owner",
            name: ru ? "Владелец процесса" : "Process owner",
          },
        ],
      },
    ],
    nodes: [
      {
        id: "start_received",
        type: "startEvent",
        name: ru ? "Заявка получена" : "Request received",
        participantId: "participant_main",
        laneId: "lane_owner",
        sourceRefs: refs,
        confidence: 0.92,
        assumptions: [],
      },
      {
        id: "task_review",
        type: "task",
        name: ru ? "Проверить заявку" : "Review request",
        participantId: "participant_main",
        laneId: "lane_owner",
        sourceRefs: refs,
        confidence: 0.84,
        assumptions: [
          ru
            ? "Ответственную роль должен подтвердить проверяющий."
            : "The responsible role needs reviewer confirmation.",
        ],
      },
      {
        id: "gateway_complete",
        type: "exclusiveGateway",
        name: ru ? "Информация полна?" : "Information complete?",
        participantId: "participant_main",
        laneId: "lane_owner",
        sourceRefs: refs,
        confidence: 0.55,
        assumptions: [],
      },
      {
        id: "task_process",
        type: "task",
        name: ru ? "Обработать заявку" : "Process request",
        participantId: "participant_main",
        laneId: "lane_owner",
        sourceRefs: refs,
        confidence: 0.82,
        assumptions: [],
      },
      {
        id: "end_complete",
        type: "endEvent",
        name: ru ? "Заявка обработана" : "Request completed",
        participantId: "participant_main",
        laneId: "lane_owner",
        sourceRefs: refs,
        confidence: 0.88,
        assumptions: [],
      },
      {
        id: "end_incomplete",
        type: "endEvent",
        name: ru
          ? "Нужна дополнительная информация"
          : "More information required",
        participantId: "participant_main",
        laneId: "lane_owner",
        sourceRefs: refs,
        confidence: 0.8,
        assumptions: [],
      },
    ],
    flows: [
      {
        id: "flow_1",
        sourceId: "start_received",
        targetId: "task_review",
        sourceRefs: refs,
      },
      {
        id: "flow_2",
        sourceId: "task_review",
        targetId: "gateway_complete",
        sourceRefs: refs,
      },
      {
        id: "flow_3",
        sourceId: "gateway_complete",
        targetId: "task_process",
        condition: ru ? "да" : "yes",
        sourceRefs: refs,
      },
      {
        id: "flow_4",
        sourceId: "task_process",
        targetId: "end_complete",
        sourceRefs: refs,
      },
      {
        id: "flow_5",
        sourceId: "gateway_complete",
        targetId: "end_incomplete",
        condition: ru ? "нет" : "no",
        sourceRefs: refs,
      },
    ],
    annotations: [
      {
        id: "annotation_review",
        text: ru
          ? "Требуется подтверждение проверяющего"
          : "Reviewer confirmation required",
        participantId: "participant_main",
        laneId: "lane_owner",
        attachedToId: "gateway_complete",
        sourceRefs: refs,
      },
    ],
    questions: [
      {
        id: "question_owner",
        text: ru
          ? "Кто отвечает за проверку полноты информации?"
          : "Who is accountable for checking whether the information is complete?",
        relatedElementIds: ["gateway_complete"],
        severity: "important",
      },
    ],
  };
}
