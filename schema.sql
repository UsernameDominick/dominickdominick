CREATE TABLE pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  meta_description TEXT DEFAULT '',
  nav_label TEXT,
  nav_order INTEGER,
  og_image TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0
);

-- A block "definition" that one or more page blocks can point at via
-- blocks.shared_block_id — editing it (content/style) updates every page
-- that uses it, since those placements defer to this row instead of their
-- own content/style. Position (col/row/span) always stays per-placement.
CREATE TABLE shared_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '{}',
  style TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '{}',
  style TEXT NOT NULL DEFAULT '{}',
  col INTEGER NOT NULL DEFAULT 1,
  col_span INTEGER NOT NULL DEFAULT 24,
  row INTEGER NOT NULL DEFAULT 1,
  row_span INTEGER NOT NULL DEFAULT 4,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  shared_block_id INTEGER REFERENCES shared_blocks(id) ON DELETE SET NULL,
  locked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  og_image TEXT,
  published_at TEXT,
  deleted_at TEXT,
  series TEXT,
  series_order INTEGER,
  co_authors TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT
);

-- Projects are a real content type (not just project-card blocks dropped on
-- a page) — their own list/detail pages, so build journals, relationships,
-- and the rest of the "projects and portfolio" section have something
-- structured to attach to.
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  tech_stack TEXT NOT NULL DEFAULT '[]',
  status TEXT,
  links TEXT NOT NULL DEFAULT '{}',
  og_image TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  featured INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  related_articles TEXT NOT NULL DEFAULT '[]',
  related_simulations TEXT NOT NULL DEFAULT '[]',
  related_scans TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT
);

-- A project's build journal — dated entries telling the story of building
-- it. entry_type also covers decision logs and failed-attempt records
-- (both are just journal entries with a different label), and test
-- records (expected/actual results go straight in the markdown-lite
-- body — no separate structured fields needed for free-form results).
CREATE TABLE journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entry_date TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  entry_type TEXT NOT NULL DEFAULT 'log',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_journal_entries_project ON journal_entries(project_id, entry_date);

-- A project's bill of materials — quantity/price stored as numbers (not
-- free text) specifically so the public page can compute and show a total
-- build cost, covering that "computed field" idea from the content-
-- modeling section with the same table as the BOM feature itself.
CREATE TABLE bom_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  price REAL,
  link TEXT,
  substitution TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_bom_items_project ON bom_items(project_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE redirects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_path TEXT UNIQUE NOT NULL,
  to_path TEXT NOT NULL,
  status_code INTEGER NOT NULL DEFAULT 301,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE simulations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  stack TEXT,
  path TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  path TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket TEXT NOT NULL,
  ip TEXT NOT NULL,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_label TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE media (
  key TEXT PRIMARY KEY,
  folder TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  alt_text TEXT,
  caption TEXT,
  credit TEXT,
  license TEXT,
  hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_media_hash ON media(hash);

CREATE TABLE scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  glb_key TEXT NOT NULL,
  usdz_key TEXT,
  poster_key TEXT,
  camera_orbit TEXT,
  camera_target TEXT,
  field_of_view TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pageviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  referrer TEXT,
  country TEXT,
  device TEXT,
  browser TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_blocks_page ON blocks(page_id);
CREATE INDEX idx_revisions_kind_entity ON revisions(kind, entity_id);
CREATE INDEX idx_articles_published ON articles(published_at);
CREATE INDEX idx_articles_series ON articles(series);
CREATE INDEX idx_login_attempts_ip_time ON login_attempts(ip, attempted_at);
CREATE INDEX idx_pageviews_created ON pageviews(created_at);
CREATE INDEX idx_pageviews_path ON pageviews(path);
CREATE INDEX idx_activity_log_created ON activity_log(created_at);
CREATE INDEX idx_error_log_created ON error_log(created_at);
CREATE INDEX idx_events_created ON events(created_at);
CREATE INDEX idx_events_name ON events(name);
CREATE INDEX idx_rate_limits_bucket_ip_time ON rate_limits(bucket, ip, attempted_at);
