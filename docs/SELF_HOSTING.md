# Self-hosting Process Foundry

This guide creates a deployer-owned Process Foundry installation on Cloudflare Workers with D1, a private R2 bucket, and Cloudflare Workflows. It uses the repository's production build and deployment scripts and keeps credentials outside the checkout.

The recommended path is the public release launcher:

```bash
bash -o pipefail -c 'curl -fsSL https://github.com/maxjustships/process-foundry/releases/latest/download/install.sh | bash'
```

The `latest` asset URL is a publisher-trusted convenience entry point. The launcher verifies the immutable bootstrap and source revision selected by the release before running them. Inspect the release and launcher first if your trust policy requires independent review.

The wizard uses unique names, validates Cloudflare and OpenAI credentials before mutation, checks collisions, shows the complete resource plan, and asks for explicit confirmation. It creates D1 and private R2, writes those identities into the canonical `wrangler.jsonc`, applies append-only migrations, then deploys the Worker and Workflow together. It finishes by checking `/health` and writing a secret-free receipt.

Alternatively, clone the only source repository, `maxjustships/process-foundry`, and install from a full commit SHA that you audited:

```bash
git clone https://github.com/maxjustships/process-foundry.git
cd process-foundry
git checkout --detach <AUDITED_RELEASE_COMMIT_SHA>
npm ci
npm run installer
```

The committed `wrangler.jsonc` is the canonical neutral configuration: its production environment uses generic resource names, a Cloudflare-managed `workers.dev` hostname, and the non-owner D1 placeholder `00000000-0000-0000-0000-000000000000`. The discoverable `wrangler.production.example.jsonc` carries the same production contract for reference.

Production scripts explicitly select `wrangler.jsonc`; they do not discover a separate `wrangler.production.jsonc`. The all-zero UUID is permitted for local production typegen, template build, and deploy dry-run validation. It must be replaced in an uncommitted, operator-owned deployment checkout before migration or real deploy; the installer does this automatically after D1 creation. The real-deploy guard enforces a valid non-template UUID before build or any Wrangler deploy command. Do not commit the operator's resource ID, account metadata, credentials, or secrets.

## Prerequisites and authentication

- Node.js 22.22.2+ on the 22.x line or 24.15+ on the 24.x line, npm 12+, and `curl`, `tar`, and Bash when using the public launcher.
- A Cloudflare account with Workers, D1, R2, and Workflows available.
- Wrangler authorization for the Cloudflare account that will own every resource. Prefer `CLOUDFLARE_API_TOKEN` or an explicit regular token file. OAuth can create an installation when the operator explicitly chooses it and uses `wrangler login --use-keyring`; failed token authentication never triggers a browser or plaintext fallback. Resuming or upgrading an installation whose Worker deployment is recorded complete requires token authentication for direct Cloudflare API verification of the recorded Worker identity and URL.
- An OpenAI API key with access to direct `gpt-transcribe` and `gpt-5.6-terra` Responses requests.
- A high-entropy private mnemonic for the shared login and two independent high-entropy values for session signing and feedback export.

Install the locked dependencies, authenticate Wrangler, and confirm the selected Cloudflare account:

```bash
npm ci
npm exec wrangler -- login
npm exec wrangler -- whoami
```

Treat the installation as private. Process Foundry has one shared mnemonic rather than individual accounts or RBAC.

## Installer state, recovery, and ownership

The ignored `.process-foundry-installer/state.json` is a journal, not a second deployment configuration. It records installation/account/resource identifiers and completed steps but never credentials, the shared phrase, auth verifier, signing material, provider key, or token. `wrangler.jsonc` remains the single input to guards, build, migrations, and deploy.

Use `npm run installer:resume` after a definite failure. Completed D1/R2 steps are not recreated. A bootstrap failure after the installer starts preserves the checkout and journal and prints the exact `cd ... && npm run installer:resume` command; only the temporary downloaded archive is removed. If a create command times out, is interrupted, or returns an unparseable success, the journal marks it `uncertain` and resume refuses to retry. Supply one of the explicit recovery requests below; before changing the journal or applying migrations, the installer performs read-only lookups in the recorded account and requires the exact D1 name and UUID, R2 name, or Worker identity, new deployment, and provider-derived `workers.dev` URL:

```bash
npm run installer:resume -- --accept-created-d1 <VERIFIED_D1_UUID>
npm run installer:resume -- --accept-created-r2
npm run installer:resume -- --accept-deployed https://<VERIFIED_WORKER>.workers.dev
npm run installer:resume -- --retry-verified-missing d1
```

Never use these acknowledgements to adopt an unknown existing resource. A mismatched, inaccessible, or malformed provider lookup leaves the uncertain journal unchanged. `--retry-verified-missing d1|r2|deploy` authorizes one retry only when its read-only lookup proves the recorded target is absent; an existing Worker is treated as a collision even when it has zero deployments. Initial creation can use explicit Wrangler OAuth, but a resume or upgrade whose journal records a completed deployment requires `CLOUDFLARE_API_TOKEN` or the token-file option. The installer uses that token only against fixed Cloudflare API endpoints to verify the recorded Worker identity and provider-derived URL; it never requests the supplied URL. The installer performs no automatic rollback or deletion. Any destructive cleanup requires separate operator scope and confirmation. A Worker rollback never implies a D1 rollback.

