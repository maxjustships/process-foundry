import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deriveAuthValues,
  normalizeAuthPhrase,
} from "../../scripts/auth-values.mjs";
import {
  archiveUrl,
  bootstrap,
  parseBootstrapArgs,
  PUBLIC_REPOSITORY,
} from "../../scripts/bootstrap.mjs";
import {
  assertNoCollisions,
  parseCreatedDatabaseId,
  parseWhoami,
} from "../../scripts/installer/cloudflare.mjs";
import { installationNames } from "../../scripts/installer/names.mjs";
import {
  CommandError,
  redactText,
  safeChildEnvironment,
} from "../../scripts/installer/runner.mjs";
import {
  validateSecretsObject,
  writeSecretsFile,
} from "../../scripts/installer/secrets.mjs";
import { installerPaths, readState } from "../../scripts/installer/state.mjs";
import { runInstaller } from "../../scripts/install.mjs";

const fixtureRoots: string[] = [];
const tokenCanary = "cf-token-canary-f20ad6f4";
const providerCanary = "openai-key-canary-00de7301";
const phraseCanary = "mnemonic phrase canary 90dc61";
const databaseId = "123e4567-e89b-42d3-a456-426614174000";
const releaseRef = "a".repeat(40);

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "pf-installer-test-"));
  fixtureRoots.push(root);
  const checkout = path.join(root, "checkout");
  mkdirSync(checkout);
  writeFileSync(
    path.join(checkout, "wrangler.jsonc"),
    JSON.stringify({
      name: "bpmn-builder-v0",
      env: {
        production: {
          name: "process-foundry",
          workers_dev: true,
          vars: {
            APP_VERSION: "0.1.0",
            MOCK_AI: "false",
            MOCK_AI_DELAY_MS: "0",
          },
          secrets: {
            required: [
              "AUTH_PHRASE_SALT",
              "AUTH_PHRASE_VERIFIER",
              "SESSION_SIGNING_KEY",
              "OPENAI_API_KEY",
              "FEEDBACK_EXPORT_TOKEN",
            ],
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
        },
      },
    }),
  );
  return {
    root,
    checkout,
    secretsFile: path.join(root, "secrets", "production.json"),
  };
}

function prompts(secretsFile: string, confirmCreate = true) {
  let confirmCount = 0;
  let secretCount = 0;
  return {
    confirm: () => {
      confirmCount += 1;
      return Promise.resolve(confirmCount === 1 ? true : confirmCreate);
    },
    text: (message: string, options?: { defaultValue?: string }) => {
      if (message === "Installation name")
        return Promise.resolve("Acme Operations");
      if (message === "External production secrets file")
        return Promise.resolve(secretsFile);
      return Promise.resolve(options?.defaultValue ?? "");
    },
    secret: () => {
      secretCount += 1;
      return Promise.resolve(secretCount === 1 ? providerCanary : phraseCanary);
    },
  };
}

type Call = {
  command: string;
  args: string[];
  options: { cwd?: string; env?: NodeJS.ProcessEnv };
};

function successfulRunner(calls: Call[], override?: (call: Call) => unknown) {
  return (command: string, args: string[], options: Call["options"]) => {
    const call = { command, args, options };
    calls.push(call);
    const overridden = override?.(call);
    if (overridden) return overridden;
    if (args[0] === "--version") return { stdout: "4.125.0\n", stderr: "" };
    if (args[0] === "whoami")
      return {
        stdout: JSON.stringify({
          accounts: [{ accountId: "account-1", accountName: "Acme" }],
        }),
        stderr: "",
      };
    if (args[0] === "d1" && args[1] === "list")
      return { stdout: "[]", stderr: "" };
    if (args[0] === "r2" && args[2] === "list")
      return { stdout: "", stderr: "" };
    if (args[0] === "d1" && args[1] === "info")
      return {
        stdout: JSON.stringify({ name: args[2], uuid: databaseId }),
        stderr: "",
      };
    if (args[0] === "r2" && args[2] === "info")
      return { stdout: JSON.stringify({ name: args[3] }), stderr: "" };
    if (args[0] === "deployments")
      throw new CommandError("missing worker", {
        stderr: "script_not_found 10090",
      });
    if (args[0] === "d1" && args[1] === "create")
      return { stdout: `database_id = "${databaseId}"`, stderr: "" };
    if (args[0] === "deploy") {
      const config = JSON.parse(
        readFileSync(path.join(options.cwd ?? "", "wrangler.jsonc"), "utf8"),
      ) as { env: { production: { name: string } } };
      return {
        stdout: `Deployed https://${config.env.production.name}.example.workers.dev`,
        stderr: "",
      };
    }
    return { stdout: "", stderr: "" };
  };
}

type InstallerState = {
  accountId: string;
  operation: string;
  resources: {
    database: string;
    databaseId?: string;
    bucket: string;
    worker: string;
  };
  steps: Record<string, string>;
  url?: string;
};

async function createUncertainInstallation(
  checkout: string,
  secretsFile: string,
  step: "d1" | "r2" | "deploy",
) {
  await expect(
    runInstaller({
      checkout,
      args: { mode: "install", releaseRef },
      prompts: prompts(secretsFile),
      run: successfulRunner([], (call) => {
        if (
          (step === "d1" &&
            call.args[0] === "d1" &&
            call.args[1] === "create") ||
          (step === "r2" &&
            call.args[0] === "r2" &&
            call.args[2] === "create") ||
          (step === "deploy" && call.args[0] === "deploy")
        )
          throw new CommandError(`${step} fixture timeout`, {
            ambiguous: true,
          });
      }),
      fetch: () => Promise.resolve({ ok: true, status: 200 }),
    }),
  ).rejects.toThrow(/fixture timeout/u);
  return readState(installerPaths(checkout).state) as Promise<InstallerState>;
}

function workerDeployment(id = "new-deployment") {
  return {
    id,
    versions: [{ version_id: `${id}-version`, percentage: 100 }],
  };
}

