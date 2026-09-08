import { cancelGenerationWorkflow } from "./generation-cancellation.server";
import { deleteProjectVerified } from "./repository.server";

export async function deleteProjectWithWorkflow(
  db: D1Database,
  bucket: R2Bucket,
  workflow: Pick<Workflow, "get">,
  projectId: string,
): Promise<{
  id: string;
  deletedObjectCount: number;
  deletedRowCount: number;
}> {
  const timestamp = new Date().toISOString();
  await db
    .prepare(
      "UPDATE projects SET status = 'deleting', updated_at = ? WHERE id = ? AND status IN ('active', 'deleting')",
    )
    .bind(timestamp, projectId)
    .run();
  const activeJobs = (
    await db
      .prepare(
        "SELECT id FROM jobs WHERE project_id = ? AND status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling', 'cancelling') ORDER BY created_at, id",
      )
      .bind(projectId)
      .all<{ id: string }>()
  ).results;
  for (const job of activeJobs) {
    const cancellation = await cancelGenerationWorkflow(db, workflow, job.id);
    if (!["cancelled", "failed", "ready"].includes(cancellation.status))
      throw new Error(
        "Active generation could not be stopped before deletion.",
      );
  }
  return deleteProjectVerified(db, bucket, projectId);
}
