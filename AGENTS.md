# Repository guidance

## Architecture entry points

- `app/root.tsx` and `app/routes.ts` define the React Router SSR shell and routes; route handlers live in `app/routes/`.
- `workers/app.ts` is the Cloudflare Worker request entry point; `workers/generation.ts` owns the durable generation workflow.
- `ai/provider.server.ts` and `ai/openai.server.ts` implement the AI boundary.
- `domain/process-ir.ts` defines and validates `ProcessIR`; `domain/bpmn-compiler.ts` deterministically compiles validated IR to BPMN XML/DI.
- `app/lib/repository.server.ts` is the D1 persistence boundary, with schema changes in append-only `migrations/` files. Source objects belong in private R2.
- `app/components/BpmnEditor.tsx` and `BpmnEditorCore.tsx` are the client-only `bpmn-js` editor boundary.

## Checks

Use the locked toolchain from `package.json` (`npm ci`; supported Node/npm versions are declared there). The canonical full local gate is `npm run check`. For focused work, use the matching non-mutating checks: `npm run format:check`, `npm run public-copy:check`, `npm run lint`, `npm run typegen:check`, `npm run typecheck`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, and `npm run build`.

## Public copy

Lead public-facing copy with the buyer outcome and a concrete next action. Do not foreground implementation details, limitations, or sample/mock/preview framing. Preserve an action CTA such as “Explore the workflow” or “Open workspace,” and run `npm run public-copy:check` for changes to the guarded public files.

## Safety

- Never read, print, copy, or commit credentials, tokens, mnemonic phrases, secret files, provider bodies, or private source content. Use only anonymized fixtures and committed examples.
- Do not deploy, run installers, call real providers, mutate remote Cloudflare resources, apply production migrations, or alter production configuration without explicit operator authorization. Treat `npm run deploy*`, `npm run installer*`, `npm run db:migrate:production`, and `npm run smoke:openai` as operator-only commands.
- Preserve the direct-provider, `store: false`, private-R2, validated-IR, and deterministic-compiler boundaries; surface unsupported or ambiguous BPMN as questions rather than inventing behavior.
