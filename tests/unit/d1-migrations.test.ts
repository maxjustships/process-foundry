import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const wranglerPath = path.join(
  repositoryRoot,
  "node_modules",
  ".bin",
  "wrangler",
);
const temporaryRoots: string[] = [];

async function runWrangler(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(wranglerPath, args, {
    cwd: repositoryRoot,
    env: { ...process.env, CI: "true" },
  });
  return stdout;
}

async function stageMigration(root: string, filename: string): Promise<void> {
  await copyFile(
    path.join(repositoryRoot, "migrations", filename),
    path.join(root, "migrations", filename),
  );
}

describe("configured local D1 migrations", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })),
    );
  });

  it("preserves a populated graph through additive 0005 with a constrained legacy locale", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bpmn-d1-migration-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, "migrations"));
    const configPath = path.join(root, "wrangler.jsonc");
    const persistencePath = path.join(root, "state");
    await writeFile(
      configPath,
      JSON.stringify({
        name: "bpmn-migration-regression",
        main: path.join(repositoryRoot, "workers", "app.ts"),
        compatibility_date: "2026-08-18",
        d1_databases: [
          {
            binding: "DB",
            database_name: "bpmn-builder-v0",
            database_id: "00000000-0000-0000-0000-000000000001",
            migrations_dir: "migrations",
          },
        ],
      }),
    );
    await stageMigration(root, "0001_initial.sql");
    await stageMigration(root, "0002_review_clarifications.sql");
    await runWrangler([
      "d1",
      "migrations",
      "apply",
      "bpmn-builder-v0",
      "--local",
      "--persist-to",
      persistencePath,
      "--config",
      configPath,
    ]);

    const fixturePath = path.join(root, "populated-graph.sql");
    await writeFile(
      fixturePath,
      `INSERT INTO projects (id, title, status, active_job_id, created_at, updated_at)
VALUES ('project-1', 'Migration graph', 'active', 'job-1', '2026-08-26T00:00:00.000Z', '2026-08-26T00:00:00.000Z');
INSERT INTO sources (id, project_id, type, name, mime_type, size_bytes, r2_key, created_at)
VALUES ('source-1', 'project-1', 'correction', 'Answer', 'text/plain', 6, 'projects/project-1/sources/source-1.txt', '2026-08-26T00:00:00.000Z');
INSERT INTO jobs (id, project_id, workflow_instance_id, status, model_provider, model_name, prompt_version, created_at, updated_at)
VALUES ('job-1', 'project-1', 'workflow-1', 'failed', 'openai', 'gpt-5.6-terra', 'extract-process/3', '2026-08-26T00:00:00.000Z', '2026-08-26T00:00:00.000Z');
INSERT INTO job_attempts (id, job_id, attempt_number, status, transport, provider, requested_model, reasoning_level, prompt_version, schema_version, compiler_version, layout_version, created_at, completed_at)
VALUES ('attempt-1', 'job-1', 1, 'failed', 'direct', 'openai', 'gpt-5.6-terra', 'high', 'extract-process/3', 'process-ir/1', 'bpmn-compiler/1', 'bpmn-layout/1', '2026-08-26T00:00:00.000Z', '2026-08-26T00:01:00.000Z');
INSERT INTO diagram_versions (id, project_id, job_id, version_number, ir_json, bpmn_xml, created_by, created_at)
VALUES ('version-1', 'project-1', 'job-1', 1, '{"title":"fixture"}', '<definitions fixture="true" />', 'ai', '2026-08-26T00:01:00.000Z');
INSERT INTO question_clarifications (id, project_id, question_version_id, question_id, source_id, status, applied_version_id, created_at, applied_at)
VALUES ('clarification-1', 'project-1', 'version-1', 'question-1', 'source-1', 'applied', 'version-1', '2026-08-26T00:02:00.000Z', '2026-08-26T00:03:00.000Z');
INSERT INTO job_sources (job_id, source_id, captured_at)
VALUES ('job-1', 'source-1', '2026-08-26T00:00:00.000Z');`,
    );
    await runWrangler([
      "d1",
      "execute",
      "bpmn-builder-v0",
      "--local",
      "--persist-to",
      persistencePath,
      "--config",
      configPath,
      "--file",
      fixturePath,
    ]);

    const repositoryConfigPath = path.join(repositoryRoot, "wrangler.jsonc");
    await runWrangler([
      "d1",
      "migrations",
      "apply",
      "bpmn-builder-v0",
      "--local",
      "--persist-to",
      persistencePath,
      "--config",
      repositoryConfigPath,
    ]);

    const verification = JSON.parse(
      await runWrangler([
        "d1",
        "execute",
        "bpmn-builder-v0",
        "--local",
        "--persist-to",
        persistencePath,
        "--config",
        repositoryConfigPath,
        "--command",
        "PRAGMA foreign_key_check; SELECT p.id AS project_id, p.active_job_id, j.id AS job_id, j.output_locale, ja.job_id AS attempt_job_id, js.job_id AS source_job_id, s.id AS source_id, dv.job_id AS version_job_id, qc.question_version_id, qc.source_id AS clarification_source_id FROM projects p JOIN jobs j ON j.project_id = p.id JOIN job_attempts ja ON ja.job_id = j.id JOIN job_sources js ON js.job_id = j.id JOIN sources s ON s.id = js.source_id AND s.project_id = p.id JOIN diagram_versions dv ON dv.job_id = j.id AND dv.project_id = p.id JOIN question_clarifications qc ON qc.question_version_id = dv.id AND qc.source_id = s.id WHERE p.id = 'project-1' AND j.id = 'job-1';",
        "--json",
      ]),
    ) as Array<{ results: Array<Record<string, unknown>> }>;

    expect(verification[0]?.results).toEqual([]);
    expect(verification[1]?.results).toEqual([
      {
        project_id: "project-1",
        active_job_id: "job-1",
        job_id: "job-1",
        output_locale: "ru",
        attempt_job_id: "job-1",
        source_job_id: "job-1",
        source_id: "source-1",
        version_job_id: "job-1",
        question_version_id: "version-1",
        clarification_source_id: "source-1",
      },
    ]);
    await expect(
      runWrangler([
        "d1",
        "execute",
        "bpmn-builder-v0",
        "--local",
        "--persist-to",
        persistencePath,
        "--config",
        repositoryConfigPath,
        "--command",
        "UPDATE jobs SET output_locale = 'fr' WHERE id = 'job-1';",
      ]),
    ).rejects.toThrow();
  }, 30_000);
});
