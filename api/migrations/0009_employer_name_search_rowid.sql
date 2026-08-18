PRAGMA foreign_keys = ON;

-- Rebuild employer_names_fts so every FTS row mirrors the employers.rowid it
-- describes. Triggers then update the index by rowid (a direct lookup) instead
-- of scanning the whole index for the UNINDEXED nzbn column on every change.

DROP TRIGGER IF EXISTS employers_name_search_after_insert;
DROP TRIGGER IF EXISTS employers_name_search_after_update;
DROP TRIGGER IF EXISTS employers_name_search_after_delete;

DELETE FROM employer_names_fts;

INSERT INTO employer_names_fts (rowid, nzbn, employer_name, trading_name)
SELECT rowid, nzbn, employer_name, COALESCE(trading_name, '')
  FROM employers;

CREATE TRIGGER employers_name_search_after_insert
AFTER INSERT ON employers
BEGIN
  INSERT INTO employer_names_fts (rowid, nzbn, employer_name, trading_name)
  VALUES (NEW.rowid, NEW.nzbn, NEW.employer_name, COALESCE(NEW.trading_name, ''));
END;

CREATE TRIGGER employers_name_search_after_update
AFTER UPDATE OF nzbn, employer_name, trading_name ON employers
WHEN OLD.nzbn IS NOT NEW.nzbn
  OR OLD.employer_name IS NOT NEW.employer_name
  OR OLD.trading_name IS NOT NEW.trading_name
BEGIN
  DELETE FROM employer_names_fts WHERE rowid = OLD.rowid;
  INSERT INTO employer_names_fts (rowid, nzbn, employer_name, trading_name)
  VALUES (NEW.rowid, NEW.nzbn, NEW.employer_name, COALESCE(NEW.trading_name, ''));
END;

CREATE TRIGGER employers_name_search_after_delete
AFTER DELETE ON employers
BEGIN
  DELETE FROM employer_names_fts WHERE rowid = OLD.rowid;
END;

PRAGMA optimize;
