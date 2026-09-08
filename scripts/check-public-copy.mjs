import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** @typedef {{ file: string; reason: string; match: string }} CopyFailure */

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const publicSourceFiles = [
  "app/routes/home.tsx",
  "app/routes/demo.tsx",
  "app/components/PublicHeader.tsx",
  "app/demo/fixture.ts",
  "app/root.tsx",
];

const forbiddenPatterns = [
  /(?:100%\s+)?synthetic/giu,
  /no\s+AI\s+calls?/giu,
  /\bsample(?:\s+(?:data|project|workflow|source))?\b/giu,
  /\bmock\b/giu,
  /\bdrafts?\b/giu,
  /\bpreview\b/giu,
  /not\s+in\s+this\s+version/giu,
  /does\s+not\s+yet/giu,
  /not\s+ready/giu,
  /no\s+account/giu,
  /no\s+private\s+data/giu,
  /without\s+(?:AI|an?\s+account|private\s+data)/giu,
  /reset(?:s)?\s+on\s+reload/giu,
];

const cyrillicPattern = /[\u0400-\u04ff]+/gu;
const limitationOpening =
  /^(?:100%\s+synthetic|synthetic|sample|draft|preview|no\b|not\b|without\b|limited\b|limitations?\b|does(?:n't|\s+not)\b)/iu;
const literalH1Pattern = /<h1\b[^>]*>\s*([^<{][^<]*)<\/h1>/giu;
const titlePropertyPattern = /(?:heroTitle|title)\s*:\s*["'`]([^"'`]+)["'`]/giu;
const actionCtaPattern =
  /(?:Explore\s+(?:the\s+)?(?:workflow|demo)|Open\s+(?:the\s+)?workspace)/iu;

/**
 * @param {string} file
 * @returns {string}
 */
function displayPath(file) {
  const relative = path.relative(repositoryRoot, file);
  return relative.startsWith("..") ? file : relative;
}

/**
 * @param {CopyFailure} failure
 * @returns {string}
 */
export function formatPublicCopyFailure(failure) {
  return `${displayPath(failure.file)}: ${failure.reason}: ${JSON.stringify(failure.match)}`;
}

/**
 * @param {string[]} files
 * @returns {CopyFailure[]}
 */
export function inspectPublicCopy(files) {
  /** @type {CopyFailure[]} */
  const failures = [];
  const sources = files.map((file) => ({
    file: path.resolve(file),
    source: readFileSync(file, "utf8"),
  }));

  for (const { file, source } of sources) {
    for (const pattern of forbiddenPatterns) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern))
        failures.push({ file, reason: "forbidden phrase", match: match[0] });
    }

    cyrillicPattern.lastIndex = 0;
    for (const match of source.matchAll(cyrillicPattern))
      failures.push({ file, reason: "Cyrillic text", match: match[0] });

    for (const pattern of [literalH1Pattern, titlePropertyPattern]) {
      pattern.lastIndex = 0;
      for (const match of source.matchAll(pattern)) {
        const heading = match[1]?.trim() ?? "";
        if (limitationOpening.test(heading))
          failures.push({
            file,
            reason: "limitation-framed H1",
            match: heading,
          });
      }
    }
  }

  if (!actionCtaPattern.test(sources.map(({ source }) => source).join("\n")))
    failures.push({
      file: sources[0]?.file ?? repositoryRoot,
      reason: "missing action CTA",
      match: "Explore the workflow or Open workspace",
    });

  return failures;
}

/**
 * @param {string[]} argv
 * @returns {string[]}
 */
function parseFiles(argv) {
  const marker = argv.indexOf("--files");
  if (marker === -1)
    return publicSourceFiles.map((file) => path.join(repositoryRoot, file));
  const files = argv.slice(marker + 1);
  if (!files.length) throw new Error("--files requires at least one path");
  return files.map((file) => path.resolve(file));
}

/**
 * @param {string[]} files
 * @returns {number}
 */
export function runPublicCopyCheck(files) {
  const failures = inspectPublicCopy(files);
  if (failures.length) {
    for (const failure of failures)
      process.stderr.write(`${formatPublicCopyFailure(failure)}\n`);
    return 1;
  }
  process.stdout.write(`Public copy check passed (${files.length} files).\n`);
  return 0;
}

const isCli = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isCli)
  process.exitCode = runPublicCopyCheck(parseFiles(process.argv.slice(2)));