function ownedWorkerFetch(
  calls: string[],
  options: { subdomain?: string; enabled?: boolean; status?: number } = {},
) {
  return (url: string | URL) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("api.cloudflare.com")) {
      if (options.status)
        return Promise.resolve({ ok: false, status: options.status });
      const result = target.includes("/scripts/")
        ? { enabled: options.enabled ?? true }
        : { subdomain: options.subdomain ?? "example" };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, result }),
      });
    }
    return Promise.resolve({ ok: true, status: 200 });
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  for (const root of fixtureRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("installer primitives", () => {
  it("derives the unchanged normalized authentication contract", async () => {
    expect(normalizeAuthPhrase("  Ｔｅｓｔ   Phrase 123  ")).toBe(
      "test phrase 123",
    );
    const values = await deriveAuthValues(
      "A sufficiently long phrase",
      Buffer.alloc(16, 7),
    );
    expect(values.AUTH_PHRASE_SALT).toBe("BwcHBwcHBwcHBwcHBwcHBw");
    expect(values.AUTH_PHRASE_VERIFIER).toHaveLength(43);
  });

  it("creates bounded unique resource names", () => {
    expect(installationNames("Acme Operations", "abcdefghijkl")).toEqual({
      root: "pf-acme-opera-abcdefghijkl",
      worker: "pf-acme-opera-abcdefghijkl",
      database: "pf-acme-opera-abcdefghijkl-db",
      bucket: "pf-acme-opera-abcdefghijkl-sources",
      workflow: "pf-acme-opera-abcdefghijkl-generation",
    });
  });

  it("requires an immutable public ref and labels fixture archives as non-live", () => {
    expect(PUBLIC_REPOSITORY).toBe("maxjustships/process-foundry");
    expect(archiveUrl(releaseRef)).toContain(
      `${PUBLIC_REPOSITORY}/tar.gz/${releaseRef}`,
    );
    expect(() => parseBootstrapArgs(["--ref", "main"])).toThrow(
      /40-character/u,
    );
    expect(parseBootstrapArgs(["--ref", releaseRef]).ref).toBe(releaseRef);
  });

  it("runs a local snapshot fixture only under the explicit non-live test gate", async () => {
    const { root } = fixture();
    const snapshot = path.join(root, "snapshot");
    const archive = path.join(root, "snapshot.tgz");
    const destination = path.join(root, "installed");
    const bin = path.join(root, "bin");
    mkdirSync(path.join(snapshot, "release", "scripts"), { recursive: true });
    mkdirSync(bin);
    writeFileSync(path.join(snapshot, "release", "proof.txt"), "fixture");
    writeFileSync(path.join(snapshot, "release", "scripts", "install.mjs"), "");
    writeFileSync(path.join(bin, "npm"), "#!/bin/sh\nexit 0\n", {
      mode: 0o700,
    });
    const packed = spawnSync("tar", [
      "-czf",
      archive,
      "-C",
      snapshot,
      "release",
    ]);
    expect(packed.status).toBe(0);
    vi.stubEnv("PF_INSTALLER_ALLOW_LOCAL_FIXTURE", "1");
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    const warning = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    let warned: boolean;
    try {
      await bootstrap({ ref: releaseRef, archive, directory: destination });
      warned = warning.mock.calls.some(([message]) =>
        /not proof of a public audited release/iu.test(String(message)),
      );
    } finally {
      warning.mockRestore();
      vi.unstubAllEnvs();
    }
    expect(readFileSync(path.join(destination, "proof.txt"), "utf8")).toBe(
      "fixture",
    );
    expect(warned).toBe(true);
  });

  it.each([1, 130])(
    "preserves a bootstrapped checkout and journal after installer exit %i",
    async (installerExit) => {
      const { root } = fixture();
      const snapshot = path.join(root, "snapshot");
      const archive = path.join(root, "snapshot.tgz");
      const destination = path.join(root, "installed checkout");
      const bin = path.join(root, "bin");
      const calls = path.join(root, "npm-calls");
      mkdirSync(path.join(snapshot, "release", "scripts"), {
        recursive: true,
      });
      mkdirSync(bin);
      writeFileSync(path.join(snapshot, "release", "source.txt"), "source");
      writeFileSync(
        path.join(snapshot, "release", "scripts", "install.mjs"),
        "",
      );
      writeFileSync(
        path.join(bin, "npm"),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "$PF_FIXTURE_CALLS"\nif [ "$1" = "ci" ]; then exit 0; fi\nmkdir -p .process-foundry-installer\nprintf '{"version":1,"installationId":"fixture"}\\n' > .process-foundry-installer/state.json\nexit "$PF_FIXTURE_INSTALLER_EXIT"\n`,
        { mode: 0o700 },
      );
      expect(
        spawnSync("tar", ["-czf", archive, "-C", snapshot, "release"]).status,
      ).toBe(0);
      const temporaryBefore = new Set(
        readdirSync(os.tmpdir()).filter((entry) =>
          entry.startsWith("process-foundry-bootstrap-"),
        ),
      );
      vi.stubEnv("PF_INSTALLER_ALLOW_LOCAL_FIXTURE", "1");
      vi.stubEnv("PF_FIXTURE_CALLS", calls);
      vi.stubEnv("PF_FIXTURE_INSTALLER_EXIT", String(installerExit));
      vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);

      let failure: unknown;
      try {
        await bootstrap({ ref: releaseRef, archive, directory: destination });
      } catch (error) {
        failure = error;
      } finally {
        vi.unstubAllEnvs();
      }

      expect(String((failure as Error)?.message)).toContain(destination);
      expect(String((failure as Error)?.message)).toContain(
        "npm run installer:resume",
      );
      expect(readFileSync(path.join(destination, "source.txt"), "utf8")).toBe(
        "source",
      );
      expect(
        readFileSync(
          path.join(destination, ".process-foundry-installer", "state.json"),
          "utf8",
        ),
      ).toContain('"installationId":"fixture"');
      expect(readFileSync(calls, "utf8")).not.toMatch(
        /delete|destroy|remove/iu,
      );
      expect(
        readdirSync(os.tmpdir()).filter(
          (entry) =>
            entry.startsWith("process-foundry-bootstrap-") &&
            !temporaryBefore.has(entry),
        ),
      ).toEqual([]);
    },
  );

  it("never touches a destination that already exists", async () => {
    const { root } = fixture();
    const destination = path.join(root, "existing destination");
    mkdirSync(destination);
    writeFileSync(path.join(destination, "sentinel"), "keep");
    await expect(
      bootstrap({
        ref: releaseRef,
        archive: path.join(root, "unused.tgz"),
        directory: destination,
      }),
    ).rejects.toThrow(/already exists/u);
    expect(readFileSync(path.join(destination, "sentinel"), "utf8")).toBe(
      "keep",
    );
  });

  it("matches the installed Wrangler 4.125.0 help contract", () => {
    const wrangler = path.resolve("node_modules/.bin/wrangler");
    const version = spawnSync(wrangler, ["--version"], { encoding: "utf8" });
    const whoami = spawnSync(wrangler, ["whoami", "--help"], {
      encoding: "utf8",
    });
    const deploy = spawnSync(wrangler, ["deploy", "--help"], {
      encoding: "utf8",
    });
    const d1Info = spawnSync(wrangler, ["d1", "info", "--help"], {
      encoding: "utf8",
    });
    const r2Info = spawnSync(wrangler, ["r2", "bucket", "info", "--help"], {
      encoding: "utf8",
    });
    const deployments = spawnSync(wrangler, ["deployments", "list", "--help"], {
      encoding: "utf8",
    });
    expect(version.stdout.trim()).toBe("4.125.0");
    expect(whoami.stdout).toContain("--json");
    expect(deploy.stdout).toContain("--secrets-file");
    expect(deploy.stdout).toContain("--strict");
    expect(d1Info.stdout).toContain("--json");
    expect(r2Info.stdout).toContain("--json");
    expect(deployments.stdout).toContain("--name");
    expect(deployments.stdout).toContain("--json");
  }, 15_000);

  it("parses actual Wrangler JSON shapes and refuses collisions", () => {
    expect(
      parseWhoami(
        JSON.stringify({
          accounts: [{ accountId: "id", accountName: "name" }],
        }),
      ),
    ).toEqual([{ id: "id", name: "name" }]);
    expect(parseCreatedDatabaseId(`created ${databaseId}`)).toBe(databaseId);
    expect(() =>
      assertNoCollisions(
        {
          databases: [{ name: "target-db" }],
          buckets: "",
          workerDeployments: [],
        },
        { database: "target-db", bucket: "target-sources", worker: "target" },
      ),
    ).toThrow(/will not be adopted/u);
    expect(() =>
      assertNoCollisions(
        {
          databases: [],
          buckets: "",
          workerExists: true,
          workerDeployments: [],
        },
        { database: "target-db", bucket: "target-sources", worker: "target" },
      ),
    ).toThrow(/will not be overwritten/u);
  });

  it("keeps application secrets out of generic child environments and redacts output", () => {
    const env = safeChildEnvironment({
      OPENAI_API_KEY: providerCanary,
      SESSION_SIGNING_KEY: phraseCanary,
      SAFE: "yes",
    });
    expect(env).toEqual({ SAFE: "yes" });
    expect(
      redactText(`${providerCanary} ${phraseCanary}`, [
        providerCanary,
        phraseCanary,
      ]),
    ).toBe("[REDACTED] [REDACTED]");
  });

  it("writes only exact secrets outside checkout with 0700/0600 modes", async () => {
    const { checkout, secretsFile } = fixture();
    const secrets = Object.fromEntries(
      [
        "AUTH_PHRASE_SALT",
        "AUTH_PHRASE_VERIFIER",
        "SESSION_SIGNING_KEY",
        "OPENAI_API_KEY",
        "FEEDBACK_EXPORT_TOKEN",
      ].map((name) => [name, "canary"]),
    );
    validateSecretsObject(secrets);
    await writeSecretsFile(secretsFile, secrets, checkout);
    expect(statSync(path.dirname(secretsFile)).mode & 0o777).toBe(0o700);
    expect(statSync(secretsFile).mode & 0o777).toBe(0o600);
    await expect(
      writeSecretsFile(secretsFile, secrets, checkout),
    ).rejects.toThrow(/will not be overwritten/u);
    await expect(
      writeSecretsFile(path.join(checkout, "bad.json"), secrets, checkout),
    ).rejects.toThrow(/outside/u);
  });

  it("rejects physical paths and symlinks that could write into the checkout", async () => {
    const { root, checkout } = fixture();
    const secrets = Object.fromEntries(
      [
        "AUTH_PHRASE_SALT",
        "AUTH_PHRASE_VERIFIER",
        "SESSION_SIGNING_KEY",
        "OPENAI_API_KEY",
        "FEEDBACK_EXPORT_TOKEN",
      ].map((name) => [name, "fixture-only"]),
    );
    const outsideLink = path.join(root, "outside-link");
    symlinkSync(checkout, outsideLink, "dir");
    const destination = path.join(outsideLink, "should-not-exist.json");

    await expect(
      writeSecretsFile(destination, secrets, checkout),
    ).rejects.toThrow(/symlink|outside|physical/iu);
    expect(existsSync(path.join(checkout, "should-not-exist.json"))).toBe(
      false,
    );
  });

  it("does not follow predictable temporary or destination symlinks", async () => {
    const { root, checkout, secretsFile } = fixture();
    const secrets = Object.fromEntries(
      [
        "AUTH_PHRASE_SALT",
        "AUTH_PHRASE_VERIFIER",
        "SESSION_SIGNING_KEY",
        "OPENAI_API_KEY",
        "FEEDBACK_EXPORT_TOKEN",
      ].map((name) => [name, "fixture-only"]),
    );
    mkdirSync(path.dirname(secretsFile), { mode: 0o700 });
    const victim = path.join(checkout, "victim.txt");
    writeFileSync(victim, "untouched");
    const predictableTemporary = `${secretsFile}.${process.pid}.tmp`;
    symlinkSync(victim, predictableTemporary);

    await writeSecretsFile(secretsFile, secrets, checkout);
    expect(readFileSync(victim, "utf8")).toBe("untouched");
    expect(lstatSync(secretsFile).isFile()).toBe(true);
    expect(lstatSync(secretsFile).isSymbolicLink()).toBe(false);

    const linkedDestination = path.join(root, "secrets", "linked.json");
    symlinkSync(victim, linkedDestination);
    await expect(
      writeSecretsFile(linkedDestination, secrets, checkout),
    ).rejects.toThrow(/exists|symlink|regular file/iu);
    expect(readFileSync(victim, "utf8")).toBe("untouched");
  });

  it("requires a dedicated private parent and supports spaces without chmod side effects", async () => {
    const { root, checkout } = fixture();
    const secrets = Object.fromEntries(
      [
        "AUTH_PHRASE_SALT",
        "AUTH_PHRASE_VERIFIER",
        "SESSION_SIGNING_KEY",
        "OPENAI_API_KEY",
        "FEEDBACK_EXPORT_TOKEN",
      ].map((name) => [name, "fixture-only"]),
    );
    const unsafeParent = path.join(root, "shared parent");
    mkdirSync(unsafeParent, { mode: 0o755 });
    chmodSync(unsafeParent, 0o755);
    await expect(
      writeSecretsFile(
        path.join(unsafeParent, "secrets.json"),
        secrets,
        checkout,
      ),
    ).rejects.toThrow(/dedicated private directory|0700/iu);
    expect(statSync(unsafeParent).mode & 0o777).toBe(0o755);

    const spacedFile = path.join(
      root,
      "dedicated private secrets",
      "production secrets.json",
    );
    await writeSecretsFile(spacedFile, secrets, checkout);
    expect(statSync(path.dirname(spacedFile)).mode & 0o777).toBe(0o700);
    expect(statSync(spacedFile).mode & 0o777).toBe(0o600);

    const directoryInput = path.join(root, "directory input");
    mkdirSync(directoryInput, { mode: 0o700 });
    await expect(
      writeSecretsFile(directoryInput, secrets, checkout),
    ).rejects.toThrow(/directory|will not be overwritten/iu);
  });

  it("cleans an exclusive temporary secret after a write failure", async () => {
    const { root, checkout } = fixture();
    const directory = path.join(root, "private secrets");
    const destination = path.join(directory, "production.json");
    let reads = 0;
    const secrets = Object.fromEntries(
      [
        "AUTH_PHRASE_SALT",
        "AUTH_PHRASE_VERIFIER",
        "SESSION_SIGNING_KEY",
        "OPENAI_API_KEY",
        "FEEDBACK_EXPORT_TOKEN",
      ].map((name) => [name, "fixture-only"]),
    );
    Object.defineProperty(secrets, "OPENAI_API_KEY", {
      enumerable: true,
      get() {
        reads += 1;
        if (reads > 2) throw new Error("fixture serialization failure");
        return "fixture-only";
      },
    });

    await expect(
      writeSecretsFile(destination, secrets, checkout),
    ).rejects.toThrow(/fixture serialization failure/u);
    expect(existsSync(destination)).toBe(false);
    expect(readdirSync(directory)).toEqual([]);
  });
});

describe("installer state machine", () => {
  it("pins every selected-account operation despite a conflicting inherited account", async () => {
    const { checkout, secretsFile } = fixture();
    process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
    process.env.CLOUDFLARE_ACCOUNT_ID = "wrong-inherited-account";
    const calls: Call[] = [];
    const accountPrompts = prompts(secretsFile);
    const baseText = accountPrompts.text;
    accountPrompts.text = (
      message: string,
      options?: { defaultValue?: string },
    ) =>
      message.startsWith("Cloudflare account")
        ? Promise.resolve("chosen-account")
        : baseText(message, options);
    await runInstaller({
      checkout,
      args: { mode: "install", releaseRef },
      prompts: accountPrompts,
      run: successfulRunner(calls, (call) => {
        if (call.args[0] === "whoami")
          return {
            stdout: JSON.stringify({
              accounts: [
                { accountId: "wrong-inherited-account", accountName: "Wrong" },
                { accountId: "chosen-account", accountName: "Chosen" },
              ],
            }),
            stderr: "",
          };
      }),
      fetch: () => Promise.resolve({ ok: true, status: 200 }),
    });

    const whoami = calls.find((call) => call.args[0] === "whoami");
    expect(whoami?.options.env?.CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
    for (const call of calls.filter(
      (candidate) =>
        candidate.command === "wrangler" &&
        candidate.args[0] !== "--version" &&
        candidate.args[0] !== "whoami",
    ))
      expect(call.options.env?.CLOUDFLARE_ACCOUNT_ID).toBe("chosen-account");
  });

  it("installs once, uses the canonical config, and leaks no canaries", async () => {
    const { checkout, secretsFile } = fixture();
    process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
    const calls: Call[] = [];
    const receipt = await runInstaller({
      checkout,
      args: { mode: "install", releaseRef },
      prompts: prompts(secretsFile),
      run: successfulRunner(calls),
      fetch: () => Promise.resolve({ ok: true, status: 200 }),
    });
    const state = (await readState(installerPaths(checkout).state)) as {
      steps: Record<string, string>;
    };
    expect(state.steps).toMatchObject({
      d1: "complete",
      r2: "complete",
      migrations: "complete",
      deploy: "complete",
      health: "complete",
    });
    expect(receipt.url).toContain("workers.dev");
    const persisted = `${readFileSync(installerPaths(checkout).state, "utf8")}${readFileSync(installerPaths(checkout).receipt, "utf8")}${readFileSync(path.join(checkout, "wrangler.jsonc"), "utf8")}`;
    expect(persisted).not.toContain(tokenCanary);
    expect(persisted).not.toContain(providerCanary);
    expect(persisted).not.toContain(phraseCanary);
    const serializedCalls = JSON.stringify(
      calls.map(({ command, args }) => ({ command, args })),
    );
    expect(serializedCalls).not.toContain(tokenCanary);
    expect(serializedCalls).not.toContain(providerCanary);
    expect(serializedCalls).not.toContain(phraseCanary);
    for (const call of calls) {
      if (call.options.env?.CLOUDFLARE_API_TOKEN)
        expect(call.command).toBe("wrangler");
    }
  });

  it("cancels before confirmation without a remote mutation or journal", async () => {
    const { checkout, secretsFile } = fixture();
    process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
    const calls: Call[] = [];
    await expect(
      runInstaller({
        checkout,
        args: { mode: "install", releaseRef },
        prompts: prompts(secretsFile, false),
        run: successfulRunner(calls),
        fetch: () => Promise.resolve({ ok: true, status: 200 }),
      }),
    ).rejects.toThrow(/cancelled/u);
    expect(
      calls.some((call) => call.args[0] === "d1" && call.args[1] === "create"),
    ).toBe(false);
    expect(existsSync(installerPaths(checkout).state)).toBe(false);
  });

  it("fails authentication and provider validation before mutations", async () => {
    for (const failure of ["auth", "provider"] as const) {
      const { checkout, secretsFile } = fixture();
      process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
      const calls: Call[] = [];
      const run = successfulRunner(calls, (call) => {
        if (failure === "auth" && call.args[0] === "whoami")
          throw new CommandError("auth failed");
      });
      await expect(
        runInstaller({
          checkout,
          args: { mode: "install", releaseRef },
          prompts: prompts(secretsFile),
          run,
          fetch: (url: string) =>
            Promise.resolve({
              ok: failure !== "provider" || url.includes("/health"),
              status: 401,
            }),
        }),
      ).rejects.toThrow(
        failure === "auth"
          ? /authentication failed/u
          : /credential validation failed/u,
      );
      expect(calls.some((call) => call.args[1] === "create")).toBe(false);
    }
  });

  it("preserves ambiguous creation state and never retries without explicit recovery", async () => {
    const { checkout, secretsFile } = fixture();
    process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
    const firstCalls: Call[] = [];
    await expect(
      runInstaller({
        checkout,
        args: { mode: "install", releaseRef },
        prompts: prompts(secretsFile),
        run: successfulRunner(firstCalls, (call) => {
          if (call.args[0] === "d1" && call.args[1] === "create")
            throw new CommandError("timeout", { ambiguous: true });
        }),
        fetch: () => Promise.resolve({ ok: true, status: 200 }),
      }),
    ).rejects.toThrow(/timeout/u);
    expect(
      (
        (await readState(installerPaths(checkout).state)) as {
          steps: Record<string, string>;
        }
      ).steps.d1,
    ).toBe("uncertain");
    const resumeCalls: Call[] = [];
    await expect(
      runInstaller({
        checkout,
        args: { mode: "resume" },
        prompts: prompts(secretsFile),
        run: successfulRunner(resumeCalls),
        fetch: () => Promise.resolve({ ok: true, status: 200 }),
      }),
    ).rejects.toThrow(/accept-created-d1/u);
    expect(
      resumeCalls.some(
        (call) => call.args[0] === "d1" && call.args[1] === "create",
      ),
    ).toBe(false);

    const acceptedCalls: Call[] = [];
    await runInstaller({
      checkout,
      args: { mode: "resume", acceptD1: databaseId },
      prompts: prompts(secretsFile),
      run: successfulRunner(acceptedCalls),
      fetch: () => Promise.resolve({ ok: true, status: 200 }),
    });
    expect(
      acceptedCalls.some(
        (call) => call.args[0] === "d1" && call.args[1] === "create",
      ),
    ).toBe(false);
    expect(
      (
        (await readState(installerPaths(checkout).state)) as {
          steps: Record<string, string>;
        }
      ).steps.health,
    ).toBe("complete");
  });

  it("does not accept a D1 UUID until the selected account returns the exact name and UUID", async () => {
    const { checkout, secretsFile } = fixture();
    process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
    await expect(
      runInstaller({
        checkout,
        args: { mode: "install", releaseRef },
        prompts: prompts(secretsFile),
        run: successfulRunner([], (call) => {
          if (call.args[0] === "d1" && call.args[1] === "create")
            throw new CommandError("timeout", { ambiguous: true });
        }),
        fetch: () => Promise.resolve({ ok: true, status: 200 }),
      }),
    ).rejects.toThrow(/timeout/u);
    const before = readFileSync(installerPaths(checkout).state, "utf8");
    const calls: Call[] = [];

    await expect(
      runInstaller({
        checkout,
        args: { mode: "resume", acceptD1: databaseId },
        prompts: prompts(secretsFile),
        run: successfulRunner(calls, (call) => {
          if (call.args[0] === "d1" && call.args[1] === "info")
            return {
              stdout: JSON.stringify({
                name: "somebody-elses-database",
                uuid: databaseId,
              }),
              stderr: "",
            };
        }),
        fetch: () => Promise.resolve({ ok: true, status: 200 }),
      }),
    ).rejects.toThrow(/exact installer-owned D1/iu);
    expect(readFileSync(installerPaths(checkout).state, "utf8")).toBe(before);
    expect(
      calls.some((call) => call.args[0] === "d1" && call.args[1] === "create"),
    ).toBe(false);
  });

  it("keeps D1 recovery uncertain when lookup fails or returns prose instead of JSON", async () => {
    for (const result of ["failed", "prose"] as const) {
      const { checkout, secretsFile } = fixture();
      process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
      await createUncertainInstallation(checkout, secretsFile, "d1");
      const before = readFileSync(installerPaths(checkout).state, "utf8");
      const calls: Call[] = [];
      await expect(
        runInstaller({
          checkout,
          args: { mode: "resume", acceptD1: databaseId },
          prompts: prompts(secretsFile),
          run: successfulRunner(calls, (call) => {
            if (call.args[0] === "d1" && call.args[1] === "info") {
              if (result === "failed")
                throw new CommandError("lookup failed", {
                  stderr: "permission denied",
                });
              return {
                stdout: `Successfully found ${databaseId}`,
                stderr: "",
              };
            }
          }),
          fetch: () => Promise.resolve({ ok: true, status: 200 }),
        }),
      ).rejects.toThrow(
        result === "failed" ? /lookup failed/u : /malformed JSON/u,
      );
      expect(readFileSync(installerPaths(checkout).state, "utf8")).toBe(before);
      expect(calls.some((call) => call.args[1] === "create")).toBe(false);
    }
  });

  it("verifies exact R2 ownership before accepting recovery", async () => {
    const { checkout, secretsFile } = fixture();
    process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
    const state = await createUncertainInstallation(
      checkout,
      secretsFile,
      "r2",
    );
    const before = readFileSync(installerPaths(checkout).state, "utf8");
    const calls: Call[] = [];
    await expect(
      runInstaller({
        checkout,
        args: { mode: "resume", acceptR2: true },
        prompts: prompts(secretsFile),
        run: successfulRunner(calls, (call) => {
          if (call.args[0] === "r2" && call.args[2] === "info")
            return {
              stdout: JSON.stringify({
                name: `${state.resources.bucket}-wrong`,
              }),
              stderr: "",
            };
        }),
        fetch: () => Promise.resolve({ ok: true, status: 200 }),
      }),
    ).rejects.toThrow(/exact installer-owned R2/iu);
    expect(readFileSync(installerPaths(checkout).state, "utf8")).toBe(before);
    expect(calls.some((call) => call.args[2] === "create")).toBe(false);

    await runInstaller({
      checkout,
      args: { mode: "resume", acceptR2: true },
      prompts: prompts(secretsFile),
      run: successfulRunner([]),
      fetch: () => Promise.resolve({ ok: true, status: 200 }),
    });
    expect(
      ((await readState(installerPaths(checkout).state)) as InstallerState)
        .steps.health,
    ).toBe("complete");
  });

  it.each(["d1", "r2"] as const)(
    "authorizes a %s retry only after a verified missing lookup",
    async (step) => {
      for (const exists of [true, false]) {
        const { checkout, secretsFile } = fixture();
        process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
        await createUncertainInstallation(checkout, secretsFile, step);
        const before = readFileSync(installerPaths(checkout).state, "utf8");
        const calls: Call[] = [];
        const attempt = runInstaller({
          checkout,
          args: { mode: "resume", retryMissing: step },
          prompts: prompts(secretsFile),
          run: successfulRunner(calls, (call) => {
            const isLookup =
              (step === "d1" &&
                call.args[0] === "d1" &&
                call.args[1] === "info") ||
              (step === "r2" &&
                call.args[0] === "r2" &&
                call.args[2] === "info");
            if (isLookup && !exists)
              throw new CommandError("verified missing", {
                stderr: "resource not found 404",
              });
          }),
          fetch: () => Promise.resolve({ ok: true, status: 200 }),
        });
        if (exists) {
          await expect(attempt).rejects.toThrow(/retry is not authorized/iu);
          expect(readFileSync(installerPaths(checkout).state, "utf8")).toBe(
            before,
          );
          expect(
            calls.some(
              (call) => call.args[0] === step && call.args.includes("create"),
            ),
          ).toBe(false);
        } else {
          await attempt;
          expect(
            calls.some((call) =>
              step === "d1"
                ? call.args[0] === "d1" && call.args[1] === "create"
                : call.args[0] === "r2" && call.args[2] === "create",
            ),
          ).toBe(true);
        }
      }
    },
  );

  it.each(["d1", "r2"] as const)(
    "rechecks completed %s identity before later recovery or mutations",
    async (resource) => {
      const { checkout, secretsFile } = fixture();
      process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
      await createUncertainInstallation(checkout, secretsFile, "deploy");
      const before = readFileSync(installerPaths(checkout).state, "utf8");
      const calls: Call[] = [];
      await expect(
        runInstaller({
          checkout,
          args: { mode: "resume" },
          prompts: prompts(secretsFile),
          run: successfulRunner(calls, (call) => {
            if (
              resource === "d1" &&
              call.args[0] === "d1" &&
              call.args[1] === "info"
            )
              return {
                stdout: JSON.stringify({
                  name: call.args[2],
                  uuid: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
                }),
                stderr: "",
              };
            if (
              resource === "r2" &&
              call.args[0] === "r2" &&
              call.args[2] === "info"
            )
              return {
                stdout: JSON.stringify({ name: `${call.args[3]}-wrong` }),
                stderr: "",
              };
          }),
          fetch: () => Promise.resolve({ ok: true, status: 200 }),
        }),
      ).rejects.toThrow(
        new RegExp(`exact installer-owned ${resource.toUpperCase()}`, "iu"),
      );
      expect(readFileSync(installerPaths(checkout).state, "utf8")).toBe(before);
      expect(
        calls.some(
          (call) =>
            call.args[0] === "deploy" ||
            (call.args[0] === "d1" && call.args[1] === "migrations"),
        ),
      ).toBe(false);
    },
  );

  it("accepts only a new deployment and the provider-derived URL for the exact Worker", async () => {
    const { checkout, secretsFile } = fixture();
    process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
    const state = await createUncertainInstallation(
      checkout,
      secretsFile,
      "deploy",
    );
    const expectedUrl = `https://${state.resources.worker}.example.workers.dev/`;
    const calls: Call[] = [];
    const fetchCalls: string[] = [];
    const receipt = await runInstaller({
      checkout,
      args: { mode: "resume", acceptDeployed: expectedUrl },
      prompts: prompts(secretsFile),
      run: successfulRunner(calls, (call) => {
        if (call.args[0] === "deployments")
          return {
            stdout: JSON.stringify([workerDeployment()]),
            stderr: "",
          };
      }),
      fetch: ownedWorkerFetch(fetchCalls),
    });
    expect(receipt.url).toBe(expectedUrl);
    expect(
      fetchCalls.filter((url) => url.includes("api.cloudflare.com")),
    ).toEqual([
      `https://api.cloudflare.com/client/v4/accounts/${state.accountId}/workers/subdomain`,
      `https://api.cloudflare.com/client/v4/accounts/${state.accountId}/workers/scripts/${state.resources.worker}/subdomain`,
    ]);
    expect(
      calls.find((call) => call.args[0] === "deployments")?.options.env
        ?.CLOUDFLARE_ACCOUNT_ID,
    ).toBe(state.accountId);
    expect(calls.some((call) => call.args[0] === "deploy")).toBe(false);
  });

  it.each([
    [
      "wrong worker",
      (worker: string) => `https://wrong-${worker}.example.workers.dev/`,
    ],
    [
      "wrong account URL",
      (worker: string) => `https://${worker}.other.workers.dev/`,
    ],
    [
      "URL path",
      (worker: string) => `https://${worker}.example.workers.dev/health`,
    ],
  ])("rejects accepted deployment with %s", async (_label, acceptedUrl) => {
    const { checkout, secretsFile } = fixture();
    process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
    const state = await createUncertainInstallation(
      checkout,
      secretsFile,
      "deploy",
    );
    const before = readFileSync(installerPaths(checkout).state, "utf8");
    const fetchCalls: string[] = [];
    await expect(
      runInstaller({
        checkout,
        args: {
          mode: "resume",
          acceptDeployed: acceptedUrl(state.resources.worker),
        },
        prompts: prompts(secretsFile),
        run: successfulRunner([], (call) => {
          if (call.args[0] === "deployments")
            return {
              stdout: JSON.stringify([workerDeployment()]),
              stderr: "",
            };
        }),
        fetch: ownedWorkerFetch(fetchCalls),
      }),
    ).rejects.toThrow(/exact workers.dev URL|does not match/iu);
    expect(readFileSync(installerPaths(checkout).state, "utf8")).toBe(before);
    expect(fetchCalls).not.toContain(acceptedUrl(state.resources.worker));
  });

  it("keeps deployment uncertain for zero deployments, malformed output, or failed provider lookup", async () => {
    for (const failure of ["zero", "malformed", "provider"] as const) {
      const { checkout, secretsFile } = fixture();
      process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
      const state = await createUncertainInstallation(
        checkout,
        secretsFile,
        "deploy",
      );
      const before = readFileSync(installerPaths(checkout).state, "utf8");
      await expect(
        runInstaller({
          checkout,
          args: {
            mode: "resume",
            acceptDeployed: `https://${state.resources.worker}.example.workers.dev/`,
          },
          prompts: prompts(secretsFile),
          run: successfulRunner([], (call) => {
            if (call.args[0] === "deployments")
              return {
                stdout:
                  failure === "zero"
                    ? "[]"
                    : failure === "malformed"
                      ? "Deployment succeeded"
                      : JSON.stringify([workerDeployment()]),
                stderr: "",
              };
          }),
          fetch: ownedWorkerFetch([], {
            status: failure === "provider" ? 503 : undefined,
          }),
        }),
      ).rejects.toThrow(
        failure === "zero"
          ? /no new deployment/iu
          : failure === "malformed"
            ? /malformed JSON/iu
            : /lookup failed/iu,
      );
      expect(readFileSync(installerPaths(checkout).state, "utf8")).toBe(before);
    }
  });

  it("retries an uncertain deploy only when the recorded target remains missing", async () => {
    for (const exists of [true, false]) {
      const { checkout, secretsFile } = fixture();
      process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
      await createUncertainInstallation(checkout, secretsFile, "deploy");
      const before = readFileSync(installerPaths(checkout).state, "utf8");
      const calls: Call[] = [];
      const attempt = runInstaller({
        checkout,
        args: { mode: "resume", retryMissing: "deploy" },
        prompts: prompts(secretsFile),
        run: successfulRunner(calls, (call) => {
          if (exists && call.args[0] === "deployments")
            return { stdout: "[]", stderr: "" };
        }),
        fetch: () => Promise.resolve({ ok: true, status: 200 }),
      });
      if (exists) {
        await expect(attempt).rejects.toThrow(/retry is not authorized/iu);
        expect(readFileSync(installerPaths(checkout).state, "utf8")).toBe(
          before,
        );
        expect(calls.some((call) => call.args[0] === "deploy")).toBe(false);
      } else {
        await attempt;
        expect(calls.some((call) => call.args[0] === "deploy")).toBe(true);
      }
    }
  });

  it("rejects recovery under an account that does not own the journal", async () => {
    const { checkout, secretsFile } = fixture();
    process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
    await createUncertainInstallation(checkout, secretsFile, "d1");
    const before = readFileSync(installerPaths(checkout).state, "utf8");
    const calls: Call[] = [];
    await expect(
      runInstaller({
        checkout,
        args: { mode: "resume", acceptD1: databaseId },
        prompts: prompts(secretsFile),
        run: successfulRunner(calls, (call) => {
          if (call.args[0] === "whoami")
            return {
              stdout: JSON.stringify({
                accounts: [
                  { accountId: "other-account", accountName: "Other" },
                ],
              }),
              stderr: "",
            };
        }),
        fetch: () => Promise.resolve({ ok: true, status: 200 }),
      }),
    ).rejects.toThrow(/does not own this installation state/iu);
    expect(readFileSync(installerPaths(checkout).state, "utf8")).toBe(before);
    expect(calls.some((call) => call.args[1] === "info")).toBe(false);
  });

  it("upgrades the same owned resources without recreating or resetting secrets", async () => {
    const { checkout, secretsFile } = fixture();
    process.env.CLOUDFLARE_API_TOKEN = tokenCanary;
    await runInstaller({
      checkout,
      args: { mode: "install", releaseRef },
      prompts: prompts(secretsFile),
      run: successfulRunner([]),
      fetch: () => Promise.resolve({ ok: true, status: 200 }),
    });
    const secretBefore = readFileSync(secretsFile, "utf8");
    const calls: Call[] = [];
    await runInstaller({
      checkout,
      args: { mode: "upgrade", releaseRef: "b".repeat(40) },
      prompts: prompts(secretsFile),
      run: successfulRunner(calls, (call) => {
        if (call.args[0] === "deployments")
          return {
            stdout: JSON.stringify([
              {
                id: "existing-deployment",
                versions: [{ version_id: "existing-version", percentage: 100 }],
              },
            ]),
            stderr: "",
          };
      }),
      fetch: (url: string | URL) => {
        const target = String(url);
        if (
          target.includes("api.cloudflare.com") &&
          target.endsWith("/workers/subdomain")
        )
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({
                success: true,
                result: { subdomain: "example" },
              }),
          });
        if (
          target.includes("api.cloudflare.com") &&
          target.includes("/scripts/")
        )
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve({ success: true, result: { enabled: true } }),
          });
        return Promise.resolve({ ok: true, status: 200 });
      },
    });
    expect(
      calls.some((call) => call.args[0] === "d1" && call.args[1] === "create"),
    ).toBe(false);
    expect(
      calls.some((call) => call.args[0] === "r2" && call.args[2] === "create"),
    ).toBe(false);
    expect(readFileSync(secretsFile, "utf8")).toBe(secretBefore);
  });
});

