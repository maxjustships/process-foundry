import type { TelemetryBatch } from "./telemetry";
import { COMPILER_VERSION, LAYOUT_VERSION } from "../../domain/bpmn-compiler";
import {
  EXTRACTION_MODEL,
  PROMPT_VERSION,
  REASONING_LEVEL,
  SCHEMA_VERSION,
} from "../../ai/openai.server";
import { processIrSchema } from "../../domain/process-ir";
import {
  DEFAULT_OUTPUT_LOCALE,
  type OutputLocale,
} from "../../domain/output-locale";
import {
  buildClarificationBody,
  classifyClarificationRetry,
  deriveClarificationArtifacts,
  parseQuestionAnswer,
  readClarificationAnswer,
} from "./clarifications";

const nowIso = () => new Date().toISOString();

export type ProjectRow = {
  id: string;
  title: string;
  status: "active" | "deleting";
  active_job_id: string | null;
  created_at: string;
  updated_at: string;
};
export type SourceRow = {
  id: string;
  project_id: string;
  type: "text" | "audio" | "image" | "correction" | "csv" | "docx" | "xlsx";
  name: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  r2_key: string;
  transcript_r2_key: string | null;
  extracted_r2_key: string | null;
  extracted_metadata_json: string | null;
  created_at: string;
};
export type JobRow = {
  id: string;
  project_id: string;
  workflow_instance_id: string;
  status:
    | "queued"
    | "transcribing"
    | "extracting"
    | "validating"
    | "compiling"
    | "cancelling"
    | "cancelled"
    | "ready"
    | "failed";
  generation_mode: "legacy" | "refine" | "alternative";
  base_version_id: string | null;
  planned_version_number: number | null;
  source_count: number;
  clarification_count: number;
  output_locale: OutputLocale;
  error_code: string | null;
  error_stage: string | null;
  error_safe_message: string | null;
  created_at: string;
  updated_at: string;
};
export type JobView = JobRow & {
  sources: Array<{
    id: string;
    name: string;
    type: SourceRow["type"];
  }>;
};
export type DiagramVersionRow = {
  id: string;
  project_id: string;
  job_id: string | null;
  version_number: number;
  ir_json: string | null;
  bpmn_xml: string;
  created_by: "ai" | "human";
  generation_mode: "refine" | "alternative" | null;
  base_version_id: string | null;
  source_snapshot_json: string | null;
  source_count: number | null;
  clarification_count: number | null;
  created_at: string;
};
export type BaseDiagramSnapshot = Pick<
  DiagramVersionRow,
  "id" | "bpmn_xml" | "ir_json" | "created_by"
>;
export type QuestionClarificationRow = {
  id: string;
  project_id: string;
  question_version_id: string;
  question_id: string;
  source_id: string;
  status: "answered" | "applied";
  applied_version_id: string | null;
  created_at: string;
  applied_at: string | null;
};
export type QuestionClarificationView = QuestionClarificationRow & {
  question_version_number: number;
  question_text: string;
  applied_version_number: number | null;
  answer: string;
};

export class ClarificationRequestError extends Error {
  constructor(
    readonly code:
      | "clarification_not_found"
      | "clarification_conflict"
      | "clarification_unavailable",
    readonly status: 404 | 409 | 500,
  ) {
    super(code);
    this.name = "ClarificationRequestError";
  }
}

export class GenerationIntentError extends Error {
  constructor(
    readonly code:
      | "generation_intent_invalid"
      | "generation_base_stale"
      | "generation_source_invalid"
      | "generation_clarification_invalid"
      | "generation_project_unavailable",
    readonly status: 400 | 404 | 409,
  ) {
    super(code);
    this.name = "GenerationIntentError";
  }
}

