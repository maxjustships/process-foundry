# Process Foundry

Process Foundry turns fragmented process knowledge—messy notes, recorded or uploaded audio, images, and structured tables—into an evidence-backed BPMN diagram that people can inspect, correct, and keep improving.

The pipeline is deliberate: sources become traceable evidence, evidence becomes a schema- and invariant-validated `ProcessIR`, and that IR is compiled into deterministic BPMN 2.0 XML and BPMN-DI. The result opens in an embedded `bpmn-js` editor, retains its review context, and exports as a standard `.bpmn` file.

On a deployed instance, `/demo` is the public product surface. The project workspace remains behind the shared mnemonic login.

## What it produces

- An editable BPMN diagram with deterministic XML and diagram layout for the same validated IR.
- Source references, assumptions, and explicit questions where the evidence is incomplete or ambiguous.
- Saved revisions for review and comparison, plus `.bpmn` export.
- Durable generation status, explicit retries, ratings, and first-party feedback handling.

Structural validation does not assert that a diagram is semantically correct for the real-world process. Process Foundry keeps evidence and ambiguity visible so a reviewer can make that judgment.

## Inputs and supported BPMN

Process Foundry accepts:

- Text and corrections, up to 50,000 characters each.
- Browser-recorded or uploaded audio: up to two confirmed sources per project, 15 minutes and 25 MB per source.
- JPEG, PNG, WebP, HEIC, and HEIF images: up to eight per project and 10 MB each after optional client-side resizing.
- Structured tables.

The current BPMN subset covers start and end events, tasks, sequence flows, exclusive and parallel gateways, pools, lanes, annotations, and evidence-backed basic message and timer events. Unsupported or weakly supported constructs must be surfaced as questions rather than invented.

## Architecture

- React Router 8 full-stack SSR runs on Cloudflare Workers through the first-party Cloudflare Vite plugin. `bpmn-js` stays client-only.
- D1 stores projects, generation jobs, review state, revisions, safe semantic telemetry, feedback, and deletion receipts.
- Private R2 stores source objects. Cloudflare Workflows runs durable, idempotent processing outside the request path, with one active generation job per project.
- Direct OpenAI `gpt-transcribe` handles transcription. Direct OpenAI Responses with `gpt-5.6-terra`, high reasoning, image input, strict structured output, and `store: false` extracts typed `ProcessIR`.
- Zod and domain validators enforce the IR schema, references, and supported-subset invariants. One bounded repair is allowed.
- A deterministic compiler emits BPMN XML and BPMN-DI, then `bpmn-moddle` parses the result before it is accepted.

Every generation attempt records the exact provider, model, reasoning level, prompt version, and schema version. The application does not silently switch provider, model, reasoning level, or transport.

## Local quickstart

Requirements: Node.js 22.22.2+ on the 22.x line or 24.15+ on the 24.x line, npm 12+, and no Cloudflare login when using the local mocked provider.

```bash
npm ci
cp .dev.vars.example .dev.vars
npm run auth:derive
```

`auth:derive` reads the mnemonic in a hidden interactive prompt and prints only its random salt and PBKDF2-SHA256 verifier. Paste those assignments into `.dev.vars`. Set `SESSION_SIGNING_KEY` and `FEEDBACK_EXPORT_TOKEN` to separate high-entropy values. The committed local configuration uses `MOCK_AI=true`, so local development does not call OpenAI.

```bash
npm run db:migrate
npm run dev
```

Open `http://localhost:5173`. Local D1, R2, and Workflow state persists under the ignored `.wrangler/` directory.

## Guided self-hosted installation

Requirements: Node.js 22.22.2+ on the 22.x line or 24.15+ on the 24.x line, npm 12+, and `curl`, `tar`, and Bash. You also need a Cloudflare API token (preferred) or must explicitly choose Wrangler OAuth, your own OpenAI API key, and a shared login phrase. The installer does not purchase or change paid plans.

