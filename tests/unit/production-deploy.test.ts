import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  productionDeployCommand,
  productionDeployEnvironment,
} from "../../scripts/installer/deploy.mjs";

const fixtureRoots: string[] = [];
const databaseId = "123e4567-e89b-42d3-a456-426614174000";
const secretNames = [
  "AUTH_PHRASE_SALT",
  "AUTH_PHRASE_VERIFIER",
  "SESSION_SIGNING_KEY",
  "OPENAI_API_KEY",
  "FEEDBACK_EXPORT_TOKEN",
];

function production(database = databaseId) {
  return {
    name: "pf-fixture-worker",
    workers_dev: true,
    vars: {
      APP_VERSION: "0.1.0",
      MOCK_AI: "false",
      MOCK_AI_DELAY_MS: "0",
    },
    secrets: { required: secretNames },
    d1_databases: [
      {
        binding: "DB",
        database_name: "pf-fixture-db",
        database_id: database,
        migrations_dir: "migrations",
      },
    ],
    r2_buckets: [{ binding: "SOURCES", bucket_name: "pf-fixture-sources" }],
    workflows: [
      {
        binding: "GENERATION_WORKFLOW",
        name: "pf-fixture-generation",
        class_name: "GenerationWorkflow",
      },
    ],
  };
}

function builtConfig(root: string, database = databaseId) {
  const canonical = production(database);
  return {
    configPath: path.join(root, "wrangler.jsonc"),
    userConfigPath: path.join(root, "wrangler.jsonc"),
    topLevelName: "bpmn-builder-v0",
    definedEnvironments: ["production"],
    targetEnvironment: "production",
    name: canonical.name,
    main: "index.js",
    assets: { directory: "../client" },
    workers_dev: true,
    vars: canonical.vars,
    secrets: canonical.secrets,
    d1_databases: canonical.d1_databases.map((binding) => ({
      ...binding,
      migrations_dir: "../../migrations",
    })),
    r2_buckets: canonical.r2_buckets,
    workflows: canonical.workflows,
    secrets_store_secrets: [],
    no_bundle: true,
  };
}

function fixture(database = databaseId) {
  const root = mkdtempSync(path.join(os.tmpdir(), "pf-built-deploy-"));
  fixtureRoots.push(root);
  mkdirSync(path.join(root, ".wrangler/deploy"), { recursive: true });
  mkdirSync(path.join(root, "build/server"), { recursive: true });
  mkdirSync(path.join(root, "build/client"), { recursive: true });
  mkdirSync(path.join(root, "migrations"));
  writeFileSync(
    path.join(root, "wrangler.jsonc"),
    JSON.stringify({
      name: "bpmn-builder-v0",
      env: { production: production(database) },
    }),
  );
  writeFileSync(
    path.join(root, ".wrangler/deploy/config.json"),
    JSON.stringify({
      configPath: "../../build/server/wrangler.json",
      auxiliaryWorkers: [],
    }),
  );
  writeFileSync(
    path.join(root, "build/server/wrangler.json"),
    JSON.stringify(builtConfig(root, database)),
  );
  writeFileSync(
    path.join(root, "build/server/index.js"),
    "export default {};\n",
  );
  const secretsFile = path.join(root, "production secrets.json");
  writeFileSync(
    secretsFile,
    JSON.stringify(Object.fromEntries(secretNames.map((name) => [name, "x"]))),
  );
  const old = new Date(1_000_000);
  const current = new Date(2_000_000);
  utimesSync(path.join(root, "wrangler.jsonc"), old, old);
  utimesSync(path.join(root, "build/server/wrangler.json"), current, current);
  return {
    root,
    secretsFile,
    state: {
      accountId: "account-fixture",
      resources: {
        worker: "pf-fixture-worker",
        database: "pf-fixture-db",
        databaseId: database,
        bucket: "pf-fixture-sources",
        workflow: "pf-fixture-generation",
      },
    },
  };
}

type BuiltConfig = ReturnType<typeof builtConfig>;
type InstallerStateFixture = {
  accountId: string;
  resources: {
    worker: string;
    database: string;
    databaseId: string;
    bucket: string;
    workflow: string;
  };
};

