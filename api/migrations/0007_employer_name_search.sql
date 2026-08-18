PRAGMA foreign_keys = ON;

-- FTS supports user-initiated keyword search only. Automatic resolution uses
-- platform associations and exact official or trading-name equality.
CREATE VIRTUAL TABLE employer_names_fts USING fts5(
  nzbn UNINDEXED,
  employer_name,
  trading_name,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);

INSERT INTO employer_names_fts (nzbn, employer_name, trading_name)
SELECT nzbn, employer_name, COALESCE(trading_name, '')
  FROM employers;

CREATE TRIGGER employers_name_search_after_insert
AFTER INSERT ON employers
BEGIN
  INSERT INTO employer_names_fts (nzbn, employer_name, trading_name)
  VALUES (NEW.nzbn, NEW.employer_name, COALESCE(NEW.trading_name, ''));
END;

CREATE TRIGGER employers_name_search_after_update
AFTER UPDATE OF nzbn, employer_name, trading_name ON employers
WHEN OLD.nzbn IS NOT NEW.nzbn
  OR OLD.employer_name IS NOT NEW.employer_name
  OR OLD.trading_name IS NOT NEW.trading_name
BEGIN
  DELETE FROM employer_names_fts WHERE nzbn = OLD.nzbn;
  INSERT INTO employer_names_fts (nzbn, employer_name, trading_name)
  VALUES (NEW.nzbn, NEW.employer_name, COALESCE(NEW.trading_name, ''));
END;

CREATE TRIGGER employers_name_search_after_delete
AFTER DELETE ON employers
BEGIN
  DELETE FROM employer_names_fts WHERE nzbn = OLD.nzbn;
END;

PRAGMA optimize;
