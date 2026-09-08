import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { INSTALLER_DIRECTORY, STATE_VERSION } from "./constants.mjs";

export function installerPaths(checkout) {
  const directory = path.join(checkout, INSTALLER_DIRECTORY);
  return {
    directory,
    state: path.join(directory, "state.json"),
    receipt: path.join(directory, "receipt.json"),
  };
}

export async function ensurePrivateDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

export async function atomicWriteJson(file, value, mode = 0o600) {
  await ensurePrivateDirectory(path.dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = await open(temporary, "w", mode);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(temporary, mode);
  await rename(temporary, file);
  const directory = await open(path.dirname(file), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function readState(file) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  if (
    parsed?.version !== STATE_VERSION ||
    typeof parsed.installationId !== "string"
  )
    throw new Error(
      "Installer state is missing or has an unsupported version.",
    );
  return parsed;
}

export async function stateExists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function removeTemporaryFile(file) {
  try {
    await unlink(file);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
