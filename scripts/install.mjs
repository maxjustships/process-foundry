#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deriveAuthValues, randomSecret } from "./auth-values.mjs";
import {
  assertNoCollisions,
  authenticateWrangler,
  inspectD1,
  inspectR2,
  inspectWorker,
  listCloudflareResources,
  parseCreatedDatabaseId,
  verifiedWorkerUrl,
  wranglerEnvironment,
} from "./installer/cloudflare.mjs";
import {
  readCanonicalConfig,
  writeInstallerConfig,
} from "./installer/config.mjs";
import { STATE_VERSION, WRANGLER_VERSION } from "./installer/constants.mjs";
import { installationNames } from "./installer/names.mjs";
import {
  CancelledError,
  promptConfirm,
  promptSecret,
  promptText,
} from "./installer/prompt.mjs";
import { runCommand, safeChildEnvironment } from "./installer/runner.mjs";
import {
  assertSecretFileModes,
  validateSecretsObject,
  writeSecretsFile,
} from "./installer/secrets.mjs";
import {
  atomicWriteJson,
  installerPaths,
  readState,
  removeTemporaryFile,
  stateExists,
} from "./installer/state.mjs";

function parseArgs(argv) {
  const result = { mode: "install" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--resume") result.mode = "resume";
    else if (argument === "--upgrade") result.mode = "upgrade";
    else if (argument === "--release-ref") result.releaseRef = argv[++index];
    else if (argument === "--accept-created-d1")
      result.acceptD1 = argv[++index];
    else if (argument === "--accept-created-r2") result.acceptR2 = true;
    else if (argument === "--accept-deployed")
      result.acceptDeployed = argv[++index];
    else if (argument === "--retry-verified-missing")
      result.retryMissing = argv[++index];
    else throw new Error(`Unknown installer option: ${argument}`);
  }
  if (result.releaseRef && !/^[0-9a-f]{40}$/iu.test(result.releaseRef))
    throw new Error("--release-ref must be a full 40-character commit SHA.");
  if (
    result.retryMissing &&
    !["d1", "r2", "deploy"].includes(result.retryMissing)
  )
    throw new Error("--retry-verified-missing must be d1, r2, or deploy.");
  return result;
}

function resolveReleaseRef(checkout, supplied, run) {
  if (supplied) return supplied.toLowerCase();
  const result = run("git", ["rev-parse", "HEAD"], {
    cwd: checkout,
    env: safeChildEnvironment(),
    label: "Release reference lookup",
  });
  const ref = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/iu.test(ref))
    throw new Error("Current checkout has no immutable commit reference.");
  return ref.toLowerCase();
}

async function cloudflareCredentials(prompts, run, checkout) {
  let token;
  if (process.env.CLOUDFLARE_API_TOKEN) {
    if (
      await prompts.confirm(
        "Use CLOUDFLARE_API_TOKEN from this process environment?",
        true,
      )
    )
      token = process.env.CLOUDFLARE_API_TOKEN;
  }
  if (!token) {
    const mode = await prompts.text(
      "Cloudflare authentication method (token-file/oauth)",
      {
        defaultValue: "token-file",
      },
    );
    if (mode === "token-file") {
      const tokenFile = path.resolve(
        await prompts.text("Cloudflare API token file"),
      );
      token = (await readFile(tokenFile, "utf8")).trim();
      if (!token) throw new Error("Cloudflare API token file is empty.");
    } else if (mode === "oauth") {
      const approved = await prompts.confirm(
        "Open explicit Wrangler OAuth login and store it in the OS keyring?",
        false,
      );
      if (!approved) throw new CancelledError();
      run("wrangler", ["login", "--use-keyring"], {
        cwd: checkout,
        env: safeChildEnvironment(),
        inherit: true,
        timeout: 300_000,
        label: "Wrangler OAuth login",
      });
    } else throw new Error("Choose token-file or oauth.");
  }
  return token;
}

function selectAccount(accounts, answer) {
  if (accounts.length === 1) return accounts[0];
  const selected = accounts.find(
    (account) => account.id === answer || account.name === answer,
  );
  if (!selected)
    throw new Error("Selected Cloudflare account was not returned by whoami.");
  return selected;
}

