import { z } from "zod";

const answerSchema = z
  .object({
    answer: z.string().trim().min(1).max(5000),
  })
  .strict();

export type QuestionAnswer = z.infer<typeof answerSchema>;

export function parseQuestionAnswer(input: unknown): QuestionAnswer {
  return answerSchema.parse(input);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function deriveClarificationArtifacts(
  projectId: string,
  versionId: string,
  questionId: string,
): Promise<{
  clarificationId: string;
  sourceId: string;
  r2Key: string;
}> {
  const seed = [
    "bpmn-builder:clarification:v1",
    `project:${projectId}`,
    `version:${versionId}`,
    `question:${questionId}`,
  ].join("\n");
  const digest = bytesToHex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)),
    ),
  );
  return {
    clarificationId: `clarification_${digest}`,
    sourceId: `source_${digest}`,
    r2Key: `projects/${projectId}/clarifications/${digest}.txt`,
  };
}

export function buildClarificationBody(
  questionText: string,
  confirmedAnswer: string,
): string {
  return `BPMN clarification v1\n\nQuestion:\n${questionText}\n\nConfirmed answer:\n${confirmedAnswer}`;
}

export function readClarificationAnswer(
  canonicalBody: string,
  questionText: string,
): string {
  const prefix = `BPMN clarification v1\n\nQuestion:\n${questionText}\n\nConfirmed answer:\n`;
  if (!canonicalBody.startsWith(prefix))
    throw new Error("Clarification evidence is not canonical.");
  const answer = canonicalBody.slice(prefix.length);
  if (!answer || answer.length > 5000)
    throw new Error("Clarification evidence has an invalid answer.");
  return answer;
}

export function classifyClarificationRetry(
  existingCanonicalBody: string,
  proposedCanonicalBody: string,
): "same" | "different" {
  return existingCanonicalBody === proposedCanonicalBody ? "same" : "different";
}
