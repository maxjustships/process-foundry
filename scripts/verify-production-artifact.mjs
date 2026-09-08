import { readFile } from "node:fs/promises";
import path from "node:path";
import { experimental_readRawConfig } from "wrangler";
import {
  DATABASE_ID_PATTERN,
  isRecord,
  ReleaseContractError,
  validateProductionConfig,
} from "./installer/release-contract.mjs";

const readRawConfig =
  /** @type {(args: {config: string}) => {rawConfig: any}} */ (
    experimental_readRawConfig
  );
const artifactPath = path.resolve("build/server/wrangler.json");
const configPath = path.resolve("wrangler.jsonc");

function exact(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new ReleaseContractError(
      `${label} do not match canonical wrangler.jsonc`,
    );
}

try {
  const source = await readFile(artifactPath, "utf8");
  const artifact = JSON.parse(source);
  if (!isRecord(artifact))
    throw new ReleaseContractError("artifact root is not an object");
  if (/"(?:account_id|api_token|credentials)"\s*:/u.test(source))
    throw new ReleaseContractError(
      "account or credential configuration is present",
    );
  if (
    !Array.isArray(artifact.secrets_store_secrets) ||
    artifact.secrets_store_secrets.length !== 0
  )
    throw new ReleaseContractError("secret configuration is present");

  const rawConfig = readRawConfig({ config: configPath }).rawConfig;
  const { production, database, bucket, workflow } = validateProductionConfig(
    rawConfig,
    {
      allowTemplate: true,
    },
  );
  if (
    isRecord(artifact.vars) &&
    production.secrets.required.some((name) => name in artifact.vars)
  )
    throw new ReleaseContractError("secret configuration is present");
  exact(artifact.secrets, production.secrets, "required secret names");
  exact(
    {
      topLevelName: artifact.topLevelName,
      definedEnvironments: artifact.definedEnvironments,
      targetEnvironment: artifact.targetEnvironment,
      name: artifact.name,
      main: artifact.main,
    },
    {
      topLevelName: rawConfig.name,
      definedEnvironments: Object.keys(rawConfig.env),
      targetEnvironment: "production",
      name: production.name,
      main: "index.js",
    },
    "environment selection",
  );
  if (artifact.workers_dev !== true || Object.hasOwn(artifact, "routes"))
    throw new ReleaseContractError(
      "workers.dev routing does not match canonical wrangler.jsonc",
    );
  exact(artifact.vars, production.vars, "public runtime vars");
  const artifactId = artifact.d1_databases?.[0]?.database_id;
  if (typeof artifactId !== "string" || !DATABASE_ID_PATTERN.test(artifactId))
    throw new ReleaseContractError(
      "D1 database ID does not match canonical wrangler.jsonc",
    );
  exact(
    artifact.d1_databases,
    [{ ...database, migrations_dir: "../../migrations" }],
    "D1 bindings",
  );
  exact(artifact.r2_buckets, [bucket], "R2 bindings");
  exact(artifact.workflows, [workflow], "Workflow bindings");
  console.log(
    "Production deploy artifact verified against canonical wrangler.jsonc.",
  );
} catch (error) {
  if (error instanceof ReleaseContractError)
    console.error(
      `Production deploy artifact verification failed: ${error.message}.`,
    );
  else
    console.error(
      "Production deploy artifact verification could not complete safely.",
    );
  process.exitCode = 1;
}
