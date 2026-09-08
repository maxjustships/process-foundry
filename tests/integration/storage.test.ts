import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import {
  addSource,
  claimJobExecution,
  createProject,
  claimGenerationJob,
  confirmQuestionAnswer,
  createGenerationIntent,
  getJobBaseVersion,
  getJobSources,
  getProject,
  requestJobCancellation,
  retryJobSnapshot,
  saveDiagramVersion,
  saveReadyAiVersion,
  settleJobCancelled,
  setJobStatus,
  storeTelemetry,
} from "../../app/lib/repository.server";
import { advanceFeedbackStatus } from "../../app/lib/feedback.server";
import { parseTelemetryBatch } from "../../app/lib/telemetry";
import { getMockProcessIr } from "../../ai/provider.server";
import {
  buildClarificationBody,
  deriveClarificationArtifacts,
} from "../../app/lib/clarifications";
import { deleteProjectWithWorkflow } from "../../app/lib/project-deletion.server";
import { startGenerationWorkflowOrCompensate } from "../../app/lib/generation-start.server";
import { loadExtractionInputsForJob } from "../../workers/generation";

const missingWorkflow = {
  get(): Promise<WorkflowInstance> {
    return Promise.reject(new Error("instance.not_found"));
  },
} satisfies Pick<Workflow, "get">;

const unknownWorkflowInstance = {
  id: "indeterminate-workflow",
  pause: () => Promise.resolve(),
  resume: () => Promise.resolve(),
  terminate: () => Promise.resolve(),
  restart: () => Promise.resolve(),
  delete: () => Promise.resolve(),
  status: () => Promise.resolve({ status: "unknown" as const }),
  sendEvent: () => Promise.resolve(),
} satisfies WorkflowInstance;

const unknownWorkflow = {
  get: () => Promise.resolve(unknownWorkflowInstance),
} satisfies Pick<Workflow, "get">;

const rejectingWorkflow = {
  create: (): Promise<WorkflowInstance> =>
    Promise.reject(new Error("synthetic workflow create rejection")),
} satisfies Pick<Workflow, "create">;

async function addTextSource(projectId: string, id: string, text: string) {
  const key = `projects/${projectId}/sources/${id}.txt`;
  await env.SOURCES.put(key, text);
  return addSource(env.DB, {
    id,
    project_id: projectId,
    type: "text",
    name: "Text",
    mime_type: "text/plain",
    size_bytes: text.length,
    duration_seconds: null,
    r2_key: key,
  });
}

async function addQuestionVersion(
  projectId: string,
  questionId = "question_owner",
) {
  const sources = (await getProject(env.DB, projectId))?.sources ?? [];
  const ir = getMockProcessIr(sources);
  ir.questions[0].id = questionId;
  return saveDiagramVersion(
    env.DB,
    projectId,
    null,
    "<definitions />",
    JSON.stringify(ir),
    "ai",
  );
}

describe("review clarification migration", () => {
  it("applies additively over existing 0001 fixture rows", async () => {
    const [initialMigration, reviewMigration] = env.TEST_MIGRATIONS;
    await applyD1Migrations(env.DB, [initialMigration]);
    const timestamp = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO projects (id, title, status, created_at, updated_at) VALUES ('existing-project', 'Existing fixture', 'active', ?, ?)",
    )
      .bind(timestamp, timestamp)
      .run();
    await env.DB.prepare(
      "INSERT INTO sources (id, project_id, type, name, mime_type, size_bytes, r2_key, created_at) VALUES ('existing-source', 'existing-project', 'text', 'Text', 'text/plain', 8, 'projects/existing-project/sources/existing.txt', ?)",
    )
      .bind(timestamp)
      .run();

    await applyD1Migrations(env.DB, [reviewMigration]);

    expect(
      await env.DB.prepare(
        "SELECT title FROM projects WHERE id = 'existing-project'",
      ).first(),
    ).toEqual({ title: "Existing fixture" });
    expect(
      await env.DB.prepare(
        "SELECT type FROM sources WHERE id = 'existing-source'",
      ).first(),
    ).toEqual({ type: "text" });
    expect(
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('question_clarifications', 'job_sources') ORDER BY name",
      ).all(),
    ).toMatchObject({
      results: [{ name: "job_sources" }, { name: "question_clarifications" }],
    });
  });
});

describe("tester-priority migration", () => {
  it("preserves existing jobs while adding cancellation and provenance contracts", async () => {
    const [initialMigration, reviewMigration, priorityMigration] =
      env.TEST_MIGRATIONS;
    await applyD1Migrations(env.DB, [initialMigration, reviewMigration]);
    const timestamp = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO projects (id, title, status, created_at, updated_at) VALUES ('legacy-project', 'Legacy fixture', 'active', ?, ?)",
      ).bind(timestamp, timestamp),
      env.DB.prepare(
        "INSERT INTO jobs (id, project_id, workflow_instance_id, status, model_provider, model_name, prompt_version, created_at, updated_at) VALUES ('legacy-job', 'legacy-project', 'legacy-workflow', 'failed', 'openai', 'gpt-5.6-terra', 'process-ir/v1', ?, ?)",
      ).bind(timestamp, timestamp),
    ]);

    await applyD1Migrations(env.DB, [priorityMigration]);

    expect(
      await env.DB.prepare(
        "SELECT id, status, generation_mode, error_stage FROM jobs WHERE id = 'legacy-job'",
      ).first(),
    ).toEqual({
      id: "legacy-job",
      status: "failed",
      generation_mode: "legacy",
      error_stage: null,
    });
    expect(
      await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'job_clarifications'",
      ).first(),
    ).toEqual({ name: "job_clarifications" });
  });
});

