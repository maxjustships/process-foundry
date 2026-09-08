PRAGMA defer_foreign_keys = ON;

CREATE TABLE jobs_slice1 (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id),
	workflow_instance_id TEXT NOT NULL UNIQUE,
	status TEXT NOT NULL CHECK(status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling', 'cancelling', 'cancelled', 'ready', 'failed')),
	generation_mode TEXT NOT NULL CHECK(generation_mode IN ('legacy', 'refine', 'alternative')),
	base_version_id TEXT,
	planned_version_number INTEGER,
	source_count INTEGER NOT NULL DEFAULT 0 CHECK(source_count >= 0),
	clarification_count INTEGER NOT NULL DEFAULT 0 CHECK(clarification_count >= 0),
	model_provider TEXT NOT NULL,
	model_name TEXT NOT NULL,
	prompt_version TEXT NOT NULL,
	error_code TEXT,
	error_stage TEXT,
	error_safe_message TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

INSERT INTO jobs_slice1 (
	id, project_id, workflow_instance_id, status, generation_mode,
	base_version_id, planned_version_number, source_count, clarification_count,
	model_provider, model_name, prompt_version, error_code, error_stage,
	error_safe_message, created_at, updated_at
)
SELECT
	j.id, j.project_id, j.workflow_instance_id, j.status, 'legacy',
	NULL, NULL,
	(SELECT COUNT(*) FROM job_sources js WHERE js.job_id = j.id),
	(SELECT COUNT(*) FROM question_clarifications qc
		WHERE qc.source_id IN (SELECT js.source_id FROM job_sources js WHERE js.job_id = j.id)),
	j.model_provider, j.model_name, j.prompt_version, j.error_code, NULL,
	j.error_safe_message, j.created_at, j.updated_at
FROM jobs j;

CREATE TABLE job_attempts_slice1_data AS
	SELECT * FROM job_attempts;
CREATE TABLE diagram_versions_slice1_data AS
	SELECT * FROM diagram_versions;
CREATE TABLE job_sources_slice1_data AS
	SELECT js.job_id, js.source_id, s.name AS source_name,
		s.type AS source_type, js.captured_at
	FROM job_sources js
	JOIN sources s ON s.id = js.source_id;

DELETE FROM job_attempts;
DELETE FROM diagram_versions;
DELETE FROM job_sources;

DROP TABLE jobs;
ALTER TABLE jobs_slice1 RENAME TO jobs;

CREATE UNIQUE INDEX one_active_job_per_project ON jobs(project_id)
	WHERE status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling', 'cancelling');

INSERT INTO job_attempts (
	id, job_id, attempt_number, status, transport, provider, requested_model,
	returned_model, reasoning_level, prompt_version, schema_version,
	compiler_version, layout_version, provider_response_id, safe_usage_json,
	error_class, created_at, completed_at
)
SELECT
	id, job_id, attempt_number, status, transport, provider, requested_model,
	returned_model, reasoning_level, prompt_version, schema_version,
	compiler_version, layout_version, provider_response_id, safe_usage_json,
	error_class, created_at, completed_at
FROM job_attempts_slice1_data;

INSERT INTO diagram_versions (
	id, project_id, job_id, version_number, ir_json, bpmn_xml, created_by, created_at
)
SELECT
	id, project_id, job_id, version_number, ir_json, bpmn_xml, created_by, created_at
FROM diagram_versions_slice1_data;

CREATE TABLE job_sources_slice1 (
	job_id TEXT NOT NULL REFERENCES jobs(id),
	source_id TEXT NOT NULL REFERENCES sources(id),
	source_name TEXT NOT NULL,
	source_type TEXT NOT NULL CHECK(source_type IN ('text', 'audio', 'image', 'correction')),
	captured_at TEXT NOT NULL,
	PRIMARY KEY(job_id, source_id)
);

INSERT INTO job_sources_slice1 (job_id, source_id, source_name, source_type, captured_at)
SELECT job_id, source_id, source_name, source_type, captured_at
FROM job_sources_slice1_data;

DROP TABLE job_sources;
ALTER TABLE job_sources_slice1 RENAME TO job_sources;
CREATE INDEX job_sources_job_idx ON job_sources(job_id, captured_at, source_id);
CREATE INDEX job_sources_source_idx ON job_sources(source_id, job_id);

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
CREATE INDEX job_clarifications_job_idx
	ON job_clarifications(job_id, captured_at, clarification_id);

ALTER TABLE diagram_versions ADD COLUMN generation_mode TEXT
	CHECK(generation_mode IN ('refine', 'alternative'));
ALTER TABLE diagram_versions ADD COLUMN base_version_id TEXT;
ALTER TABLE diagram_versions ADD COLUMN source_snapshot_json TEXT;
ALTER TABLE diagram_versions ADD COLUMN source_count INTEGER CHECK(source_count >= 0);
ALTER TABLE diagram_versions ADD COLUMN clarification_count INTEGER CHECK(clarification_count >= 0);

DROP TABLE job_sources_slice1_data;
DROP TABLE diagram_versions_slice1_data;
DROP TABLE job_attempts_slice1_data;
