PRAGMA foreign_keys = ON;

ALTER TABLE employers
  ADD COLUMN accreditation_type TEXT;

ALTER TABLE employers
  ADD COLUMN accreditation_status TEXT;

ALTER TABLE employers
  ADD COLUMN sector TEXT;

ALTER TABLE employers
  ADD COLUMN subsector TEXT;

ALTER TABLE employers
  ADD COLUMN accreditation_start_date TEXT;

ALTER TABLE employers
  ADD COLUMN region TEXT;

ALTER TABLE employers
  ADD COLUMN city TEXT;

ALTER TABLE employers
  ADD COLUMN official_snapshot_date TEXT
    CHECK (
      official_snapshot_date IS NULL OR (
        length(official_snapshot_date) = 10
        AND official_snapshot_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      )
    );

CREATE TABLE official_employer_imports (
  snapshot_date TEXT PRIMARY KEY
    CHECK (
      length(snapshot_date) = 10
      AND snapshot_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    ),
  source_filename TEXT NOT NULL,
  source_sha256 TEXT NOT NULL
    CHECK (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
  expected_row_count INTEGER NOT NULL CHECK (expected_row_count > 0),
  importable_row_count INTEGER NOT NULL
    CHECK (importable_row_count > 0 AND importable_row_count <= expected_row_count),
  actual_row_count INTEGER NOT NULL DEFAULT 0 CHECK (actual_row_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('loading', 'validated', 'ready')),
  prepared_at INTEGER NOT NULL,
  activated_at INTEGER,

  CHECK (status = 'loading' OR actual_row_count = expected_row_count)
);

CREATE TABLE official_employer_import_rows (
  snapshot_date TEXT NOT NULL,
  source_row_number INTEGER NOT NULL CHECK (source_row_number >= 1),
  employer_name TEXT NOT NULL,
  normalized_employer_name TEXT NOT NULL,
  trading_name TEXT,
  normalized_trading_name TEXT,
  nzbn TEXT
    CHECK (
      nzbn IS NULL OR (
        length(nzbn) = 13
        AND nzbn NOT GLOB '*[^0-9]*'
      )
    ),
  accreditation_type TEXT NOT NULL,
  accreditation_status TEXT NOT NULL,
  sector TEXT,
  subsector TEXT,
  expiry_date_of_accreditation TEXT NOT NULL,
  accreditation_start_date TEXT NOT NULL,
  region TEXT,
  city TEXT,

  PRIMARY KEY (snapshot_date, source_row_number),
  UNIQUE (snapshot_date, nzbn),

  FOREIGN KEY (snapshot_date)
    REFERENCES official_employer_imports(snapshot_date)
    ON DELETE CASCADE
);

CREATE INDEX idx_official_import_rows_nzbn
  ON official_employer_import_rows(nzbn);
