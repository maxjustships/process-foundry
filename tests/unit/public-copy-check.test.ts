import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// The production check stays executable as plain Node ESM.
// @ts-expect-error JavaScript check module intentionally has no declaration file.
import {
  formatPublicCopyFailure,
  inspectPublicCopy,
  publicSourceFiles,
} from "../../scripts/check-public-copy.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const directory of temporaryRoots.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("public copy check", () => {
  it("reports the source file and matched defensive phrase", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "public-copy-check-"));
    temporaryRoots.push(directory);
    const fixture = path.join(directory, "rejected-public-copy.tsx");
    writeFileSync(
      fixture,
      'export const copy = { title: "Map the process" };\nexport default <><h1>Map the process</h1><a>Explore the workflow</a><p>100% synthetic, no AI calls</p></>;\n',
    );

    const failures = inspectPublicCopy([fixture]);
    const output = failures.map(formatPublicCopyFailure).join("\n");

    expect(failures).toHaveLength(2);
    expect(output).toContain("rejected-public-copy.tsx");
    expect(output).toContain('forbidden phrase: "100% synthetic"');
    expect(output).toContain('forbidden phrase: "no AI calls"');
  });

  it("passes against the current public sources", () => {
    const files = publicSourceFiles.map((file: string) =>
      path.join(root, file),
    );

    expect(inspectPublicCopy(files)).toEqual([]);
  });
});
