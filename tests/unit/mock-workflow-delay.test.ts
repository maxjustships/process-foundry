import { describe, expect, it } from "vitest";
import {
  MOCK_FIRST_ATTEMPT_DELAY_MARKER,
  resolveMockWorkflowDelayMs,
} from "../../workers/mock-workflow-delay";

const markedText = `${MOCK_FIRST_ATTEMPT_DELAY_MARKER} A reviewer checks the request.`;

describe("mock Workflow delay", () => {
  it("delays only a marked mock job's first attempt", () => {
    expect(
      resolveMockWorkflowDelayMs({
        mockAi: true,
        configuredDelayMs: 30_000,
        attemptNumber: 1,
        textInputs: [markedText],
      }),
    ).toBe(30_000);
    expect(
      resolveMockWorkflowDelayMs({
        mockAi: true,
        configuredDelayMs: 30_000,
        attemptNumber: 2,
        textInputs: [markedText],
      }),
    ).toBe(0);
  });

  it("cannot delay production or an unmarked mock job", () => {
    expect(
      resolveMockWorkflowDelayMs({
        mockAi: false,
        configuredDelayMs: 30_000,
        attemptNumber: 1,
        textInputs: [markedText],
      }),
    ).toBe(0);
    expect(
      resolveMockWorkflowDelayMs({
        mockAi: true,
        configuredDelayMs: 30_000,
        attemptNumber: 1,
        textInputs: ["A reviewer checks the request."],
      }),
    ).toBe(0);
  });
});
