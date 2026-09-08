import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, introspectWorkflowInstance } from "cloudflare:test";
import {
  addSource,
  claimGenerationJob,
  createProject,
} from "../../app/lib/repository.server";
import { cancelGenerationWorkflow } from "../../app/lib/generation-cancellation.server";
import { deleteProjectWithWorkflow } from "../../app/lib/project-deletion.server";

describe("Cloudflare Workflow cancellation", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it("terminates a real active Workflow before settling the job as cancelled", async () => {
    const project = await createProject(env.DB, "Workflow cancellation");
    const sourceId = crypto.randomUUID();
    const key = `projects/${project.id}/sources/${sourceId}.txt`;
    await env.SOURCES.put(key, "Synthetic cancellation evidence");
    await addSource(env.DB, {
      id: sourceId,
      project_id: project.id,
      type: "text",
      name: "Synthetic source",
      mime_type: "text/plain",
      size_bytes: 31,
      duration_seconds: null,
      r2_key: key,
    });
    const claim = await claimGenerationJob(env.DB, project.id);
    const introspector = await introspectWorkflowInstance(
      env.GENERATION_WORKFLOW,
      claim.workflowInstanceId,
    );
    try {
      await env.GENERATION_WORKFLOW.create({
        id: claim.workflowInstanceId,
        params: { jobId: claim.jobId, projectId: project.id },
      });

      const cancelled = await cancelGenerationWorkflow(
        env.DB,
        env.GENERATION_WORKFLOW,
        claim.jobId,
      );

      expect(cancelled).toMatchObject({ status: "cancelled", changed: true });
      await introspector.waitForStatus("terminated");
      await expect(
        env.GENERATION_WORKFLOW.get(claim.workflowInstanceId).then((instance) =>
          instance.status(),
        ),
      ).resolves.toMatchObject({ status: "terminated" });
      expect(
        await env.DB.prepare("SELECT status FROM jobs WHERE id = ?")
          .bind(claim.jobId)
          .first(),
      ).toEqual({ status: "cancelled" });
    } finally {
      await introspector.dispose();
    }
  }, 30_000);

  it("lets pre-create cancellation win before any source read or provider work", async () => {
    const project = await createProject(env.DB, "Pre-create cancellation");
    const sourceId = crypto.randomUUID();
    await addSource(env.DB, {
      id: sourceId,
      project_id: project.id,
      type: "text",
      name: "Deliberately unavailable source",
      mime_type: "text/plain",
      size_bytes: 20,
      duration_seconds: null,
      r2_key: `projects/${project.id}/sources/missing.txt`,
    });
    const claim = await claimGenerationJob(env.DB, project.id);
    const cancelled = await cancelGenerationWorkflow(
      env.DB,
      env.GENERATION_WORKFLOW,
      claim.jobId,
    );
    expect(cancelled).toMatchObject({ status: "cancelled", changed: true });

    const introspector = await introspectWorkflowInstance(
      env.GENERATION_WORKFLOW,
      claim.workflowInstanceId,
    );
    try {
      await env.GENERATION_WORKFLOW.create({
        id: claim.workflowInstanceId,
        params: { jobId: claim.jobId, projectId: project.id },
      });
      await introspector.waitForStatus("complete");

      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS value FROM job_attempts WHERE job_id = ?",
        )
          .bind(claim.jobId)
          .first(),
      ).toEqual({ value: 0 });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS value FROM product_events WHERE job_id = ? AND event_type = 'ai.request_completed'",
        )
          .bind(claim.jobId)
          .first(),
      ).toEqual({ value: 0 });
      expect(
        await env.DB.prepare("SELECT status FROM jobs WHERE id = ?")
          .bind(claim.jobId)
          .first(),
      ).toEqual({ status: "cancelled" });
    } finally {
      await introspector.dispose();
    }
  }, 30_000);

  it("terminates an active Workflow before verified project deletion", async () => {
    const project = await createProject(env.DB, "Active deletion");
    const sourceId = crypto.randomUUID();
    const key = `projects/${project.id}/sources/${sourceId}.txt`;
    await env.SOURCES.put(key, "Synthetic deletion evidence");
    await addSource(env.DB, {
      id: sourceId,
      project_id: project.id,
      type: "text",
      name: "Synthetic source",
      mime_type: "text/plain",
      size_bytes: 27,
      duration_seconds: null,
      r2_key: key,
    });
    const claim = await claimGenerationJob(env.DB, project.id);
    const introspector = await introspectWorkflowInstance(
      env.GENERATION_WORKFLOW,
      claim.workflowInstanceId,
    );
    try {
      await env.GENERATION_WORKFLOW.create({
        id: claim.workflowInstanceId,
        params: { jobId: claim.jobId, projectId: project.id },
      });

      const receipt = await deleteProjectWithWorkflow(
        env.DB,
        env.SOURCES,
        env.GENERATION_WORKFLOW,
        project.id,
      );

      await introspector.waitForStatus("terminated");
      expect(receipt.deletedObjectCount).toBe(1);
      expect(
        await env.SOURCES.list({ prefix: `projects/${project.id}/` }),
      ).toMatchObject({ objects: [], truncated: false });
      expect(
        await env.DB.prepare("SELECT id FROM projects WHERE id = ?")
          .bind(project.id)
          .first(),
      ).toBeNull();
    } finally {
      await introspector.dispose();
    }
  }, 30_000);
});
