import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type WranglerEnvironment = {
  name?: string;
  workers_dev?: boolean;
  routes?: Array<{ pattern: string; custom_domain: boolean }>;
  vars?: Record<string, string>;
  d1_databases?: Array<Record<string, string>>;
  r2_buckets?: Array<Record<string, string>>;
  workflows?: Array<Record<string, string>>;
  secrets?: { required?: string[] };
  account_id?: string;
};

type WranglerConfig = WranglerEnvironment & {
  env?: { production?: WranglerEnvironment };
};

const root = path.resolve(import.meta.dirname, "../..");
const deployReadyGuard = fileURLToPath(
  new URL("../../scripts/assert-deploy-ready-config.mjs", import.meta.url),
);
const deployReadyGuardSource = readFileSync(deployReadyGuard, "utf8");
const wranglerSource = readFileSync(path.join(root, "wrangler.jsonc"), "utf8");
const parseWranglerConfig = (source: string) =>
  JSON.parse(
    source.replace(/^\s*\/\/.*$/gmu, "").replace(/,\s*([}\]])/gu, "$1"),
  ) as WranglerConfig;
const wrangler = parseWranglerConfig(wranglerSource);
const wranglerExampleSource = readFileSync(
  path.join(root, "wrangler.production.example.jsonc"),
  "utf8",
);
const wranglerExample = parseWranglerConfig(wranglerExampleSource);
const packageJson = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
) as { scripts: Record<string, string> };
const readme = readFileSync(path.join(root, "README.md"), "utf8");
const selfHosting = readFileSync(
  path.join(root, "docs/SELF_HOSTING.md"),
  "utf8",
);

const secretNames = [
  "AUTH_PHRASE_SALT",
  "AUTH_PHRASE_VERIFIER",
  "SESSION_SIGNING_KEY",
  "OPENAI_API_KEY",
  "FEEDBACK_EXPORT_TOKEN",
];
const templateProductionDatabaseId = "00000000-0000-0000-0000-000000000000";
const deployerProductionDatabaseId = "123e4567-e89b-42d3-a456-426614174000";
const deployProductionCommand =
  'test -n "$BPMN_BUILDER_PRODUCTION_SECRETS" && test -f "$BPMN_BUILDER_PRODUCTION_SECRETS" && test -s "$BPMN_BUILDER_PRODUCTION_SECRETS" && node scripts/assert-deploy-ready-config.mjs --secrets-file "$BPMN_BUILDER_PRODUCTION_SECRETS" && npm run build:production && CLOUDFLARE_ENV=production wrangler deploy --strict --env production --config wrangler.jsonc --secrets-file "$BPMN_BUILDER_PRODUCTION_SECRETS"';

function productionConfigFixture(
  fixtureRoot: string,
  production: WranglerEnvironment | undefined,
) {
  const configPath = path.join(fixtureRoot, "wrangler.jsonc");
  writeFileSync(
    configPath,
    JSON.stringify({ env: production ? { production } : {} }),
  );
  return configPath;
}

function prepareDeployFixture(
  fixtureRoot: string,
  production: WranglerEnvironment | undefined,
) {
  productionConfigFixture(fixtureRoot, production);
  symlinkSync(
    path.join(root, "scripts"),
    path.join(fixtureRoot, "scripts"),
    "dir",
  );
}

function deployReadyProduction(
  databaseId = deployerProductionDatabaseId,
): WranglerEnvironment {
  return {
    name: "process-foundry",
    workers_dev: true,
    vars: {
      APP_VERSION: "0.1.0",
      MOCK_AI: "false",
      MOCK_AI_DELAY_MS: "0",
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: "process-foundry-db",
        database_id: databaseId,
        migrations_dir: "migrations",
      },
    ],
    r2_buckets: [
      { binding: "SOURCES", bucket_name: "process-foundry-sources" },
    ],
    workflows: [
      {
        binding: "GENERATION_WORKFLOW",
        name: "process-foundry-generation",
        class_name: "GenerationWorkflow",
      },
    ],
    secrets: { required: secretNames },
  };
}

