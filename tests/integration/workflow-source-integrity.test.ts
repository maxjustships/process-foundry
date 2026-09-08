import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  introspectWorkflowInstance,
} from "cloudflare:test";
import {
  addSource,
  claimGenerationJob,
  createProject,
  getJobSources,
} from "../../app/lib/repository.server";
import { getMockProcessIr } from "../../ai/provider.server";
import { GenerationWorkflow } from "../../workers/generation";

const NORMAL_STEP_RESULT_LIMIT_BYTES = 1_048_576;

class SizeLimitedWorkflowStep {
  readonly serializedResults = new Map<string, string>();

  async do<T>(
    name: string,
    configOrCallback: object | (() => Promise<T>),
    configuredCallback?: () => Promise<T>,
  ): Promise<T> {
    const callback: (() => Promise<T>) | undefined =
      typeof configOrCallback === "function"
        ? (configOrCallback as () => Promise<T>)
        : configuredCallback;
    if (!callback) throw new Error(`Missing callback for Workflow step ${name}.`);
    const result = await callback();
    const serialized = JSON.stringify(result);
    if (serialized === undefined)
      throw new Error(`Workflow step ${name} returned a non-JSON result.`);
    this.serializedResults.set(name, serialized);
    const serializedBytes = new TextEncoder().encode(serialized).byteLength;
    if (serializedBytes > NORMAL_STEP_RESULT_LIMIT_BYTES)
      throw new Error(
        `Workflow step ${name} exceeded ${NORMAL_STEP_RESULT_LIMIT_BYTES} serialized bytes with ${serializedBytes}.`,
      );
    return structuredClone(result) as T;
  }

  async sleep(): Promise<void> {}
}

function createProviderWorkflow(): GenerationWorkflow {
  const workflowEnv: Env = {
    SOURCES: env.SOURCES,
    DB: env.DB,
    APP_VERSION: "0.1.0",
    MOCK_AI: "false",
    MOCK_AI_DELAY_MS: "0",
    OPENAI_API_KEY: "integration-test-key",
    GENERATION_WORKFLOW: env.GENERATION_WORKFLOW,
  };
  const workflow = Object.create(
    GenerationWorkflow.prototype,
  ) as GenerationWorkflow;
  Object.assign(workflow as unknown as { env: Env }, { env: workflowEnv });
  return workflow;
}

describe("Workflow source-reference persistence gate", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("keeps a large image out of persisted step results while delivering it to the provider", async () => {
    const project = await createProject(env.DB, "Bounded Workflow context");
    const sourceId = "source_large_image";
    const key = `projects/${project.id}/sources/${sourceId}.png`;
    const imageBytes = new Uint8Array(2_000_000).fill(65);
    await env.SOURCES.put(key, imageBytes);
    await addSource(env.DB, {
      id: sourceId,
      project_id: project.id,
      type: "image",
      name: "Synthetic large image",
      mime_type: "image/png",
      size_bytes: imageBytes.byteLength,
      duration_seconds: null,
      r2_key: key,
    });
    const claim = await claimGenerationJob(env.DB, project.id);
    const providerIr = getMockProcessIr(
      await getJobSources(env.DB, claim.jobId),
    );
    let providerImageUrlBytes = 0;
    const providerFetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body !== "string")
          throw new TypeError("Expected a JSON provider request body.");
        const request = JSON.parse(init.body) as {
          input: Array<{
            content: Array<{ type: string; image_url?: string }>;
          }>;
        };
        const imageUrl = request.input
          .flatMap((entry) => entry.content)
          .find((content) => content.type === "input_image")?.image_url;
        expect(imageUrl).toMatch(/^data:image\/png;base64,/u);
        providerImageUrlBytes = new TextEncoder().encode(imageUrl).byteLength;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "response_local_large_image",
              model: "gpt-5.6-terra",
              status: "completed",
              output_text: JSON.stringify(providerIr),
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      },
    );
    vi.stubGlobal("fetch", providerFetch);
    const workflow = createProviderWorkflow();
    const step = new SizeLimitedWorkflowStep();

    const result = await workflow.run(
      {
        payload: { jobId: claim.jobId, projectId: project.id },
        timestamp: new Date(0),
        instanceId: claim.workflowInstanceId,
        workflowName: "bounded-context-test",
      },
      step as unknown as Parameters<GenerationWorkflow["run"]>[1],
    );
    expect(typeof result.versionId).toBe("string");

    expect(providerFetch).toHaveBeenCalledOnce();
    expect(providerImageUrlBytes).toBeGreaterThan(
      NORMAL_STEP_RESULT_LIMIT_BYTES,
    );
    for (const serialized of step.serializedResults.values()) {
      expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
        NORMAL_STEP_RESULT_LIMIT_BYTES,
      );
      expect(serialized).not.toContain("data:image/png;base64,");
    }
  });

  it("treats empty source eligibility as a non-retryable Workflow error without fetching", async () => {
    const project = await createProject(env.DB, "Empty Workflow eligibility");
    const sourceId = "source_removed_from_snapshot";
    const key = `projects/${project.id}/sources/${sourceId}.txt`;
    await env.SOURCES.put(key, "Synthetic source");
    await addSource(env.DB, {
      id: sourceId,
      project_id: project.id,
      type: "text",
      name: "Synthetic source",
      mime_type: "text/plain",
      size_bytes: 16,
      duration_seconds: null,
      r2_key: key,
    });
    const claim = await claimGenerationJob(env.DB, project.id);
    await env.DB.prepare("DELETE FROM job_sources WHERE job_id = ?")
      .bind(claim.jobId)
      .run();
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    await expect(
      createProviderWorkflow().run(
        {
          payload: { jobId: claim.jobId, projectId: project.id },
          timestamp: new Date(0),
          instanceId: claim.workflowInstanceId,
          workflowName: "empty-eligibility-test",
        },
        new SizeLimitedWorkflowStep() as unknown as Parameters<
          GenerationWorkflow["run"]
        >[1],
      ),
    ).rejects.toMatchObject({
      name: "provider_source_eligibility_empty",
      message: "Process extraction requires at least one eligible source.",
    });
    expect(providerFetch).not.toHaveBeenCalled();
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
