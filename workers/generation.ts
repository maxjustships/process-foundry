import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { BpmnModdle } from "bpmn-moddle";
import {
  buildProcessIrRepairInstruction,
  enforceBpmnOnlyModalityQuestion,
  extractProcess,
  getMockProcessIr,
  PROMPT_VERSION,
  transcribeAudio,
} from "../ai/provider.server";
import { compileProcessIr } from "../domain/bpmn-compiler";
import {
  processIrSchema,
  validateProcessIr,
  type ProcessIR,
} from "../domain/process-ir";
import {
  claimJobExecution,
  getJobBaseVersion,
  getJobOutputLocale,
  getJobSources,
  saveReadyAiVersion,
  setJobStatus,
  storeAiRequestEvent,
  type SourceRow,
  type BaseDiagramSnapshot,
} from "../app/lib/repository.server";
import { getRequiredSecret } from "../app/lib/auth.server";
import { resolveMockWorkflowDelayMs } from "./mock-workflow-delay";

type GenerationParams = { jobId: string; projectId: string };

export async function loadExtractionInputs(
  env: Env,
  sources: SourceRow[],
  baseVersion: BaseDiagramSnapshot | null = null,
): Promise<
  Array<{ kind: "text"; text: string } | { kind: "image"; dataUrl: string }>
