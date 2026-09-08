import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { REQUIRED_SECRET_NAMES } from "./constants.mjs";

export function validateSecretsObject(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Secrets file must contain a JSON object.");
  const keys = Object.keys(value).sort();
  const expected = [...REQUIRED_SECRET_NAMES].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected))
    throw new Error(
      "Secrets file must contain exactly the five required secret names.",
    );
  if (
    expected.some(
      (name) => typeof value[name] !== "string" || value[name].length === 0,
    )
  )
    throw new Error("Every required secret must have a non-empty value.");
  return value;
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== "..")
  );
}

async function assertNoSymlinkComponents(target) {
  const resolved = path.resolve(target);
  const { root } = path.parse(resolved);
  const components = resolved
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean);
  let current = root;
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink())
        throw new Error(
          "External secrets path must not contain symlink components.",
        );
    } catch (error) {
      if (error?.code === "ENOENT") return index;
      throw error;
    }
  }
  return components.length;
}

async function validatePrivateDirectory(directory) {
  await assertNoSymlinkComponents(directory);
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error(
      "External secrets parent must be a dedicated regular directory, not a symlink.",
    );
  if ((stats.mode & 0o777) !== 0o700)
    throw new Error(
      "External secrets parent must be a dedicated private directory with mode 0700; create it or fix its permissions explicitly.",
    );
  return { real: await realpath(directory), dev: stats.dev, ino: stats.ino };
}

async function preparePrivateDirectory(directory, checkoutReal) {
  const missingIndex = await assertNoSymlinkComponents(directory);
  const { root } = path.parse(directory);
  const components = directory
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean);
  if (missingIndex < components.length - 1)
    throw new Error(
      "Create the dedicated secrets parent first; the installer will not recursively create or chmod shared ancestor directories.",
    );
  let created = false;
  if (missingIndex === components.length - 1) {
    const existingParent = path.dirname(directory);
    const parentStats = await lstat(existingParent);
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink())
      throw new Error(
        "The secrets parent ancestor is not a regular directory.",
      );
    const parentReal = await realpath(existingParent);
    if (isContained(checkoutReal, parentReal))
      throw new Error(
        "Production secrets must be stored physically outside the source checkout.",
      );
    try {
      await mkdir(directory, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    if (created) await chmod(directory, 0o700);
  }
  const identity = await validatePrivateDirectory(directory);
  if (isContained(checkoutReal, identity.real))
    throw new Error(
      "Production secrets must be stored physically outside the source checkout.",
    );
  return identity;
}

async function assertDestinationAbsent(file) {
  try {
    const stats = await lstat(file);
    const kind = stats.isSymbolicLink()
      ? "symlink"
      : stats.isDirectory()
        ? "directory"
        : "existing file";
    throw new Error(
      `External secrets destination is an ${kind} and will not be overwritten.`,
    );
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function writeSecretsFile(file, secrets, checkout) {
  validateSecretsObject(secrets);
  const resolved = path.resolve(file);
  const checkoutReal = await realpath(path.resolve(checkout));
  const checkoutStats = await lstat(checkoutReal);
  if (!checkoutStats.isDirectory() || checkoutStats.isSymbolicLink())
    throw new Error("Source checkout must resolve to a regular directory.");
  if (isContained(checkoutReal, resolved))
    throw new Error(
      "Production secrets must be stored outside the source checkout.",
    );

  const directory = path.dirname(resolved);
  const directoryIdentity = await preparePrivateDirectory(
    directory,
    checkoutReal,
  );
  await assertDestinationAbsent(resolved);
  const temporary = path.join(
    directory,
    `.${path.basename(resolved)}.${randomUUID()}.tmp`,
  );
  let temporaryCreated = false;
  const flags =
    fsConstants.O_WRONLY |
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    (fsConstants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = await open(temporary, flags, 0o600);
    temporaryCreated = true;
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(secrets, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    const rechecked = await validatePrivateDirectory(directory);
    if (
      rechecked.real !== directoryIdentity.real ||
      rechecked.dev !== directoryIdentity.dev ||
      rechecked.ino !== directoryIdentity.ino ||
      isContained(checkoutReal, rechecked.real)
    )
      throw new Error(
        "External secrets parent changed during validation; no secrets file was installed.",
      );
    await assertDestinationAbsent(resolved);
    await link(temporary, resolved);
  } catch (error) {
    if (error?.code === "EEXIST")
      throw new Error(
        "External secrets file already exists and will not be overwritten.",
        { cause: error },
      );
    throw error;
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    if (temporaryCreated) await unlink(temporary).catch(() => undefined);
  }
  const directoryHandle = await open(directory, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
  return resolved;
}

export async function assertSecretFileModes(file) {
  await assertNoSymlinkComponents(path.resolve(file));
  const fileStats = await lstat(file);
  const directoryStats = await lstat(path.dirname(file));
  if (!fileStats.isFile() || fileStats.isSymbolicLink())
    throw new Error("Secrets path must be a regular file, not a symlink.");
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink())
    throw new Error(
      "Secrets parent must be a regular directory, not a symlink.",
    );
  if (
    (fileStats.mode & 0o777) !== 0o600 ||
    (directoryStats.mode & 0o777) !== 0o700
  )
    throw new Error(
      "Secrets file and its directory must use 0600/0700 permissions.",
    );
}
