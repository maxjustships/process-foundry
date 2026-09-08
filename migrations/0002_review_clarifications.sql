PRAGMA foreign_keys = ON;

CREATE TABLE question_clarifications (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id),
	question_version_id TEXT NOT NULL REFERENCES diagram_versions(id),
	question_id TEXT NOT NULL CHECK(length(question_id) BETWEEN 1 AND 100),
	source_id TEXT NOT NULL UNIQUE REFERENCES sources(id),
	status TEXT NOT NULL CHECK(status IN ('answered', 'applied')),
	applied_version_id TEXT REFERENCES diagram_versions(id),
	created_at TEXT NOT NULL,
	applied_at TEXT,
	UNIQUE(question_version_id, question_id),
	CHECK(
		(status = 'answered' AND applied_version_id IS NULL AND applied_at IS NULL)
		OR
		(status = 'applied' AND applied_version_id IS NOT NULL AND applied_at IS NOT NULL)
	)
);
CREATE INDEX question_clarifications_project_status_idx
	ON question_clarifications(project_id, status, created_at, id);
CREATE INDEX question_clarifications_question_version_idx
	ON question_clarifications(question_version_id, question_id);
CREATE INDEX question_clarifications_applied_version_idx
	ON question_clarifications(applied_version_id);

CREATE TABLE job_sources (
	job_id TEXT NOT NULL REFERENCES jobs(id),
	source_id TEXT NOT NULL REFERENCES sources(id),
	captured_at TEXT NOT NULL,
	PRIMARY KEY(job_id, source_id)
);
CREATE INDEX job_sources_job_idx ON job_sources(job_id, captured_at, source_id);
CREATE INDEX job_sources_source_idx ON job_sources(source_id, job_id);

CREATE UNIQUE INDEX one_ai_version_per_job
	ON diagram_versions(job_id)
	WHERE job_id IS NOT NULL;
