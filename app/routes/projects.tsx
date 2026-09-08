import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { createProject, listProjects } from "../lib/repository.server";
import { formatDisplayDate } from "../lib/display-date";
import {
  displayStatus,
  formatProjectCount,
  resolveLocale,
  t,
} from "../lib/i18n";
import {
  cloudflareEnv,
  requireMutationOrigin,
  requireSession,
} from "../lib/request.server";

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: t(loaderData?.locale ?? "ru", "projects.metaTitle") },
];

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireSession(request, context);
  return {
    locale: resolveLocale(request),
    projects: await listProjects(cloudflareEnv(context).DB),
  };
}

export async function action({ request, context }: ActionFunctionArgs) {
  await requireSession(request, context);
  requireMutationOrigin(request);
  const locale = resolveLocale(request);
  const title = (await request.formData()).get("title");
  if (typeof title !== "string" || !title.trim())
    return { error: t(locale, "projects.validation.title") };
  const project = await createProject(cloudflareEnv(context).DB, title);
  throw redirect(`/projects/${project.id}`);
}

export default function Projects() {
  const { locale, projects } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  return (
    <main className="projects-page">
      <header className="topbar">
        <Link to="/projects" className="wordmark">
          <span>PF</span> Process Foundry
        </Link>
        <nav>
          <Link to="/admin/telemetry">{t(locale, "nav.telemetry")}</Link>
        </nav>
      </header>
      <section className="projects-hero">
        <div>
          <p className="eyebrow">{t(locale, "projects.eyebrow")}</p>
          <h1>
            {t(locale, "projects.heroLine1")}
            <br />
            {t(locale, "projects.heroLine2")}
          </h1>
        </div>
        <p>{t(locale, "projects.summary")}</p>
      </section>
      <section className="new-project-strip">
        <p className="step-marker">{t(locale, "projects.new")}</p>
        <Form method="post">
          <label className="sr-only" htmlFor="project-title">
            {t(locale, "projects.title")}
          </label>
          <input
            id="project-title"
            name="title"
            maxLength={160}
            placeholder={t(locale, "projects.placeholder")}
            required
          />
          <button
            className="button primary"
            disabled={navigation.state !== "idle"}
          >
            {navigation.state === "submitting"
              ? t(locale, "projects.creating")
              : t(locale, "projects.create")}
          </button>
          {result?.error ? (
            <p className="form-error" role="alert">
              {result.error}
            </p>
          ) : null}
        </Form>
      </section>
      <section className="project-list" aria-labelledby="recent-projects">
        <div className="section-heading">
          <h2 id="recent-projects">{t(locale, "projects.recent")}</h2>
          <span>{formatProjectCount(locale, projects.length)}</span>
        </div>
        {projects.length ? (
          projects.map((project, index) => (
            <Link
              className="project-row"
              to={`/projects/${project.id}`}
              key={project.id}
            >
              <span className="project-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <strong>{project.title}</strong>
                <small>
                  {t(locale, "projects.updated", {
                    date: formatDisplayDate(project.updated_at, locale),
                  })}
                </small>
              </span>
              <span className={`status-dot ${project.status}`}>
                {displayStatus(locale, project.status)}
              </span>
              <span aria-hidden="true">↗</span>
            </Link>
          ))
        ) : (
          <div className="empty-state">
            <h3>{t(locale, "projects.emptyTitle")}</h3>
            <p>{t(locale, "projects.emptyBody")}</p>
          </div>
        )}
      </section>
    </main>
  );
}
