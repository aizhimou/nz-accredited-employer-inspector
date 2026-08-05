PRAGMA foreign_keys = ON;

-- Search responses are no longer persisted in D1. The canonical employers
-- table and platform association tables are the complete production model.
DROP TABLE employer_search_results;
DROP TABLE employer_searches;
