PRAGMA foreign_keys = ON;

-- Short-lived evidence that an exact platform display-name query returned the
-- recognised INZ HTTP 400 No Results envelope. These fields are not an
-- accreditation claim and are ignored after 24 hours by the Worker.
ALTER TABLE platform_entities
  ADD COLUMN last_no_match_query TEXT;

ALTER TABLE platform_entities
  ADD COLUMN last_no_match_at INTEGER;
