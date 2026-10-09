-- Local and preview only. Rebuilds the home page: the title, a line about the site, the Studio button and the two study buttons.
-- NEVER run this against production: it deletes and recreates the "home" page and its blocks.
--   npx wrangler d1 execute DB --local --file=seed/home.sql
DELETE FROM blocks WHERE page_id IN (SELECT id FROM pages WHERE slug = 'home');
DELETE FROM pages WHERE slug = 'home';
INSERT INTO pages (slug, title, meta_description, nav_label, nav_order)
  VALUES ('home', 'Dominick', 'Dominick Gentile: a music studio in the browser.', 'home', 0);
INSERT INTO blocks (page_id, type, content, style, col, col_span, row, row_span)
  SELECT id, 'heading', '{"text":"Dominick","level":1}', '{}', 1, 24, 1, 4 FROM pages WHERE slug = 'home';
INSERT INTO blocks (page_id, type, content, style, col, col_span, row, row_span)
  SELECT id, 'text', '{"text":"I make small things in the browser. The Studio is a music maker with five tracks, a step grid and a piano roll. Everything you make stays on your device."}', '{}', 1, 16, 5, 5 FROM pages WHERE slug = 'home';
INSERT INTO blocks (page_id, type, content, style, col, col_span, row, row_span)
  SELECT id, 'button', '{"label":"Open the Studio","url":"/studio"}', '{}', 17, 8, 5, 3 FROM pages WHERE slug = 'home';
INSERT INTO blocks (page_id, type, content, style, col, col_span, row, row_span)
  SELECT id, 'study', '{"lab":"core1-lab","label":"A+ Core 1 drill"}', '{}', 1, 8, 10, 3 FROM pages WHERE slug = 'home';
INSERT INTO blocks (page_id, type, content, style, col, col_span, row, row_span)
  SELECT id, 'study', '{"lab":"c777-lab","label":"C777 web drill"}', '{}', 9, 8, 10, 3 FROM pages WHERE slug = 'home';
