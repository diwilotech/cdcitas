ALTER TABLE businesses ADD COLUMN card_bio TEXT;
ALTER TABLE businesses ADD COLUMN card_address TEXT;

ALTER TABLE services ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;

-- Botones/links de la tarjeta (redes sociales, sitio web, etc.), en el orden que elija el negocio.
CREATE TABLE card_links (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  icon TEXT,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

-- Fuentes con nombre para generar links rastreables (ej. "Bio de Instagram" -> código "ig-bio").
-- El evento (card_events) guarda el código crudo como texto, no una FK, así conserva las
-- estadísticas aunque después se borre la fuente.
CREATE TABLE card_sources (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  code TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(business_id, code)
);

-- Analítica: una fila por vista de la tarjeta y por click en un botón/link.
CREATE TABLE card_events (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  source_code TEXT,
  event_type TEXT NOT NULL,
  target TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_card_events_business_date ON card_events(business_id, created_at);
