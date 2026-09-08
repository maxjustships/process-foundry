#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import { access, copyFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { get } from "node:https";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const PUBLIC_REPOSITORY = "maxjustships/process-foundry";
export const IMMUTABLE_REF = /^[0-9a-f]{40}$/iu;

export function parseBootstrapArgs(argv) {
  const result = { directory: path.resolve("process-foundry") };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--ref") result.ref = argv[++index];
    else if (argument === "--directory")
      result.directory = path.resolve(argv[++index]);
    else if (argument === "--archive")
      result.archive = path.resolve(argv[++index]);
    else throw new Error(`Unknown bootstrap option: ${argument}`);
  }
  if (!IMMUTABLE_REF.test(result.ref ?? ""))
    throw new Error(
      "--ref must be an explicit full 40-character release commit SHA.",
    );
  return result;
}

export const archiveUrl = (ref) =>
  `https://codeload.github.com/${PUBLIC_REPOSITORY}/tar.gz/${ref}`;

async function download(url, destination, redirects = 0) {
  if (redirects > 5) throw new Error("Too many archive redirects.");
  await new Promise((resolve, reject) => {
    const request = get(
      url,
      { headers: { "User-Agent": "process-foundry-bootstrap" } },
      (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          download(
            new URL(response.headers.location, url),
            destination,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new Error(
              `Release archive download failed with HTTP ${response.statusCode}.`,
            ),
          );
          return;
        }
        const output = createWriteStream(destination, { mode: 0o600 });
        response.pipe(output);
        output.on("finish", () => output.close(resolve));
        output.on("error", reject);
      },
    );
    request.on("error", reject);
  });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} failed.`);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export async function bootstrap(options) {
  try {
    await access(options.directory);
    throw new Error(`Destination already exists: ${options.directory}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await mkdir(path.dirname(options.directory), { recursive: true });
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), "process-foundry-bootstrap-"),
  );
  let directoryCreated = false;
  let installerStarted = false;
  try {
    const archive = path.join(temporary, "release.tgz");
    if (options.archive) {
      if (process.env.PF_INSTALLER_ALLOW_LOCAL_FIXTURE !== "1")
        throw new Error(
          "Local archives are test-only and require PF_INSTALLER_ALLOW_LOCAL_FIXTURE=1.",
        );
      console.error(
        "LOCAL FIXTURE ONLY — this is not proof of a public audited release.",
      );
      await copyFile(options.archive, archive);
    } else await download(archiveUrl(options.ref), archive);
    await mkdir(options.directory, { mode: 0o700 });
    directoryCreated = true;
    run("tar", [
      "-xzf",
      archive,
      "--strip-components=1",
      "-C",
      options.directory,
    ]);
    run("npm", ["ci"], options.directory);
    installerStarted = true;
    run(
      "npm",
      ["run", "installer", "--", "--release-ref", options.ref],
      options.directory,
    );
  } catch (error) {
    if (installerStarted)
      throw new Error(
        `Installer stopped after it began. The checkout and recovery journal are preserved at ${options.directory}.\nResume with: cd ${shellQuote(options.directory)} && npm run installer:resume`,
        { cause: error },
      );
    if (directoryCreated)
      await rm(options.directory, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    await bootstrap(parseBootstrapArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`Bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  }
}
