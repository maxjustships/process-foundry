import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import {
  artifactFiles,
  isLocalSecretFileName,
} from "./build-artifact-policy.mjs";

const buildRoot = path.resolve("build");
const serverRoot = path.join(buildRoot, "server");
const projectRoot = path.resolve(".");
const skipLocalSecretSources =
  process.env.BUNDLE_CHECK_SKIP_LOCAL_SECRET_SOURCES === "1";
const publicRuntimeConfigNames = new Set(["APP_VERSION", "MOCK_AI"]);
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".md",
  ".mjs",
  ".svg",
  ".toml",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

/**
 * @param {string} file
 */
function isTextArtifact(file) {
  return (
    textExtensions.has(path.extname(file)) ||
    path.basename(file) === ".assetsignore"
  );
}

try {
  const files = await artifactFiles(buildRoot);
  const serverFiles = files.filter((file) =>
    file.startsWith(`${serverRoot}${path.sep}`),
  );
  /** @param {string} file */
  const relativePath = (file) => path.relative(buildRoot, file);
  const forbiddenFiles = files
    .filter((file) => isLocalSecretFileName(path.basename(file)))
    .map(relativePath);

  /** @type {Array<[string, string]>} */
  const localSecrets = [];
  if (!skipLocalSecretSources) {
    const rootEntries = await readdir(projectRoot, { withFileTypes: true });
    const secretSourceFiles = rootEntries.filter(
      (entry) =>
        entry.isFile() &&
        isLocalSecretFileName(entry.name) &&
        !entry.name.endsWith(".example"),
    );
    for (const entry of secretSourceFiles) {
      const values = parseEnv(
        await readFile(path.join(projectRoot, entry.name), "utf8"),
      );
      for (const [name, value] of Object.entries(values)) {
        if (value.length > 0 && !publicRuntimeConfigNames.has(name))
          localSecrets.push([name, value]);
      }
    }
  }

  /** @type {Map<string, Set<string>>} */
  const leakedSecrets = new Map();
  /** @type {string[]} */
  const bpmnOffenders = [];
  for (const file of files.filter(isTextArtifact)) {
    const source = await readFile(file, "utf8");
    if (
      serverFiles.includes(file) &&
      file.endsWith(".js") &&
      /bpmn-js|class Modeler/u.test(source)
    )
      bpmnOffenders.push(relativePath(file));
    for (const [name, value] of localSecrets) {
      if (!source.includes(value)) continue;
      const offenders = leakedSecrets.get(name) ?? new Set();
      offenders.add(relativePath(file));
      leakedSecrets.set(name, offenders);
    }
  }

  const failures = [];
  if (forbiddenFiles.length)
    failures.push(
      `Local secret files leaked into the production build: ${forbiddenFiles.join(", ")}`,
    );
  if (leakedSecrets.size) {
    const details = [...leakedSecrets]
      .map(([name, offenders]) => `${name} (${[...offenders].join(", ")})`)
      .join(", ");
    failures.push(
      `Local secret payloads leaked into the production build: ${details}`,
    );
  }
  if (bpmnOffenders.length)
    failures.push(
      `bpmn-js leaked into the server bundle: ${bpmnOffenders.join(", ")}`,
    );

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    const javascriptFileCount = serverFiles.filter((file) =>
      file.endsWith(".js"),
    ).length;
    console.log(
      `Server bundle verified: ${skipLocalSecretSources ? "local secret source scan skipped; " : "no local secrets and "}bpmn-js implementation absent from ${javascriptFileCount} JS files.`,
    );
  }
} catch {
  console.error("Server bundle verification could not complete safely.");
  process.exitCode = 1;
}
