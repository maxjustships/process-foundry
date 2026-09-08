import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const renderer = path.join(root, "scripts/render-install-launcher.mjs");
const ref = "0123456789abcdef0123456789abcdef01234567";
const bootstrapModuleUrl = pathToFileURL(
  path.join(root, "scripts/bootstrap.mjs"),
).href;
const bootstrapSource = `
import { writeFileSync } from "node:fs";
import { parseBootstrapArgs } from ${JSON.stringify(bootstrapModuleUrl)};

const parsed = parseBootstrapArgs(process.argv.slice(2));
writeFileSync(
  process.env.PF_LAUNCHER_TEST_RECEIPT,
  JSON.stringify({
    parsed,
    cwd: process.cwd(),
    stdinIsTTY: process.stdin.isTTY,
  }),
);
process.exit(Number(process.env.PF_LAUNCHER_TEST_BOOTSTRAP_EXIT ?? "0"));
`;
const bootstrapSha256 = createHash("sha256")
  .update(bootstrapSource)
  .digest("hex");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0))
    spawnSync("/bin/rm", ["-rf", "--", temporaryRoot]);
});

function temporaryRoot() {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "process foundry launcher test "),
  );
  temporaryRoots.push(directory);
  return directory;
}

function render(args: string[]) {
  return spawnSync(process.execPath, [renderer, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

function executable(file: string, source: string) {
  writeFileSync(file, source, { mode: 0o755 });
  chmodSync(file, 0o755);
}

function systemCommand(name: string) {
  const result = spawnSync(
    "/usr/bin/env",
    ["bash", "-lc", `command -v ${name}`],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error(`${name} is required for this test`);
  return result.stdout.trim();
}

function makeFixture(
  options: {
    includeTar?: boolean;
    nodeVersion?: string;
    npmVersion?: string;
  } = {},
) {
  const fixtureRoot = temporaryRoot();
  const bin = path.join(fixtureRoot, "fixture bin");
  const cwd = path.join(fixtureRoot, "working directory");
  mkdirSync(bin);
  mkdirSync(cwd);

  for (const command of ["mktemp", "rm"])
    symlinkSync(systemCommand(command), path.join(bin, command));
  executable(
    path.join(bin, "node"),
    `#!/bin/sh
if [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then
  printf '%s\\n' ${shellQuote(options.nodeVersion ?? "v24.15.0")}
  exit 0
fi
exec ${shellQuote(systemCommand("node"))} "$@"
`,
  );
  executable(
    path.join(bin, "npm"),
    `#!/bin/sh
if [ "$#" -eq 1 ] && [ "$1" = "--version" ]; then
  printf '%s\\n' ${shellQuote(options.npmVersion ?? "12.0.0")}
  exit 0
fi
exit 0
`,
  );
  if (options.includeTar !== false)
    executable(path.join(bin, "tar"), "#!/bin/sh\nexit 0\n");
  executable(
    path.join(bin, "curl"),
    `#!/bin/sh
output=''
url=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--output' ]; then
    output=$2
    shift 2
  elif [ "\${1#https://}" != "$1" ]; then
    url=$1
    shift
  else
    shift
  fi
done
printf '%s\\n%s\\n' "$output" "$url" > "$PF_LAUNCHER_TEST_CURL_LOG"
if [ "\${PF_LAUNCHER_TEST_CURL_EXIT:-0}" -ne 0 ]; then
  exit "$PF_LAUNCHER_TEST_CURL_EXIT"
fi
cp "$PF_LAUNCHER_TEST_DOWNLOAD" "$output"
`,
  );
  symlinkSync(systemCommand("cp"), path.join(bin, "cp"));

  const download = path.join(fixtureRoot, "synthetic bootstrap.mjs");
  const receipt = path.join(fixtureRoot, "bootstrap receipt.json");
  const curlLog = path.join(fixtureRoot, "curl output path.txt");
  const launcher = path.join(fixtureRoot, "install.sh");
  writeFileSync(download, bootstrapSource);
  const rendered = render([
    "--ref",
    ref,
    "--bootstrap-sha256",
    bootstrapSha256,
  ]);
  expect(rendered.status).toBe(0);
  writeFileSync(launcher, rendered.stdout, { mode: 0o755 });

  return { fixtureRoot, bin, cwd, download, receipt, curlLog, launcher };
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function executeLauncher(
  fixture: ReturnType<typeof makeFixture>,
  args: string[] = [],
  env: Record<string, string> = {},
) {
  const command = `/bin/cat ${shellQuote(fixture.launcher)} | /bin/bash -s -- ${args
    .map(shellQuote)
    .join(" ")}`;
  return spawnSync(systemCommand("script"), ["-qefc", command, "/dev/null"], {
    cwd: fixture.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: fixture.bin,
      PF_LAUNCHER_TEST_DOWNLOAD: fixture.download,
      PF_LAUNCHER_TEST_RECEIPT: fixture.receipt,
      PF_LAUNCHER_TEST_CURL_LOG: fixture.curlLog,
      ...env,
    },
  });
}

function launcherTemporaryDirectory(fixture: ReturnType<typeof makeFixture>) {
  return path.dirname(readFileSync(fixture.curlLog, "utf8").split("\n")[0]!);
}

function launcherDownloadUrl(fixture: ReturnType<typeof makeFixture>) {
  return readFileSync(fixture.curlLog, "utf8").split("\n")[1];
}

describe("release install launcher renderer", () => {
  it.each([
    { args: [], message: "--ref must be exactly 40" },
    {
      args: ["--ref", "main", "--bootstrap-sha256", bootstrapSha256],
      message: "--ref must be exactly 40",
    },
    {
      args: [
        "--ref",
        `${ref}; touch escaped`,
        "--bootstrap-sha256",
        bootstrapSha256,
      ],
      message: "--ref must be exactly 40",
    },
    {
      args: ["--ref", ref, "--bootstrap-sha256", "ABC"],
      message: "--bootstrap-sha256 must be exactly 64",
    },
    {
      args: ["--ref", ref, "--bootstrap-sha256", `${bootstrapSha256}\nunsafe`],
      message: "--bootstrap-sha256 must be exactly 64",
    },
    {
      args: [
        "--ref",
        ref,
        "--bootstrap-sha256",
        bootstrapSha256,
        "--output",
        "install.sh",
      ],
      message: "Unknown option: --output",
    },
    {
      args: ["--ref", ref, "--ref", ref, "--bootstrap-sha256", bootstrapSha256],
      message: "Duplicate option: --ref",
    },
  ])("rejects malformed or unsafe renderer input", ({ args, message }) => {
    const result = render(args);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(message);
  });

  it("renders deterministic output with an exact immutable bootstrap URL", () => {
    const args = ["--ref", ref, "--bootstrap-sha256", bootstrapSha256];
    const first = render(args);
    const second = render(args);

    expect(first.status).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toContain(
      `https://raw.githubusercontent.com/maxjustships/process-foundry/${ref}/scripts/bootstrap.mjs`,
    );
    expect(first.stdout).toContain(`readonly launcher_ref='${ref}'`);
    expect(first.stdout).toContain(
      `readonly launcher_bootstrap_sha256='${bootstrapSha256}'`,
    );
    expect(first.stdout).not.toContain("eval");
  });

  it("does not execute bootstrap when the downloaded digest mismatches and cleans its temp directory", () => {
    const fixture = makeFixture();
    const launcher = readFileSync(fixture.launcher, "utf8").replace(
      bootstrapSha256,
      "0".repeat(64),
    );
    writeFileSync(fixture.launcher, launcher, { mode: 0o755 });

    const result = executeLauncher(fixture);

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain("SHA-256 mismatch");
    expect(existsSync(fixture.receipt)).toBe(false);
    expect(existsSync(launcherTemporaryDirectory(fixture))).toBe(false);
  });

  it("propagates a curl download failure and removes the temp directory", () => {
    const fixture = makeFixture();

    const result = executeLauncher(fixture, [], {
      PF_LAUNCHER_TEST_CURL_EXIT: "37",
    });

    expect(result.status).toBe(37);
    expect(existsSync(fixture.receipt)).toBe(false);
    expect(existsSync(launcherTemporaryDirectory(fixture))).toBe(false);
  });

  it("reports a missing prerequisite before downloading", () => {
    const fixture = makeFixture({ includeTar: false });

    const result = executeLauncher(fixture);

    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain(
      "Required command not found: tar.",
    );
    expect(existsSync(fixture.curlLog)).toBe(false);
    expect(existsSync(fixture.receipt)).toBe(false);
  });

  it.each(["v22.22.1", "v22.22.2-rc.1", "v23.0.0", "v24.14.9", "v25.0.0"])(
    "rejects unsupported Node version %s before downloading",
    (nodeVersion) => {
      const fixture = makeFixture({ nodeVersion });

      const result = executeLauncher(fixture);

      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain(
        "Node.js ^22.22.2 or ^24.15.0 is required.",
      );
      expect(existsSync(fixture.curlLog)).toBe(false);
      expect(existsSync(fixture.receipt)).toBe(false);
    },
  );

  it.each(["11.9.0", "12.0.0-beta.1"])(
    "rejects unsupported npm version %s before downloading",
    (npmVersion) => {
      const fixture = makeFixture({ npmVersion });

      const result = executeLauncher(fixture);

      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain(
        "npm 12 or newer is required.",
      );
      expect(existsSync(fixture.curlLog)).toBe(false);
      expect(existsSync(fixture.receipt)).toBe(false);
    },
  );

  it.each(["v22.22.2", "v24.15.0"])(
    "passes the pinned ref and optional directory through the real bootstrap parser on Node %s",
    (nodeVersion) => {
      const fixture = makeFixture({ nodeVersion });
      const destination = path.join(fixture.cwd, "installation with spaces");

      const result = executeLauncher(fixture, ["--directory", destination]);

      expect(result.status).toBe(0);
      expect(JSON.parse(readFileSync(fixture.receipt, "utf8"))).toEqual({
        parsed: { directory: destination, ref },
        cwd: fixture.cwd,
        stdinIsTTY: true,
      });
      expect(launcherDownloadUrl(fixture)).toBe(
        `https://raw.githubusercontent.com/maxjustships/process-foundry/${ref}/scripts/bootstrap.mjs`,
      );
      expect(existsSync(launcherTemporaryDirectory(fixture))).toBe(false);
    },
  );

  it.each([
    { args: ["--ref", ref], message: "Unsupported option: --ref" },
    {
      args: ["--repo", "another/repository"],
      message: "Unsupported option: --repo",
    },
    {
      args: ["--archive", "/tmp/release.tgz"],
      message: "Unsupported option: --archive",
    },
    { args: ["--unknown"], message: "Unknown option: --unknown" },
    {
      args: ["--directory", "first", "--directory", "second"],
      message: "Duplicate option: --directory",
    },
    {
      args: ["--directory", ""],
      message: "--directory requires a nonempty value",
    },
    {
      args: ["--directory"],
      message: "--directory requires a nonempty value",
    },
  ])(
    "rejects unsupported launcher arguments before curl: $args",
    ({ args, message }) => {
      const fixture = makeFixture();

      const result = executeLauncher(fixture, args);

      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).toContain(message);
      expect(existsSync(fixture.curlLog)).toBe(false);
      expect(existsSync(fixture.receipt)).toBe(false);
    },
  );

  it.each([0, 29])(
    "propagates bootstrap exit status %i and cleans up",
    (status) => {
      const fixture = makeFixture();
      const installerJournal = path.join(
        fixture.cwd,
        "process-foundry",
        ".process-foundry-installer",
        "journal.json",
      );
      mkdirSync(path.dirname(installerJournal), { recursive: true });
      writeFileSync(installerJournal, "installer-owned");

      const result = executeLauncher(fixture, [], {
        PF_LAUNCHER_TEST_BOOTSTRAP_EXIT: String(status),
      });

      expect(result.status).toBe(status);
      expect(existsSync(fixture.receipt)).toBe(true);
      expect(existsSync(launcherTemporaryDirectory(fixture))).toBe(false);
      expect(readFileSync(installerJournal, "utf8")).toBe("installer-owned");
    },
  );
});
