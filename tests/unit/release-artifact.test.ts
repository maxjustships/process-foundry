import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const verifier = fileURLToPath(
  new URL("../../scripts/verify-production-artifact.mjs", import.meta.url),
);
const fixtureRoots: string[] = [];
const requiredSecretNames = [
  "AUTH_PHRASE_SALT",
  "AUTH_PHRASE_VERIFIER",
  "SESSION_SIGNING_KEY",
  "OPENAI_API_KEY",
  "FEEDBACK_EXPORT_TOKEN",
];
const templateDatabaseId = "00000000-0000-0000-0000-000000000000";
const deployerDatabaseId = "123e4567-e89b-42d3-a456-426614174000";

function fixtureRoot(artifact: Record<string, unknown>) {
  const root = mkdtempSync(path.join(tmpdir(), "bpmn-release-artifact-"));
  fixtureRoots.push(root);
  mkdirSync(path.join(root, "build/server"), { recursive: true });
  writeFileSync(
    path.join(root, "build/server/wrangler.json"),
    JSON.stringify(artifact),
  );
  writeFileSync(
    path.join(root, "wrangler.jsonc"),
    JSON.stringify({
      name: "bpmn-builder-v0",
      env: {
        production: {
          name: artifact.name,
          workers_dev: true,
          vars: artifact.vars,
          secrets: artifact.secrets,
          workflows: artifact.workflows,
          r2_buckets: artifact.r2_buckets,
          d1_databases: (
            artifact.d1_databases as Array<Record<string, unknown>>
          ).map((database) => ({ ...database, migrations_dir: "migrations" })),
        },
      },
    }),
  );
  return root;
}

function productionArtifact(databaseId = templateDatabaseId) {
  return {
    topLevelName: "bpmn-builder-v0",
    definedEnvironments: ["production"],
    targetEnvironment: "production",
    name: "process-foundry",
    main: "index.js",
    workers_dev: true,
    vars: {
      APP_VERSION: "0.1.0",
      MOCK_AI: "false",
      MOCK_AI_DELAY_MS: "0",
    },
    secrets: { required: requiredSecretNames },
    workflows: [
      {
        binding: "GENERATION_WORKFLOW",
        name: "process-foundry-production-generation",
        class_name: "GenerationWorkflow",
      },
    ],
    r2_buckets: [
      {
        binding: "SOURCES",
        bucket_name: "process-foundry-production-sources",
      },
    ],
    d1_databases: [
      {
        binding: "DB",
        database_name: "process-foundry-production",
        database_id: databaseId,
        migrations_dir: "../../migrations",
      },
    ],
    secrets_store_secrets: [],
  };
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true });
});

describe("generated production deploy artifact", () => {
  it("accepts the exact production contract with the template UUID", () => {
    const result = spawnSync(process.execPath, [verifier], {
      cwd: fixtureRoot(productionArtifact()),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Production deploy artifact verified");
  });

  it("accepts the exact production contract with a deployer UUID", () => {
    const result = spawnSync(process.execPath, [verifier], {
      cwd: fixtureRoot(productionArtifact(deployerDatabaseId)),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Production deploy artifact verified");
  });

  it("rejects a malformed D1 UUID", () => {
    const result = spawnSync(process.execPath, [verifier], {
      cwd: fixtureRoot(productionArtifact("not-a-database-uuid")),
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("D1 UUID");
  });

  it("accepts unique installer names when artifact and canonical config agree", () => {
    const artifact = productionArtifact(deployerDatabaseId);
    artifact.name = "pf-acme-abcdefghijkl";
    artifact.d1_databases[0].database_name = "pf-acme-abcdefghijkl-db";
    artifact.r2_buckets[0].bucket_name = "pf-acme-abcdefghijkl-sources";
    artifact.workflows[0].name = "pf-acme-abcdefghijkl-generation";
    const result = spawnSync(process.execPath, [verifier], {
      cwd: fixtureRoot(artifact),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
  });

  it("rejects custom-domain routing", () => {
    const artifact = {
      ...productionArtifact(),
      workers_dev: false,
      routes: [{ pattern: "example.com", custom_domain: true }],
    };
    const result = spawnSync(process.execPath, [verifier], {
      cwd: fixtureRoot(artifact),
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("workers.dev routing");
  });

  it("rejects a local mock artifact", () => {
    const artifact = productionArtifact();
    artifact.vars.MOCK_AI = "true";
    const result = spawnSync(process.execPath, [verifier], {
      cwd: fixtureRoot(artifact),
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("production AI mode");
  });

  it("rejects secret configuration without echoing a value", () => {
    const secretValue = "test-only-release-secret-payload-682cce20";
    const artifact = {
      ...productionArtifact(),
      vars: {
        ...productionArtifact().vars,
        SESSION_SIGNING_KEY: secretValue,
      },
    };
    const result = spawnSync(process.execPath, [verifier], {
      cwd: fixtureRoot(artifact),
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("secret configuration");
    expect(result.stderr).not.toContain(secretValue);
    expect(result.stdout).not.toContain(secretValue);
  });

  it("rejects an incomplete required-secret declaration", () => {
    const artifact = productionArtifact();
    artifact.secrets.required = requiredSecretNames.slice(0, -1);
    const result = spawnSync(process.execPath, [verifier], {
      cwd: fixtureRoot(artifact),
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("required secret names");
  });
});
