import { readFile } from "node:fs/promises";
import path from "node:path";
import { experimental_readRawConfig } from "wrangler";
import {
  ReleaseContractError,
  validateInstallerOwnership,
  validateProductionConfig,
  validateSecretsFile,
} from "./installer/release-contract.mjs";

const readRawConfig =
  /** @type {(args: { config: string }) => { rawConfig: unknown }} */ (
    experimental_readRawConfig
  );
const configPath = path.resolve(process.cwd(), "wrangler.jsonc");
function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

try {
  const contract = validateProductionConfig(
    readRawConfig({ config: configPath }).rawConfig,
  );
  const secretsFile = option("--secrets-file");
  if (secretsFile) await validateSecretsFile(path.resolve(secretsFile));
  const stateFile = option("--installer-state");
  if (stateFile) {
    const state = JSON.parse(await readFile(path.resolve(stateFile), "utf8"));
    validateInstallerOwnership(contract, state);
  }
  console.log("Production deploy config is ready.");
} catch (error) {
  if (error instanceof ReleaseContractError)
    console.error(
      `Production deploy readiness check failed: ${error.message}.`,
    );
  else
    console.error(
      "Production deploy readiness check could not complete safely.",
    );
  process.exitCode = 1;
}
