import {
  Form,
  Link,
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { cloudflareEnv, requireSession } from "../lib/request.server";
import { formatDisplayDate } from "../lib/display-date";
import { resolveLocale, t } from "../lib/i18n";

export const meta: MetaFunction<typeof loader> = ({ loaderData }) => [
  { title: t(loaderData?.locale ?? "ru", "telemetry.metaTitle") },
];

type EventRow = {
  id: string;
  client_session_id: string;
  client_sequence: number;
  occurred_at_client: string;
  received_at_server: string;
  event_type: string;
  route: string;
  project_id: string | null;
  job_id: string | null;
  diagram_version_id: string | null;
  app_version: string;
  safe_payload_json: string;
};

export async function loader({ request, context }: LoaderFunctionArgs) {
  await requireSession(request, context);
  const url = new URL(request.url);
  const filters = {
    session: url.searchParams.get("session")?.slice(0, 100) ?? "",
    project: url.searchParams.get("project")?.slice(0, 100) ?? "",
    job: url.searchParams.get("job")?.slice(0, 100) ?? "",
    version: url.searchParams.get("version")?.slice(0, 100) ?? "",
    type: url.searchParams.get("type")?.slice(0, 80) ?? "",
    from: url.searchParams.get("from")?.slice(0, 40) ?? "",
    to: url.searchParams.get("to")?.slice(0, 40) ?? "",
  };
  const clauses: string[] = [];
  const values: string[] = [];
  for (const [key, column] of [
    ["session", "client_session_id"],
    ["project", "project_id"],
    ["job", "job_id"],
    ["version", "diagram_version_id"],
    ["type", "event_type"],
  ] as const)
    if (filters[key]) {
      clauses.push(`${column} = ?`);
      values.push(filters[key]);
    }
  if (filters.from) {
    clauses.push("received_at_server >= ?");
    values.push(new Date(filters.from).toISOString());
  }
  if (filters.to) {
    clauses.push("received_at_server <= ?");
    values.push(new Date(filters.to).toISOString());
  }
  const query = `SELECT * FROM product_events ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY received_at_server DESC, client_sequence DESC, id DESC LIMIT 500`;
  const events = (
    await cloudflareEnv(context)
      .DB.prepare(query)
      .bind(...values)
      .all<EventRow>()
  ).results;
  return {
    locale: resolveLocale(request),
    filters,
    events: events.map((event) => ({
      ...event,
      safe_payload: JSON.parse(event.safe_payload_json) as Record<
        string,
        string | number
      >,
    })),
  };
}

export default function TelemetryTimeline() {
  const { locale, filters, events } = useLoaderData<typeof loader>();
  return (
    <main className="telemetry-page">
      <header className="topbar">
        <Link to="/projects" className="wordmark">
          <span>PF</span> Process Foundry
        </Link>
        <nav>
          <Link to="/projects">{t(locale, "nav.projects")}</Link>
        </nav>
      </header>
      <section className="telemetry-head">
        <div>
          <p className="eyebrow">{t(locale, "telemetry.eyebrow")}</p>
          <h1>{t(locale, "telemetry.heading")}</h1>
        </div>
        <p>{t(locale, "telemetry.summary")}</p>
      </section>
      <Form method="get" className="filter-grid">
        <label>
          {t(locale, "telemetry.session")}
          <input name="session" defaultValue={filters.session} />
        </label>
        <label>
          {t(locale, "telemetry.project")}
          <input name="project" defaultValue={filters.project} />
        </label>
        <label>
          {t(locale, "telemetry.job")}
          <input name="job" defaultValue={filters.job} />
        </label>
        <label>
          {t(locale, "telemetry.version")}
          <input name="version" defaultValue={filters.version} />
        </label>
        <label>
          {t(locale, "telemetry.eventType")}
          <input name="type" defaultValue={filters.type} />
        </label>
        <label>
          {t(locale, "telemetry.from")}
          <input
            type="datetime-local"
            name="from"
            defaultValue={filters.from}
          />
        </label>
        <label>
          {t(locale, "telemetry.to")}
          <input type="datetime-local" name="to" defaultValue={filters.to} />
        </label>
        <button className="button primary">
          {t(locale, "telemetry.apply")}
        </button>
      </Form>
      <section className="timeline">
        <div className="section-heading">
          <h2>{t(locale, "telemetry.events")}</h2>
          <span>{t(locale, "telemetry.shown", { count: events.length })}</span>
        </div>
        {events.length ? (
          events.map((event) => (
            <article className="timeline-event" key={event.id}>
              <time>{formatDisplayDate(event.received_at_server, locale)}</time>
              <span className="timeline-line" aria-hidden="true" />
              <div>
                <strong>{event.event_type}</strong>
                <p>{event.route}</p>
                <dl>
                  {event.project_id ? (
                    <>
                      <dt>{t(locale, "telemetry.project")}</dt>
                      <dd>{event.project_id}</dd>
                    </>
                  ) : null}
                  {event.job_id ? (
                    <>
                      <dt>{t(locale, "telemetry.job")}</dt>
                      <dd>{event.job_id}</dd>
                    </>
                  ) : null}
                  {Object.entries(event.safe_payload).map(([key, value]) => (
                    <span key={key}>
                      <dt>{key}</dt>
                      <dd>{String(value)}</dd>
                    </span>
                  ))}
                </dl>
              </div>
            </article>
          ))
        ) : (
          <div className="empty-state">
            <h3>{t(locale, "telemetry.emptyTitle")}</h3>
            <p>{t(locale, "telemetry.emptyBody")}</p>
          </div>
        )}
      </section>
    </main>
  );
}
