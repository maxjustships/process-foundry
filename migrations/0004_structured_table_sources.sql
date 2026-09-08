PRAGMA defer_foreign_keys = ON;

ALTER TABLE sources RENAME TO sources_slice2_legacy;
DROP INDEX sources_project_idx;

CREATE TABLE sources (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id),
	type TEXT NOT NULL CHECK(type IN ('text', 'audio', 'image', 'correction', 'csv', 'docx', 'xlsx')),
	name TEXT NOT NULL,
	mime_type TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	duration_seconds REAL,
	r2_key TEXT NOT NULL UNIQUE,
	transcript_r2_key TEXT,
	extracted_r2_key TEXT UNIQUE,
	extracted_metadata_json TEXT,
	created_at TEXT NOT NULL,
	CHECK(
		(type IN ('csv', 'docx', 'xlsx') AND extracted_r2_key IS NOT NULL AND extracted_metadata_json IS NOT NULL)
		OR
		(type IN ('text', 'audio', 'image', 'correction') AND extracted_r2_key IS NULL AND extracted_metadata_json IS NULL)
	)
);
INSERT INTO sources (
	id, project_id, type, name, mime_type, size_bytes, duration_seconds,
	r2_key, transcript_r2_key, extracted_r2_key, extracted_metadata_json, created_at
)
SELECT
	id, project_id, type, name, mime_type, size_bytes, duration_seconds,
	r2_key, transcript_r2_key, NULL, NULL, created_at
FROM sources_slice2_legacy;
CREATE INDEX sources_project_idx ON sources(project_id, created_at);

ALTER TABLE question_clarifications
	RENAME TO question_clarifications_slice2_legacy;
DROP INDEX question_clarifications_project_status_idx;
DROP INDEX question_clarifications_question_version_idx;
DROP INDEX question_clarifications_applied_version_idx;

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
INSERT INTO question_clarifications
SELECT * FROM question_clarifications_slice2_legacy;
CREATE INDEX question_clarifications_project_status_idx
	ON question_clarifications(project_id, status, created_at, id);
CREATE INDEX question_clarifications_question_version_idx
	ON question_clarifications(question_version_id, question_id);
CREATE INDEX question_clarifications_applied_version_idx
	ON question_clarifications(applied_version_id);

ALTER TABLE job_sources RENAME TO job_sources_slice2_legacy;
DROP INDEX job_sources_job_idx;
DROP INDEX job_sources_source_idx;

CREATE TABLE job_sources (
	job_id TEXT NOT NULL REFERENCES jobs(id),
	source_id TEXT NOT NULL REFERENCES sources(id),
	source_name TEXT NOT NULL,
	source_type TEXT NOT NULL CHECK(source_type IN ('text', 'audio', 'image', 'correction', 'csv', 'docx', 'xlsx')),
	captured_at TEXT NOT NULL,
	PRIMARY KEY(job_id, source_id)
);
INSERT INTO job_sources
SELECT * FROM job_sources_slice2_legacy;
CREATE INDEX job_sources_job_idx ON job_sources(job_id, captured_at, source_id);
CREATE INDEX job_sources_source_idx ON job_sources(source_id, job_id);

ALTER TABLE job_clarifications RENAME TO job_clarifications_slice2_legacy;
DROP INDEX job_clarifications_job_idx;

CREATE TABLE job_clarifications (
	job_id TEXT NOT NULL REFERENCES jobs(id),
	clarification_id TEXT NOT NULL REFERENCES question_clarifications(id),
	question_version_id TEXT NOT NULL,
	question_id TEXT NOT NULL,
	source_id TEXT NOT NULL REFERENCES sources(id),
	captured_at TEXT NOT NULL,
	PRIMARY KEY(job_id, clarification_id),
	UNIQUE(job_id, source_id)
);
INSERT INTO job_clarifications
SELECT * FROM job_clarifications_slice2_legacy;
CREATE INDEX job_clarifications_job_idx
	ON job_clarifications(job_id, captured_at, clarification_id);

DROP TABLE job_clarifications_slice2_legacy;
DROP TABLE job_sources_slice2_legacy;
DROP TABLE question_clarifications_slice2_legacy;
DROP TABLE sources_slice2_legacy;
