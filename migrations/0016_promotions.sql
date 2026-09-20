-- Promociones del negocio, visibles en la reserva y en "mis citas" mientras estén vigentes.
CREATE TABLE promotions (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  code TEXT,
  starts_at TEXT, -- YYYY-MM-DD, NULL = ya empezó
  ends_at TEXT,   -- YYYY-MM-DD, NULL = sin fecha de fin
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_promotions_business ON promotions(business_id);
