ALTER TABLE simulations ADD COLUMN published_name TEXT;
ALTER TABLE simulations ADD COLUMN published_data TEXT;

-- Preserve the public version of every simulation that existed before this
-- feature. New simulations leave both publication columns NULL until published.
UPDATE simulations
SET published_name = name,
    published_data = data;
