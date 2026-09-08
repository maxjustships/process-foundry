#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  productionDeployCommand,
  productionDeployEnvironment,
} from "./installer/deploy.mjs";
import { ReleaseContractError } from "./installer/release-contract.mjs";
import { runCommand } from "./installer/runner.mjs";

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ dryRun: boolean; secretsFile?: string }} */
  const result = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") result.dryRun = true;
    else if (argument === "--secrets-file") result.secretsFile = argv[++index];
    else throw new ReleaseContractError(`unknown deploy option ${argument}`);
  }
  if (result.secretsFile === undefined && argv.includes("--secrets-file"))
    throw new ReleaseContractError("--secrets-file requires a path");
  return result;
}

export async function runProductionDeploy({
  checkout = process.cwd(),
  argv = process.argv.slice(2),
  run = runCommand,
} = {}) {
  const options = parseArgs(argv);
  const selected = await productionDeployCommand({ checkout, ...options });
  return run(selected.executable, selected.args, {
    cwd: checkout,
    env: productionDeployEnvironment(process.env),
    inherit: true,
    timeout: 300_000,
    label: options.dryRun
      ? "Production deployment dry-run"
      : "Production deployment",
  });
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    realpathSync(path.resolve(process.argv[1]));
if (isMain) {
  try {
    await runProductionDeploy();
  } catch (error) {
    if (error instanceof ReleaseContractError)
      console.error(`Production deployment stopped safely: ${error.message}.`);
    else console.error("Production deployment could not complete safely.");
    process.exitCode = 1;
  }
}
