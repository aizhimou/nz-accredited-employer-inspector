CREATE TABLE extension_waitlist (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  created_at INTEGER NOT NULL,
  notified_at INTEGER
);

CREATE INDEX idx_extension_waitlist_notification
  ON extension_waitlist (notified_at, created_at);
