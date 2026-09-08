export const MOCK_FIRST_ATTEMPT_DELAY_MARKER =
  "[synthetic:delay-first-attempt]";

export function resolveMockWorkflowDelayMs(input: {
  mockAi: boolean;
  configuredDelayMs: number;
  attemptNumber: number;
  textInputs: string[];
}): number {
  if (
    !input.mockAi ||
    !Number.isFinite(input.configuredDelayMs) ||
    input.configuredDelayMs <= 0 ||
    input.attemptNumber !== 1
  )
    return 0;
  return input.textInputs.some((text) =>
    text.includes(MOCK_FIRST_ATTEMPT_DELAY_MARKER),
  )
    ? input.configuredDelayMs
    : 0;
}
