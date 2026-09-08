import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { applyD1Migrations, introspectWorkflowInstance } from "cloudflare:test";
import {
  addSource,
  claimGenerationJob,
  createProject,
  getJobSources,
} from "../../app/lib/repository.server";
import { getMockProcessIr } from "../../ai/provider.server";

describe("Workflow source-reference persistence gate", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it("fails safely without saving ready output when a provider step bypasses its schema", async () => {
    const project = await createProject(env.DB, "Source integrity workflow");
    const sourceId = "source_workflow_allowed";
    const key = `projects/${project.id}/sources/${sourceId}.txt`;
    await env.SOURCES.put(key, "Synthetic workflow evidence");
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
    const ir = getMockProcessIr(await getJobSources(env.DB, claim.jobId));
    const rejectedId = "source_workflow_allowe";
    ir.flows[0]!.sourceRefs = [
      { sourceId: rejectedId, locator: "synthetic truncated reference" },
    ];

    const introspector = await introspectWorkflowInstance(
      env.GENERATION_WORKFLOW,
      claim.workflowInstanceId,
    );
    try {
      await introspector.modify(async (modifier) => {
        await modifier.mockStepResult(
          { name: "extract-process-ir" },
          {
            ir,
            metadata: {
              responseId: "response_synthetic_bypass",
              returnedModel: "gpt-5.6-terra",
              usage: {},
            },
          },
        );
      });
      await env.GENERATION_WORKFLOW.create({
        id: claim.workflowInstanceId,
        params: { jobId: claim.jobId, projectId: project.id },
      });
      await introspector.waitForStatus("errored");

      const workflowError = await introspector.getError();
      expect(workflowError.message).toBe(
        "provider_unknown_source_reference: The extraction provider returned an unknown source reference.",
      );
      expect(workflowError.message).not.toContain(rejectedId);
      expect(
        await env.DB.prepare("SELECT status, error_code FROM jobs WHERE id = ?")
          .bind(claim.jobId)
          .first(),
      ).toEqual({ status: "failed", error_code: "generation_failed" });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS value FROM diagram_versions WHERE job_id = ?",
        )
          .bind(claim.jobId)
          .first(),
      ).toEqual({ value: 0 });
    } finally {
      await introspector.dispose();
    }
  }, 30_000);
});