Run the public release launcher:

```bash
bash -o pipefail -c 'curl -fsSL https://github.com/maxjustships/process-foundry/releases/latest/download/install.sh | bash'
```

The `latest` asset URL is a publisher-trusted convenience entry point, not a cryptographically immutable URL. The launcher downloads and verifies an immutable bootstrap and source revision before running them. Inspect the release and launcher first if your trust policy requires independent review.

Alternatively, install from a source checkout pinned to a full commit SHA that you audited:

```bash
git clone https://github.com/maxjustships/process-foundry.git
cd process-foundry
git checkout --detach <AUDITED_RELEASE_COMMIT_SHA>
npm ci
npm run installer
```

The wizard accepts `CLOUDFLARE_API_TOKEN` or an explicit token file without opening a browser. OAuth is an explicit alternative and uses Wrangler's OS-keyring mode; an authentication failure stops with guidance and never silently changes methods. The OpenAI key and shared phrase use masked prompts. Before any remote mutation, the wizard validates authentication and provider access, checks for collisions, shows the exact unique D1/private R2/Workflow/Worker names, and requires confirmation. A local fixture archive is test-only and is not proof of a public audited release.

Installation intent and completed steps are journaled under the ignored `.process-foundry-installer/` directory. Resume and upgrade keep the same owned resources, data, and secrets:

```bash
npm run installer:resume
```

