import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * @param {string} fileName
 */
export const isLocalSecretFileName = (fileName) =>
  /^(?:\.dev\.vars|\.env)(?:\.|$)/u.test(fileName);

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
export async function artifactFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await artifactFiles(target)));
    else files.push(target);
  }
  return files;
}
