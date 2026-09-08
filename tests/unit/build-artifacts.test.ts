import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const checker = fileURLToPath(
  new URL("../../scripts/check-server-bundle.mjs", import.meta.url),
);
const sanitizer = fileURLToPath(
  new URL("../../scripts/sanitize-server-build.mjs", import.meta.url),
);
const fixtureRoots: string[] = [];

function fixtureRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "bpmn-build-artifacts-"));
  fixtureRoots.push(root);
  mkdirSync(path.join(root, "build/server"), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true });
});

describe("production build artifact security", () => {
  it("removes local environment files from all production build targets", () => {
    const root = fixtureRoot();
    mkdirSync(path.join(root, "build/client"), { recursive: true });
    const serverSecretFile = path.join(root, "build/server/.dev.vars");
    const clientSecretFile = path.join(root, "build/client/.env.production");
    const serverEntry = path.join(root, "build/server/index.js");
    writeFileSync(serverSecretFile, "fixture\n");
    writeFileSync(clientSecretFile, "fixture\n");
    writeFileSync(serverEntry, "export default { fetch() {} };\n");

    execFileSync(process.execPath, [sanitizer], {
      cwd: root,
      encoding: "utf8",
      stdio: "pipe",
    });

    expect(existsSync(serverSecretFile)).toBe(false);
    expect(existsSync(clientSecretFile)).toBe(false);
    expect(existsSync(serverEntry)).toBe(true);
  });

  it("rejects local environment files copied into the production build", () => {
    const root = fixtureRoot();
    mkdirSync(path.join(root, "build/client"), { recursive: true });
    writeFileSync(path.join(root, "build/server/.dev.vars"), "fixture\n");
    writeFileSync(path.join(root, "build/client/.env.production"), "fixture\n");

    const result = spawnSync(process.execPath, [checker], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(".dev.vars");
    expect(result.stderr).toContain(".env.production");
    expect(result.stderr).not.toContain("fixture");
  });

  it("rejects local secret payloads without echoing their values", () => {
    const root = fixtureRoot();
    const secretValue = "test-only-secret-payload-7b02c831";
    writeFileSync(
      path.join(root, ".dev.vars"),
      `SESSION_SIGNING_KEY=${secretValue}\n`,
    );
    writeFileSync(
      path.join(root, "build/server/index.js"),
      `export default ${JSON.stringify(secretValue)};\n`,
    );

    const result = spawnSync(process.execPath, [checker], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SESSION_SIGNING_KEY");
    expect(result.stderr).not.toContain(secretValue);
    expect(result.stdout).not.toContain(secretValue);
  });

  it("ignores known public runtime configuration values in local environment files", () => {
    const root = fixtureRoot();
    writeFileSync(
      path.join(root, ".dev.vars"),
      "MOCK_AI=false\nAPP_VERSION=0.1.0\n",
    );
    writeFileSync(
      path.join(root, "build/server/index.js"),
      'export const mockAi = false; export const appVersion = "0.1.0";\n',
    );

    expect(() =>
      execFileSync(process.execPath, [checker], {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).not.toThrow();
  });

  it("can verify a production bundle without reading local secret sources", () => {
    const root = fixtureRoot();
    writeFileSync(path.join(root, ".dev.vars"), "not valid env syntax\n");
    writeFileSync(
      path.join(root, "build/server/index.js"),
      "export default { fetch() {} };\n",
    );

    const output = execFileSync(process.execPath, [checker], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        BUNDLE_CHECK_SKIP_LOCAL_SECRET_SOURCES: "1",
      },
      stdio: "pipe",
    });

    expect(output).toContain("local secret source scan skipped");
  });

  it("accepts a clean server build", () => {
    const root = fixtureRoot();
    writeFileSync(path.join(root, ".dev.vars"), "SAFE_SECRET=not-in-build\n");
    writeFileSync(
      path.join(root, "build/server/index.js"),
      "export default { fetch() {} };\n",
    );

    expect(() =>
      execFileSync(process.execPath, [checker], {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});