export async function createProject(
  db: D1Database,
  title: string,
): Promise<ProjectRow> {
  const clean = title.trim();
  if (clean.length < 1 || clean.length > 160)
    throw new Error("Project title must be between 1 and 160 characters.");
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  await db
    .prepare(
      "INSERT INTO projects (id, title, status, created_at, updated_at) VALUES (?, ?, 'active', ?, ?)",
    )
    .bind(id, clean, timestamp, timestamp)
    .run();
  return {
    id,
    title: clean,
    status: "active",
    active_job_id: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

export async function listProjects(db: D1Database): Promise<ProjectRow[]> {
  return (
    await db
      .prepare("SELECT * FROM projects ORDER BY updated_at DESC, id DESC")
      .all<ProjectRow>()
  ).results;
}

export async function getProject(
  db: D1Database,
  projectId: string,
  bucket?: R2Bucket,
): Promise<{
  project: ProjectRow;
  sources: SourceRow[];
  jobs: JobView[];
  versions: DiagramVersionRow[];
  clarifications: QuestionClarificationView[];
} | null> {
  const project = await db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .bind(projectId)
    .first<ProjectRow>();
  if (!project) return null;
  const [sources, jobs, versions, jobSources] = await Promise.all([
    db
      .prepare(
        "SELECT * FROM sources WHERE project_id = ? ORDER BY created_at, id",
      )
      .bind(projectId)
      .all<SourceRow>(),
    db
      .prepare(
        "SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC, id DESC",
      )
      .bind(projectId)
      .all<JobRow>(),
    db
      .prepare(
        "SELECT * FROM diagram_versions WHERE project_id = ? ORDER BY version_number DESC",
      )
      .bind(projectId)
      .all<DiagramVersionRow>(),
    db
      .prepare(
        "SELECT js.job_id, js.source_id AS id, js.source_name AS name, js.source_type AS type FROM job_sources js JOIN jobs j ON j.id = js.job_id WHERE j.project_id = ? ORDER BY js.captured_at, js.source_id",
      )
      .bind(projectId)
      .all<{
        job_id: string;
        id: string;
        name: string;
        type: SourceRow["type"];
      }>(),
  ]);
  const clarifications: QuestionClarificationView[] = [];
  if (bucket) {
    const rows = (
      await db
        .prepare(
          "SELECT qc.*, s.r2_key, applied.version_number AS applied_version_number FROM question_clarifications qc JOIN sources s ON s.id = qc.source_id LEFT JOIN diagram_versions applied ON applied.id = qc.applied_version_id WHERE qc.project_id = ? ORDER BY qc.created_at, qc.id",
        )
        .bind(projectId)
        .all<
          QuestionClarificationRow & {
            r2_key: string;
            applied_version_number: number | null;
          }
        >()
    ).results;
    const versionsById = new Map(
      versions.results.map((version) => [version.id, version]),
    );
    for (const row of rows) {
      const questionVersion = versionsById.get(row.question_version_id);
      const parsed = questionVersion?.ir_json
        ? processIrSchema.safeParse(JSON.parse(questionVersion.ir_json))
        : null;
      const question = parsed?.success
        ? parsed.data.questions.find(
            (candidate) => candidate.id === row.question_id,
          )
        : null;
      const object = await bucket.get(row.r2_key);
      if (!questionVersion || !question || !object)
        throw new ClarificationRequestError("clarification_unavailable", 500);
      clarifications.push({
        id: row.id,
        project_id: row.project_id,
        question_version_id: row.question_version_id,
        question_id: row.question_id,
        source_id: row.source_id,
        status: row.status,
        applied_version_id: row.applied_version_id,
        created_at: row.created_at,
        applied_at: row.applied_at,
        question_version_number: questionVersion.version_number,
        question_text: question.text,
        applied_version_number: row.applied_version_number,
        answer: readClarificationAnswer(await object.text(), question.text),
      });
    }
  }
  return {
    project,
    sources: sources.results,
    jobs: jobs.results.map((job) => ({
      ...job,
      sources: jobSources.results
        .filter((source) => source.job_id === job.id)
        .map(({ id, name, type }) => ({ id, name, type })),
    })),
    versions: versions.results,
    clarifications,
  };
}

export async function addSource(
  db: D1Database,
  source: Omit<
    SourceRow,
    | "created_at"
    | "transcript_r2_key"
    | "extracted_r2_key"
    | "extracted_metadata_json"
  > &
    Partial<Pick<SourceRow, "extracted_r2_key" | "extracted_metadata_json">>,
): Promise<SourceRow> {
  const timestamp = nowIso();
  const extractedR2Key = source.extracted_r2_key ?? null;
  const extractedMetadataJson = source.extracted_metadata_json ?? null;
  const result = await db
    .prepare(
      "INSERT INTO sources (id, project_id, type, name, mime_type, size_bytes, duration_seconds, r2_key, extracted_r2_key, extracted_metadata_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND status = 'active')",
    )
    .bind(
      source.id,
      source.project_id,
      source.type,
      source.name,
      source.mime_type,
      source.size_bytes,
      source.duration_seconds,
      source.r2_key,
      extractedR2Key,
      extractedMetadataJson,
      timestamp,
      source.project_id,
    )
    .run();
  if (result.meta.changes !== 1)
    throw new Error("Project is unavailable for new sources.");
  return {
    ...source,
    transcript_r2_key: null,
    extracted_r2_key: extractedR2Key,
    extracted_metadata_json: extractedMetadataJson,
    created_at: timestamp,
  };
}

async function existingClarificationEvidence(
  db: D1Database,
  bucket: R2Bucket,
  versionId: string,
  questionId: string,
): Promise<{ body: string; status: "answered" | "applied" } | null> {
  const row = await db
    .prepare(
      "SELECT s.r2_key, qc.status FROM question_clarifications qc JOIN sources s ON s.id = qc.source_id WHERE qc.question_version_id = ? AND qc.question_id = ?",
    )
    .bind(versionId, questionId)
    .first<{ r2_key: string; status: "answered" | "applied" }>();
  if (!row) return null;
  const object = await bucket.get(row.r2_key);
  if (!object)
    throw new ClarificationRequestError("clarification_unavailable", 500);
  return { body: await object.text(), status: row.status };
}

export async function confirmQuestionAnswer(
  db: D1Database,
  bucket: R2Bucket,
  input: {
    projectId: string;
    versionId: string;
    questionId: string;
    answer: string;
  },
): Promise<{
  created: boolean;
  status: "answered" | "applied";
  sourceId: string;
}> {
  const { answer } = parseQuestionAnswer({ answer: input.answer });
  if (input.questionId.length < 1 || input.questionId.length > 100)
    throw new ClarificationRequestError("clarification_not_found", 404);
  const version = await db
    .prepare(
      "SELECT dv.ir_json FROM diagram_versions dv JOIN projects p ON p.id = dv.project_id WHERE p.id = ? AND p.status = 'active' AND dv.id = ? AND dv.project_id = p.id AND dv.created_by = 'ai'",
    )
    .bind(input.projectId, input.versionId)
    .first<{ ir_json: string | null }>();
  if (!version?.ir_json)
    throw new ClarificationRequestError("clarification_not_found", 404);
  let parsedIr: ReturnType<typeof processIrSchema.safeParse>;
  try {
    parsedIr = processIrSchema.safeParse(JSON.parse(version.ir_json));
  } catch {
    throw new ClarificationRequestError("clarification_not_found", 404);
  }
  if (!parsedIr.success)
    throw new ClarificationRequestError("clarification_not_found", 404);
  const question = parsedIr.data.questions.find(
    (candidate) => candidate.id === input.questionId,
  );
  if (!question)
    throw new ClarificationRequestError("clarification_not_found", 404);

  const artifacts = await deriveClarificationArtifacts(
    input.projectId,
    input.versionId,
    input.questionId,
  );
  const canonicalBody = buildClarificationBody(question.text, answer);
  const persisted = await existingClarificationEvidence(
    db,
    bucket,
    input.versionId,
    input.questionId,
  );
  if (persisted !== null) {
    if (
      classifyClarificationRetry(persisted.body, canonicalBody) === "different"
    )
      throw new ClarificationRequestError("clarification_conflict", 409);
    return {
      created: false,
      status: persisted.status,
      sourceId: artifacts.sourceId,
    };
  }

  const stored = await bucket.put(artifacts.r2Key, canonicalBody, {
    onlyIf: new Headers({ "If-None-Match": "*" }),
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
  });
  const objectAlreadyExisted = stored === null;
  if (objectAlreadyExisted) {
    const existingObject = await bucket.get(artifacts.r2Key);
    if (!existingObject)
      throw new ClarificationRequestError("clarification_unavailable", 500);
    if (
      classifyClarificationRetry(await existingObject.text(), canonicalBody) ===
      "different"
    )
      throw new ClarificationRequestError("clarification_conflict", 409);
  }

  const timestamp = nowIso();
  try {
    const results = await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO sources (id, project_id, type, name, mime_type, size_bytes, duration_seconds, r2_key, created_at) SELECT ?, ?, 'correction', 'Confirmed question answer', 'text/plain', ?, NULL, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND status = 'active')",
        )
        .bind(
          artifacts.sourceId,
          input.projectId,
          new TextEncoder().encode(canonicalBody).byteLength,
          artifacts.r2Key,
          timestamp,
          input.projectId,
        ),
      db
        .prepare(
          "INSERT INTO question_clarifications (id, project_id, question_version_id, question_id, source_id, status, created_at) SELECT ?, ?, ?, ?, ?, 'answered', ? WHERE EXISTS (SELECT 1 FROM projects p JOIN diagram_versions dv ON dv.project_id = p.id WHERE p.id = ? AND p.status = 'active' AND dv.id = ? AND dv.created_by = 'ai')",
        )
        .bind(
          artifacts.clarificationId,
          input.projectId,
          input.versionId,
          input.questionId,
          artifacts.sourceId,
          timestamp,
          input.projectId,
          input.versionId,
        ),
    ]);
    if (results[1].meta.changes !== 1)
      throw new ClarificationRequestError("clarification_unavailable", 500);
  } catch (error) {
    const winner = await existingClarificationEvidence(
      db,
      bucket,
      input.versionId,
      input.questionId,
    );
    if (
      winner !== null &&
      classifyClarificationRetry(winner.body, canonicalBody) === "same"
    )
      return {
        created: false,
        status: winner.status,
        sourceId: artifacts.sourceId,
      };
    if (winner !== null)
      throw new ClarificationRequestError("clarification_conflict", 409);
    throw error;
  }
  return {
    created: !objectAlreadyExisted,
    status: "answered",
    sourceId: artifacts.sourceId,
  };
}

