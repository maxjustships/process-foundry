import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import {
  createGenerationIntent,
  createProject,
  getJobSources,
  getProject,
  retryJobSnapshot,
  setJobStatus,
} from "../../app/lib/repository.server";
import {
  ingestTableSource,
  validateTableUploadMetadata,
} from "../../app/lib/table-ingestion.server";
import { loadExtractionInputs } from "../../workers/generation";
import { deleteProjectWithWorkflow } from "../../app/lib/project-deletion.server";
import { parseTelemetryBatch } from "../../app/lib/telemetry";

const bytes = (value: string) => new TextEncoder().encode(value);
const stream = (value: Uint8Array) => new Response(value).body!;

describe("table-source migration", () => {
  it("preserves legacy rows and adds structured source metadata", async () => {
    const [initial, review, slice1, slice2] = env.TEST_MIGRATIONS;
    expect(slice2).toBeDefined();
    await applyD1Migrations(env.DB, [initial, review, slice1]);
    const timestamp = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO projects (id, title, status, created_at, updated_at) VALUES ('table-migration', 'Migration fixture', 'active', ?, ?)",
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO sources (id, project_id, type, name, mime_type, size_bytes, r2_key, created_at) VALUES ('legacy-text', 'table-migration', 'text', 'Text', 'text/plain', 4, 'projects/table-migration/sources/legacy.txt', ?)",
      ).bind(timestamp),
    ]);

    await applyD1Migrations(env.DB, [slice2]);

    expect(
      await env.DB.prepare(
        "SELECT type, extracted_r2_key, extracted_metadata_json FROM sources WHERE id = 'legacy-text'",
      ).first(),
    ).toEqual({
      type: "text",
      extracted_r2_key: null,
      extracted_metadata_json: null,
    });
    await expect(
      env.DB.prepare(
        "INSERT INTO sources (id, project_id, type, name, mime_type, size_bytes, r2_key, extracted_r2_key, extracted_metadata_json, created_at) VALUES ('table-csv', 'table-migration', 'csv', 'Synthetic.csv', 'text/csv', 3, 'projects/table-migration/sources/table-csv.csv', 'projects/table-migration/extracted/table-csv.txt', '{\"format\":\"csv\"}', ?)",
      )
        .bind(timestamp)
        .run(),
    ).resolves.toBeDefined();
  });
});

