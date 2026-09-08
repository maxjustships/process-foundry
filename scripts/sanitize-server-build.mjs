import { rm } from "node:fs/promises";
import path from "node:path";
import {
  artifactFiles,
  isLocalSecretFileName,
} from "./build-artifact-policy.mjs";

const buildRoot = path.resolve("build");

try {
  const forbiddenFiles = (await artifactFiles(buildRoot)).filter((file) =>
    isLocalSecretFileName(path.basename(file)),
  );

  await Promise.all(forbiddenFiles.map((file) => rm(file)));
  console.log(
    `Production build sanitized: removed ${forbiddenFiles.length} local secret file(s).`,
  );
} catch {
  console.error("Production build sanitization could not complete safely.");
  process.exitCode = 1;
}
