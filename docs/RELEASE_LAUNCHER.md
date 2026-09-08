# Release launcher procedure

This procedure packages an already audited Process Foundry source commit as the
`install.sh` release asset. It does not publish anything by itself.

## Render from audited bytes

Start only after the final source commit has passed the security audit and is
available in `maxjustships/process-foundry`. Use the exact commit object, not a
branch or tag name. Keep staging outside the checkout so the generated asset and
downloaded verification files cannot enter the source commit they pin.

```bash
RELEASE_REF="${FULL_40_CHARACTER_SOURCE_COMMIT_SHA}"
STAGING_DIR="$(mktemp -d)"
BOOTSTRAP_BLOB="$STAGING_DIR/bootstrap.mjs"

git show "$RELEASE_REF:scripts/bootstrap.mjs" > "$BOOTSTRAP_BLOB"
BOOTSTRAP_SHA256="$(node -e '
  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
' "$BOOTSTRAP_BLOB")"

node scripts/render-install-launcher.mjs \
  --ref "$RELEASE_REF" \
  --bootstrap-sha256 "$BOOTSTRAP_SHA256" \
  > "$STAGING_DIR/install.sh"
```

The renderer accepts only an explicit 40-character lowercase hexadecimal ref
and an exact 64-character lowercase hexadecimal bootstrap digest. Its output is
deterministic and goes only to stdout.

The generated launcher requires Node.js `^22.22.2 || ^24.15.0` and npm 12 or
newer. It accepts only one optional `--directory VALUE` argument; the caller's
working directory and spaces in the value are preserved. Source overrides such
as `--ref`, `--repo`, and `--archive`, duplicate `--directory` options, and all
unknown arguments are rejected before any download.

## Inspect and test before release

Read both the audited bootstrap blob and the complete generated launcher. Then
run the repository checks and shell syntax check; the targeted test executes the
generated Bash with a synthetic local download and a real pseudo-terminal. Its
mock bootstrap main calls the repository's real `parseBootstrapArgs` before
recording the parsed result, without downloading or provisioning anything.

```bash
sed -n '1,260p' "$BOOTSTRAP_BLOB"
sed -n '1,260p' "$STAGING_DIR/install.sh"
bash -n "$STAGING_DIR/install.sh"
npx vitest run --config vitest.config.ts tests/unit/render-install-launcher.test.ts
```

Record the staged launcher digest before attaching exactly that file as
`install.sh` to the GitHub release for the audited source commit:

```bash
INSTALL_SH_SHA256="$(node -e '
  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
' "$STAGING_DIR/install.sh")"
printf '%s  %s\n' "$INSTALL_SH_SHA256" "$STAGING_DIR/install.sh"
```

Creating the public repository, pushing the audited commit, creating the GitHub
release, and uploading the asset are explicit owner actions after audit. Do not
publish from this preparation lane.

## Verify the published bytes

After publication, independently download the pinned raw bootstrap and release
asset, then compare both against the values computed before publication.

```bash
curl -fsSL \
  "https://raw.githubusercontent.com/maxjustships/process-foundry/$RELEASE_REF/scripts/bootstrap.mjs" \
  --output "$STAGING_DIR/published-bootstrap.mjs"
curl -fsSL \
  "https://github.com/maxjustships/process-foundry/releases/latest/download/install.sh" \
  --output "$STAGING_DIR/published-install.sh"

PUBLISHED_BOOTSTRAP_SHA256="$(node -e '
  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
' "$STAGING_DIR/published-bootstrap.mjs")"
PUBLISHED_INSTALL_SH_SHA256="$(node -e '
  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"));
' "$STAGING_DIR/published-install.sh")"

test "$PUBLISHED_BOOTSTRAP_SHA256" = "$BOOTSTRAP_SHA256"
test "$PUBLISHED_INSTALL_SH_SHA256" = "$INSTALL_SH_SHA256"
```

Finally, from a fresh directory and interactive terminal, run the same public
CTA shown on the landing page:

```bash
bash -o pipefail -c 'curl -fsSL https://github.com/maxjustships/process-foundry/releases/latest/download/install.sh | bash'
```

The release launcher pins an immutable source commit and exact bootstrap bytes.
The `releases/latest` discovery URL is mutable and therefore also relies on the
repository and release publisher remaining trustworthy.
