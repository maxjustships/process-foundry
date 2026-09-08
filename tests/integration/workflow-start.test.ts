import { env } from "cloudflare:workers";
import { applyD1Migrations, createExecutionContext } from "cloudflare:test";
import { RouterContextProvider } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { signSession } from "../../app/lib/auth.server";
import { cloudflareContext } from "../../app/lib/cloudflare-context";
import { addSource, createProject } from "../../app/lib/repository.server";
import { action as generateAction } from "../../app/routes/api.generate";
import { action as retryAction } from "../../app/routes/api.job-retry";

const signingKey = "integration-only-route-signing-key";

const rejectingWorkflow = {
  get: (id: string) => env.GENERATION_WORKFLOW.get(id),
  create: (): Promise<WorkflowInstance> =>
    Promise.reject(new Error("synthetic workflow create rejection")),
  createBatch: (): Promise<WorkflowInstance[]> => Promise.resolve([]),
  deleteBatch: (): Promise<WorkflowBatchDeleteResult> =>
    Promise.resolve({ deleted: [], errors: [] }),
} satisfies Workflow<{ jobId: string; projectId: string }>;

async function routeContext(): Promise<{
  context: RouterContextProvider;
  cookie: string;
}> {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: {
      SOURCES: env.SOURCES,
      DB: env.DB,
      APP_VERSION: "0.1.0",
      MOCK_AI: "true",
      MOCK_AI_DELAY_MS: "0",
      SESSION_SIGNING_KEY: signingKey,
      GENERATION_WORKFLOW: rejectingWorkflow,
    },
    ctx: createExecutionContext(),
  });
  const session = await signSession(signingKey);
  return { context, cookie: `bpmn_session=${session.value}` };
}

describe("generation route Workflow creation compensation", () => {
  beforeEach(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  it("returns safely and restores D1 after create failures in generate and retry", async () => {
    const project = await createProject(env.DB, "Route compensation");
    const sourceId = crypto.randomUUID();
    const key = `projects/${project.id}/sources/${sourceId}.txt`;
    await env.SOURCES.put(key, "Synthetic route evidence");
    await addSource(env.DB, {
      id: sourceId,
      project_id: project.id,
      type: "text",
      name: "Route source",
      mime_type: "text/plain",
      size_bytes: 24,
      duration_seconds: null,
      r2_key: key,
    });
    const { context, cookie } = await routeContext();
    const origin = "https://workflow.test";
    const untrustedLocaleResponse = await generateAction({
      request: new Request(`${origin}/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: origin,
        },
        body: JSON.stringify({
          mode: "alternative",
          sourceIds: [sourceId],
          outputLocale: "en",
        }),
      }),
      context,
      params: { projectId: project.id },
    });
    expect(untrustedLocaleResponse.status).toBe(400);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS value FROM jobs").first(),
    ).toEqual({ value: 0 });

    const generateResponse = await generateAction({
      request: new Request(`${origin}/api/projects/${project.id}/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
          Origin: origin,
        },
        body: JSON.stringify({
          mode: "alternative",
          sourceIds: [sourceId],
        }),
      }),
      context,
      params: { projectId: project.id },
    });
    expect(generateResponse.status).toBe(503);
    const failed = await env.DB.prepare(
      "SELECT id, workflow_instance_id, status, error_code, output_locale FROM jobs WHERE project_id = ?",
    )
      .bind(project.id)
      .first<{
        id: string;
        workflow_instance_id: string;
        status: string;
        error_code: string;
        output_locale: string;
      }>();
    expect(failed).toMatchObject({
      status: "failed",
      error_code: "workflow_create_failed",
      output_locale: "ru",
    });

    const retryResponse = await retryAction({
      request: new Request(`${origin}/api/jobs/${failed!.id}/retry`, {
        method: "POST",
        headers: {
          Cookie: `${cookie}; bpmn_locale=en`,
          Origin: origin,
        },
      }),
      context,
      params: { jobId: failed!.id },
    });
    expect(retryResponse.status).toBe(503);
    const retried = await env.DB.prepare(
      "SELECT status, error_code, workflow_instance_id, output_locale FROM jobs WHERE id = ?",
    )
      .bind(failed!.id)
      .first<{
        status: string;
        error_code: string;
        workflow_instance_id: string;
        output_locale: string;
      }>();
    expect(retried).toMatchObject({
      status: "failed",
      error_code: "workflow_create_failed",
      output_locale: "ru",
    });
    expect(retried?.workflow_instance_id).not.toBe(
      failed!.workflow_instance_id,
    );
    expect(
      await env.DB.prepare(
        "SELECT status, active_job_id FROM projects WHERE id = ?",
      )
        .bind(project.id)
        .first(),
    ).toEqual({ status: "active", active_job_id: failed!.id });
  });
});