export async function validateProviderKey(key, fetchImpl = fetch) {
  const response = await fetchImpl("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok)
    throw new Error(
      `OpenAI credential validation failed with HTTP ${response.status}; no Cloudflare resources were changed.`,
    );
}

function deepUrl(value) {
  if (typeof value === "string") {
    const match = value.match(
      /https:\/\/[^\s"']+\.workers\.dev(?:\/[^\s"']*)?/u,
    );
    return match?.[0];
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepUrl(item);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const found = deepUrl(item);
      if (found) return found;
    }
  }
}

export function deploymentUrl(stdout, output = "") {
  for (const line of output.split(/\r?\n/gu).filter(Boolean)) {
    try {
      const found = deepUrl(JSON.parse(line));
      if (found) return found;
    } catch {
      // Wrangler's output file is NDJSON; ignore an incomplete diagnostic line.
    }
  }
  return deepUrl(stdout);
}

async function save(paths, state) {
  state.updatedAt = new Date().toISOString();
  await atomicWriteJson(paths.state, state);
}

async function markUncertain(paths, state, step, error) {
  state.steps[step] = "uncertain";
  state.recovery = `Verify ${step} in account ${state.accountId}; resume only by accepting the exact resource or explicitly retrying a verified-missing target.`;
  await save(paths, state);
  throw error;
}

function command(run, executable, args, context, label, timeout) {
  return run(executable, args, { ...context, label, timeout });
}

function requireExactD1(found, state, acceptedId = state.resources.databaseId) {
  if (
    !found.exists ||
    found.name !== state.resources.database ||
    found.id !== acceptedId
  )
    throw new Error(
      "The selected account did not return the exact installer-owned D1 name and UUID; recovery state is unchanged.",
    );
}

function requireExactR2(found, state) {
  if (!found.exists || found.name !== state.resources.bucket)
    throw new Error(
      "The selected account did not return the exact installer-owned R2 bucket; recovery state is unchanged.",
    );
}

function deploymentIds(worker) {
  return worker.deployments.map((deployment) => deployment.id);
}

function normalizedAcceptedWorkerUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch (error) {
    throw new Error("The accepted Worker URL is malformed.", { cause: error });
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.endsWith(".workers.dev")
  )
    throw new Error("The accepted Worker URL is not an exact workers.dev URL.");
  return parsed.toString();
}

function d1Lookup(checkout, token, state, run) {
  return inspectD1({
    checkout,
    token,
    accountId: state.accountId,
    database: state.resources.database,
    run,
  });
}

function r2Lookup(checkout, token, state, run) {
  return inspectR2({
    checkout,
    token,
    accountId: state.accountId,
    bucket: state.resources.bucket,
    run,
  });
}

function workerLookup(checkout, token, state, run) {
  return inspectWorker({
    checkout,
    token,
    accountId: state.accountId,
    worker: state.resources.worker,
    run,
  });
}

async function verifyCompletedResumeResources({
  checkout,
  token,
  state,
  run,
  fetchImpl,
}) {
  if (state.steps.d1 === "complete")
    requireExactD1(d1Lookup(checkout, token, state, run), state);
  if (state.steps.r2 === "complete")
    requireExactR2(r2Lookup(checkout, token, state, run), state);
  if (state.steps.deploy === "complete") {
    const worker = workerLookup(checkout, token, state, run);
    if (!worker.exists || worker.deployments.length === 0)
      throw new Error(
        "The selected account did not return the installer-owned deployed Worker; resume stopped before mutation.",
      );
    const expectedUrl = await verifiedWorkerUrl({
      accountId: state.accountId,
      worker: state.resources.worker,
      token,
      fetchImpl,
    });
    if (normalizedAcceptedWorkerUrl(state.url) !== expectedUrl)
      throw new Error(
        "The recorded Worker URL no longer matches the selected account and Worker identity.",
      );
  }
}