export async function getJobSources(
  db: D1Database,
  jobId: string,
): Promise<SourceRow[]> {
  return (
    await db
      .prepare(
        "SELECT s.* FROM job_sources js JOIN sources s ON s.id = js.source_id WHERE js.job_id = ? ORDER BY s.created_at, s.id",
      )
      .bind(jobId)
      .all<SourceRow>()
  ).results;
}

export async function getJobBaseVersion(
  db: D1Database,
  jobId: string,
): Promise<BaseDiagramSnapshot | null> {
  return db
    .prepare(
      "SELECT dv.id, dv.bpmn_xml, dv.ir_json, dv.created_by FROM jobs j JOIN diagram_versions dv ON dv.id = j.base_version_id AND dv.project_id = j.project_id WHERE j.id = ? AND j.generation_mode = 'refine'",
    )
    .bind(jobId)
    .first<BaseDiagramSnapshot>();
}

export async function claimGenerationJob(
  db: D1Database,
  projectId: string,
  outputLocale: OutputLocale = DEFAULT_OUTPUT_LOCALE,
): Promise<{ created: boolean; jobId: string; workflowInstanceId: string }> {
  const existing = await db
    .prepare(
      "SELECT id, workflow_instance_id FROM jobs WHERE project_id = ? AND status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling', 'cancelling') ORDER BY created_at DESC LIMIT 1",
    )
    .bind(projectId)
    .first<{ id: string; workflow_instance_id: string }>();
  if (existing)
    return {
      created: false,
      jobId: existing.id,
      workflowInstanceId: existing.workflow_instance_id,
    };
  const project = await db
    .prepare("SELECT status FROM projects WHERE id = ?")
    .bind(projectId)
    .first<{ status: string }>();
  if (!project || project.status !== "active")
    throw new Error("Project is unavailable for generation.");
  const jobId = crypto.randomUUID();
  const timestamp = nowIso();
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO jobs (id, project_id, workflow_instance_id, status, generation_mode, planned_version_number, model_provider, model_name, prompt_version, output_locale, created_at, updated_at) SELECT ?, ?, ?, 'queued', 'alternative', (SELECT COALESCE(MAX(version_number), 0) + 1 FROM diagram_versions WHERE project_id = ?), 'openai', ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND status = 'active')",
        )
        .bind(
          jobId,
          projectId,
          jobId,
          projectId,
          EXTRACTION_MODEL,
          PROMPT_VERSION,
          outputLocale,
          timestamp,
          timestamp,
          projectId,
        ),
      db
        .prepare(
          "INSERT INTO job_sources (job_id, source_id, source_name, source_type, captured_at) SELECT ?, id, name, type, ? FROM sources WHERE project_id = ? ORDER BY created_at, id",
        )
        .bind(jobId, timestamp, projectId),
      db
        .prepare(
          "UPDATE projects SET active_job_id = ?, updated_at = ? WHERE id = ? AND status = 'active'",
        )
        .bind(jobId, timestamp, projectId),
      db
        .prepare(
          "UPDATE jobs SET source_count = (SELECT COUNT(*) FROM job_sources WHERE job_id = ?) WHERE id = ?",
        )
        .bind(jobId, jobId),
    ]);
    return { created: true, jobId, workflowInstanceId: jobId };
  } catch {
    const winner = await db
      .prepare(
        "SELECT id, workflow_instance_id FROM jobs WHERE project_id = ? AND status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling', 'cancelling') ORDER BY created_at DESC LIMIT 1",
      )
      .bind(projectId)
      .first<{ id: string; workflow_instance_id: string }>();
    if (!winner) throw new Error("Generation job could not be claimed.");
    return {
      created: false,
      jobId: winner.id,
      workflowInstanceId: winner.workflow_instance_id,
    };
  }
}

