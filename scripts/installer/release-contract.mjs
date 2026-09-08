import { readFile } from "node:fs/promises";
import { REQUIRED_SECRET_NAMES } from "./constants.mjs";

export const TEMPLATE_DATABASE_ID = "00000000-0000-0000-0000-000000000000";
export const DATABASE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const RESOURCE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

export class ReleaseContractError extends Error {}

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new ReleaseContractError(message);
}

export function validateProductionConfig(
  rawConfig,
  { allowTemplate = false } = {},
) {
  const production = isRecord(rawConfig?.env)
    ? rawConfig.env.production
    : undefined;
  if (!isRecord(production))
    throw new ReleaseContractError("production environment is missing");
  if (
    typeof production.name !== "string" ||
    !RESOURCE_NAME_PATTERN.test(production.name)
  )
    throw new ReleaseContractError("production Worker name is invalid");
  if (production.workers_dev !== true || Object.hasOwn(production, "routes"))
    throw new ReleaseContractError("production routing is not deploy-safe");
  if (
    !isRecord(production.vars) ||
    typeof production.vars.APP_VERSION !== "string" ||
    production.vars.APP_VERSION.length === 0 ||
    production.vars.MOCK_AI !== "false" ||
    production.vars.MOCK_AI_DELAY_MS !== "0"
  )
    throw new ReleaseContractError("production AI mode is not deploy-safe");
  exact(
    production.secrets,
    { required: REQUIRED_SECRET_NAMES },
    "required secret names are invalid",
  );

  const databases = production.d1_databases;
  if (
    !Array.isArray(databases) ||
    databases.length !== 1 ||
    !isRecord(databases[0])
  )
    throw new ReleaseContractError("production D1 binding is invalid");
  const database = databases[0];
  if (
    database.binding !== "DB" ||
    typeof database.database_name !== "string" ||
    !RESOURCE_NAME_PATTERN.test(database.database_name) ||
    database.migrations_dir !== "migrations"
  )
    throw new ReleaseContractError("production D1 binding is invalid");
  if (
    typeof database.database_id !== "string" ||
    !DATABASE_ID_PATTERN.test(database.database_id)
  )
    throw new ReleaseContractError("production D1 UUID is malformed");
  if (
    !allowTemplate &&
    database.database_id.toLowerCase() === TEMPLATE_DATABASE_ID
  )
    throw new ReleaseContractError(
      "production D1 UUID is still the template value",
    );

  const buckets = production.r2_buckets;
  if (
    !Array.isArray(buckets) ||
    buckets.length !== 1 ||
    !isRecord(buckets[0]) ||
    buckets[0].binding !== "SOURCES" ||
    typeof buckets[0].bucket_name !== "string" ||
    !RESOURCE_NAME_PATTERN.test(buckets[0].bucket_name)
  )
    throw new ReleaseContractError("production R2 binding is invalid");

  const workflows = production.workflows;
  if (
    !Array.isArray(workflows) ||
    workflows.length !== 1 ||
    !isRecord(workflows[0]) ||
    workflows[0].binding !== "GENERATION_WORKFLOW" ||
    workflows[0].class_name !== "GenerationWorkflow" ||
    typeof workflows[0].name !== "string" ||
    !RESOURCE_NAME_PATTERN.test(workflows[0].name)
  )
    throw new ReleaseContractError("production Workflow binding is invalid");

  return { production, database, bucket: buckets[0], workflow: workflows[0] };
}

export function parseSecrets(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    const entries = source
      .split(/\r?\n/gu)
      .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        if (index < 1)
          throw new ReleaseContractError("secrets file syntax is invalid");
        return [line.slice(0, index).trim(), line.slice(index + 1)];
      });
    if (new Set(entries.map(([name]) => name)).size !== entries.length)
      throw new ReleaseContractError("secrets file contains duplicate names");
    value = Object.fromEntries(entries);
  }
  if (!isRecord(value))
    throw new ReleaseContractError("secrets file must be an object");
  exact(
    Object.keys(value).sort(),
    [...REQUIRED_SECRET_NAMES].sort(),
    "secrets file names are invalid",
  );
  if (
    REQUIRED_SECRET_NAMES.some(
      (name) => typeof value[name] !== "string" || value[name].length === 0,
    )
  )
    throw new ReleaseContractError("secrets file contains an empty value");
  return value;
}

export async function validateSecretsFile(file) {
  return parseSecrets(await readFile(file, "utf8"));
}

export function validateInstallerOwnership(contract, state) {
  if (!isRecord(state) || !isRecord(state.resources))
    throw new ReleaseContractError("installer ownership state is invalid");
  const expected = state.resources;
  if (
    typeof state.accountId !== "string" ||
    contract.production.name !== expected.worker ||
    contract.database.database_name !== expected.database ||
    contract.database.database_id !== expected.databaseId ||
    contract.bucket.bucket_name !== expected.bucket ||
    contract.workflow.name !== expected.workflow
  )
    throw new ReleaseContractError(
      "canonical config does not match installer-owned resources",
    );
}
