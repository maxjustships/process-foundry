import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("demo", "routes/demo.tsx"),
  route("login", "routes/login.tsx"),
  route("language", "routes/language.ts"),
  route("projects", "routes/projects.tsx"),
  route("projects/:projectId", "routes/project.tsx"),
  route("admin/telemetry", "routes/admin.telemetry.tsx"),
  route("api/projects/:projectId/sources", "routes/api.sources.ts"),
  route("api/projects/:projectId/generate", "routes/api.generate.ts"),
  route("api/jobs/:jobId", "routes/api.job.ts"),
  route("api/jobs/:jobId/cancel", "routes/api.job-cancel.ts"),
  route("api/jobs/:jobId/retry", "routes/api.job-retry.ts"),
  route("api/projects/:projectId/versions", "routes/api.versions.ts"),
  route(
    "api/projects/:projectId/versions/:versionId/questions/:questionId/answer",
    "routes/api.question-answer.ts",
  ),
  route("api/projects/:projectId/export", "routes/api.export.ts"),
  route("api/events/batch", "routes/api.events.ts"),
  route("api/feedback", "routes/api.feedback.ts"),
  route("api/internal/feedback", "routes/api.internal.feedback.ts"),
  route(
    "api/internal/feedback/reported",
    "routes/api.internal.feedback.reported.ts",
  ),
  route(
    "api/internal/feedback/status",
    "routes/api.internal.feedback.status.ts",
  ),
  route("api/projects/:projectId/delete", "routes/api.delete.ts"),
  route("health", "routes/health.ts"),
] satisfies RouteConfig;
