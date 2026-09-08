import { describe, expect, it } from "vitest";
import { parseTelemetryBatch } from "../../app/lib/telemetry";
import { validateSourceUpload } from "../../app/lib/uploads";

describe("privacy and input boundaries", () => {
  it("keeps telemetry on an explicit safe payload allowlist", () => {
    const valid = {
      events: [
        {
          event_id: "e1",
          client_session_id: "s1",
          client_sequence: 1,
          occurred_at_client: "2026-08-21T00:00:00.000Z",
          event_type: "canvas.node_moved",
          route: "/projects/:projectId",
          app_version: "0.1.0",
          safe_payload: { element_type: "task", count: 1 },
        },
      ],
    };
    expect(parseTelemetryBatch(valid).events).toHaveLength(1);
    expect(() =>
      parseTelemetryBatch({
        events: [
          {
            ...valid.events[0],
            safe_payload: { source_text: "private", x: 12 },
          },
        ],
      }),
    ).toThrow();
  });

  it("allows only semantic question confirmation metadata", () => {
    const event = {
      event_id: "e2",
      client_session_id: "s1",
      client_sequence: 2,
      occurred_at_client: "2026-08-23T00:00:00.000Z",
      event_type: "question.answer_confirmed",
      route: "/projects/:projectId",
      app_version: "0.1.0",
      safe_payload: { result: "success", count: 1, status: "answered" },
    };
    expect(
      parseTelemetryBatch({ events: [event] }).events[0].safe_payload,
    ).toEqual(event.safe_payload);
    for (const privatePayload of [
      { ...event.safe_payload, question_id: "question_owner" },
      { ...event.safe_payload, answer: "The finance lead" },
      { ...event.safe_payload, question_text: "Who owns this?" },
      { ...event.safe_payload, source_body: "private" },
    ])
      expect(() =>
        parseTelemetryBatch({
          events: [{ ...event, safe_payload: privatePayload }],
        }),
      ).toThrow();
  });

  it("enforces V0 audio and image caps", () => {
    expect(
      validateSourceUpload(
        {
          kind: "audio",
          mimeType: "audio/webm",
          sizeBytes: 25_000_000,
          durationSeconds: 900,
        },
        "en",
      ),
    ).toEqual({ ok: true });
    expect(
      validateSourceUpload(
        {
          kind: "audio",
          mimeType: "audio/webm",
          sizeBytes: 25_000_001,
          durationSeconds: 900,
        },
        "en",
      ).ok,
    ).toBe(false);
    expect(
      validateSourceUpload(
        {
          kind: "audio",
          mimeType: "audio/webm",
          sizeBytes: 10,
          durationSeconds: 901,
        },
        "en",
      ).ok,
    ).toBe(false);
    expect(
      validateSourceUpload(
        {
          kind: "image",
          mimeType: "image/svg+xml",
          sizeBytes: 10,
        },
        "en",
      ).ok,
    ).toBe(false);
  });
});
