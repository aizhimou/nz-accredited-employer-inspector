PRAGMA foreign_keys = ON;

-- Search columns are maintained by the Worker using Unicode NFKC, trimmed and
-- collapsed whitespace, and lowercase. The SQL backfill is sufficient for the
-- existing ASCII records; future imports must provide Worker-normalised values.
ALTER TABLE employers
  ADD COLUMN normalized_employer_name TEXT NOT NULL DEFAULT '';

ALTER TABLE employers
  ADD COLUMN normalized_trading_name TEXT;

ALTER TABLE employers
  ADD COLUMN last_verified_source TEXT NOT NULL DEFAULT 'inz_live_lookup'
    CHECK (last_verified_source IN ('inz_live_lookup', 'inz_official_import'));

UPDATE employers
   SET normalized_employer_name = lower(trim(employer_name)),
       normalized_trading_name = CASE
         WHEN trading_name IS NULL OR trim(trading_name) = '' THEN NULL
         ELSE lower(trim(trading_name))
       END;

CREATE INDEX idx_employers_normalized_employer_name
  ON employers(normalized_employer_name);

CREATE INDEX idx_employers_normalized_trading_name
  ON employers(normalized_trading_name);

CREATE TABLE platform_entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'seek')),
  external_key TEXT NOT NULL,
  identity_kind TEXT NOT NULL CHECK (
    identity_kind IN (
      'linkedin_company_url',
      'seek_company_profile',
      'seek_advertiser_name'
    )
  ),
  identity_strength TEXT NOT NULL CHECK (identity_strength IN ('strong', 'weak')),
  display_name TEXT NOT NULL,
  public_url TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,

  UNIQUE (platform, external_key)
);

CREATE TABLE platform_employer_confirmations (
  platform_entity_id INTEGER NOT NULL,
  client_id_hash TEXT NOT NULL
    CHECK (length(client_id_hash) = 64 AND client_id_hash NOT GLOB '*[^0-9a-f]*'),
  nzbn TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  PRIMARY KEY (platform_entity_id, client_id_hash),

  FOREIGN KEY (platform_entity_id)
    REFERENCES platform_entities(id)
    ON DELETE CASCADE,

  FOREIGN KEY (nzbn)
    REFERENCES employers(nzbn)
    ON DELETE RESTRICT
);

CREATE INDEX idx_platform_confirmations_entity_nzbn
  ON platform_employer_confirmations(platform_entity_id, nzbn);

CREATE INDEX idx_platform_confirmations_nzbn
  ON platform_employer_confirmations(nzbn);
