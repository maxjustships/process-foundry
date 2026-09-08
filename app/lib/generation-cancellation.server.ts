import {
  requestJobCancellation,
  settleJobCancelled,
  type JobRow,
} from "./repository.server";

const workflowActiveStatuses = new Set([
  "queued",
  "running",
  "paused",
  "waiting",
  "waitingForPause",
  "unknown",
]);
const workflowStatusPollLimit = 3;
const workflowStatusPollDelayMs = 25;

export type CancellationResult = {
  status: JobRow["status"];
  changed: boolean;
  workflowStatus: InstanceStatus["status"] | "missing" | null;
};

async function pollWorkflowStatus(
  instance: WorkflowInstance,
): Promise<InstanceStatus["status"]> {
  for (let poll = 0; poll < workflowStatusPollLimit; poll += 1) {
    const status = (await instance.status()).status;
    if (status !== "unknown") return status;
    if (poll + 1 < workflowStatusPollLimit)
      await scheduler.wait(workflowStatusPollDelayMs);
  }
  return "unknown";
}

async function readWorkflowStatus(
  workflow: Pick<Workflow, "get">,
  workflowInstanceId: string,
): Promise<
  | { instance: WorkflowInstance; status: InstanceStatus["status"] }
  | { instance: null; status: "missing" }
> {
  try {
    const instance = await workflow.get(workflowInstanceId);
    return { instance, status: await pollWorkflowStatus(instance) };
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (
      message.includes("instance.not_found") ||
      message.includes("not found") ||
      message.includes("never started")
    )
      return { instance: null, status: "missing" };
    throw new Error("Workflow status could not be verified.", { cause: error });
  }
}

export async function cancelGenerationWorkflow(
  db: D1Database,
  workflow: Pick<Workflow, "get">,
  jobId: string,
): Promise<CancellationResult> {
  const requested = await requestJobCancellation(db, jobId);
  if (requested.status !== "cancelling")
    return {
      status: requested.status,
      changed: false,
      workflowStatus: null,
    };

  let workflowState = await readWorkflowStatus(
    workflow,
    requested.workflowInstanceId,
  );
  if (
    workflowState.instance &&
    workflowActiveStatuses.has(workflowState.status)
  ) {
    try {
      await workflowState.instance.terminate();
      workflowState = {
        instance: workflowState.instance,
        status: await pollWorkflowStatus(workflowState.instance),
      };
    } catch {
      workflowState = await readWorkflowStatus(
        workflow,
        requested.workflowInstanceId,
      );
      if (
        workflowState.instance &&
        workflowActiveStatuses.has(workflowState.status)
      )
        throw new Error("Workflow cancellation could not be verified.");
    }
  }

  if (
    workflowState.status !== "missing" &&
    workflowActiveStatuses.has(workflowState.status)
  )
    throw new Error("Workflow cancellation could not be verified.");

  const settled = await settleJobCancelled(db, jobId);
  return {
    status: settled.status,
    changed: requested.changed || settled.changed,
    workflowStatus: workflowState.status,
  };
}
