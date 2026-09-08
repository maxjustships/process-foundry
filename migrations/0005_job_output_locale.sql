ALTER TABLE jobs ADD COLUMN output_locale TEXT NOT NULL DEFAULT 'ru'
	CHECK(output_locale IN ('ru', 'en'));