`npm run installer:upgrade` rebuilds and redeploys the code already in the current checkout while retaining the recorded resource identity and external secrets. It does not fetch newer source. Supplying `--release-ref` records a commit SHA but does not download or verify that revision. This release has no integrated source-refresh command for a checkout created from the release archive; follow the [pinned-source upgrade sequence](docs/SELF_HOSTING.md#upgrades) to obtain and audit newer source while preserving the installer journal, installer-generated `wrangler.jsonc`, and referenced external secrets.

An ambiguous create/deploy result stops without deleting, adopting, overwriting, or retrying the resource. Follow the printed recovery instruction and use an explicit `--accept-created-d1 <UUID>`, `--accept-created-r2`, or `--accept-deployed <URL>`; the installer then queries the recorded account and accepts only the exact resource identity and actual Worker deployment/URL. `--retry-verified-missing d1|r2|deploy` also performs a read-only absence lookup before it authorizes one retry. An inaccessible, malformed, mismatched, or still-present result leaves the uncertain journal unchanged. See [self-hosting](docs/SELF_HOSTING.md) for secrets retention, manual deployment, recovery, upgrades, and rollback.

## Canonical scripts

These are the exact scripts exposed by `package.json`:

| Command                             | Purpose                                                          |
| ----------------------------------- | ---------------------------------------------------------------- |
| `npm run auth:derive`               | Derive the mnemonic salt and verifier through a hidden prompt.   |
| `npm run dev`                       | Start the React Router development server.                       |
| `npm run preview`                   | Build and preview the production bundle locally.                 |
| `npm run format`                    | Apply Prettier formatting.                                       |
| `npm run format:check`              | Check formatting without changing files.                         |
| `npm run installer`                 | Create and deploy a uniquely named self-hosted installation.     |
| `npm run installer:resume`          | Resume without duplicating installer-owned resources.            |
| `npm run installer:upgrade`         | Rebuild and redeploy the current checkout to the same resources. |
| `npm run lint`                      | Run ESLint.                                                      |
| `npm run typegen`                   | Generate local Wrangler and React Router types.                  |
| `npm run typegen:check`             | Verify generated Wrangler binding types.                         |
| `npm run typegen:production`        | Generate isolated production binding types.                      |
| `npm run typecheck`                 | Generate route types and run the TypeScript build.               |
| `npm run test:unit`                 | Run deterministic Node unit tests.                               |
| `npm run test:integration`          | Run local workerd integration tests with real bindings.          |
| `npm run test:e2e`                  | Run the mocked-provider Chromium journey.                        |
| `npm test`                          | Run unit and integration tests.                                  |
| `npm run build`                     | Build, sanitize, and secret-check the Workers bundle.            |
| `npm run bundle:sanitize`           | Sanitize the server build.                                       |
| `npm run bundle:check`              | Check the server bundle for forbidden material.                  |
| `npm run check`                     | Run the complete local release gate.                             |
| `npm run release:verify`            | Verify the generated production deployment artifact.             |
| `npm run build:production`          | Build and verify the production environment.                     |
| `npm run deploy:dry-run:production` | Rebuild and run a no-upload Wrangler deploy check.               |
| `npm run db:migrate`                | Apply D1 migrations to local state.                              |
| `npm run db:migrate:production`     | Apply append-only migrations to the production D1 binding.       |
| `npm run deploy:production`         | Guard, build, and deploy with an external secrets file.          |
| `npm run deploy`                    | Alias for `deploy:production`.                                   |
| `npm run smoke:openai`              | Run the explicitly enabled real-provider preflight.              |

`npm run smoke:openai` refuses to run unless `REAL_OPENAI_SMOKE=1` and `OPENAI_API_KEY` are present. Automated tests use mocked AI and do not call a provider. Deployment commands mutate Cloudflare state; review [self-hosting and release operations](docs/SELF_HOSTING.md) before using them.

### Production release order

The tracked `wrangler.jsonc` is neutral and uses the all-zero production D1 placeholder. That placeholder is permitted for local production typegen, template build, and deploy dry-run validation. In an uncommitted, operator-owned deployment checkout, it must be replaced with the deploying account's D1 UUID before a migration or real deploy; do not commit the operator value. The real-deploy guard enforces a valid non-template UUID before build or any Wrangler deploy command. See the self-hosting guide for the resource-creation and safety sequence.

Run the production gate in this order and stop on the first failure:

```bash
npm ci
npm run check
npm run typegen:production
npm run build:production
npm run deploy:dry-run:production
npm run db:migrate:production
BPMN_BUILDER_PRODUCTION_SECRETS=path/to/secrets.json npm run deploy:production
```

Production type generation uses `CLOUDFLARE_ENV=production`. Review both `build/server/wrangler.json` and `.wrangler/deploy/config.json` against the original `wrangler.jsonc` before approving deployment. The final command publishes code and all five secrets as one deployed version.

The rollback boundary is explicit: a Worker rollback can restore an earlier code version, but append-only D1 migrations are not rolled back. It also does not undo D1/R2 writes, project deletion, or custom-domain changes.

## Privacy boundaries

- Unconfirmed microphone data stays in the browser. Confirmed sources are stored in a private R2 bucket and retained until explicit project deletion.
- Source text and files, transcripts, images, node labels, corrections, feedback text, raw interaction data, secrets, authorization material, signed URLs, and raw provider bodies are excluded from telemetry.
- Semantic telemetry is allowlisted, first-party, stored in D1, and non-blocking. Feedback is stored separately in `feedback_inbox` and is never automatically promoted into prompts, code, expected outputs, or evals.
- Generation uses direct OpenAI requests with `store: false`. Cloudflare AI Gateway caching is not enabled for private source material.
- Project deletion freezes the project, deletes and verifies the R2 object manifest, removes project-domain D1 records and linked telemetry atomically, and retains only an opaque receipt. Explicit feedback remains separate.
- This is a private, shared-mnemonic deployment model. It does not provide accounts, teams, RBAC, billing, or public signup; use only anonymized examples.

## Operate it safely

See [Self-hosting Process Foundry](docs/SELF_HOSTING.md) for deployer-owned Cloudflare resources, secrets, migrations, verification, upgrades, and rollback. See the [security policy](SECURITY.md) for vulnerability reporting and the [Apache 2.0 license](LICENSE) for reuse terms.
