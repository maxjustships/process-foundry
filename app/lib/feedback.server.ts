export type FeedbackStatus =
  "new" | "reported" | "reviewed" | "accepted" | "declined";

const previousStatus: Record<Exclude<FeedbackStatus, "new">, FeedbackStatus> = {
  reported: "new",
  reviewed: "reported",
  accepted: "reviewed",
  declined: "reviewed",
};

export async function advanceFeedbackStatus(
  db: D1Database,
  ids: string[],
  target: Exclude<FeedbackStatus, "new">,
): Promise<number> {
  const timestamp = new Date().toISOString();
  const results = await db.batch(
    ids.map((id) =>
      db
        .prepare(
          `UPDATE feedback_inbox SET lifecycle_status = ?, reported_at = CASE WHEN ? = 'reported' THEN ? ELSE reported_at END, reviewed_at = CASE WHEN ? IN ('reviewed', 'accepted', 'declined') THEN ? ELSE reviewed_at END WHERE id = ? AND lifecycle_status = ?`,
        )
        .bind(
          target,
          target,
          timestamp,
          target,
          timestamp,
          id,
          previousStatus[target],
        ),
    ),
  );
  return results.reduce((count, result) => count + result.meta.changes, 0);
}