type GenerationIntent =
  | {
      projectId: string;
      mode: "refine";
      baseVersionId: string;
      sourceIds: string[];
      clarificationIds?: string[];
    }
  | {
      projectId: string;
      mode: "alternative";
      sourceIds: string[];
      clarificationIds?: [] | string[];
    };

export async function createGenerationIntent(
  db: D1Database,
  intent: GenerationIntent,
  outputLocale: OutputLocale = DEFAULT_OUTPUT_LOCALE,
): Promise<{ created: boolean; jobId: string; workflowInstanceId: string }> {
  const sourceIds = [...new Set(intent.sourceIds)];
  const clarificationIds = [...new Set(intent.clarificationIds ?? [])];
  if (!sourceIds.length || sourceIds.length !== intent.sourceIds.length)
    throw new GenerationIntentError("generation_intent_invalid", 400);
  if (intent.mode === "alternative" && clarificationIds.length)
    throw new GenerationIntentError("generation_intent_invalid", 400);

  const project = await db
    .prepare("SELECT status FROM projects WHERE id = ?")
    .bind(intent.projectId)
    .first<{ status: ProjectRow["status"] }>();
  if (!project || project.status !== "active")
    throw new GenerationIntentError("generation_project_unavailable", 404);

  const existing = await db
    .prepare(
      "SELECT id, workflow_instance_id FROM jobs WHERE project_id = ? AND status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling', 'cancelling') ORDER BY created_at DESC, id DESC LIMIT 1",
    )
    .bind(intent.projectId)
    .first<{ id: string; workflow_instance_id: string }>();
  if (existing)
    return {
      created: false,
      jobId: existing.id,
      workflowInstanceId: existing.workflow_instance_id,
    };

  const placeholders = sourceIds.map(() => "?").join(", ");
  const selectedSources = (
    await db
      .prepare(
        `SELECT s.id, s.name, s.type, s.created_at FROM sources s WHERE s.project_id = ? AND s.id IN (${placeholders}) AND NOT EXISTS (SELECT 1 FROM question_clarifications qc WHERE qc.project_id = s.project_id AND qc.source_id = s.id) ORDER BY s.created_at, s.id`,
      )
      .bind(intent.projectId, ...sourceIds)
      .all<Pick<SourceRow, "id" | "name" | "type" | "created_at">>()
  ).results;
  if (selectedSources.length !== sourceIds.length)
    throw new GenerationIntentError("generation_source_invalid", 400);

  let baseVersionId: string | null = null;
  let clarifications: Array<{
    id: string;
    question_version_id: string;
    question_id: string;
    source_id: string;
    source_name: string;
    source_type: SourceRow["type"];
    source_created_at: string;
  }> = [];
  if (intent.mode === "refine") {
    const current = await db
      .prepare(
        "SELECT id FROM diagram_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1",
      )
      .bind(intent.projectId)
      .first<{ id: string }>();
    if (!current || current.id !== intent.baseVersionId)
      throw new GenerationIntentError("generation_base_stale", 409);
    baseVersionId = current.id;
    clarifications = (
      await db
        .prepare(
          "SELECT qc.id, qc.question_version_id, qc.question_id, qc.source_id, s.name AS source_name, s.type AS source_type, s.created_at AS source_created_at FROM question_clarifications qc JOIN sources s ON s.id = qc.source_id WHERE qc.project_id = ? AND qc.question_version_id = ? AND qc.status = 'answered' ORDER BY qc.created_at, qc.id",
        )
        .bind(intent.projectId, baseVersionId)
        .all<{
          id: string;
          question_version_id: string;
          question_id: string;
          source_id: string;
          source_name: string;
          source_type: SourceRow["type"];
          source_created_at: string;
        }>()
    ).results;
  }

  const sources = new Map(
    selectedSources.map((source) => [source.id, source] as const),
  );
  for (const clarification of clarifications)
    sources.set(clarification.source_id, {
      id: clarification.source_id,
      name: clarification.source_name,
      type: clarification.source_type,
      created_at: clarification.source_created_at,
    });
  const orderedSources = [...sources.values()].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id),
  );
  const jobId = crypto.randomUUID();
  const timestamp = nowIso();
  const next = await db
    .prepare(
      "SELECT COALESCE(MAX(version_number), 0) + 1 AS value FROM diagram_versions WHERE project_id = ?",
    )
    .bind(intent.projectId)
    .first<{ value: number }>();
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO jobs (id, project_id, workflow_instance_id, status, generation_mode, base_version_id, planned_version_number, source_count, clarification_count, model_provider, model_name, prompt_version, output_locale, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, 'openai', ?, ?, ?, ?, ?)",
        )
        .bind(
          jobId,
          intent.projectId,
          jobId,
          intent.mode,
          baseVersionId,
          next?.value ?? 1,
          orderedSources.length,
          clarifications.length,
          EXTRACTION_MODEL,
          PROMPT_VERSION,
          outputLocale,
          timestamp,
          timestamp,
        ),
      ...orderedSources.map((source) =>
        db
          .prepare(
            "INSERT INTO job_sources (job_id, source_id, source_name, source_type, captured_at) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(jobId, source.id, source.name, source.type, timestamp),
      ),
      ...clarifications.map((clarification) =>
        db
          .prepare(
            "INSERT INTO job_clarifications (job_id, clarification_id, question_version_id, question_id, source_id, captured_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .bind(
            jobId,
            clarification.id,
            clarification.question_version_id,
            clarification.question_id,
            clarification.source_id,
            timestamp,
          ),
      ),
      db
        .prepare(
          "UPDATE projects SET active_job_id = ?, updated_at = ? WHERE id = ? AND status = 'active'",
        )
        .bind(jobId, timestamp, intent.projectId),
    ]);
    return { created: true, jobId, workflowInstanceId: jobId };
  } catch (error) {
    const winner = await db
      .prepare(
        "SELECT id, workflow_instance_id FROM jobs WHERE project_id = ? AND status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling', 'cancelling') ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .bind(intent.projectId)
      .first<{ id: string; workflow_instance_id: string }>();
    if (!winner) throw error;
    return {
      created: false,
      jobId: winner.id,
      workflowInstanceId: winner.workflow_instance_id,
    };
  }
}

