-- Direcciones anteriores de cada negocio: al cambiar la dirección desde Diwilo, la vieja redirige a la nueva
-- (los links de reserva y los QR ya compartidos siguen funcionando).
CREATE TABLE IF NOT EXISTS business_slug_aliases (
  slug        TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
