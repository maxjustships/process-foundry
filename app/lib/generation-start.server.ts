import { compensateWorkflowCreationFailure } from "./repository.server";

export async function startGenerationWorkflowOrCompensate(
  db: D1Database,
  workflow: Pick<Workflow, "create">,
  input: {
    jobId: string;
    projectId: string;
    workflowInstanceId: string;
  },
): Promise<boolean> {
  try {
    await workflow.create({
      id: input.workflowInstanceId,
      params: { jobId: input.jobId, projectId: input.projectId },
    });
    return true;
  } catch {
    await compensateWorkflowCreationFailure(db, input);
    return false;
  }
}