describe("production release configuration", () => {
  it("preserves the top-level local mock environment", () => {
    expect(wrangler.name).toBe("bpmn-builder-v0");
    expect(wrangler.workers_dev).toBeUndefined();
    expect(wrangler.routes).toBeUndefined();
    expect(wrangler.vars).toEqual({
      APP_VERSION: "0.1.0",
      MOCK_AI: "true",
      MOCK_AI_DELAY_MS: "0",
    });
    expect(wrangler.d1_databases).toEqual([
      {
        binding: "DB",
        database_name: "bpmn-builder-v0",
        database_id: "00000000-0000-0000-0000-000000000001",
        migrations_dir: "migrations",
      },
    ]);
    expect(wrangler.r2_buckets).toEqual([
      { binding: "SOURCES", bucket_name: "bpmn-builder-v0-sources" },
    ]);
    expect(wrangler.workflows).toEqual([
      {
        binding: "GENERATION_WORKFLOW",
        name: "bpmn-builder-generation",
        class_name: "GenerationWorkflow",
      },
    ]);
  });

  it("defines the exact neutral production environment", () => {
    const production = wrangler.env?.production;
    expect(production).toBeDefined();
    expect(production).toEqual({
      name: "process-foundry",
      workers_dev: true,
      vars: {
        APP_VERSION: "0.1.0",
        MOCK_AI: "false",
        MOCK_AI_DELAY_MS: "0",
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "process-foundry-production",
          database_id: "00000000-0000-0000-0000-000000000000",
          migrations_dir: "migrations",
        },
      ],
      r2_buckets: [
        {
          binding: "SOURCES",
          bucket_name: "process-foundry-production-sources",
        },
      ],
      workflows: [
        {
          binding: "GENERATION_WORKFLOW",
          name: "process-foundry-production-generation",
          class_name: "GenerationWorkflow",
        },
      ],
      secrets: { required: secretNames },
    });
    expect(production?.routes).toBeUndefined();
    expect(wranglerExample.env?.production).toEqual(production);
  });

  it("documents a neutral deployer-owned production contract", () => {
    expect(selfHosting).toContain("00000000-0000-0000-0000-000000000000");
    expect(selfHosting).toMatch(/uncommitted.*operator-owned/iu);
    expect(selfHosting).toMatch(/permitted.*build.*dry-run/isu);
    expect(selfHosting).toMatch(/must.*before.*migration.*real deploy/isu);
    expect(selfHosting).toMatch(/deploy.*guard.*enforces/isu);
  });

  it("keeps credentials and secret values out of Wrangler config", () => {
    const production = wrangler.env?.production;
    expect(production?.account_id).toBeUndefined();
    expect(production?.secrets).toEqual({ required: secretNames });
    expect(wranglerSource).not.toContain("account_id");
  });

  it("provides the literal fail-closed atomic production deploy command", () => {
    expect(deployReadyGuardSource).toContain(
      'path.resolve(process.cwd(), "wrangler.jsonc")',
    );
    expect(deployReadyGuardSource).not.toMatch(/process\.env/u);
    expect(packageJson.scripts["typegen:production"]).toBe(
      "mkdir -p .wrangler/types && wrangler types .wrangler/types/worker-configuration.production.d.ts --env production --config wrangler.jsonc && react-router typegen",
    );
    expect(packageJson.scripts["build:production"]).toBe(
      "CLOUDFLARE_ENV=production BUNDLE_CHECK_SKIP_LOCAL_SECRET_SOURCES=1 npm run build && npm run release:verify",
    );
    expect(packageJson.scripts["db:migrate:production"]).toBe(
      "wrangler d1 migrations apply DB --remote --env production --config wrangler.jsonc",
    );
    expect(packageJson.scripts["deploy:dry-run:production"]).toBe(
      "npm run build:production && CLOUDFLARE_ENV=production wrangler deploy --dry-run",
    );
    expect(packageJson.scripts["deploy:production"]).toBe(
      deployProductionCommand,
    );
    expect(packageJson.scripts["release:verify"]).toBe(
      "node scripts/verify-production-artifact.mjs",
    );

    const productionScripts = Object.entries(packageJson.scripts)
      .filter(([name]) => name.includes("production"))
      .map(([, command]) => command)
      .join("\n");
    expect(productionScripts).not.toMatch(/\.dev\.vars|\.env(?:\s|$)/u);
    expect(productionScripts).not.toMatch(/secret\s+(?:put|bulk)/u);
  });

  it("fails closed before build for every invalid secrets-file path", () => {
    expect(packageJson.scripts["deploy:production"]).toBe(
      deployProductionCommand,
    );

    const fixtureRoot = mkdtempSync(
      path.join(os.tmpdir(), "bpmn release gate "),
    );
    try {
      const emptyFile = path.join(fixtureRoot, "empty secrets file.json");
      writeFileSync(emptyFile, "");
      const invalidPaths = [
        undefined,
        "",
        path.join(fixtureRoot, "missing secrets file.json"),
        emptyFile,
      ];

      for (const secretsFile of invalidPaths) {
        const marker = path.join(fixtureRoot, "unexpected-command");
        const binDir = path.join(fixtureRoot, "bin");
        const result = spawnSync("/bin/sh", ["-c", deployProductionCommand], {
          encoding: "utf8",
          env: {
            PATH: binDir,
            ...(secretsFile === undefined
              ? {}
              : { BPMN_BUILDER_PRODUCTION_SECRETS: secretsFile }),
            RELEASE_TEST_MARKER: marker,
          },
        });

        expect(result.status).not.toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
        expect(() => readFileSync(marker, "utf8")).toThrow();
      }
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["template UUID", deployReadyProduction(templateProductionDatabaseId)],
    ["malformed UUID", deployReadyProduction("not-a-database-uuid")],
    ["missing production environment", undefined],
    [
      "workers.dev disabled",
      { ...deployReadyProduction(), workers_dev: false },
    ],
    [
      "custom routes",
      {
        ...deployReadyProduction(),
        routes: [{ pattern: "example.com", custom_domain: true }],
      },
    ],
    [
      "mock AI enabled",
      {
        ...deployReadyProduction(),
        vars: { ...deployReadyProduction().vars, MOCK_AI: "true" },
      },
    ],
  ])("rejects %s without printing config contents", (_label, production) => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "deploy guard "));
    try {
      const configPath = productionConfigFixture(fixtureRoot, production);
      const result = spawnSync(process.execPath, [deployReadyGuard], {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: process.env,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "Production deploy readiness check failed",
      );
      expect(result.stderr).not.toContain(configPath);
      expect(result.stdout).not.toContain(configPath);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("accepts a real deployer UUID", () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "deploy guard "));
    try {
      productionConfigFixture(fixtureRoot, deployReadyProduction());
      const result = spawnSync(process.execPath, [deployReadyGuard], {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: process.env,
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Production deploy config is ready");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects the template config before build or Wrangler stubs execute", () => {
    const fixtureRoot = mkdtempSync(
      path.join(os.tmpdir(), "bpmn release config gate "),
    );
    try {
      const binDir = path.join(fixtureRoot, "stub bin");
      const secretsFile = path.join(fixtureRoot, "dummy secrets file.json");
      const callsFile = path.join(fixtureRoot, "calls");
      mkdirSync(binDir);
      prepareDeployFixture(
        fixtureRoot,
        deployReadyProduction(templateProductionDatabaseId),
      );
      writeFileSync(
        secretsFile,
        JSON.stringify(
          Object.fromEntries(secretNames.map((name) => [name, "fixture"])),
        ),
      );
      for (const command of ["npm", "wrangler"]) {
        const stub = path.join(binDir, command);
        writeFileSync(
          stub,
          '#!/bin/sh\nprintf "%s\\n" "$0" >> "$RELEASE_TEST_CALLS"\n',
          { mode: 0o700 },
        );
        chmodSync(stub, 0o700);
      }
      const nodeStub = path.join(binDir, "node");
      writeFileSync(
        nodeStub,
        `#!/bin/sh\nprintf "guard:%s\\n" "$*" >> "$RELEASE_TEST_CALLS"\nexec ${JSON.stringify(process.execPath)} "$@"\n`,
        { mode: 0o700 },
      );
      chmodSync(nodeStub, 0o700);

      const result = spawnSync("/bin/sh", ["-c", deployProductionCommand], {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          BPMN_BUILDER_PRODUCTION_SECRETS: secretsFile,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          RELEASE_TEST_CALLS: callsFile,
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "Production deploy readiness check failed",
      );
      expect(readFileSync(callsFile, "utf8").split("\n")).toEqual([
        `guard:scripts/assert-deploy-ready-config.mjs --secrets-file ${secretsFile}`,
        "",
      ]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects malformed secrets before build or deployment executes", () => {
    const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "secret guard "));
    try {
      const binDir = path.join(fixtureRoot, "bin");
      const secretsFile = path.join(fixtureRoot, "incomplete.json");
      const callsFile = path.join(fixtureRoot, "calls");
      mkdirSync(binDir);
      prepareDeployFixture(fixtureRoot, deployReadyProduction());
      writeFileSync(secretsFile, '{"OPENAI_API_KEY":"canary"}');
      for (const command of ["npm", "wrangler"]) {
        writeFileSync(
          path.join(binDir, command),
          '#!/bin/sh\nprintf "%s\\n" "$0" >> "$RELEASE_TEST_CALLS"\n',
          { mode: 0o700 },
        );
      }
      writeFileSync(
        path.join(binDir, "node"),
        `#!/bin/sh\nprintf "guard:%s\\n" "$*" >> "$RELEASE_TEST_CALLS"\nexec ${JSON.stringify(process.execPath)} "$@"\n`,
        { mode: 0o700 },
      );
      const result = spawnSync("/bin/sh", ["-c", deployProductionCommand], {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          BPMN_BUILDER_PRODUCTION_SECRETS: secretsFile,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          RELEASE_TEST_CALLS: callsFile,
        },
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).not.toContain("canary");
      expect(readFileSync(callsFile, "utf8").split("\n")).toEqual([
        `guard:scripts/assert-deploy-ready-config.mjs --secrets-file ${secretsFile}`,
        "",
      ]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("quotes a nonempty secrets-file path and runs guard then build then deploy", () => {
    expect(packageJson.scripts["deploy:production"]).toBe(
      deployProductionCommand,
    );

    const fixtureRoot = mkdtempSync(
      path.join(os.tmpdir(), "bpmn release command "),
    );
    try {
      const binDir = path.join(fixtureRoot, "stub bin");
      const secretsFile = path.join(fixtureRoot, "dummy secrets file.json");
      const callsFile = path.join(fixtureRoot, "calls");
      const npmStub = path.join(binDir, "npm");
      const wranglerStub = path.join(binDir, "wrangler");
      mkdirSync(binDir);
      prepareDeployFixture(fixtureRoot, deployReadyProduction());
      writeFileSync(
        secretsFile,
        JSON.stringify(
          Object.fromEntries(secretNames.map((name) => [name, "fixture"])),
        ),
      );
      const nodeStub = path.join(binDir, "node");
      writeFileSync(
        nodeStub,
        `#!/bin/sh\nprintf "guard:%s\\n" "$*" >> "$RELEASE_TEST_CALLS"\nexec ${JSON.stringify(process.execPath)} "$@"\n`,
        { mode: 0o700 },
      );
      writeFileSync(
        npmStub,
        '#!/bin/sh\nprintf "npm:%s\\n" "$*" >> "$RELEASE_TEST_CALLS"\n',
        { mode: 0o700 },
      );
      writeFileSync(
        wranglerStub,
        '#!/bin/sh\nprintf "wrangler:%s:%s:%s:argc=%s:env=%s\\n" "$1" "$2" "$3" "$#" "$CLOUDFLARE_ENV" >> "$RELEASE_TEST_CALLS"\n',
        { mode: 0o700 },
      );
      chmodSync(npmStub, 0o700);
      chmodSync(wranglerStub, 0o700);
      chmodSync(nodeStub, 0o700);

      const result = spawnSync("/bin/sh", ["-c", deployProductionCommand], {
        cwd: fixtureRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          BPMN_BUILDER_PRODUCTION_SECRETS: secretsFile,
          PATH: `${binDir}:${process.env.PATH ?? ""}`,
          RELEASE_TEST_CALLS: callsFile,
        },
      });

      expect(result.status).toBe(0);
      expect(readFileSync(callsFile, "utf8").split("\n")).toEqual([
        `guard:scripts/assert-deploy-ready-config.mjs --secrets-file ${secretsFile}`,
        "npm:run build:production",
        "wrangler:deploy:--strict:--env:argc=8:env=production",
        "",
      ]);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("documents the exact approval order and rollback boundary", () => {
    const releaseOrder = [
      "npm ci",
      "npm run check",
      "npm run typegen:production",
      "npm run build:production",
      "npm run deploy:dry-run:production",
      "npm run db:migrate:production",
      "BPMN_BUILDER_PRODUCTION_SECRETS=path/to/secrets.json npm run deploy:production",
    ];
    let previousIndex = -1;
    for (const command of releaseOrder) {
      const index = readme.indexOf(command, previousIndex + 1);
      expect(index, `${command} is missing or out of order`).toBeGreaterThan(
        previousIndex,
      );
      previousIndex = index;
    }

    expect(readme).toContain("CLOUDFLARE_ENV=production");
    expect(readme).toContain("build/server/wrangler.json");
    expect(readme).toContain(".wrangler/deploy/config.json");
    expect(readme).toContain("original `wrangler.jsonc`");
    expect(readme).toContain("append-only D1 migrations are not rolled back");
    expect(readme).toContain(
      "code and all five secrets as one deployed version",
    );
    expect(readme).not.toMatch(/wrangler\s+--?\s*secret\s+put/u);
    for (const secretName of secretNames)
      expect(readme).not.toMatch(new RegExp(`${secretName}\\s*=`, "u"));
  });
});
