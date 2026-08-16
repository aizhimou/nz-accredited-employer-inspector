PRAGMA foreign_keys = ON;

ALTER TABLE employers
  ADD COLUMN last_refresh_attempt_at INTEGER;

ALTER TABLE employers
  ADD COLUMN last_refresh_outcome TEXT
    CHECK (
      last_refresh_outcome IS NULL OR
      last_refresh_outcome IN ('pending', 'positive', 'no_result')
    );

ALTER TABLE employers
  ADD COLUMN refresh_not_before INTEGER;
