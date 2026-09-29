-- Songs a project features ("Related songs" multi-select, shown as playable
-- embeds on the public project page). Same shape as related_simulations and
-- related_scans: a JSON array of song ids. Nullable-by-default so existing rows
-- read as "no songs". The application tolerates this column being absent, so a
-- deploy before the migration is applied does not break project saves; the
-- feature switches on once the column exists.
ALTER TABLE projects ADD COLUMN related_songs TEXT NOT NULL DEFAULT '[]';
