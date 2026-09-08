PRAGMA foreign_keys = ON;

CREATE TABLE projects (
	id TEXT PRIMARY KEY,
	title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
	status TEXT NOT NULL CHECK(status IN ('active', 'deleting')),
	active_job_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE sources (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id),
	type TEXT NOT NULL CHECK(type IN ('text', 'audio', 'image', 'correction')),
	name TEXT NOT NULL,
	mime_type TEXT NOT NULL,
	size_bytes INTEGER NOT NULL,
	duration_seconds REAL,
	r2_key TEXT NOT NULL UNIQUE,
	transcript_r2_key TEXT,
	created_at TEXT NOT NULL
);
CREATE INDEX sources_project_idx ON sources(project_id, created_at);

CREATE TABLE jobs (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id),
	workflow_instance_id TEXT NOT NULL UNIQUE,
	status TEXT NOT NULL CHECK(status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling', 'ready', 'failed')),
	model_provider TEXT NOT NULL,
	model_name TEXT NOT NULL,
	prompt_version TEXT NOT NULL,
	error_code TEXT,
	error_safe_message TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX one_active_job_per_project ON jobs(project_id) WHERE status IN ('queued', 'transcribing', 'extracting', 'validating', 'compiling');

CREATE TABLE job_attempts (
	id TEXT PRIMARY KEY,
	job_id TEXT NOT NULL REFERENCES jobs(id),
	attempt_number INTEGER NOT NULL,
	status TEXT NOT NULL,
	transport TEXT NOT NULL,
	provider TEXT NOT NULL,
	requested_model TEXT NOT NULL,
	returned_model TEXT,
	reasoning_level TEXT NOT NULL,
	prompt_version TEXT NOT NULL,
	schema_version TEXT NOT NULL,
	compiler_version TEXT NOT NULL,
	layout_version TEXT NOT NULL,
	provider_response_id TEXT,
	safe_usage_json TEXT,
	error_class TEXT,
	created_at TEXT NOT NULL,
	completed_at TEXT,
	UNIQUE(job_id, attempt_number)
);

CREATE TABLE diagram_versions (
	id TEXT PRIMARY KEY,
	project_id TEXT NOT NULL REFERENCES projects(id),
	job_id TEXT REFERENCES jobs(id),
	version_number INTEGER NOT NULL,
	ir_json TEXT,
	bpmn_xml TEXT NOT NULL,
	created_by TEXT NOT NULL CHECK(created_by IN ('ai', 'human')),
	created_at TEXT NOT NULL,
	UNIQUE(project_id, version_number)
);

CREATE TABLE product_events (
	id TEXT PRIMARY KEY,
	client_session_id TEXT NOT NULL,
	client_sequence INTEGER NOT NULL,
	occurred_at_client TEXT NOT NULL,
	received_at_server TEXT NOT NULL,
	event_type TEXT NOT NULL,
	route TEXT NOT NULL,
	project_id TEXT,
	job_id TEXT,
	diagram_version_id TEXT,
	app_version TEXT NOT NULL,
	safe_payload_json TEXT NOT NULL,
	UNIQUE(client_session_id, client_sequence)
);
CREATE INDEX product_events_timeline_idx ON product_events(received_at_server, id);

CREATE TABLE feedback_inbox (
	id TEXT PRIMARY KEY,
	project_id TEXT,
	diagram_version_id TEXT,
	job_id TEXT,
	client_session_id TEXT NOT NULL,
	rating INTEGER CHECK(rating BETWEEN 1 AND 5),
	text TEXT NOT NULL CHECK(length(text) BETWEEN 1 AND 5000),
	lifecycle_status TEXT NOT NULL CHECK(lifecycle_status IN ('new', 'reported', 'reviewed', 'accepted', 'declined')),
	app_version TEXT NOT NULL,
	model_name TEXT,
	prompt_version TEXT,
	schema_version TEXT,
	created_at TEXT NOT NULL,
	reported_at TEXT,
	reviewed_at TEXT
);
CREATE INDEX feedback_status_cursor_idx ON feedback_inbox(lifecycle_status, created_at, id);

CREATE TABLE deletion_receipts (
	id TEXT PRIMARY KEY,
	opaque_project_fingerprint TEXT NOT NULL UNIQUE,
	deleted_object_count INTEGER NOT NULL,
	deleted_row_count INTEGER NOT NULL,
	completed_at TEXT NOT NULL
);

CREATE TABLE auth_throttle (
	key_hash TEXT PRIMARY KEY,
	failure_count INTEGER NOT NULL,
	window_started_at TEXT NOT NULL,
	blocked_until TEXT
);