describe("masked terminal input", () => {
  async function ptyRun(cancel = false) {
    const root = mkdtempSync(path.join(os.tmpdir(), "pf-prompt-pty-"));
    fixtureRoots.push(root);
    const harness = path.join(root, "harness.mjs");
    const promptUrl = pathToFileURL(
      path.resolve("scripts/installer/prompt.mjs"),
    ).href;
    writeFileSync(
      harness,
      cancel
        ? `import {promptSecret,CancelledError} from ${JSON.stringify(promptUrl)}; try { await promptSecret("Secret"); } catch (error) { if (error instanceof CancelledError) { console.log("restored="+String(!process.stdin.isRaw && !process.stdin.destroyed)); process.exitCode=130; } else throw error; }`
        : `import {promptSecret} from ${JSON.stringify(promptUrl)}; const value=await promptSecret("Secret"); console.log("length="+value.length);`,
    );
    return await new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        const child = spawn(
          "script",
          ["-qefc", `${process.execPath} ${harness}`, "/dev/null"],
          {
            stdio: ["pipe", "pipe", "pipe"],
          },
        );
        let output = "";
        let sent = false;
        const onData = (chunk: Buffer) => {
          output += chunk.toString();
          if (!sent && output.includes("Secret (input hidden):")) {
            sent = true;
            child.stdin.write(cancel ? "\u0003" : `${phraseCanary}\r`);
          }
        };
        child.stdout.on("data", onData);
        child.stderr.on(
          "data",
          (chunk: Buffer) => (output += chunk.toString()),
        );
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, output }));
      },
    );
  }

  it("does not echo a secret in a real PTY", async () => {
    const result = await ptyRun();
    expect(result.code).toBe(0);
    expect(result.output).toContain(`length=${phraseCanary.length}`);
    expect(result.output).not.toContain(phraseCanary);
  });

  it("handles Ctrl-C in a real PTY", async () => {
    const result = await ptyRun(true);
    expect(result.code).toBe(130);
    expect(result.output).toContain("restored=true");
    expect(result.output).not.toContain(phraseCanary);
  });

  it("reads sequential prompts from the same real PTY", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pf-prompt-sequence-"));
    fixtureRoots.push(root);
    const harness = path.join(root, "harness.mjs");
    const promptUrl = pathToFileURL(
      path.resolve("scripts/installer/prompt.mjs"),
    ).href;
    writeFileSync(
      harness,
      `import {promptConfirm,promptSecret,promptText} from ${JSON.stringify(promptUrl)};
const method=await promptText("Method",{defaultValue:"token-file"});
const tokenFile=await promptText("Token file");
const secret=await promptSecret("Secret");
const confirmed=await promptConfirm("Continue");
console.log("result="+JSON.stringify({method,tokenFile,secretLength:secret.length,confirmed}));`,
    );

    const result = await new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        const child = spawn(
          "script",
          ["-qefc", `${process.execPath} ${harness}`, "/dev/null"],
          { stdio: ["pipe", "pipe", "pipe"] },
        );
        const responses = [
          ["Method:", "token-file\r"],
          ["Token file:", "/tmp/fake-token\r"],
          ["Secret (input hidden):", `${phraseCanary}\r`],
          ["Continue [y/N]:", "y\r"],
        ] as const;
        let output = "";
        let responseIndex = 0;
        const onData = (chunk: Buffer) => {
          output += chunk.toString();
          const response = responses[responseIndex];
          if (response && output.includes(response[0])) {
            responseIndex += 1;
            child.stdin.write(response[1]);
          }
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, output }));
      },
    );

    expect(result.code).toBe(0);
    expect(result.output).toContain(
      `result={"method":"token-file","tokenFile":"/tmp/fake-token","secretLength":${phraseCanary.length},"confirmed":true}`,
    );
    expect(result.output).not.toContain(phraseCanary);
  });
});
