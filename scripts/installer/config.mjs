import { open, rename, stat } from "node:fs/promises";
import path from "node:path";
import { experimental_readRawConfig } from "wrangler";
import { REQUIRED_SECRET_NAMES } from "./constants.mjs";

const readRawConfig =
  /** @type {(args: {config: string}) => {rawConfig: any}} */ (
    experimental_readRawConfig
  );

export function configuredProduction(rawConfig, resources) {
  const next = structuredClone(rawConfig);
  if (!next.env?.production)
    throw new Error("Canonical production environment is missing.");
  const production = next.env.production;
  production.name = resources.worker;
  production.workers_dev = true;
  delete production.routes;
  production.vars = { ...production.vars, MOCK_AI: "false" };
  production.d1_databases = [
    {
      binding: "DB",
      database_name: resources.database,
      database_id: resources.databaseId,
      migrations_dir: "migrations",
    },
  ];
  production.r2_buckets = [
    { binding: "SOURCES", bucket_name: resources.bucket },
  ];
  production.workflows = [
    {
      binding: "GENERATION_WORKFLOW",
      name: resources.workflow,
      class_name: "GenerationWorkflow",
    },
  ];
  production.secrets = { required: REQUIRED_SECRET_NAMES };
  return next;
}

export function readCanonicalConfig(configPath) {
  return readRawConfig({ config: configPath }).rawConfig;
}

export async function writeInstallerConfig(configPath, resources) {
  const current = readCanonicalConfig(configPath);
  const next = configuredProduction(current, resources);
  const temporary = `${configPath}.${process.pid}.tmp`;
  const currentMode = (await stat(configPath)).mode & 0o777;
  const handle = await open(temporary, "w", currentMode);
  try {
    await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, configPath);
  const directory = await open(path.dirname(configPath), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