## 1. Review the neutral production Wrangler configuration

The canonical configuration and example both enable a Cloudflare-managed `workers.dev` hostname. The neutral contract uses generic names; the installer safely replaces them with one unique installation root. Keep these binding and class names unchanged because the application uses them:

- D1 binding: `DB`
- R2 binding: `SOURCES`
- Workflow binding: `GENERATION_WORKFLOW`
- Workflow class: `GenerationWorkflow`

Unique installer-generated production names are supported. Custom routes remain outside the verified release contract. A D1 database ID is a resource identifier rather than a secret, but it must belong to the deploying account and must not be committed to this public repository. Artifact verification compares the generated production artifact semantically with this same canonical configuration.

## 2. Create D1 and private R2 resources

Create the production D1 database using the same name as the example:

```bash
npm exec wrangler -- d1 create process-foundry-production
```

Copy the returned database ID into `env.production.d1_databases[0].database_id` in `wrangler.jsonc`, replacing `00000000-0000-0000-0000-000000000000` in the uncommitted deployment checkout. Local template build and dry-run checks may run before this replacement, but it is mandatory before the migration or real deploy steps below.

Create the R2 source bucket:

```bash
npm exec wrangler -- r2 bucket create process-foundry-production-sources
```

R2 buckets are private unless public access is separately enabled. Do not enable an `r2.dev` URL or a public custom domain for `SOURCES`.

The Workflow does not require a separate create command. The production `workflows` binding in `wrangler.jsonc` registers `GenerationWorkflow` during deployment.

Generate and check the production binding types and deployment artifact before any remote data change:

```bash
npm run typegen:production
npm run build:production
npm run deploy:dry-run:production
```

## 3. Apply D1 migrations

The repository currently contains these append-only migrations, in order:

1. `0001_initial.sql`
2. `0002_review_clarifications.sql`
3. `0003_tester_priorities_slice1.sql`
4. `0004_structured_table_sources.sql`
5. `0005_job_output_locale.sql`

After replacing the all-zero UUID, apply all pending migrations to the `DB` binding selected from the production environment:

```bash
npm run db:migrate:production
```

Migrations are the durable data boundary. Review every new migration before an upgrade and take an operator-managed D1 backup outside the repository when your recovery policy requires one. A Worker rollback does not undo a D1 migration.

## 4. Derive authentication values and prepare secrets

Run the repository helper in an interactive terminal:

```bash
npm run auth:derive
```

The prompt hides the mnemonic. The command normalizes it and prints only a newly generated salt and its PBKDF2-SHA256 verifier; the mnemonic itself is not stored. Use a secure editor to place those two assignments in an operator-owned `.env` or JSON secrets file outside the repository. The installer instead creates JSON in an external directory with directory mode `0700` and file mode `0600`.

Add all five required production secrets to that same file:

- `AUTH_PHRASE_SALT` from `auth:derive`
- `AUTH_PHRASE_VERIFIER` from `auth:derive`
- `SESSION_SIGNING_KEY`, an independent high-entropy value
- `OPENAI_API_KEY`, the direct OpenAI credential
- `FEEDBACK_EXPORT_TOKEN`, another independent high-entropy value

Restrict access to the file without printing any value:

```bash
chmod 600 /absolute/path/to/process-foundry.production.secrets
```

Do not use `echo`, command-line secret arguments, shell history, the Wrangler config, `.env` inside the checkout, or `.dev.vars` to transport production values. Do not reuse the mnemonic as a signing key or feedback token.

Retain the external secrets file for the lifetime of the installation because resume and upgrade reuse it without resetting authentication or data. Keep an encrypted operator-controlled backup: losing these values can invalidate sessions or make the current login phrase impractical to reproduce. Delete the file only after the installation has been retired or every value has deliberately been replaced and recovery no longer depends on it; deletion is always a manual operator action.

## 5. Deploy

The production deployment script requires the external secrets-file path, validates exactly the five required non-empty secret names, rejects the template or malformed D1 UUID and unsafe production routing/AI settings before build, rebuilds with `CLOUDFLARE_ENV=production`, verifies the generated artifact, and sends code plus all five secrets in one strict deployment:

```bash
BPMN_BUILDER_PRODUCTION_SECRETS=/absolute/path/to/process-foundry.production.secrets npm run deploy:production
```

The environment variable contains only a file path, not a secret value. `npm run deploy` is an alias for the same command. Record the deployed URL and version from Wrangler's output. You can confirm that the required secret names exist without revealing their values:

```bash
npm exec wrangler -- secret list --env production --config wrangler.jsonc
```

## 6. Verify the installation

Use anonymized material for verification.