describe("D1 and R2 lifecycle", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it("enforces one active job and allows a new claim after failure", async () => {
    const project = await createProject(env.DB, "Test process");
    const first = await claimGenerationJob(env.DB, project.id);
    expect(first.created).toBe(true);
    const duplicate = await claimGenerationJob(env.DB, project.id);
    expect(duplicate).toMatchObject({ created: false, jobId: first.jobId });
    await env.DB.prepare("UPDATE jobs SET status = 'failed' WHERE id = ?")
      .bind(first.jobId)
      .run();
    const retry = await claimGenerationJob(env.DB, project.id);
    expect(retry.created).toBe(true);
    expect(retry.jobId).not.toBe(first.jobId);
  });

  it("defaults persisted jobs from internal creation paths to Russian", async () => {
    const legacyProject = await createProject(env.DB, "Legacy job creator");
    const legacyClaim = await claimGenerationJob(env.DB, legacyProject.id);
    expect(
      await env.DB.prepare("SELECT output_locale FROM jobs WHERE id = ?")
        .bind(legacyClaim.jobId)
        .first(),
    ).toEqual({ output_locale: "ru" });

    const intentProject = await createProject(env.DB, "Intent job creator");
    await addTextSource(
      intentProject.id,
      "default-locale-source",
      "Synthetic evidence",
    );
    const intentClaim = await createGenerationIntent(env.DB, {
      projectId: intentProject.id,
      mode: "alternative",
      sourceIds: ["default-locale-source"],
    });
    expect(
      await env.DB.prepare("SELECT output_locale FROM jobs WHERE id = ?")
        .bind(intentClaim.jobId)
        .first(),
    ).toEqual({ output_locale: "ru" });
  });

  it("lets cancellation win once and permanently prevents version publication", async () => {
    const project = await createProject(env.DB, "Cancellation race");
    await addTextSource(project.id, "race-source", "Synthetic evidence");
    const claim = await claimGenerationJob(env.DB, project.id);

    expect(await requestJobCancellation(env.DB, claim.jobId)).toMatchObject({
      status: "cancelling",
      changed: true,
    });
    expect(await requestJobCancellation(env.DB, claim.jobId)).toMatchObject({
      status: "cancelling",
      changed: false,
    });
    expect(await settleJobCancelled(env.DB, claim.jobId)).toMatchObject({
      status: "cancelled",
      changed: true,
    });
    expect(await settleJobCancelled(env.DB, claim.jobId)).toMatchObject({
      status: "cancelled",
      changed: false,
    });

    await expect(
      saveReadyAiVersion(
        env.DB,
        project.id,
        claim.jobId,
        "<definitions />",
        JSON.stringify(
          getMockProcessIr(await getJobSources(env.DB, claim.jobId)),
        ),
      ),
    ).rejects.toThrow("Generation job is no longer publishable.");
    await setJobStatus(env.DB, claim.jobId, "ready");

    expect(
      await env.DB.prepare("SELECT status FROM jobs WHERE id = ?")
        .bind(claim.jobId)
        .first(),
    ).toEqual({ status: "cancelled" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS value FROM diagram_versions WHERE job_id = ?",
      )
        .bind(claim.jobId)
        .first(),
    ).toEqual({ value: 0 });
  });

  it("claims execution only for the queued job's exact Workflow instance", async () => {
    const project = await createProject(env.DB, "Execution claim");
    await addTextSource(project.id, "claim-source", "Synthetic evidence");
    const queued = await claimGenerationJob(env.DB, project.id);

    await expect(
      claimJobExecution(env.DB, {
        jobId: queued.jobId,
        projectId: project.id,
        workflowInstanceId: "stale-workflow-instance",
      }),
    ).resolves.toBeNull();
    expect(
      await env.DB.prepare("SELECT status FROM jobs WHERE id = ?")
        .bind(queued.jobId)
        .first(),
    ).toEqual({ status: "queued" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS value FROM job_attempts WHERE job_id = ?",
      )
        .bind(queued.jobId)
        .first(),
    ).toEqual({ value: 0 });

    await expect(
      claimJobExecution(env.DB, {
        jobId: queued.jobId,
        projectId: project.id,
        workflowInstanceId: queued.workflowInstanceId,
      }),
    ).resolves.toEqual(expect.any(String));
    expect(
      await env.DB.prepare("SELECT status FROM jobs WHERE id = ?")
        .bind(queued.jobId)
        .first(),
    ).toEqual({ status: "transcribing" });
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS value FROM job_attempts WHERE job_id = ? AND status = 'running'",
      )
        .bind(queued.jobId)
        .first(),
    ).toEqual({ value: 1 });
  });

  it("closes a running attempt in the same cancellation settlement", async () => {
    const project = await createProject(env.DB, "Attempt cancellation");
    await addTextSource(project.id, "attempt-source", "Synthetic evidence");
    const queued = await claimGenerationJob(env.DB, project.id);
    await claimJobExecution(env.DB, {
      jobId: queued.jobId,
      projectId: project.id,
      workflowInstanceId: queued.workflowInstanceId,
    });

    await requestJobCancellation(env.DB, queued.jobId);
    await settleJobCancelled(env.DB, queued.jobId);

    const rows = await env.DB.prepare(
      "SELECT status, error_class, completed_at FROM job_attempts WHERE job_id = ?",
    )
      .bind(queued.jobId)
      .all<{
        status: string;
        error_class: string | null;
        completed_at: string | null;
      }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      status: "cancelled",
      error_class: "generation_cancelled",
    });
    expect(typeof rows.results[0]?.completed_at).toBe("string");
  });

  it("requeues the identical job snapshot only from failed or cancelled", async () => {
    const project = await createProject(env.DB, "Retry state machine");
    await addTextSource(project.id, "retry-source", "Synthetic evidence");
    const claim = await claimGenerationJob(env.DB, project.id);
    const sourceIds = (await getJobSources(env.DB, claim.jobId)).map(
      (source) => source.id,
    );

    expect(await retryJobSnapshot(env.DB, claim.jobId)).toMatchObject({
      changed: false,
      status: "queued",
      workflowInstanceId: claim.workflowInstanceId,
    });
    await setJobStatus(env.DB, claim.jobId, "failed", {
      code: "generation_failed",
      message: "Safe failure.",
    });
    const retried = await retryJobSnapshot(env.DB, claim.jobId);
    expect(retried).toMatchObject({ changed: true, status: "queued" });
    expect(retried.workflowInstanceId).not.toBe(claim.workflowInstanceId);
    expect(
      (await getJobSources(env.DB, claim.jobId)).map((source) => source.id),
    ).toEqual(sourceIds);

    await requestJobCancellation(env.DB, claim.jobId);
    await settleJobCancelled(env.DB, claim.jobId);
    expect(await retryJobSnapshot(env.DB, claim.jobId)).toMatchObject({
      changed: true,
      status: "queued",
    });
  });

  it("compensates Workflow creation failures for initial generation and retry", async () => {
    const project = await createProject(env.DB, "Workflow create failure");
    await addTextSource(project.id, "create-source", "Synthetic evidence");
    const readyBeforeFailure = await saveDiagramVersion(
      env.DB,
      project.id,
      null,
      "<definitions last-ready='preserved' />",
      null,
      "human",
    );
    const initial = await createGenerationIntent(env.DB, {
      projectId: project.id,
      mode: "alternative",
      sourceIds: ["create-source"],
      clarificationIds: [],
    });

    await expect(
      startGenerationWorkflowOrCompensate(env.DB, rejectingWorkflow, {
        jobId: initial.jobId,
        projectId: project.id,
        workflowInstanceId: initial.workflowInstanceId,
      }),
    ).resolves.toBe(false);
    expect(
      await env.DB.prepare(
        "SELECT status, error_code, error_stage, error_safe_message FROM jobs WHERE id = ?",
      )
        .bind(initial.jobId)
        .first(),
    ).toEqual({
      status: "failed",
      error_code: "workflow_create_failed",
      error_stage: "queued",
      error_safe_message: "Generation could not be started. Retry safely.",
    });
    expect(
      await env.DB.prepare(
        "SELECT status, active_job_id FROM projects WHERE id = ?",
      )
        .bind(project.id)
        .first(),
    ).toEqual({ status: "active", active_job_id: initial.jobId });

    const retried = await retryJobSnapshot(env.DB, initial.jobId);
    expect(retried).toMatchObject({ changed: true, status: "queued" });
    await expect(
      startGenerationWorkflowOrCompensate(env.DB, rejectingWorkflow, {
        jobId: initial.jobId,
        projectId: project.id,
        workflowInstanceId: retried.workflowInstanceId,
      }),
    ).resolves.toBe(false);
    expect(
      await env.DB.prepare(
        "SELECT status, workflow_instance_id, error_code FROM jobs WHERE id = ?",
      )
        .bind(initial.jobId)
        .first(),
    ).toEqual({
      status: "failed",
      workflow_instance_id: retried.workflowInstanceId,
      error_code: "workflow_create_failed",
    });
    expect(
      await env.DB.prepare(
        "SELECT id, bpmn_xml FROM diagram_versions WHERE project_id = ? ORDER BY version_number DESC LIMIT 1",
      )
        .bind(project.id)
        .first(),
    ).toEqual({
      id: readyBeforeFailure.id,
      bpmn_xml: "<definitions last-ready='preserved' />",
    });
  });

  it("persists one immutable correction source and reloads its private answer", async () => {
    const project = await createProject(env.DB, "Clarification project");
    await addTextSource(project.id, "source-original", "Original evidence");
    const version = await addQuestionVersion(project.id);

    const first = await confirmQuestionAnswer(env.DB, env.SOURCES, {
      projectId: project.id,
      versionId: version.id,
      questionId: "question_owner",
      answer: "  The finance lead.  ",
    });
    const retry = await confirmQuestionAnswer(env.DB, env.SOURCES, {
      projectId: project.id,
      versionId: version.id,
      questionId: "question_owner",
      answer: "The finance lead.",
    });

    expect(first).toMatchObject({ created: true, status: "answered" });
    expect(retry).toMatchObject({ created: false, status: "answered" });
    await expect(
      confirmQuestionAnswer(env.DB, env.SOURCES, {
        projectId: project.id,
        versionId: version.id,
        questionId: "question_owner",
        answer: "The operations lead.",
      }),
    ).rejects.toMatchObject({ code: "clarification_conflict" });

    const correctionRows = await env.DB.prepare(
      "SELECT COUNT(*) AS value FROM sources WHERE project_id = ? AND type = 'correction'",
    )
      .bind(project.id)
      .first<{ value: number }>();
    const clarificationRows = await env.DB.prepare(
      "SELECT COUNT(*) AS value FROM question_clarifications WHERE project_id = ?",
    )
      .bind(project.id)
      .first<{ value: number }>();
    const objects = await env.SOURCES.list({
      prefix: `projects/${project.id}/clarifications/`,
    });
    expect(correctionRows?.value).toBe(1);
    expect(clarificationRows?.value).toBe(1);
    expect(objects.objects).toHaveLength(1);
    const storedObject = await env.SOURCES.get(objects.objects[0].key);
    expect(storedObject).not.toBeNull();

    const refreshed = await getProject(env.DB, project.id, env.SOURCES);
    expect(refreshed?.clarifications).toEqual([
      expect.objectContaining({
        question_version_id: version.id,
        question_id: "question_owner",
        status: "answered",
        applied_version_number: null,
        answer: "The finance lead.",
      }),
    ]);
  });

  it("recovers a same-answer crash-orphan object without overwriting it", async () => {
    const project = await createProject(env.DB, "Orphan recovery project");
    await addTextSource(project.id, "orphan-original", "Original evidence");
    const version = await addQuestionVersion(project.id);
    const artifacts = await deriveClarificationArtifacts(
      project.id,
      version.id,
      "question_owner",
    );
    const body = buildClarificationBody(
      "Who is accountable for checking whether the information is complete?",
      "Finance",
    );
    await env.SOURCES.put(artifacts.r2Key, body);

    const recovered = await confirmQuestionAnswer(env.DB, env.SOURCES, {
      projectId: project.id,
      versionId: version.id,
      questionId: "question_owner",
      answer: "Finance",
    });

    expect(recovered).toMatchObject({ created: false, status: "answered" });
    expect(await (await env.SOURCES.get(artifacts.r2Key))?.text()).toBe(body);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS value FROM question_clarifications WHERE source_id = ?",
      )
        .bind(artifacts.sourceId)
        .first(),
    ).toEqual({ value: 1 });
  });

  it("safely rejects unknown clarification ownership and question mismatches", async () => {
    const project = await createProject(env.DB, "Ownership project");
    await addTextSource(project.id, "ownership-source", "Evidence");
    const version = await addQuestionVersion(project.id);

    for (const input of [
      {
        projectId: "missing",
        versionId: version.id,
        questionId: "question_owner",
      },
      {
        projectId: project.id,
        versionId: "missing",
        questionId: "question_owner",
      },
      { projectId: project.id, versionId: version.id, questionId: "missing" },
    ])
      await expect(
        confirmQuestionAnswer(env.DB, env.SOURCES, {
          ...input,
          answer: "Confirmed",
        }),
      ).rejects.toMatchObject({ code: "clarification_not_found" });

    await expect(
      confirmQuestionAnswer(env.DB, env.SOURCES, {
        projectId: project.id,
        versionId: version.id,
        questionId: "question_owner",
        answer: "x".repeat(5001),
      }),
    ).rejects.toThrow();

    expect(
      await env.SOURCES.list({
        prefix: `projects/${project.id}/clarifications/`,
      }),
    ).toMatchObject({ objects: [] });
  });

  it("snapshots legacy sources without treating ordinary evidence as applied clarifications", async () => {
    const project = await createProject(env.DB, "Snapshot project");
    await addTextSource(project.id, "snapshot-original", "Original evidence");
    const firstQuestionVersion = await addQuestionVersion(project.id);
    const firstAnswer = await confirmQuestionAnswer(env.DB, env.SOURCES, {
      projectId: project.id,
      versionId: firstQuestionVersion.id,
      questionId: "question_owner",
      answer: "Finance",
    });
    await saveDiagramVersion(
      env.DB,
      project.id,
      null,
      "<definitions human-save='true' />",
      null,
      "human",
    );
    expect(
      await env.DB.prepare(
        "SELECT status FROM question_clarifications WHERE source_id = ?",
      )
        .bind(firstAnswer.sourceId)
        .first(),
    ).toEqual({ status: "answered" });
    const claim = await claimGenerationJob(env.DB, project.id);

    const lateQuestionVersion = await addQuestionVersion(
      project.id,
      "question_late",
    );
    const lateAnswer = await confirmQuestionAnswer(env.DB, env.SOURCES, {
      projectId: project.id,
      versionId: lateQuestionVersion.id,
      questionId: "question_late",
      answer: "Operations",
    });
    const snapshotted = await getJobSources(env.DB, claim.jobId);
    expect(snapshotted.map((source) => source.id)).toEqual([
      "snapshot-original",
      firstAnswer.sourceId,
    ]);
    expect(snapshotted.map((source) => source.id)).not.toContain(
      lateAnswer.sourceId,
    );

    const ir = getMockProcessIr(snapshotted);
    const saved = await saveReadyAiVersion(
      env.DB,
      project.id,
      claim.jobId,
      "<definitions />",
      JSON.stringify(ir),
    );
    const replay = await saveReadyAiVersion(
      env.DB,
      project.id,
      claim.jobId,
      "<definitions replay-must-not-overwrite='true' />",
      JSON.stringify(ir),
    );
    expect(replay.id).toBe(saved.id);
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS value FROM diagram_versions WHERE job_id = ?",
      )
        .bind(claim.jobId)
        .first<{ value: number }>(),
    ).toMatchObject({ value: 1 });
    expect(
      await env.DB.prepare(
        "SELECT status, applied_version_id FROM question_clarifications WHERE source_id = ?",
      )
        .bind(firstAnswer.sourceId)
        .first(),
    ).toEqual({ status: "answered", applied_version_id: null });
    expect(
      await env.DB.prepare(
        "SELECT status, applied_version_id FROM question_clarifications WHERE source_id = ?",
      )
        .bind(lateAnswer.sourceId)
        .first(),
    ).toEqual({ status: "answered", applied_version_id: null });

    await setJobStatus(env.DB, claim.jobId, "ready");
    const failedClaim = await claimGenerationJob(env.DB, project.id);
    await setJobStatus(env.DB, failedClaim.jobId, "failed", {
      code: "generation_failed",
      message: "Generation stopped safely.",
    });
    expect(
      await env.DB.prepare(
        "SELECT status FROM question_clarifications WHERE source_id = ?",
      )
        .bind(lateAnswer.sourceId)
        .first(),
    ).toEqual({ status: "answered" });

    const laterClaim = await claimGenerationJob(env.DB, project.id);
    await saveReadyAiVersion(
      env.DB,
      project.id,
      laterClaim.jobId,
      "<definitions />",
      JSON.stringify(
        getMockProcessIr(await getJobSources(env.DB, laterClaim.jobId)),
      ),
    );
    expect(
      await env.DB.prepare(
        "SELECT status, applied_version_id FROM question_clarifications WHERE source_id = ?",
      )
        .bind(firstAnswer.sourceId)
        .first(),
    ).toEqual({ status: "answered", applied_version_id: null });
    expect(
      await env.DB.prepare(
        "SELECT status, applied_version_id FROM question_clarifications WHERE source_id = ?",
      )
        .bind(lateAnswer.sourceId)
        .first(),
    ).toEqual({ status: "answered", applied_version_id: null });
  });

  it("persists explicit refine and alternative intent without gluing ambient sources", async () => {
    const project = await createProject(env.DB, "Intent project");
    await addTextSource(project.id, "intent-a", "Evidence A");
    await addTextSource(project.id, "intent-b", "Evidence B");
    const base = await addQuestionVersion(project.id);
    const answer = await confirmQuestionAnswer(env.DB, env.SOURCES, {
      projectId: project.id,
      versionId: base.id,
      questionId: "question_owner",
      answer: "Finance",
    });
    const clarification = await env.DB.prepare(
      "SELECT id FROM question_clarifications WHERE source_id = ?",
    )
      .bind(answer.sourceId)
      .first<{ id: string }>();

    const refine = await createGenerationIntent(env.DB, {
      projectId: project.id,
      mode: "refine",
      baseVersionId: base.id,
      sourceIds: ["intent-a"],
      clarificationIds: [clarification!.id],
    });
    expect(
      (await getJobSources(env.DB, refine.jobId)).map((source) => source.id),
    ).toEqual(["intent-a", answer.sourceId]);
    const refineVersion = await saveReadyAiVersion(
      env.DB,
      project.id,
      refine.jobId,
      "<definitions refine='true' />",
      JSON.stringify(
        getMockProcessIr(await getJobSources(env.DB, refine.jobId)),
      ),
    );
    expect(refineVersion).toMatchObject({
      generation_mode: "refine",
      base_version_id: base.id,
      source_count: 2,
      clarification_count: 1,
    });
    expect(JSON.parse(refineVersion.source_snapshot_json ?? "[]")).toEqual([
      { id: "intent-a", name: "Text", type: "text" },
      {
        id: answer.sourceId,
        name: "Confirmed question answer",
        type: "correction",
      },
    ]);
    expect(
      await env.DB.prepare(
        "SELECT status, applied_version_id FROM question_clarifications WHERE source_id = ?",
      )
        .bind(answer.sourceId)
        .first(),
    ).toEqual({ status: "applied", applied_version_id: refineVersion.id });

    const alternative = await createGenerationIntent(env.DB, {
      projectId: project.id,
      mode: "alternative",
      sourceIds: ["intent-b"],
      clarificationIds: [],
    });
    expect(
      (await getJobSources(env.DB, alternative.jobId)).map(
        (source) => source.id,
      ),
    ).toEqual(["intent-b"]);
    const alternativeVersion = await saveReadyAiVersion(
      env.DB,
      project.id,
      alternative.jobId,
      "<definitions alternative='true' />",
      JSON.stringify(
        getMockProcessIr(await getJobSources(env.DB, alternative.jobId)),
      ),
    );
    expect(alternativeVersion).toMatchObject({
      generation_mode: "alternative",
      base_version_id: null,
      source_count: 1,
      clarification_count: 0,
    });
    expect(JSON.parse(alternativeVersion.source_snapshot_json ?? "[]")).toEqual(
      [{ id: "intent-b", name: "Text", type: "text" }],
    );
    expect(
      await env.DB.prepare(
        "SELECT version_number FROM diagram_versions WHERE project_id = ? ORDER BY version_number",
      )
        .bind(project.id)
        .all(),
    ).toMatchObject({
      results: [
        { version_number: base.version_number },
        { version_number: refineVersion.version_number },
        { version_number: alternativeVersion.version_number },
      ],
    });
  });

  it("automatically snapshots exact-base answers while rejecting answer sources as ordinary selections", async () => {
    const project = await createProject(env.DB, "Safe clarification inputs");
    await addTextSource(project.id, "ordinary-evidence", "Original evidence");
    const generalCorrection = await addTextSource(
      project.id,
      "general-correction",
      "Project-level correction",
    );
    await env.DB.prepare("UPDATE sources SET type = 'correction' WHERE id = ?")
      .bind(generalCorrection.id)
      .run();
    const base = await addQuestionVersion(project.id);
    const answer = await confirmQuestionAnswer(env.DB, env.SOURCES, {
      projectId: project.id,
      versionId: base.id,
      questionId: "question_owner",
      answer: "Finance",
    });

    await expect(
      createGenerationIntent(env.DB, {
        projectId: project.id,
        mode: "alternative",
        sourceIds: [answer.sourceId],
        clarificationIds: [],
      }),
    ).rejects.toMatchObject({ code: "generation_source_invalid" });

    const refine = await createGenerationIntent(env.DB, {
      projectId: project.id,
      mode: "refine",
      baseVersionId: base.id,
      sourceIds: ["ordinary-evidence"],
      clarificationIds: [],
    });
    expect(
      (await getJobSources(env.DB, refine.jobId)).map((source) => source.id),
    ).toEqual(["ordinary-evidence", answer.sourceId]);
    expect(
      await env.DB.prepare(
        "SELECT clarification_id, question_version_id, source_id FROM job_clarifications WHERE job_id = ?",
      )
        .bind(refine.jobId)
        .first(),
    ).toMatchObject({
      question_version_id: base.id,
      source_id: answer.sourceId,
    });

    await setJobStatus(env.DB, refine.jobId, "failed", {
      code: "synthetic_failure",
      message: "Safe synthetic failure.",
    });
    await retryJobSnapshot(env.DB, refine.jobId);
    expect(
      (await getJobSources(env.DB, refine.jobId)).map((source) => source.id),
    ).toEqual(["ordinary-evidence", answer.sourceId]);

    await setJobStatus(env.DB, refine.jobId, "failed", {
      code: "synthetic_failure",
      message: "Safe synthetic failure.",
    });
    const alternative = await createGenerationIntent(env.DB, {
      projectId: project.id,
      mode: "alternative",
      sourceIds: [generalCorrection.id],
      clarificationIds: [],
    });
    expect(
      (await getJobSources(env.DB, alternative.jobId)).map(
        (source) => source.id,
      ),
    ).toEqual([generalCorrection.id]);
  });

  it("loads the exact immutable base snapshot for refine, never alternative, and preserves it on retry", async () => {
    const refineProject = await createProject(env.DB, "Refine base evidence");
    await addTextSource(refineProject.id, "refine-source", "Refine evidence");
    const selectedXml = "<definitions selected-human-edit='exact' />";
    const selectedIr = '{"snapshot":"selected-process-ir"}';
    const selectedBase = await saveDiagramVersion(
      env.DB,
      refineProject.id,
      null,
      selectedXml,
      selectedIr,
      "human",
    );
    const refine = await createGenerationIntent(env.DB, {
      projectId: refineProject.id,
      mode: "refine",
      baseVersionId: selectedBase.id,
      sourceIds: ["refine-source"],
      clarificationIds: [],
    });
    await claimJobExecution(env.DB, {
      jobId: refine.jobId,
      projectId: refineProject.id,
      workflowInstanceId: refine.workflowInstanceId,
    });

    expect(await getJobBaseVersion(env.DB, refine.jobId)).toEqual(
      expect.objectContaining({
        id: selectedBase.id,
        bpmn_xml: selectedXml,
        ir_json: selectedIr,
        created_by: "human",
      }),
    );
    const firstInputs = await loadExtractionInputsForJob(env, refine.jobId);
    const firstBaseInput = firstInputs.find(
      (input) =>
        input.kind === "text" && input.text.includes("[base-diagram-snapshot]"),
    );
    expect(firstBaseInput?.kind).toBe("text");
    if (firstBaseInput?.kind !== "text")
      throw new Error("The refine base input was not loaded.");
    expect(firstBaseInput.text).toContain(selectedXml);
    expect(firstBaseInput.text).toContain(selectedIr);
    expect(firstBaseInput.text).toContain(
      "Preserve its existing semantics and human edits",
    );

    await setJobStatus(env.DB, refine.jobId, "failed", {
      code: "generation_failed",
      message: "Safe failure.",
    });
    const newerXml =
      "<definitions newer-project-version='must-not-replace-base' />";
    await saveDiagramVersion(
      env.DB,
      refineProject.id,
      null,
      newerXml,
      null,
      "human",
    );
    const retried = await retryJobSnapshot(env.DB, refine.jobId);
    await claimJobExecution(env.DB, {
      jobId: refine.jobId,
      projectId: refineProject.id,
      workflowInstanceId: retried.workflowInstanceId,
    });
    const retryInputs = await loadExtractionInputsForJob(env, refine.jobId);
    const retryText = retryInputs
      .filter((input) => input.kind === "text")
      .map((input) => input.text)
      .join("\n");
    expect(retryText).toContain(selectedXml);
    expect(retryText).toContain(selectedIr);
    expect(retryText).not.toContain(newerXml);

    const alternativeProject = await createProject(
      env.DB,
      "Alternative has no base",
    );
    await addTextSource(
      alternativeProject.id,
      "alternative-source",
      "Alternative evidence",
    );
    await saveDiagramVersion(
      env.DB,
      alternativeProject.id,
      null,
      "<definitions ambient-base='must-not-be-sent' />",
      null,
      "human",
    );
    const alternative = await createGenerationIntent(env.DB, {
      projectId: alternativeProject.id,
      mode: "alternative",
      sourceIds: ["alternative-source"],
      clarificationIds: [],
    });
    await claimJobExecution(env.DB, {
      jobId: alternative.jobId,
      projectId: alternativeProject.id,
      workflowInstanceId: alternative.workflowInstanceId,
    });
    expect(await getJobBaseVersion(env.DB, alternative.jobId)).toBeNull();
    expect(
      (await loadExtractionInputsForJob(env, alternative.jobId)).some(
        (input) =>
          input.kind === "text" &&
          input.text.includes("[base-diagram-snapshot]"),
      ),
    ).toBe(false);
  });

  it("rejects a question-answer source presented as an ordinary source", async () => {
    const project = await createProject(env.DB, "Exact clarification snapshot");
    await addTextSource(project.id, "ordinary-source", "Original evidence");
    const base = await addQuestionVersion(project.id);
    const answer = await confirmQuestionAnswer(env.DB, env.SOURCES, {
      projectId: project.id,
      versionId: base.id,
      questionId: "question_owner",
      answer: "Finance",
    });
    await expect(
      createGenerationIntent(env.DB, {
        projectId: project.id,
        mode: "refine",
        baseVersionId: base.id,
        sourceIds: [answer.sourceId],
        clarificationIds: [],
      }),
    ).rejects.toMatchObject({ code: "generation_source_invalid" });
  });

  it("fails closed on an indeterminate Workflow status during deletion", async () => {
    const project = await createProject(env.DB, "Unknown Workflow status");
    await addTextSource(project.id, "unknown-source", "Private evidence");
    await claimGenerationJob(env.DB, project.id);

    await expect(
      deleteProjectWithWorkflow(
        env.DB,
        env.SOURCES,
        unknownWorkflow,
        project.id,
      ),
    ).rejects.toThrow("Workflow cancellation could not be verified.");
    expect(
      await env.SOURCES.list({ prefix: `projects/${project.id}/` }),
    ).toMatchObject({ objects: [expect.anything()], truncated: false });
    expect(
      await env.DB.prepare("SELECT id FROM projects WHERE id = ?")
        .bind(project.id)
        .first(),
    ).toEqual({ id: project.id });
    expect(
      await env.DB.prepare("SELECT status FROM jobs WHERE project_id = ?")
        .bind(project.id)
        .first(),
    ).toEqual({ status: "cancelling" });
  });

  it("deletes every project object and linked row but retains an opaque receipt", async () => {
    const project = await createProject(env.DB, "Delete me");
    await addTextSource(project.id, "delete-source", "private text");
    const version = await addQuestionVersion(project.id);
    await confirmQuestionAnswer(env.DB, env.SOURCES, {
      projectId: project.id,
      versionId: version.id,
      questionId: "question_owner",
      answer: "Confirmed privately",
    });
    await claimGenerationJob(env.DB, project.id);
    const orphanKey = `projects/${project.id}/clarifications/deliberate-orphan.txt`;
    await env.SOURCES.put(orphanKey, "crash orphan");
    const receipt = await deleteProjectWithWorkflow(
      env.DB,
      env.SOURCES,
      missingWorkflow,
      project.id,
    );
    const repeated = await deleteProjectWithWorkflow(
      env.DB,
      env.SOURCES,
      missingWorkflow,
      project.id,
    );
    expect(repeated.id).toBe(receipt.id);
    expect(receipt.deletedObjectCount).toBe(3);
    expect(
      await env.SOURCES.list({ prefix: `projects/${project.id}/` }),
    ).toMatchObject({ objects: [], truncated: false });
    expect(
      await env.DB.prepare("SELECT id FROM projects WHERE id = ?")
        .bind(project.id)
        .first(),
    ).toBeNull();
    const retained = await env.DB.prepare(
      "SELECT opaque_project_fingerprint FROM deletion_receipts WHERE id = ?",
    )
      .bind(receipt.id)
      .first<{ opaque_project_fingerprint: string }>();
    expect(retained?.opaque_project_fingerprint).not.toContain(project.id);
    expect(receipt.deletedRowCount).toBeGreaterThanOrEqual(7);
  });

  it("drops late telemetry links after deletion but retains an unlinked deletion event", async () => {
    const project = await createProject(env.DB, "Late telemetry project");
    const claim = await claimGenerationJob(env.DB, project.id);
    const version = await saveDiagramVersion(
      env.DB,
      project.id,
      claim.jobId,
      "<definitions />",
      null,
      "human",
    );
    await deleteProjectWithWorkflow(
      env.DB,
      env.SOURCES,
      missingWorkflow,
      project.id,
    );

    const clientSessionId = crypto.randomUUID();
    const occurredAtClient = new Date().toISOString();
    await storeTelemetry(
      env.DB,
      parseTelemetryBatch({
        events: [
          {
            event_id: crypto.randomUUID(),
            client_session_id: clientSessionId,
            client_sequence: 1,
            occurred_at_client: occurredAtClient,
            event_type: "route.view",
            route: "/projects/:projectId",
            project_id: project.id,
            app_version: "0.1.0",
            safe_payload: {},
          },
          {
            event_id: crypto.randomUUID(),
            client_session_id: clientSessionId,
            client_sequence: 2,
            occurred_at_client: occurredAtClient,
            event_type: "canvas.loaded",
            route: "/projects/:projectId",
            project_id: project.id,
            job_id: claim.jobId,
            diagram_version_id: version.id,
            app_version: "0.1.0",
            safe_payload: {},
          },
          {
            event_id: crypto.randomUUID(),
            client_session_id: clientSessionId,
            client_sequence: 3,
            occurred_at_client: occurredAtClient,
            event_type: "project.deleted",
            route: "/projects/:projectId",
            project_id: project.id,
            job_id: claim.jobId,
            diagram_version_id: version.id,
            app_version: "0.1.0",
            safe_payload: { result: "success" },
          },
        ],
      }),
    );

    expect(
      await env.DB.prepare(
        "SELECT event_type, project_id, job_id, diagram_version_id FROM product_events WHERE client_session_id = ? ORDER BY client_sequence",
      )
        .bind(clientSessionId)
        .all(),
    ).toMatchObject({
      results: [
        {
          event_type: "project.deleted",
          project_id: null,
          job_id: null,
          diagram_version_id: null,
        },
      ],
    });
  });

  it("keeps feedback isolated and enforces the human-reviewed lifecycle", async () => {
    const project = await createProject(env.DB, "Feedback project");
    const id = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO feedback_inbox (id, project_id, client_session_id, rating, text, lifecycle_status, app_version, created_at) VALUES (?, ?, 'session', 4, 'Explicit reviewer feedback', 'new', '0.1.0', ?)",
    )
      .bind(id, project.id, new Date().toISOString())
      .run();
    expect(await advanceFeedbackStatus(env.DB, [id], "accepted")).toBe(0);
    expect(await advanceFeedbackStatus(env.DB, [id], "reported")).toBe(1);
    expect(await advanceFeedbackStatus(env.DB, [id], "reviewed")).toBe(1);
    expect(await advanceFeedbackStatus(env.DB, [id], "accepted")).toBe(1);
    const row = await env.DB.prepare(
      "SELECT lifecycle_status, text FROM feedback_inbox WHERE id = ?",
    )
      .bind(id)
      .first<{ lifecycle_status: string; text: string }>();
    expect(row).toEqual({
      lifecycle_status: "accepted",
      text: "Explicit reviewer feedback",
    });
    expect(
      await env.DB.prepare("SELECT id FROM product_events WHERE project_id = ?")
        .bind(project.id)
        .first(),
    ).toBeNull();
  });
});
