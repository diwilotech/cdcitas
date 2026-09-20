-- Tratamientos: paquetes de varias sesiones (citas) para un mismo cliente. Cada sesión sigue
-- siendo una fila normal de appointments, solo enlazada a treatment_id y con su propia etiqueta.
CREATE TABLE treatments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT,
  total_sessions INTEGER,
  status TEXT NOT NULL DEFAULT 'active', -- active | completed | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_treatments_client ON treatments(client_id);

ALTER TABLE appointments ADD COLUMN treatment_id TEXT REFERENCES treatments(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN session_label TEXT;