describe("private table-source lifecycle", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it.each([
    ["steps.csv", "text/csv", "csv"],
    ["steps.csv", "", "csv"],
    [
      "steps.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "docx",
    ],
    [
      "steps.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "xlsx",
    ],
  ] as const)("accepts strict metadata for %s", (name, mimeType, format) => {
    expect(validateTableUploadMetadata(name, mimeType)).toEqual({ format });
  });

  it.each([
    ["steps.xls", "application/vnd.ms-excel", "table_unsupported_format"],
    [
      "steps.xlsm",
      "application/vnd.ms-excel.sheet.macroEnabled.12",
      "table_unsupported_format",
    ],
    [
      "steps.docm",
      "application/vnd.ms-word.document.macroEnabled.12",
      "table_unsupported_format",
    ],
    [
      "steps.ods",
      "application/vnd.oasis.opendocument.spreadsheet",
      "table_unsupported_format",
    ],
    ["steps.pdf", "application/pdf", "table_unsupported_format"],
    ["steps.zip", "application/zip", "table_unsupported_format"],
    ["steps.csv", "application/pdf", "table_mime_mismatch"],
    ["steps.docx", "application/zip", "table_mime_mismatch"],
    ["steps.xlsx", "text/csv", "table_mime_mismatch"],
  ])("rejects unsafe metadata for %s", (name, mimeType, code) => {
    expect(() => validateTableUploadMetadata(name, mimeType)).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it("stores raw and deterministic extracted artifacts with safe D1 metadata", async () => {
    const project = await createProject(env.DB, "CSV lifecycle");
    const input = bytes("Step,Owner,Result\nReceive,Clerk,Open");
    const source = await ingestTableSource(env.DB, env.SOURCES, {
      projectId: project.id,
      sourceId: "csv-lifecycle-source",
      name: "synthetic-steps.csv",
      mimeType: "text/csv",
      contentLength: input.byteLength,
      body: stream(input),
    });

    expect(source).toMatchObject({
      type: "csv",
      extracted_r2_key: `projects/${project.id}/extracted/csv-lifecycle-source.txt`,
      extracted_metadata_json: JSON.stringify({
        format: "csv",
        sectionCount: 1,
        rowCount: 2,
        cellCount: 6,
      }),
    });
    expect(await (await env.SOURCES.get(source.r2_key))?.arrayBuffer()).toEqual(
      input.buffer,
    );
    expect(
      await (await env.SOURCES.get(source.extracted_r2_key!))?.text(),
    ).toContain("[source:csv-lifecycle-source]");
    expect((await getProject(env.DB, project.id))?.sources[0]).toMatchObject({
      type: "csv",
      name: "synthetic-steps.csv",
    });
  });

  it("cleans raw and extracted artifacts after a partial persistence failure", async () => {
    const project = await createProject(env.DB, "Partial failure");
    let putCount = 0;
    const failingBucket = {
      put: async (...args: Parameters<R2Bucket["put"]>) => {
        putCount += 1;
        if (putCount === 2) throw new Error("synthetic extracted put failure");
        return env.SOURCES.put(...args);
      },
      delete: (...args: Parameters<R2Bucket["delete"]>) =>
        env.SOURCES.delete(...args),
    };
    const input = bytes("Step,Owner\nReceive,Clerk");
    await expect(
      ingestTableSource(env.DB, failingBucket, {
        projectId: project.id,
        sourceId: "partial-source",
        name: "partial.csv",
        mimeType: "text/csv",
        contentLength: input.byteLength,
        body: stream(input),
      }),
    ).rejects.toThrow("synthetic extracted put failure");

    expect(
      await env.SOURCES.list({ prefix: `projects/${project.id}/` }),
    ).toMatchObject({ objects: [] });
    expect((await getProject(env.DB, project.id))?.sources).toEqual([]);
  });

  it("loads only the extracted artifact for generation and reuses it on retry", async () => {
    const project = await createProject(env.DB, "Immutable extraction");
    const input = bytes("Step,Owner\nReceive,Clerk");
    const source = await ingestTableSource(env.DB, env.SOURCES, {
      projectId: project.id,
      sourceId: "immutable-table",
      name: "immutable.csv",
      mimeType: "text/csv",
      contentLength: input.byteLength,
      body: stream(input),
    });
    const claim = await createGenerationIntent(env.DB, {
      projectId: project.id,
      mode: "alternative",
      sourceIds: [source.id],
      clarificationIds: [],
    });
    await env.SOURCES.delete(source.r2_key);

    const snapshotted = await getJobSources(env.DB, claim.jobId);
    const extraction = await loadExtractionInputs(env, snapshotted);
    expect(extraction).toHaveLength(1);
    expect(extraction[0].kind).toBe("text");
    if (extraction[0].kind === "text")
      expect(extraction[0].text).toContain("[source:immutable-table]");
    await setJobStatus(env.DB, claim.jobId, "failed", {
      code: "generation_failed",
      message: "Safe failure.",
    });
    await retryJobSnapshot(env.DB, claim.jobId);
    expect((await getJobSources(env.DB, claim.jobId))[0].extracted_r2_key).toBe(
      source.extracted_r2_key,
    );
  });

  it("verified deletion removes both artifacts and table metadata", async () => {
    const project = await createProject(env.DB, "Delete table source");
    const input = bytes("Step,Owner\nReceive,Clerk");
    await ingestTableSource(env.DB, env.SOURCES, {
      projectId: project.id,
      sourceId: "delete-table",
      name: "delete.csv",
      mimeType: "text/csv",
      contentLength: input.byteLength,
      body: stream(input),
    });
    const receipt = await deleteProjectWithWorkflow(
      env.DB,
      env.SOURCES,
      { get: () => Promise.reject(new Error("instance.not_found")) },
      project.id,
    );
    expect(receipt.deletedObjectCount).toBe(2);
    expect(
      await env.SOURCES.list({ prefix: `projects/${project.id}/` }),
    ).toMatchObject({ objects: [] });
    expect(await getProject(env.DB, project.id)).toBeNull();
  });

  it("allows only semantic table telemetry fields", () => {
    const base = {
      event_id: "table-event",
      client_session_id: "session",
      client_sequence: 1,
      occurred_at_client: new Date().toISOString(),
      event_type: "source.upload_complete",
      route: "/projects/:projectId",
      project_id: "project",
      app_version: "test",
    };
    expect(
      parseTelemetryBatch({
        events: [
          {
            ...base,
            safe_payload: {
              source_kind: "csv",
              mime_family: "table",
              size_bucket: "small",
            },
          },
        ],
      }).events[0].safe_payload,
    ).toEqual({
      source_kind: "csv",
      mime_family: "table",
      size_bucket: "small",
    });
    expect(() =>
      parseTelemetryBatch({
        events: [
          {
            ...base,
            safe_payload: { source_kind: "csv", sheet_name: "Private" },
          },
        ],
      }),
    ).toThrow();
  });
});
