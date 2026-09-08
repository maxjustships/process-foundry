import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { readCanonicalConfig } from "./config.mjs";
import {
  isRecord,
  ReleaseContractError,
  validateInstallerOwnership,
  validateProductionConfig,
  validateSecretsFile,
} from "./release-contract.mjs";

const redirectRelativePath = ".wrangler/deploy/config.json";
const generatedConfigRelativePath = "build/server/wrangler.json";

function exact(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new ReleaseContractError(
      `generated ${label} do not match canonical production config`,
    );
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function checkoutBoundary(checkout) {
  const resolved = path.resolve(checkout);
  const stats = await lstat(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new ReleaseContractError(
      "deployment checkout must be a physical directory, not a symlink",
    );
  return { resolved, physical: await realpath(resolved) };
}

async function safeExistingPath(boundary, target, kind, label) {
  const resolved = path.resolve(target);
  if (!isInside(boundary.resolved, resolved))
    throw new ReleaseContractError(`${label} escapes the deployment checkout`);

  let current = boundary.resolved;
  const relative = path.relative(boundary.resolved, resolved);
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stats = await lstat(current);
    if (stats.isSymbolicLink())
      throw new ReleaseContractError(`${label} contains a symlink`);
  }

  const physical = await realpath(resolved);
  if (!isInside(boundary.physical, physical))
    throw new ReleaseContractError(`${label} escapes the physical checkout`);
  const stats = await lstat(resolved);
  if (
    (kind === "file" && !stats.isFile()) ||
    (kind === "directory" && !stats.isDirectory())
  )
    throw new ReleaseContractError(`${label} has the wrong filesystem type`);
  return { resolved, stats };
}

async function parseJsonFile(file, label) {
  let source;
  let value;
  try {
    source = await readFile(file, "utf8");
    value = JSON.parse(source);
  } catch (error) {
    throw new ReleaseContractError(`${label} is malformed`, { cause: error });
  }
  if (!isRecord(value)) throw new ReleaseContractError(`${label} is malformed`);
  return { source, value };
}

function validateGeneratedConfig(
  rawConfig,
  contract,
  artifact,
  source,
  canonicalPath,
) {
  if (
    artifact.configPath !== canonicalPath ||
    artifact.userConfigPath !== canonicalPath ||
    artifact.topLevelName !== rawConfig.name ||
    artifact.targetEnvironment !== "production" ||
    artifact.main !== "index.js" ||
    artifact.no_bundle !== true ||
    Object.hasOwn(artifact, "env")
  )
    throw new ReleaseContractError(
      "generated environment selection does not match canonical production config",
    );
  exact(
    artifact.definedEnvironments,
    Object.keys(rawConfig.env),
    "environment selection",
  );
  exact(artifact.name, contract.production.name, "Worker identity");
  if (artifact.workers_dev !== true || Object.hasOwn(artifact, "routes"))
    throw new ReleaseContractError(
      "generated routing does not match canonical production config",
    );
  exact(artifact.vars, contract.production.vars, "runtime vars");
  exact(artifact.secrets, contract.production.secrets, "required secret names");
  exact(
    artifact.d1_databases,
    [{ ...contract.database, migrations_dir: "../../migrations" }],
    "D1 bindings",
  );
  exact(artifact.r2_buckets, [contract.bucket], "R2 bindings");
  exact(artifact.workflows, [contract.workflow], "Workflow bindings");
  exact(artifact.assets, { directory: "../client" }, "assets path");
  if (
    /"(?:account_id|api_token|credentials)"\s*:/u.test(source) ||
    !Array.isArray(artifact.secrets_store_secrets) ||
    artifact.secrets_store_secrets.length !== 0 ||
    (isRecord(artifact.vars) &&
      contract.production.secrets.required.some(
        (name) => name in artifact.vars,
      ))
  )
    throw new ReleaseContractError(
      "generated deploy config contains account, credential, or secret configuration",
    );
}

export function productionDeployEnvironment(base = process.env) {
  const environment = { ...base };
  delete environment.CLOUDFLARE_ENV;
  return environment;
}

export async function productionDeployCommand({
  checkout,
  secretsFile,
  installerState,
  dryRun = false,
}) {
  const boundary = await checkoutBoundary(checkout);
  const canonical = await safeExistingPath(
    boundary,
    path.join(boundary.resolved, "wrangler.jsonc"),
    "file",
    "canonical deploy config",
  );
  const rawConfig = readCanonicalConfig(canonical.resolved);
  const contract = validateProductionConfig(rawConfig, {
    allowTemplate: dryRun,
  });
  if (installerState) validateInstallerOwnership(contract, installerState);

  let resolvedSecretsFile;
  if (secretsFile) {
    resolvedSecretsFile = path.resolve(boundary.resolved, secretsFile);
    await validateSecretsFile(resolvedSecretsFile);
  } else if (!dryRun) {
    throw new ReleaseContractError(
      "a complete external secrets file is required for real deployment",
    );
  }

  const redirect = await safeExistingPath(
    boundary,
    path.join(boundary.resolved, redirectRelativePath),
    "file",
    "generated deploy redirect",
  );
  const { value: redirectConfig } = await parseJsonFile(
    redirect.resolved,
    "generated deploy redirect",
  );
  if (
    redirectConfig.configPath !== "../../build/server/wrangler.json" ||
    !Array.isArray(redirectConfig.auxiliaryWorkers) ||
    redirectConfig.auxiliaryWorkers.length !== 0 ||
    Object.keys(redirectConfig).some(
      (key) => !["configPath", "auxiliaryWorkers"].includes(key),
    )
  )
    throw new ReleaseContractError("generated deploy redirect is invalid");

  const generatedTarget = path.resolve(
    path.dirname(redirect.resolved),
    redirectConfig.configPath,
  );
  if (
    generatedTarget !==
    path.join(boundary.resolved, generatedConfigRelativePath)
  )
    throw new ReleaseContractError("generated deploy redirect is invalid");
  const generated = await safeExistingPath(
    boundary,
    generatedTarget,
    "file",
    "generated deploy config",
  );
  if (generated.stats.mtimeMs < canonical.stats.mtimeMs)
    throw new ReleaseContractError(
      "generated deploy config is stale relative to canonical config",
    );
  const { source, value: artifact } = await parseJsonFile(
    generated.resolved,
    "generated deploy config",
  );
  validateGeneratedConfig(
    rawConfig,
    contract,
    artifact,
    source,
    canonical.resolved,
  );

  await safeExistingPath(
    boundary,
    path.resolve(path.dirname(generated.resolved), artifact.main),
    "file",
    "generated Worker entrypoint",
  );
  await safeExistingPath(
    boundary,
    path.resolve(path.dirname(generated.resolved), artifact.assets.directory),
    "directory",
    "generated asset directory",
  );

  return {
    executable: "wrangler",
    workerName: artifact.name,
    configPath: generated.resolved,
    args: [
      "deploy",
      "--strict",
      "--config",
      generated.resolved,
      ...(resolvedSecretsFile ? ["--secrets-file", resolvedSecretsFile] : []),
      ...(dryRun ? ["--dry-run"] : []),
    ],
  };
}
