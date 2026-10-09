-- Local and preview only. Rebuilds the home page: a heading and the two study buttons.
-- NEVER run this against production: it deletes and recreates the "home" page and its blocks.
--   npx wrangler d1 execute DB --local --file=seed/home.sql
DELETE FROM blocks WHERE page_id IN (SELECT id FROM pages WHERE slug = 'home');
DELETE FROM pages WHERE slug = 'home';
INSERT INTO pages (slug, title, meta_description, nav_label, nav_order)
  VALUES ('home', 'Dominick', 'Dominick Gentile: a music studio in the browser.', 'home', 0);
INSERT INTO blocks (page_id, type, content, style, col, col_span, row, row_span)
  SELECT id, 'heading', '{"text":"DOMINICK . DOMINICK","level":1}', '{}', 1, 24, 1, 4 FROM pages WHERE slug = 'home';
INSERT INTO blocks (page_id, type, content, style, col, col_span, row, row_span)
  SELECT id, 'study', '{"lab":"core1-lab","label":"A+ Core 1 drill"}', '{}', 1, 8, 5, 3 FROM pages WHERE slug = 'home';
INSERT INTO blocks (page_id, type, content, style, col, col_span, row, row_span)
  SELECT id, 'study', '{"lab":"c777-lab","label":"C777 web drill"}', '{}', 9, 8, 5, 3 FROM pages WHERE slug = 'home';