> {
  const inputs: Array<
    { kind: "text"; text: string } | { kind: "image"; dataUrl: string }
  > = [];
  if (baseVersion)
    inputs.push({
      kind: "text",
      text: `[base-diagram-snapshot]
This immutable selected base diagram is the starting point for refinement. Preserve its existing semantics and human edits unless the supplied evidence explicitly supports a change. Do not replace it with a fresh alternative.
[base-bpmn-xml]
${baseVersion.bpmn_xml}
[/base-bpmn-xml]
[base-process-ir-json]
${baseVersion.ir_json ?? "(not available)"}
[/base-process-ir-json]
[/base-diagram-snapshot]`,
    });
  for (const source of sources) {
    const isTable = ["csv", "docx", "xlsx"].includes(source.type);
    const key = isTable
      ? source.extracted_r2_key
      : (source.transcript_r2_key ?? source.r2_key);
    if (!key) throw new Error("A confirmed source is unavailable.");
    const object = await env.SOURCES.get(key);
    if (!object) throw new Error("A confirmed source is unavailable.");
    if (source.type === "image") {
      const bytes = new Uint8Array(await object.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      inputs.push({
        kind: "image",
        dataUrl: `data:${source.mime_type};base64,${btoa(binary)}`,
      });
    } else if (isTable)
      inputs.push({ kind: "text", text: await object.text() });
    else
      inputs.push({
        kind: "text",
        text: `[source:${source.id}]\n${await object.text()}`,
      });
  }
  return inputs;
}

export async function loadExtractionInputsForJob(
  env: Env,
  jobId: string,
): ReturnType<typeof loadExtractionInputs> {
  const [sources, baseVersion] = await Promise.all([
    getJobSources(env.DB, jobId),
    getJobBaseVersion(env.DB, jobId),
  ]);
  return loadExtractionInputs(env, sources, baseVersion);
}

export class GenerationWorkflow extends WorkflowEntrypoint<
  Env,
  GenerationParams
> {
  async run(
    event: WorkflowEvent<GenerationParams>,
    step: WorkflowStep,
  ): Promise<{ versionId: string | null }> {
    const { jobId, projectId } = event.payload;
    const attemptId = await step.do("claim-execution", async () =>
      claimJobExecution(this.env.DB, {
        jobId,
        projectId,
        workflowInstanceId: event.instanceId,
      }),
    );
    if (!attemptId) return { versionId: null };
    try {
      const outputLocale = await step.do("load-output-locale", async () =>
        getJobOutputLocale(this.env.DB, jobId),
      );
      const configuredMockDelayMs = Number(this.env.MOCK_AI_DELAY_MS);
      let mockDelayMs = 0;
      if (this.env.MOCK_AI === "true" && configuredMockDelayMs > 0) {
        mockDelayMs = await step.do(
          "resolve-mock-ai-browser-delay",
          async () => {
            const [attemptCount, sources] = await Promise.all([
              this.env.DB.prepare(
                "SELECT COUNT(*) AS value FROM job_attempts WHERE job_id = ?",
              )
                .bind(jobId)
                .first<{ value: number }>(),
              getJobSources(this.env.DB, jobId),
            ]);
            const textInputs: string[] = [];
            for (const source of sources) {
              if (source.type === "audio" || source.type === "image") continue;
              const key = ["csv", "docx", "xlsx"].includes(source.type)
                ? source.extracted_r2_key
                : source.r2_key;
              const object = key ? await this.env.SOURCES.get(key) : null;
              if (object) textInputs.push(await object.text());
            }
            return resolveMockWorkflowDelayMs({
              mockAi: true,
              configuredDelayMs: configuredMockDelayMs,
              attemptNumber: attemptCount?.value ?? 0,
              textInputs,
            });
          },
        );
      }
      if (mockDelayMs > 0)
        await step.sleep("mock-ai-browser-delay", mockDelayMs);
      await step.do(
        "transcribe-audio",
        {
          retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
          timeout: "20 minutes",
        },
        async () => {
          await setJobStatus(this.env.DB, jobId, "transcribing");
          const sources = await getJobSources(this.env.DB, jobId);
          for (const [index, source] of sources
            .filter((item) => item.type === "audio" && !item.transcript_r2_key)
            .entries()) {
            const object = await this.env.SOURCES.get(source.r2_key);
            if (!object)
              throw new Error("Confirmed audio source is unavailable.");
            const transcription =
              this.env.MOCK_AI === "true"
                ? {
                    text: "Mock transcript: review the submitted process evidence.",
                    responseId: `mock-transcription-${source.id}`,
                  }
                : await transcribeAudio(
                    getRequiredSecret(this.env, "OPENAI_API_KEY"),
                    await object.blob(),
                    source.name,
                  );
            const key = `projects/${projectId}/transcripts/${source.id}.txt`;
            await this.env.SOURCES.put(key, transcription.text, {
              httpMetadata: { contentType: "text/plain; charset=utf-8" },
            });
            await this.env.DB.prepare(
              "UPDATE sources SET transcript_r2_key = ? WHERE id = ? AND transcript_r2_key IS NULL",
            )
              .bind(key, source.id)
              .run();
            await storeAiRequestEvent(
              this.env.DB,
              jobId,
              `${jobId}:transcription:${source.id}`,
              20 + index,
              {
                provider: "openai",
                model: "gpt-transcribe",
                result: "success",
                ...(transcription.responseId
                  ? { response_id: transcription.responseId }
                  : {}),
              },
            );
          }
          return {
            transcribedCount: sources.filter(
              (source) => source.type === "audio",
            ).length,
          };
        },
      );

      let extraction = await step.do(
        "extract-process-ir",
        {
          retries: { limit: 2, delay: "10 seconds", backoff: "exponential" },
          timeout: "10 minutes",
        },
        async () => {
          await setJobStatus(this.env.DB, jobId, "extracting");
          const sources = await getJobSources(this.env.DB, jobId);
          if (this.env.MOCK_AI === "true") {
            const inputs = await loadExtractionInputsForJob(this.env, jobId);
            const attemptCount = await this.env.DB.prepare(
              "SELECT COUNT(*) AS value FROM job_attempts WHERE job_id = ?",
            )
              .bind(jobId)
              .first<{ value: number }>();
            if (
              attemptCount?.value === 1 &&
              inputs.some(
                (input) =>
                  input.kind === "text" &&
                  input.text.includes("[synthetic:fail-first-extraction]"),
              )
            )
              throw new Error("Synthetic extraction failure.");
            const mockIr = getMockProcessIr(sources, outputLocale);
            if (
              inputs.some(
                (input) =>
                  input.kind === "text" &&
                  input.text.includes("[synthetic:changed-owner-question]"),
              )
            )
              mockIr.questions[0].text =
                outputLocale === "ru"
                  ? "Какая роль утверждает завершённую проверку?"
                  : "Which role approves the completed review?";
            return {
              ir: enforceBpmnOnlyModalityQuestion(mockIr, inputs, outputLocale),
              metadata: {
                responseId: `mock-${jobId}`,
                returnedModel: "gpt-5.6-terra",
                usage: {},
              },
            };
          }
          return extractProcess(
            getRequiredSecret(this.env, "OPENAI_API_KEY"),
            await loadExtractionInputsForJob(this.env, jobId),
            outputLocale,
          );
        },
      );

      let ir: ProcessIR = processIrSchema.parse(extraction.ir);
      const firstIssues = validateProcessIr(ir);
      if (firstIssues.length && this.env.MOCK_AI !== "true") {
        extraction = await step.do(
          "repair-process-ir-once",
          { retries: { limit: 1, delay: "10 seconds" }, timeout: "10 minutes" },
          async () => {
            const inputs = await loadExtractionInputsForJob(this.env, jobId);
            inputs.push({
              kind: "text",
              text: buildProcessIrRepairInstruction(
                firstIssues.map((issue) => issue.code),
                outputLocale,
              ),
            });
            return extractProcess(
              getRequiredSecret(this.env, "OPENAI_API_KEY"),
              inputs,
              outputLocale,
            );
          },
        );
        ir = processIrSchema.parse(extraction.ir);
      }
      await storeAiRequestEvent(this.env.DB, jobId, `${jobId}:extraction`, 40, {
        provider: "openai",
        model: "gpt-5.6-terra",
        reasoning: "high",
        prompt_version: PROMPT_VERSION,
        schema_version: "process-ir/1",
        result: "success",
        response_id: extraction.metadata.responseId,
        usage_input_tokens: extraction.metadata.usage.input_tokens ?? 0,
        usage_output_tokens: extraction.metadata.usage.output_tokens ?? 0,
      });
      await step.do("validate-process-ir", async () => {
        await setJobStatus(this.env.DB, jobId, "validating");
        const issues = validateProcessIr(ir);
        if (issues.length)
          throw new Error(
            `ProcessIR invariant failure: ${issues.map((issue) => issue.code).join(",")}`,
          );
        return { valid: true };
      });

      const xml = await step.do("compile-and-parse-bpmn", async () => {
        await setJobStatus(this.env.DB, jobId, "compiling");
        const compiled = compileProcessIr(ir);
        const result = await new BpmnModdle().fromXML(compiled);
        if (result.warnings.length)
          throw new Error("Compiled BPMN failed its structural parse gate.");
        return compiled;
      });

      const version = await step.do("save-ready-version", async () => {
        const saved = await saveReadyAiVersion(
          this.env.DB,
          projectId,
          jobId,
          xml,
          JSON.stringify(ir),
        );
        await this.env.DB.prepare(
          "UPDATE job_attempts SET status = 'ready', returned_model = ?, provider_response_id = ?, safe_usage_json = ?, completed_at = ? WHERE id = ?",
        )
          .bind(
            extraction.metadata.returnedModel,
            extraction.metadata.responseId,
            JSON.stringify(extraction.metadata.usage),
            new Date().toISOString(),
            attemptId,
          )
          .run();
        await setJobStatus(this.env.DB, jobId, "ready");
        return { id: saved.id };
      });
      return { versionId: version.id };
    } catch (error) {
      const currentJob = await this.env.DB.prepare(
        "SELECT status FROM jobs WHERE id = ?",
      )
        .bind(jobId)
        .first<{ status: string }>();
      const cancelled =
        currentJob?.status === "cancelling" ||
        currentJob?.status === "cancelled";
      const errorClass =
        error instanceof Error && error.name
          ? error.name.toLocaleLowerCase("en-US")
          : "generation_error";
      await this.env.DB.prepare(
        "UPDATE job_attempts SET status = ?, error_class = ?, completed_at = ? WHERE id = ?",
      )
        .bind(
          cancelled ? "cancelled" : "failed",
          errorClass.replace(/[^a-z0-9_.-]/gu, "_"),
          new Date().toISOString(),
          attemptId,
        )
        .run();
      if (!cancelled)
        await setJobStatus(this.env.DB, jobId, "failed", {
          code: "generation_failed",
          stage: currentJob?.status ?? "queued",
          message: "Generation stopped safely. Review the sources and retry.",
        });
      throw error;
    }
  }
}