function rewriteArtifact(
  root: string,
  mutate: (artifact: BuiltConfig) => void,
) {
  const file = path.join(root, "build/server/wrangler.json");
  const artifact = JSON.parse(readFileSync(file, "utf8")) as BuiltConfig;
  mutate(artifact);
  writeFileSync(file, JSON.stringify(artifact));
  const current = new Date(2_000_000);
  utimesSync(file, current, current);
}

const artifactMismatches: Array<[string, (artifact: BuiltConfig) => void]> = [
  ["Worker", (artifact) => (artifact.name = "pf-other-worker")],
  ["D1 binding", (artifact) => (artifact.d1_databases[0].binding = "OTHER")],
  [
    "D1 name",
    (artifact) => (artifact.d1_databases[0].database_name = "pf-other-db"),
  ],
  [
    "D1 UUID",
    (artifact) =>
      (artifact.d1_databases[0].database_id =
        "223e4567-e89b-42d3-a456-426614174000"),
  ],
  ["R2 binding", (artifact) => (artifact.r2_buckets[0].binding = "OTHER")],
  [
    "R2 bucket",
    (artifact) => (artifact.r2_buckets[0].bucket_name = "pf-other-sources"),
  ],
  ["Workflow binding", (artifact) => (artifact.workflows[0].binding = "OTHER")],
  [
    "Workflow name",
    (artifact) => (artifact.workflows[0].name = "pf-other-generation"),
  ],
  [
    "Workflow class",
    (artifact) => (artifact.workflows[0].class_name = "OtherWorkflow"),
  ],
];

const installerStateMismatches: Array<
  [string, (state: InstallerStateFixture) => void]
> = [
  ["worker", (state) => (state.resources.worker = "pf-other-worker")],
  ["D1 name", (state) => (state.resources.database = "pf-other-db")],
  [
    "D1 UUID",
    (state) =>
      (state.resources.databaseId = "223e4567-e89b-42d3-a456-426614174000"),
  ],
  ["R2 bucket", (state) => (state.resources.bucket = "pf-other-sources")],
  ["Workflow", (state) => (state.resources.workflow = "pf-other-generation")],
];

