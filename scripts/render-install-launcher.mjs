#!/usr/bin/env node

const PUBLIC_REPOSITORY = "maxjustships/process-foundry";
const FULL_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

/** @typedef {{ ref: string, bootstrapSha256: string }} LauncherOptions */

/**
 * @param {string[]} argv
 * @returns {LauncherOptions}
 */
function parseArgs(argv) {
  /** @type {Map<string, string>} */
  const values = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--ref" && argument !== "--bootstrap-sha256")
      throw new Error(`Unknown option: ${argument}`);
    if (values.has(argument)) throw new Error(`Duplicate option: ${argument}`);

    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${argument}`);
    values.set(argument, value);
    index += 1;
  }

  const ref = values.get("--ref");
  const bootstrapSha256 = values.get("--bootstrap-sha256");
  if (!ref || !FULL_SHA.test(ref))
    throw new Error(
      "--ref must be exactly 40 lowercase hexadecimal characters",
    );
  if (!bootstrapSha256 || !SHA256.test(bootstrapSha256))
    throw new Error(
      "--bootstrap-sha256 must be exactly 64 lowercase hexadecimal characters",
    );

  return { ref, bootstrapSha256 };
}

/** @param {LauncherOptions} options */
function renderLauncher({ ref, bootstrapSha256 }) {
  const bootstrapUrl = `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/${ref}/scripts/bootstrap.mjs`;

  return `#!/usr/bin/env bash
set -Eeuo pipefail

readonly launcher_ref='${ref}'
readonly launcher_bootstrap_sha256='${bootstrapSha256}'
readonly launcher_bootstrap_url='${bootstrapUrl}'
launcher_tmp_dir=''
launcher_directory=''
launcher_directory_set=0

launcher_error() {
  printf 'Process Foundry installer: %s\\n' "$*" >&2
  exit 1
}

launcher_cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$launcher_tmp_dir" ]]; then
    if ! rm -rf -- "$launcher_tmp_dir"; then
      printf 'Process Foundry installer: could not remove temporary directory %s.\\n' "$launcher_tmp_dir" >&2
      if [[ "$status" -eq 0 ]]; then
        status=1
      fi
    fi
  fi
  exit "$status"
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --directory)
      if [[ "$launcher_directory_set" -eq 1 ]]; then
        launcher_error 'Duplicate option: --directory'
      fi
      if [[ "$#" -lt 2 || -z "$2" ]]; then
        launcher_error '--directory requires a nonempty value'
      fi
      launcher_directory="$2"
      launcher_directory_set=1
      shift 2
      ;;
    --ref|--repo|--archive)
      launcher_error "Unsupported option: $1"
      ;;
    *)
      launcher_error "Unknown option: $1"
      ;;
  esac
done

for launcher_command in node curl tar npm; do
  command -v "$launcher_command" >/dev/null 2>&1 || \
    launcher_error "Required command not found: $launcher_command. Install it and rerun this command."
done

launcher_node_version="$(node --version)" || \
  launcher_error 'Node.js ^22.22.2 or ^24.15.0 is required.'
readonly launcher_node_version
node -e '
  const numeric = "(0|[1-9][0-9]*)";
  const match = new RegExp("^v?" + numeric + "[.]" + numeric + "[.]" + numeric + "(?:[+][0-9A-Za-z.-]+)?$", "u").exec(process.argv[1]);
  if (!match) process.exit(1);
  const [, majorText, minorText, patchText] = match;
  const [major, minor, patch] = [majorText, minorText, patchText].map(Number);
  const atLeast = (requiredMinor, requiredPatch) =>
    minor > requiredMinor || (minor === requiredMinor && patch >= requiredPatch);
  const supported =
    (major === 22 && atLeast(22, 2)) ||
    (major === 24 && atLeast(15, 0));
  process.exit(supported ? 0 : 1);
' "$launcher_node_version" || \
  launcher_error 'Node.js ^22.22.2 or ^24.15.0 is required.'

launcher_npm_version="$(npm --version)" || \
  launcher_error 'npm 12 or newer is required.'
readonly launcher_npm_version
node -e '
  const numeric = "(0|[1-9][0-9]*)";
  const match = new RegExp("^" + numeric + "[.]" + numeric + "[.]" + numeric + "(?:[+][0-9A-Za-z.-]+)?$", "u").exec(process.argv[1]);
  process.exit(match && Number(match[1]) >= 12 ? 0 : 1);
' "$launcher_npm_version" || \
  launcher_error 'npm 12 or newer is required.'

if ! (: </dev/tty) 2>/dev/null; then
  launcher_error 'An interactive terminal is required so the installer can read masked input from /dev/tty.'
fi

launcher_tmp_dir="$(mktemp -d "\${TMPDIR:-/tmp}/process-foundry-launcher.XXXXXXXX")" || \
  launcher_error 'Could not create a temporary download directory.'
trap launcher_cleanup EXIT
readonly launcher_bootstrap_path="$launcher_tmp_dir/bootstrap.mjs"

curl -fsSL --proto '=https' --tlsv1.2 \
  --output "$launcher_bootstrap_path" "$launcher_bootstrap_url"

launcher_actual_sha256="$(node -e '
  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
' "$launcher_bootstrap_path")"

if [[ "$launcher_actual_sha256" != "$launcher_bootstrap_sha256" ]]; then
  launcher_error "Bootstrap SHA-256 mismatch: expected $launcher_bootstrap_sha256, received $launcher_actual_sha256."
fi

launcher_bootstrap_args=(--ref "$launcher_ref")
if [[ "$launcher_directory_set" -eq 1 ]]; then
  launcher_bootstrap_args+=(--directory "$launcher_directory")
fi

node "$launcher_bootstrap_path" "\${launcher_bootstrap_args[@]}" </dev/tty
`;
}

try {
  process.stdout.write(renderLauncher(parseArgs(process.argv.slice(2))));
} catch (error) {
  console.error(`render-install-launcher: ${error.message}`);
  process.exitCode = 1;
}