export async function runInstaller(dependencies = {}) {
  const checkout = dependencies.checkout ?? process.cwd();
  const run = dependencies.run ?? runCommand;
  const fetchImpl = dependencies.fetch ?? fetch;
  const prompts = dependencies.prompts ?? {
    text: promptText,
    secret: promptSecret,
    confirm: promptConfirm,
  };
  const args = dependencies.args ?? parseArgs(process.argv.slice(2));
  const paths = installerPaths(checkout);
  const configPath = path.join(checkout, "wrangler.jsonc");
  const hasState = await stateExists(paths.state);
  if (args.mode === "install" && hasState)
    throw new Error(
      "Installer state already exists. Use npm run installer:resume or installer:upgrade.",
    );
  if (args.mode !== "install" && !hasState)
    throw new Error("No installer-owned state exists for resume or upgrade.");

  const version = process.versions.node.split(".").map(Number);
  if (version[0] < 22 || (version[0] === 22 && version[1] < 22))
    throw new Error("Node.js 22.22+ or 24+ is required.");
  const wranglerVersion = command(
    run,
    "wrangler",
    ["--version"],
    {
      cwd: checkout,
      env: safeChildEnvironment(),
    },
    "Wrangler version check",
  ).stdout.trim();
  if (wranglerVersion !== WRANGLER_VERSION)
    throw new Error(
      `Locked Wrangler ${WRANGLER_VERSION} is required; found ${wranglerVersion}. Run npm ci.`,
    );

  const token = await cloudflareCredentials(prompts, run, checkout);
  let accounts;
  try {
    accounts = authenticateWrangler({ checkout, token, run });
  } catch (error) {
    throw new Error(
      `Cloudflare authentication failed. Check the selected token or explicitly rerun and choose OAuth. ${error.message}`,
      { cause: error },
    );
  }

  let state;
  let upgradeRequested = false;
  if (hasState) {
    state = await readState(paths.state);
    const account = accounts.find(
      (candidate) => candidate.id === state.accountId,
    );
    if (!account)
      throw new Error(
        "Authenticated Cloudflare account does not own this installation state.",
      );
    if (args.mode === "upgrade") {
      upgradeRequested = true;
    }
  } else {
    const answer =
      accounts.length === 1
        ? accounts[0].id
        : await prompts.text(
            `Cloudflare account (${accounts.map((account) => account.name).join(", ")})`,
          );
    const account = selectAccount(accounts, answer);
    const label = await prompts.text("Installation name", {
      defaultValue: "foundry",
    });
    const names = installationNames(label);
    const providerKey = await prompts.secret("OpenAI API key");
    await validateProviderKey(providerKey, fetchImpl);
    const phrase = await prompts.secret("Shared login phrase");
    const repeated = await prompts.secret("Repeat shared login phrase");
    if (phrase !== repeated)
      throw new Error("Shared login phrases do not match.");
    const auth = await deriveAuthValues(phrase);
    const secrets = validateSecretsObject({
      ...auth,
      SESSION_SIGNING_KEY: randomSecret(),
      OPENAI_API_KEY: providerKey,
      FEEDBACK_EXPORT_TOKEN: randomSecret(),
    });
    const listed = listCloudflareResources({
      checkout,
      token,
      accountId: account.id,
      worker: names.worker,
      run,
    });
    assertNoCollisions(listed, names);
    process.stdout.write(
      `\nResources in ${account.name}:\n  Worker: ${names.worker}\n  D1: ${names.database}\n  private R2: ${names.bucket}\n  Workflow: ${names.workflow}\n`,
    );
    if (
      !(await prompts.confirm(
        "Create these resources, apply migrations, and deploy?",
        false,
      ))
    )
      throw new CancelledError();
    const secretsDefault = path.join(
      path.dirname(checkout),
      ".process-foundry-secrets",
      `${names.root}.json`,
    );
    const secretsFile = path.resolve(
      await prompts.text("External production secrets file", {
        defaultValue: secretsDefault,
      }),
    );
    await writeSecretsFile(secretsFile, secrets, checkout);
    await assertSecretFileModes(secretsFile);
    state = {
      version: STATE_VERSION,
      installationId: randomUUID(),
      operationId: randomUUID(),
      operation: "install",
      releaseRef: resolveReleaseRef(checkout, args.releaseRef, run),
      accountId: account.id,
      accountName: account.name,
      resources: names,
      secretsFile,
      steps: { confirmed: "complete" },
      createdAt: new Date().toISOString(),
    };
    await save(paths, state);
  }

  await assertSecretFileModes(state.secretsFile);
  validateSecretsObject(JSON.parse(await readFile(state.secretsFile, "utf8")));
  if (hasState)
    await verifyCompletedResumeResources({
      checkout,
      token,
      state,
      run,
      fetchImpl,
    });
  if (upgradeRequested) {
    state.operation = "upgrade";
    state.operationId = randomUUID();
    state.releaseRef = resolveReleaseRef(checkout, args.releaseRef, run);
    state.steps = { d1: "complete", r2: "complete", config: "complete" };
    delete state.recovery;
    delete state.deployRecovery;
    await save(paths, state);
  }
  const wranglerContext = {
    cwd: checkout,
    env: wranglerEnvironment(token, state.accountId),
  };
  const localContext = { cwd: checkout, env: safeChildEnvironment() };

  if (state.steps.d1 === "uncertain" || state.steps.d1 === "creating") {
    if (args.retryMissing === "d1") {
      const found = d1Lookup(checkout, token, state, run);
      if (found.exists)
        throw new Error(
          "The exact D1 target exists in the selected account; retry is not authorized and recovery state is unchanged.",
        );
      state.steps.d1 = "pending";
      delete state.recovery;
      await save(paths, state);
    } else if (!args.acceptD1)
      throw new Error(
        "D1 creation is uncertain. Verify it in Cloudflare, then resume with --accept-created-d1 <UUID>, or --retry-verified-missing d1 only when the exact name is absent.",
      );
    else {
      const acceptedId = parseCreatedDatabaseId(args.acceptD1);
      requireExactD1(d1Lookup(checkout, token, state, run), state, acceptedId);
      state.resources.databaseId = acceptedId;
      state.steps.d1 = "complete";
      delete state.recovery;
      await save(paths, state);
    }
  }
  if (state.steps.d1 !== "complete") {
    state.steps.d1 = "creating";
    await save(paths, state);
    try {
      const created = command(
        run,
        "wrangler",
        ["d1", "create", state.resources.database],
        wranglerContext,
        "D1 creation",
      );
      state.resources.databaseId = parseCreatedDatabaseId(created.stdout);
      state.steps.d1 = "complete";
      await save(paths, state);
    } catch (error) {
      await markUncertain(paths, state, "d1", error);
    }
  }

  if (state.steps.r2 === "uncertain" || state.steps.r2 === "creating") {
    if (args.retryMissing === "r2") {
      const found = r2Lookup(checkout, token, state, run);
      if (found.exists)
        throw new Error(
          "The exact R2 target exists in the selected account; retry is not authorized and recovery state is unchanged.",
        );
      state.steps.r2 = "pending";
      delete state.recovery;
      await save(paths, state);
    } else if (!args.acceptR2)
      throw new Error(
        "R2 creation is uncertain. Verify the exact bucket in Cloudflare, then resume with --accept-created-r2, or --retry-verified-missing r2 only when the exact name is absent.",
      );
    else {
      requireExactR2(r2Lookup(checkout, token, state, run), state);
      state.steps.r2 = "complete";
      delete state.recovery;
      await save(paths, state);
    }
  }
  if (state.steps.r2 !== "complete") {
    state.steps.r2 = "creating";
    await save(paths, state);
    try {
      command(
        run,
        "wrangler",
        ["r2", "bucket", "create", state.resources.bucket],
        wranglerContext,
        "private R2 creation",
      );
      state.steps.r2 = "complete";
      await save(paths, state);
    } catch (error) {
      await markUncertain(paths, state, "r2", error);
    }
  }

  if (state.steps.config !== "complete") {
    await writeInstallerConfig(configPath, state.resources);
    state.steps.config = "complete";
    await save(paths, state);
  } else {
    const config = readCanonicalConfig(configPath);
    if (
      config.env.production.name !== state.resources.worker ||
      config.env.production.d1_databases?.[0]?.database_id !==
        state.resources.databaseId
    )
      throw new Error(
        "Canonical wrangler.jsonc no longer matches installer-owned state; refusing to overwrite or deploy.",
      );
  }

  const guardArgs = [
    "scripts/assert-deploy-ready-config.mjs",
    "--secrets-file",
    state.secretsFile,
    "--installer-state",
    paths.state,
  ];
  command(
    run,
    process.execPath,
    guardArgs,
    localContext,
    "Installer ownership guard",
  );
  if (state.steps.build !== "complete") {
    command(
      run,
      "npm",
      ["run", "build:production"],
      localContext,
      "Production build",
      300_000,
    );
    state.steps.build = "complete";
    await save(paths, state);
  }
  if (state.steps.migrations !== "complete") {
    command(
      run,
      "wrangler",
      [
        "d1",
        "migrations",
        "apply",
        "DB",
        "--remote",
        "--env",
        "production",
        "--config",
        "wrangler.jsonc",
      ],
      wranglerContext,
      "D1 migrations",
      300_000,
    );
    state.steps.migrations = "complete";
    await save(paths, state);
  }

  if (
    state.steps.deploy === "uncertain" ||
    state.steps.deploy === "deploying"
  ) {
    if (args.retryMissing === "deploy") {
      const worker = workerLookup(checkout, token, state, run);
      const baseline = state.deployRecovery;
      if (!baseline) {
        if (state.operation !== "install" || worker.exists)
          throw new Error(
            "The recorded deployment target cannot be verified missing; retry is not authorized and recovery state is unchanged.",
          );
      } else if (baseline.workerExistedBefore) {
        const prior = new Set(baseline.deploymentIds);
        if (
          !worker.exists ||
          deploymentIds(worker).some((id) => !prior.has(id))
        )
          throw new Error(
            "A new deployment exists or the recorded Worker is inaccessible; retry is not authorized and recovery state is unchanged.",
          );
      } else if (worker.exists)
        throw new Error(
          "The Worker now exists in the selected account; retry is not authorized and recovery state is unchanged.",
        );
      state.steps.deploy = "pending";
      delete state.recovery;
      await save(paths, state);
    } else if (!args.acceptDeployed)
      throw new Error(
        "Deployment is uncertain. Verify the Worker version and URL, then resume with --accept-deployed https://...workers.dev, or --retry-verified-missing deploy only when no new version exists.",
      );
    else {
      const acceptedUrl = normalizedAcceptedWorkerUrl(args.acceptDeployed);
      const worker = workerLookup(checkout, token, state, run);
      const baselineIds = new Set(state.deployRecovery?.deploymentIds ?? []);
      if (
        !worker.exists ||
        worker.deployments.length === 0 ||
        (state.deployRecovery &&
          !deploymentIds(worker).some((id) => !baselineIds.has(id)))
      )
        throw new Error(
          "The selected account returned no new deployment for the exact Worker; recovery state is unchanged.",
        );
      const expectedUrl = await verifiedWorkerUrl({
        accountId: state.accountId,
        worker: state.resources.worker,
        token,
        fetchImpl,
      });
      if (acceptedUrl !== expectedUrl)
        throw new Error(
          "The accepted URL does not match the exact Worker and selected account; recovery state is unchanged.",
        );
      state.url = expectedUrl;
      state.steps.deploy = "complete";
      delete state.recovery;
      delete state.deployRecovery;
      await save(paths, state);
    }
  }
  if (state.steps.deploy !== "complete") {
    const outputFile = path.join(
      paths.directory,
      `wrangler-output-${state.operationId}.ndjson`,
    );
    const beforeDeploy = workerLookup(checkout, token, state, run);
    if (state.operation === "install" && beforeDeploy.exists)
      throw new Error(
        `Worker ${state.resources.worker} already exists and will not be overwritten.`,
      );
    if (state.operation === "upgrade" && !beforeDeploy.exists)
      throw new Error(
        `Worker ${state.resources.worker} is missing; upgrade will not create a replacement.`,
      );
    state.deployRecovery = {
      workerExistedBefore: beforeDeploy.exists,
      deploymentIds: deploymentIds(beforeDeploy),
    };
    state.steps.deploy = "deploying";
    await save(paths, state);
    try {
      const deployed = command(
        run,
        "wrangler",
        [
          "deploy",
          "--strict",
          "--env",
          "production",
          "--config",
          "wrangler.jsonc",
          "--secrets-file",
          state.secretsFile,
        ],
        {
          cwd: checkout,
          env: wranglerEnvironment(token, state.accountId, outputFile),
        },
        "Worker and Workflow deployment",
        300_000,
      );
      let structured = "";
      try {
        structured = await readFile(outputFile, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      const url = deploymentUrl(deployed.stdout, structured);
      if (!url)
        throw new Error(
          "Deployment succeeded but returned no unambiguous workers.dev URL.",
        );
      state.url = url;
      state.steps.deploy = "complete";
      delete state.deployRecovery;
      await save(paths, state);
    } catch (error) {
      await markUncertain(paths, state, "deploy", error);
    } finally {
      await removeTemporaryFile(outputFile);
    }
  }

  if (state.steps.health !== "complete") {
    const response = await fetchImpl(new URL("/health", state.url), {
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(
        `Health check failed with HTTP ${response.status}; deployment is preserved for inspection.`,
      );
    state.steps.health = "complete";
    await save(paths, state);
  }
  const receipt = {
    installationId: state.installationId,
    releaseRef: state.releaseRef,
    accountId: state.accountId,
    resources: state.resources,
    url: state.url,
    verifiedAt: new Date().toISOString(),
  };
  await atomicWriteJson(paths.receipt, receipt);
  process.stdout.write(
    `\nProcess Foundry is ready: ${state.url}\nReceipt: ${paths.receipt}\n`,
  );
  return receipt;
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    await runInstaller();
  } catch (error) {
    if (error instanceof CancelledError) {
      console.error(
        "Installation cancelled. No automatic cleanup or deletion was performed.",
      );
      process.exitCode = 130;
    } else {
      console.error(`Installer stopped safely: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