afterEach(() => {
  for (const root of fixtureRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("production deploy config selection", () => {
  it("selects the built entry without re-applying the production environment", async () => {
    const { root, secretsFile, state } = fixture();
    const selected = await productionDeployCommand({
      checkout: root,
      secretsFile,
      installerState: state,
    });

    expect(selected.workerName).toBe("pf-fixture-worker");
    expect(selected.args).toEqual([
      "deploy",
      "--strict",
      "--config",
      path.join(root, "build/server/wrangler.json"),
      "--secrets-file",
      secretsFile,
    ]);
    expect(selected.args).not.toContain("--env");
    expect(selected.workerName).not.toBe("pf-fixture-worker-production");
  });

  it("uses the same built entry for dry-run with only the dry-run flag added", async () => {
    const { root, secretsFile } = fixture();
    const real = await productionDeployCommand({ checkout: root, secretsFile });
    const dryRun = await productionDeployCommand({
      checkout: root,
      secretsFile,
      dryRun: true,
    });

    expect(dryRun.args).toEqual([...real.args, "--dry-run"]);
  });

  it("permits the neutral template and no secret payload for dry-run only", async () => {
    const { root } = fixture("00000000-0000-0000-0000-000000000000");
    const selected = await productionDeployCommand({
      checkout: root,
      dryRun: true,
    });
    expect(selected.args).toEqual([
      "deploy",
      "--strict",
      "--config",
      path.join(root, "build/server/wrangler.json"),
      "--dry-run",
    ]);
  });

  it("rejects a template D1 UUID for a real deploy", async () => {
    const { root, secretsFile } = fixture(
      "00000000-0000-0000-0000-000000000000",
    );
    await expect(
      productionDeployCommand({ checkout: root, secretsFile }),
    ).rejects.toThrow(/template/iu);
  });

  it.each(artifactMismatches)(
    "rejects a cross-resource %s mismatch",
    async (_label, mutate) => {
      const { root } = fixture();
      rewriteArtifact(root, mutate);
      await expect(
        productionDeployCommand({ checkout: root, dryRun: true }),
      ).rejects.toThrow(/match canonical/iu);
    },
  );

  it.each(installerStateMismatches)(
    "rejects an installer-state %s mismatch",
    async (_label, mutate) => {
      const { root, secretsFile, state } = fixture();
      mutate(state);
      await expect(
        productionDeployCommand({
          checkout: root,
          secretsFile,
          installerState: state,
        }),
      ).rejects.toThrow(/installer-owned/iu);
    },
  );

  it("rejects malformed and stale generated configs", async () => {
    const malformed = fixture();
    writeFileSync(
      path.join(malformed.root, "build/server/wrangler.json"),
      "not json",
    );
    await expect(
      productionDeployCommand({ checkout: malformed.root, dryRun: true }),
    ).rejects.toThrow(/malformed/iu);

    const stale = fixture();
    const newer = new Date(3_000_000);
    utimesSync(path.join(stale.root, "wrangler.jsonc"), newer, newer);
    await expect(
      productionDeployCommand({ checkout: stale.root, dryRun: true }),
    ).rejects.toThrow(/stale/iu);
  });

  it("rejects redirect and generated artifact escapes", async () => {
    const redirected = fixture();
    writeFileSync(
      path.join(redirected.root, ".wrangler/deploy/config.json"),
      JSON.stringify({
        configPath: "../../../outside.json",
        auxiliaryWorkers: [],
      }),
    );
    await expect(
      productionDeployCommand({ checkout: redirected.root, dryRun: true }),
    ).rejects.toThrow(/redirect/iu);

    const linkedConfig = fixture();
    const externalConfig = path.join(linkedConfig.root, "outside-config.json");
    writeFileSync(
      externalConfig,
      JSON.stringify(builtConfig(linkedConfig.root)),
    );
    rmSync(path.join(linkedConfig.root, "build/server/wrangler.json"));
    symlinkSync(
      externalConfig,
      path.join(linkedConfig.root, "build/server/wrangler.json"),
    );
    await expect(
      productionDeployCommand({ checkout: linkedConfig.root, dryRun: true }),
    ).rejects.toThrow(/symlink/iu);

    const linkedMain = fixture();
    const externalMain = path.join(linkedMain.root, "outside-main.js");
    writeFileSync(externalMain, "export default {};\n");
    rmSync(path.join(linkedMain.root, "build/server/index.js"));
    symlinkSync(
      externalMain,
      path.join(linkedMain.root, "build/server/index.js"),
    );
    await expect(
      productionDeployCommand({ checkout: linkedMain.root, dryRun: true }),
    ).rejects.toThrow(/symlink/iu);

    const linkedAssets = fixture();
    const externalAssets = path.join(linkedAssets.root, "outside-assets");
    mkdirSync(externalAssets);
    rmSync(path.join(linkedAssets.root, "build/client"), { recursive: true });
    symlinkSync(
      externalAssets,
      path.join(linkedAssets.root, "build/client"),
      "dir",
    );
    await expect(
      productionDeployCommand({ checkout: linkedAssets.root, dryRun: true }),
    ).rejects.toThrow(/symlink/iu);
  });

  it("preserves account, token, and output propagation while clearing build-time env selection", () => {
    const environment = productionDeployEnvironment({
      PATH: "/fixture/bin",
      CLOUDFLARE_API_TOKEN: "token-canary",
      CLOUDFLARE_ACCOUNT_ID: "account-canary",
      WRANGLER_OUTPUT_FILE_PATH: "/fixture/output.ndjson",
      CLOUDFLARE_ENV: "staging",
    });

    expect(environment).toEqual({
      PATH: "/fixture/bin",
      CLOUDFLARE_API_TOKEN: "token-canary",
      CLOUDFLARE_ACCOUNT_ID: "account-canary",
      WRANGLER_OUTPUT_FILE_PATH: "/fixture/output.ndjson",
    });
  });
});
