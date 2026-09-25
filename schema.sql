CREATE TABLE pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  meta_description TEXT DEFAULT '',
  nav_label TEXT,
  nav_order INTEGER,
  og_image TEXT,
  canonical_url TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0,
  sitemap_exclude INTEGER NOT NULL DEFAULT 0,
  custom_json_ld TEXT,
  nav_parent_id INTEGER REFERENCES pages(id)
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
  canonical_url TEXT,
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
  expires_at TEXT,
  correction_note TEXT,
  tts_audio_key TEXT,
  sitemap_exclude INTEGER NOT NULL DEFAULT 0,
  related_override TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  private_notes TEXT,
  custom_json_ld TEXT
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
  canonical_url TEXT,
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
  expires_at TEXT,
  correction_note TEXT,
  tts_audio_key TEXT,
  sitemap_exclude INTEGER NOT NULL DEFAULT 0,
  related_override TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  featured_order INTEGER,
  private_notes TEXT,
  sort_order INTEGER,
  hero_video TEXT,
  custom_json_ld TEXT
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

-- Optional per-tag customization for /topics/:tag landing pages — falls
-- back to the auto-generated title/description when a tag has no row
-- here. Not a full page-builder (that's page/block territory); just
-- enough to give a topic's own intro blurb and share image.
CREATE TABLE topic_meta (
  tag TEXT PRIMARY KEY,
  description TEXT,
  og_image TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

-- Loop-based songs for the DAW module — mirrors `simulations`: all the
-- actual composition (tempo, drum-grid steps, piano-roll notes, chosen
-- drum kit, animation-sync settings) lives in `data` as JSON, versioned
-- structurally by whatever code reads it rather than by schema columns,
-- the same tradeoff already made for simulations.
CREATE TABLE songs (
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

-- Every webhook attempt, success or failure, so a silent-swallowed error
-- is actually visible somewhere, and a failed delivery can be retried
-- without needing to trigger a fresh publish/unpublish to fire it again.
CREATE TABLE webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  status_code INTEGER,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_webhook_deliveries_created ON webhook_deliveries(created_at);

-- One row per reaction click, not one row per visitor — there's no visitor
-- identity to dedupe against server-side (matches this site's no-accounts,
-- no-fingerprinting analytics approach elsewhere). Double-voting is only
-- discouraged client-side (localStorage), never enforced here.
CREATE TABLE reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_reactions_content ON reactions(content_type, content_id);

-- A shareable link that lets someone view an unpublished article/project
-- without being logged in as admin — expires on its own, and can be
-- revoked early without touching the content itself.
CREATE TABLE preview_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_type TEXT NOT NULL,
  content_id INTEGER NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_preview_links_token ON preview_links(token);
CREATE INDEX idx_preview_links_content ON preview_links(content_type, content_id);

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

-- Snapshots of a media file's editable metadata, taken right before each
-- editorial change (not on upload or the hash-backfill scan) — lets an
-- accidental overwrite of alt text/caption/credit/etc. be undone. Keyed
-- by media_key (not a foreign key: media rows can be deleted while their
-- revision history stays, same as pages/articles/projects already do
-- with the revisions table).
CREATE TABLE media_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_key TEXT NOT NULL,
  folder TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  alt_text TEXT,
  caption TEXT,
  credit TEXT,
  license TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_media_revisions_key ON media_revisions(media_key);

-- The actual file bytes from before an in-place "Overwrite original"
-- (photo editor / PUT /media/:key) — media_revisions above only covers
-- the metadata (alt/caption/etc.), never the image content itself. Each
-- old version's bytes live in R2 under a `_versions/` prefix (kept out
-- of the main `uploads/` listing), and this table just points at them.
CREATE TABLE media_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_key TEXT NOT NULL,
  version_key TEXT NOT NULL,
  size INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_media_versions_key ON media_versions(media_key);

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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  region TEXT,
  city TEXT
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