1. Request `https://<YOUR_WORKER_HOST>/health` and require a successful response.
2. Open `https://<YOUR_WORKER_HOST>/demo` and confirm the public surface loads without entering the mnemonic.
3. Open the project workspace, log in with the mnemonic used by `auth:derive`, and create a project.
4. Generate from an anonymized text source. Confirm the job survives a page refresh, then review questions, assumptions, source references, and the editable diagram.
5. Export the `.bpmn` file and open it in a BPMN-compatible viewer. Exercise an explicit retry.
6. Repeat with small anonymized audio, image, and structured-table sources to verify the approved OpenAI path and R2 uploads.
7. Submit a rating and feedback, then delete the test project and verify it no longer appears.

Do not treat a successful build or health response as proof of semantic correctness. A human reviewer must inspect the diagram and evidence.

## Security and privacy operations

- Keep the R2 bucket private and restrict Cloudflare account access to the operators who need it.
- Put access controls appropriate to a private deployment in front of the hostname; the shared mnemonic is the application's only login boundary.
- Never log or export source content, transcripts, node labels, correction text, feedback text, cookies, authorization headers, signed URLs, or provider bodies.
- Keep `MOCK_AI=false` in production. Do not silently substitute a provider, model, reasoning level, or transport. OpenAI requests use the direct API with `store: false`.
- Rotate the mnemonic by rerunning `npm run auth:derive` and replacing both auth values together in a new deployment. Rotate the other secrets independently and expect existing sessions to end when the signing key changes.
- Retain source and project material until explicit verified deletion. Do not add automatic purging without adopting and reviewing a retention policy.
- Review [SECURITY.md](../SECURITY.md) before publishing or operating the service.

## Upgrades

`npm run installer:upgrade` redeploys the source already present in the current checkout. It does not download a release or verify that the checkout matches `--release-ref`; that option only records the supplied full commit SHA in the journal. Before upgrading, review the source change, the production configuration contract, every new migration, and the release notes included with the source you obtained.

For an installer-owned release checkout, obtain a separately pinned public source checkout and carry forward only the installation-owned state and configuration. Keep the old checkout and the external secrets file in place until the upgrade is verified:

```bash
export PF_OLD_CHECKOUT=/absolute/path/to/current-process-foundry
export PF_NEW_CHECKOUT=/absolute/path/to/new-process-foundry
export PF_AUDITED_REF=PASTE_THE_AUDITED_40_CHARACTER_SHA_HERE
git clone https://github.com/maxjustships/process-foundry.git "$PF_NEW_CHECKOUT"
git -C "$PF_NEW_CHECKOUT" checkout --detach "$PF_AUDITED_REF"
test "$(git -C "$PF_NEW_CHECKOUT" rev-parse HEAD)" = "$PF_AUDITED_REF"
cp -a "$PF_OLD_CHECKOUT/.process-foundry-installer" "$PF_NEW_CHECKOUT/"
cp "$PF_OLD_CHECKOUT/wrangler.jsonc" "$PF_NEW_CHECKOUT/wrangler.jsonc"
cd "$PF_NEW_CHECKOUT"
npm ci
npm run check
npm run installer:upgrade -- --release-ref "$PF_AUDITED_REF"
```

The copied journal continues to reference the existing external secrets file; do not move, regenerate, or replace it. The copied installer-generated `wrangler.jsonc` preserves the owned D1/R2/Workflow/Worker identities; never replace it with the neutral configuration or recreate those resources. Authenticate the upgrade with `CLOUDFLARE_API_TOKEN` or the token-file option because the completed Worker identity check uses the direct Cloudflare API.

The upgrade reuses the same resources and external secrets, applies only pending append-only migrations, and deploys a new version. It does not reset authentication or application data.

For a manually managed installation, preserve the complete operator-owned `wrangler.jsonc` and external secrets file when moving reviewed source into a new deployment checkout. Compare the new production configuration contract and merge any required structural changes without replacing owned resource names or IDs. Then run the local gates:

```bash
npm ci
npm run check
npm run typegen:production
npm run build:production
npm run deploy:dry-run:production
```

Take any required D1 backup outside the repository, apply reviewed migrations, and deploy with the same external secrets file:

```bash
npm run db:migrate:production
BPMN_BUILDER_PRODUCTION_SECRETS=/absolute/path/to/process-foundry.production.secrets npm run deploy:production
```

Repeat the health, login, generation, editing, export, and deletion checks after deployment.

## Rollback

List deployed versions and inspect the version you intend to restore:

```bash
npm exec wrangler -- versions list --env production --config wrangler.jsonc
npm exec wrangler -- versions view <VERSION_ID> --env production --config wrangler.jsonc
```

With explicit operator approval, roll back the Worker:

```bash
npm exec wrangler -- rollback <VERSION_ID> --env production --config wrangler.jsonc
```

A Worker rollback does not reverse D1 migrations, R2 writes or deletions, custom-domain configuration, or project deletion. Prefer a reviewed forward migration for schema problems; restore D1 from an operator backup only under a separate recovery procedure. In-flight Workflow jobs may span versions, so inspect their state and avoid introducing incompatible step or payload changes during upgrades.
