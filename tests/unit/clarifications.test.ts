import { describe, expect, it } from "vitest";
import {
  buildClarificationBody,
  classifyClarificationRetry,
  deriveClarificationArtifacts,
  parseQuestionAnswer,
  readClarificationAnswer,
} from "../../app/lib/clarifications";

describe("question clarification evidence", () => {
  it("derives stable opaque identifiers and a project-scoped key", async () => {
    const artifacts = await deriveClarificationArtifacts(
      "project-1",
      "version-1",
      "question-1",
    );

    expect(artifacts).toEqual({
      clarificationId:
        "clarification_704a825ed72d70fd8da74bbeaf1573c7b09749b3de215fa4115fc05169973871",
      sourceId:
        "source_704a825ed72d70fd8da74bbeaf1573c7b09749b3de215fa4115fc05169973871",
      r2Key:
        "projects/project-1/clarifications/704a825ed72d70fd8da74bbeaf1573c7b09749b3de215fa4115fc05169973871.txt",
    });
    expect(JSON.stringify(artifacts)).not.toContain("question-1");
  });

  it("builds and reads the canonical private body", () => {
    const body = buildClarificationBody(
      "Who owns the review?",
      "The finance lead.",
    );

    expect(body).toBe(
      "BPMN clarification v1\n\nQuestion:\nWho owns the review?\n\nConfirmed answer:\nThe finance lead.",
    );
    expect(readClarificationAnswer(body, "Who owns the review?")).toBe(
      "The finance lead.",
    );
    expect(() =>
      readClarificationAnswer(body, "A different question"),
    ).toThrow();
  });

  it("accepts only a strict, trimmed answer payload of 1..5000 characters", () => {
    expect(parseQuestionAnswer({ answer: "  confirmed  " })).toEqual({
      answer: "confirmed",
    });
    for (const invalid of [
      {},
      { answer: "   " },
      { answer: "x".repeat(5001) },
      { answer: "yes", question: "client-controlled" },
      { answer: 1 },
      null,
    ])
      expect(() => parseQuestionAnswer(invalid)).toThrow();
  });

  it("classifies exact canonical retries without exposing content", () => {
    expect(classifyClarificationRetry("same", "same")).toBe("same");
    expect(classifyClarificationRetry("first", "second")).toBe("different");
  });
});
