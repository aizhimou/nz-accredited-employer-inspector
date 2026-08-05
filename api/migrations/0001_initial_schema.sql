PRAGMA foreign_keys = ON;

CREATE TABLE employers (
  -- Employer Name (INZ Type: Title)
  employer_name TEXT NOT NULL,

  -- Trading Name (INZ Type: PlainText)
  trading_name TEXT,

  -- NZBN (INZ Type: PlainText)
  nzbn TEXT PRIMARY KEY
    CHECK (length(nzbn) = 13 AND nzbn NOT GLOB '*[^0-9]*'),

  -- Expiry Date of Accreditation (INZ Type: Date)
  expiry_date_of_accreditation TEXT NOT NULL,

  first_seen_at INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL
);

CREATE INDEX idx_employers_expiry_date
  ON employers(expiry_date_of_accreditation);

CREATE TABLE employer_searches (
  normalized_query TEXT NOT NULL,
  page INTEGER NOT NULL CHECK (page BETWEEN 1 AND 100),
  original_query TEXT NOT NULL,
  current_page INTEGER NOT NULL,
  total_pages INTEGER NOT NULL CHECK (total_pages >= 0),
  total_results INTEGER NOT NULL CHECK (total_results >= 0),
  fetched_at INTEGER NOT NULL,
  refresh_after INTEGER NOT NULL,
  hard_expires_on TEXT,

  PRIMARY KEY (normalized_query, page)
);

CREATE INDEX idx_employer_searches_refresh_after
  ON employer_searches(refresh_after);

CREATE TABLE employer_search_results (
  normalized_query TEXT NOT NULL,
  page INTEGER NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  nzbn TEXT NOT NULL,

  PRIMARY KEY (normalized_query, page, position),
  UNIQUE (normalized_query, page, nzbn),

  FOREIGN KEY (normalized_query, page)
    REFERENCES employer_searches(normalized_query, page)
    ON DELETE CASCADE,

  FOREIGN KEY (nzbn)
    REFERENCES employers(nzbn)
    ON DELETE CASCADE
);

CREATE INDEX idx_employer_search_results_nzbn
  ON employer_search_results(nzbn);