export async function getJobOutputLocale(
  db: D1Database,
  jobId: string,
): Promise<OutputLocale> {
  const job = await db
    .prepare("SELECT output_locale FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<{ output_locale: OutputLocale }>();
  if (!job) throw new Error("Generation job locale is unavailable.");
  return job.output_locale;
}

export async function claimJobExecution(
  db: D1Database,
  input: {
    jobId: string;
    projectId: string;
    workflowInstanceId: string;
  },
): Promise<string | null> {
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  const results = await db.batch([
    db
      .prepare(
        "INSERT INTO job_attempts (id, job_id, attempt_number, status, transport, provider, requested_model, reasoning_level, prompt_version, schema_version, compiler_version, layout_version, created_at) SELECT ?, j.id, (SELECT COALESCE(MAX(ja.attempt_number), 0) + 1 FROM job_attempts ja WHERE ja.job_id = j.id), 'running', 'direct', 'openai', ?, ?, ?, ?, ?, ?, ? FROM jobs j WHERE j.id = ? AND j.project_id = ? AND j.workflow_instance_id = ? AND j.status = 'queued'",
      )
      .bind(
        id,
        EXTRACTION_MODEL,
        REASONING_LEVEL,
        PROMPT_VERSION,
        SCHEMA_VERSION,
        COMPILER_VERSION,
        LAYOUT_VERSION,
        timestamp,
        input.jobId,
        input.projectId,
        input.workflowInstanceId,
      ),
    db
      .prepare(
        "UPDATE jobs SET status = 'transcribing', updated_at = ? WHERE id = ? AND project_id = ? AND workflow_instance_id = ? AND status = 'queued' AND EXISTS (SELECT 1 FROM job_attempts WHERE id = ? AND job_id = jobs.id AND status = 'running')",
      )
      .bind(
        timestamp,
        input.jobId,
        input.projectId,
        input.workflowInstanceId,
        id,
      ),
  ]);
  if (results[0].meta.changes === 0) return null;
  if (results[1].meta.changes !== 1)
    throw new Error("Job execution claim could not be completed.");
  return id;
}

export async function setJobStatus(
  db: D1Database,
  jobId: string,
  status: JobRow["status"],
  error?: { code: string; stage?: string; message: string },
): Promise<void> {
  const terminal =
    status === "ready" || status === "failed" || status === "cancelled";
  const sequence =
    [
      "queued",
      "transcribing",
      "extracting",
      "validating",
      "compiling",
      "cancelling",
      "cancelled",
      "ready",
      "failed",
    ].indexOf(status) + 1;
  const timestamp = nowIso();
  const allowedFrom: Record<JobRow["status"], JobRow["status"][]> = {
    queued: ["queued"],
    transcribing: ["queued", "transcribing"],
    extracting: ["queued", "transcribing", "extracting"],
    validating: ["queued", "transcribing", "extracting", "validating"],
    compiling: [
      "queued",
      "transcribing",
      "extracting",
      "validating",
      "compiling",
    ],
    cancelling: [],
    cancelled: [],
    ready: ["queued", "transcribing", "extracting", "validating", "compiling"],
    failed: ["queued", "transcribing", "extracting", "validating", "compiling"],
  };
  const from = allowedFrom[status];
  if (!from.length) return;
  const placeholders = from.map(() => "?").join(", ");
  const readyGuard =
    status === "ready"
      ? " AND EXISTS (SELECT 1 FROM diagram_versions WHERE job_id = jobs.id)"
      : "";
  const results = await db.batch([
    db
      .prepare(
        `UPDATE jobs SET status = ?, error_code = ?, error_stage = ?, error_safe_message = ?, updated_at = ? WHERE id = ? AND status IN (${placeholders})${readyGuard}`,
      )
      .bind(
        status,
        error?.code ?? null,
        error?.stage ?? null,
        error?.message ?? null,
        timestamp,
        jobId,
        ...from,
      ),
    db
      .prepare(
        "INSERT OR IGNORE INTO product_events (id, client_session_id, client_sequence, occurred_at_client, received_at_server, event_type, route, project_id, job_id, app_version, safe_payload_json) SELECT ?, ?, ?, ?, ?, 'workflow.stage', '/workflow/generation', project_id, id, '0.1.0', ? FROM jobs WHERE id = ? AND status = ?",
      )
      .bind(
        `${jobId}:stage:${status}`,
        `server:${jobId}`,
        sequence,
        timestamp,
        timestamp,
        JSON.stringify({
          stage: status,
          ...(error ? { error_class: error.code } : {}),
        }),
        jobId,
        status,
      ),
    ...(terminal
      ? [
          db
            .prepare(
              "UPDATE projects SET active_job_id = NULL, updated_at = ? WHERE active_job_id = ?",
            )
            .bind(timestamp, jobId),
        ]
      : []),
  ]);
  if (results[0].meta.changes !== 1) return;
}

type JobTransitionResult = {
  status: JobRow["status"];
  changed: boolean;
  workflowInstanceId: string;
};

async function readJobTransitionResult(
  db: D1Database,
  jobId: string,
  changed: boolean,
): Promise<JobTransitionResult> {
  const job = await db
    .prepare("SELECT status, workflow_instance_id FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<Pick<JobRow, "status" | "workflow_instance_id">>();
  if (!job) throw new Error("Generation job was not found.");
  return {
    status: job.status,
    changed,
    workflowInstanceId: job.workflow_instance_id,
  };
}

export async function requestJobCancellation(
  db: D1Database,
  jobId: string,
): Promise<JobTransitionResult> {
  const timestamp = nowIso();
  const result = await db
    .prepare(
      "UPDATE jobs SET status = 'cancelling', error_code = NULL, error_stage = NULL, error_safe_message = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling')",
    )
    .bind(timestamp, jobId)
    .run();
  return readJobTransitionResult(db, jobId, result.meta.changes === 1);
}

export async function settleJobCancelled(
  db: D1Database,
  jobId: string,
): Promise<JobTransitionResult> {
  const timestamp = nowIso();
  const results = await db.batch([
    db
      .prepare(
        "UPDATE jobs SET status = 'cancelled', error_code = 'generation_cancelled', error_stage = 'cancelling', error_safe_message = NULL, updated_at = ? WHERE id = ? AND status = 'cancelling'",
      )
      .bind(timestamp, jobId),
    db
      .prepare(
        "UPDATE job_attempts SET status = 'cancelled', error_class = 'generation_cancelled', completed_at = ? WHERE job_id = ? AND status = 'running'",
      )
      .bind(timestamp, jobId),
    db
      .prepare(
        "UPDATE projects SET active_job_id = NULL, updated_at = ? WHERE active_job_id = ? AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND status = 'cancelled')",
      )
      .bind(timestamp, jobId, jobId),
  ]);
  return readJobTransitionResult(db, jobId, results[0].meta.changes === 1);
}

export async function retryJobSnapshot(
  db: D1Database,
  jobId: string,
): Promise<JobTransitionResult> {
  const workflowInstanceId = crypto.randomUUID();
  const timestamp = nowIso();
  const results = await db.batch([
    db
      .prepare(
        "UPDATE jobs SET workflow_instance_id = ?, status = 'queued', error_code = NULL, error_stage = NULL, error_safe_message = NULL, updated_at = ? WHERE id = ? AND status IN ('failed', 'cancelled') AND EXISTS (SELECT 1 FROM projects WHERE id = jobs.project_id AND status = 'active') AND NOT EXISTS (SELECT 1 FROM jobs active WHERE active.project_id = jobs.project_id AND active.id <> jobs.id AND active.status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling', 'cancelling'))",
      )
      .bind(workflowInstanceId, timestamp, jobId),
    db
      .prepare(
        "UPDATE projects SET active_job_id = ?, updated_at = ? WHERE status = 'active' AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND project_id = projects.id AND workflow_instance_id = ? AND status = 'queued')",
      )
      .bind(jobId, timestamp, jobId, workflowInstanceId),
  ]);
  return readJobTransitionResult(db, jobId, results[0].meta.changes === 1);
}

export async function compensateWorkflowCreationFailure(
  db: D1Database,
  input: { jobId: string; workflowInstanceId: string },
): Promise<JobTransitionResult> {
  const timestamp = nowIso();
  const results = await db.batch([
    db
      .prepare(
        "UPDATE jobs SET status = 'failed', error_code = 'workflow_create_failed', error_stage = 'queued', error_safe_message = 'Generation could not be started. Retry safely.', updated_at = ? WHERE id = ? AND workflow_instance_id = ? AND status = 'queued'",
      )
      .bind(timestamp, input.jobId, input.workflowInstanceId),
    db
      .prepare(
        "UPDATE projects SET updated_at = ? WHERE active_job_id = ? AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND workflow_instance_id = ? AND status = 'failed' AND error_code = 'workflow_create_failed')",
      )
      .bind(timestamp, input.jobId, input.jobId, input.workflowInstanceId),
  ]);
  return readJobTransitionResult(
    db,
    input.jobId,
    results[0].meta.changes === 1,
  );
}

export async function storeAiRequestEvent(
  db: D1Database,
  jobId: string,
  eventId: string,
  sequence: number,
  payload: Record<string, string | number>,
): Promise<void> {
  const timestamp = nowIso();
  await db
    .prepare(
      "INSERT OR IGNORE INTO product_events (id, client_session_id, client_sequence, occurred_at_client, received_at_server, event_type, route, project_id, job_id, app_version, safe_payload_json) SELECT ?, ?, ?, ?, ?, 'ai.request_completed', '/workflow/generation', project_id, id, '0.1.0', ? FROM jobs WHERE id = ?",
    )
    .bind(
      eventId,
      `server:${jobId}`,
      sequence,
      timestamp,
      timestamp,
      JSON.stringify(payload),
      jobId,
    )
    .run();
}

export async function saveDiagramVersion(
  db: D1Database,
  projectId: string,
  jobId: string | null,
  bpmnXml: string,
  irJson: string | null,
  createdBy: "ai" | "human",
): Promise<DiagramVersionRow> {
  const next = await db
    .prepare(
      "SELECT COALESCE(MAX(version_number), 0) + 1 AS value FROM diagram_versions WHERE project_id = ?",
    )
    .bind(projectId)
    .first<{ value: number }>();
  const version: DiagramVersionRow = {
    id: crypto.randomUUID(),
    project_id: projectId,
    job_id: jobId,
    version_number: next?.value ?? 1,
    ir_json: irJson,
    bpmn_xml: bpmnXml,
    created_by: createdBy,
    generation_mode: null,
    base_version_id: null,
    source_snapshot_json: null,
    source_count: null,
    clarification_count: null,
    created_at: nowIso(),
  };
  await db
    .prepare(
      "INSERT INTO diagram_versions (id, project_id, job_id, version_number, ir_json, bpmn_xml, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      version.id,
      projectId,
      jobId,
      version.version_number,
      irJson,
      bpmnXml,
      createdBy,
      version.created_at,
    )
    .run();
  return version;
}

async function applySnapshottedClarifications(
  db: D1Database,
  projectId: string,
  jobId: string,
  versionId: string,
): Promise<void> {
  const timestamp = nowIso();
  await db
    .prepare(
      "UPDATE question_clarifications SET status = 'applied', applied_version_id = ?, applied_at = ? WHERE project_id = ? AND status = 'answered' AND id IN (SELECT clarification_id FROM job_clarifications WHERE job_id = ?)",
    )
    .bind(versionId, timestamp, projectId, jobId)
    .run();
}

export async function saveReadyAiVersion(
  db: D1Database,
  projectId: string,
  jobId: string,
  bpmnXml: string,
  irJson: string,
): Promise<DiagramVersionRow> {
  const job = await db
    .prepare(
      "SELECT id, status, generation_mode, base_version_id, source_count, clarification_count FROM jobs WHERE id = ? AND project_id = ?",
    )
    .bind(jobId, projectId)
    .first<
      Pick<
        JobRow,
        | "id"
        | "status"
        | "generation_mode"
        | "base_version_id"
        | "source_count"
        | "clarification_count"
      >
    >();
  if (!job) throw new Error("Generation job does not belong to the project.");
  const existing = await db
    .prepare(
      "SELECT * FROM diagram_versions WHERE job_id = ? AND project_id = ?",
    )
    .bind(jobId, projectId)
    .first<DiagramVersionRow>();
  if (existing) {
    await applySnapshottedClarifications(db, projectId, jobId, existing.id);
    return existing;
  }
  if (
    ![
      "queued",
      "transcribing",
      "extracting",
      "validating",
      "compiling",
    ].includes(job.status)
  )
    throw new Error("Generation job is no longer publishable.");

  const sourceSnapshot = JSON.stringify(
    (
      await db
        .prepare(
          "SELECT source_id AS id, source_name AS name, source_type AS type FROM job_sources WHERE job_id = ? ORDER BY captured_at, source_id",
        )
        .bind(jobId)
        .all<{ id: string; name: string; type: SourceRow["type"] }>()
    ).results,
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const next = await db
      .prepare(
        "SELECT COALESCE(MAX(version_number), 0) + 1 AS value FROM diagram_versions WHERE project_id = ?",
      )
      .bind(projectId)
      .first<{ value: number }>();
    const timestamp = nowIso();
    const version: DiagramVersionRow = {
      id: crypto.randomUUID(),
      project_id: projectId,
      job_id: jobId,
      version_number: next?.value ?? 1,
      ir_json: irJson,
      bpmn_xml: bpmnXml,
      created_by: "ai",
      generation_mode:
        job.generation_mode === "legacy" ? null : job.generation_mode,
      base_version_id: job.base_version_id,
      source_snapshot_json: sourceSnapshot,
      source_count: job.source_count,
      clarification_count: job.clarification_count,
      created_at: timestamp,
    };
    try {
      const results = await db.batch([
        db
          .prepare(
            "INSERT INTO diagram_versions (id, project_id, job_id, version_number, ir_json, bpmn_xml, created_by, generation_mode, base_version_id, source_snapshot_json, source_count, clarification_count, created_at) SELECT ?, ?, ?, ?, ?, ?, 'ai', ?, ?, ?, ?, ?, ? FROM jobs WHERE id = ? AND project_id = ? AND status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling')",
          )
          .bind(
            version.id,
            projectId,
            jobId,
            version.version_number,
            irJson,
            bpmnXml,
            version.generation_mode,
            version.base_version_id,
            version.source_snapshot_json,
            version.source_count,
            version.clarification_count,
            timestamp,
            jobId,
            projectId,
          ),
        db
          .prepare(
            "UPDATE jobs SET status = 'ready', error_code = NULL, error_stage = NULL, error_safe_message = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling') AND EXISTS (SELECT 1 FROM diagram_versions WHERE job_id = ?)",
          )
          .bind(timestamp, jobId, jobId),
        db
          .prepare(
            "UPDATE projects SET active_job_id = NULL, updated_at = ? WHERE active_job_id = ? AND EXISTS (SELECT 1 FROM jobs WHERE id = ? AND status = 'ready')",
          )
          .bind(timestamp, jobId, jobId),
        db
          .prepare(
            "UPDATE question_clarifications SET status = 'applied', applied_version_id = ?, applied_at = ? WHERE project_id = ? AND status = 'answered' AND id IN (SELECT clarification_id FROM job_clarifications WHERE job_id = ?)",
          )
          .bind(version.id, timestamp, projectId, jobId),
      ]);
      if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1)
        throw new Error("Generation job is no longer publishable.");
      return version;
    } catch (error) {
      const winner = await db
        .prepare(
          "SELECT * FROM diagram_versions WHERE job_id = ? AND project_id = ?",
        )
        .bind(jobId, projectId)
        .first<DiagramVersionRow>();
      if (winner) {
        await applySnapshottedClarifications(db, projectId, jobId, winner.id);
        return winner;
      }
      if (attempt === 1) throw error;
    }
  }
  throw new Error("AI version could not be saved.");
}

export async function storeTelemetry(
  db: D1Database,
  batch: TelemetryBatch,
): Promise<void> {
  if (!batch.events.length) return;
  const received = nowIso();
  await db.batch(
    batch.events.map((event) =>
      db
        .prepare(
          "INSERT OR IGNORE INTO product_events (id, client_session_id, client_sequence, occurred_at_client, received_at_server, event_type, route, project_id, job_id, diagram_version_id, app_version, safe_payload_json) SELECT incoming.id, incoming.client_session_id, incoming.client_sequence, incoming.occurred_at_client, incoming.received_at_server, incoming.event_type, incoming.route, CASE WHEN incoming.event_type = 'project.deleted' THEN NULL ELSE incoming.project_id END, CASE WHEN incoming.event_type = 'project.deleted' THEN NULL ELSE incoming.job_id END, CASE WHEN incoming.event_type = 'project.deleted' THEN NULL ELSE incoming.diagram_version_id END, incoming.app_version, incoming.safe_payload_json FROM (SELECT ? AS id, ? AS client_session_id, ? AS client_sequence, ? AS occurred_at_client, ? AS received_at_server, ? AS event_type, ? AS route, ? AS project_id, ? AS job_id, ? AS diagram_version_id, ? AS app_version, ? AS safe_payload_json) AS incoming WHERE incoming.event_type = 'project.deleted' OR incoming.project_id IS NULL OR EXISTS (SELECT 1 FROM projects WHERE projects.id = incoming.project_id)",
        )
        .bind(
          event.event_id,
          event.client_session_id,
          event.client_sequence,
          event.occurred_at_client,
          received,
          event.event_type,
          event.route,
          event.project_id ?? null,
          event.job_id ?? null,
          event.diagram_version_id ?? null,
          event.app_version,
          JSON.stringify(event.safe_payload),
        ),
    ),
  );
}

async function opaqueFingerprint(projectId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`bpmn-builder-deletion:${projectId}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function deleteProjectVerified(
  db: D1Database,
  bucket: R2Bucket,
  projectId: string,
): Promise<{
  id: string;
  deletedObjectCount: number;
  deletedRowCount: number;
}> {
  const fingerprint = await opaqueFingerprint(projectId);
  const existing = await db
    .prepare(
      "SELECT id, deleted_object_count, deleted_row_count FROM deletion_receipts WHERE opaque_project_fingerprint = ?",
    )
    .bind(fingerprint)
    .first<{
      id: string;
      deleted_object_count: number;
      deleted_row_count: number;
    }>();
  if (existing)
    return {
      id: existing.id,
      deletedObjectCount: existing.deleted_object_count,
      deletedRowCount: existing.deleted_row_count,
    };
  await db
    .prepare(
      "UPDATE projects SET status = 'deleting', updated_at = ? WHERE id = ?",
    )
    .bind(nowIso(), projectId)
    .run();
  const prefix = `projects/${projectId}/`;
  const keys: string[] = [];
  let cursor: string | undefined;
  let truncated = true;
  while (truncated) {
    const listed = await bucket.list({ prefix, limit: 1000, cursor });
    keys.push(...listed.objects.map((object) => object.key));
    cursor = listed.truncated ? listed.cursor : undefined;
    truncated = listed.truncated;
    if (listed.truncated && !cursor)
      throw new Error("Project object enumeration could not be continued.");
  }
  for (let offset = 0; offset < keys.length; offset += 1000)
    await bucket.delete(keys.slice(offset, offset + 1000));
  const remaining = await bucket.list({ prefix, limit: 1 });
  if (remaining.objects.length || remaining.truncated)
    throw new Error("Project object deletion could not be verified.");
  const counts = await Promise.all(
    [
      "question_clarifications",
      "sources",
      "jobs",
      "diagram_versions",
      "product_events",
    ].map(
      async (table) =>
        (
          await db
            .prepare(
              `SELECT COUNT(*) AS value FROM ${table} WHERE project_id = ?`,
            )
            .bind(projectId)
            .first<{ value: number }>()
        )?.value ?? 0,
    ),
  );
  const attemptCount =
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS value FROM job_attempts WHERE job_id IN (SELECT id FROM jobs WHERE project_id = ?)",
        )
        .bind(projectId)
        .first<{ value: number }>()
    )?.value ?? 0;
  const jobSourceCount =
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS value FROM job_sources WHERE job_id IN (SELECT id FROM jobs WHERE project_id = ?)",
        )
        .bind(projectId)
        .first<{ value: number }>()
    )?.value ?? 0;
  const jobClarificationCount =
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS value FROM job_clarifications WHERE job_id IN (SELECT id FROM jobs WHERE project_id = ?)",
        )
        .bind(projectId)
        .first<{ value: number }>()
    )?.value ?? 0;
  const deletedRowCount =
    counts.reduce((sum, count) => sum + count, 1) +
    attemptCount +
    jobSourceCount +
    jobClarificationCount;
  const receiptId = crypto.randomUUID();
  await db.batch([
    db
      .prepare("DELETE FROM product_events WHERE project_id = ?")
      .bind(projectId),
    db
      .prepare(
        "DELETE FROM job_clarifications WHERE job_id IN (SELECT id FROM jobs WHERE project_id = ?)",
      )
      .bind(projectId),
    db
      .prepare("DELETE FROM question_clarifications WHERE project_id = ?")
      .bind(projectId),
    db
      .prepare(
        "DELETE FROM job_sources WHERE job_id IN (SELECT id FROM jobs WHERE project_id = ?)",
      )
      .bind(projectId),
    db
      .prepare("DELETE FROM diagram_versions WHERE project_id = ?")
      .bind(projectId),
    db
      .prepare(
        "DELETE FROM job_attempts WHERE job_id IN (SELECT id FROM jobs WHERE project_id = ?)",
      )
      .bind(projectId),
    db.prepare("DELETE FROM jobs WHERE project_id = ?").bind(projectId),
    db.prepare("DELETE FROM sources WHERE project_id = ?").bind(projectId),
    db.prepare("DELETE FROM projects WHERE id = ?").bind(projectId),
    db
      .prepare(
        "INSERT INTO deletion_receipts (id, opaque_project_fingerprint, deleted_object_count, deleted_row_count, completed_at) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(receiptId, fingerprint, keys.length, deletedRowCount, nowIso()),
  ]);
  return { id: receiptId, deletedObjectCount: keys.length, deletedRowCount };
}
