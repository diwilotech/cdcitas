-- Rediseño de tratamientos: pasan a ser PLANTILLAS reusables (como los servicios), armadas con un
-- conjunto de servicios elegidos una sola vez en Reglas, en vez de crearse cita por cita para un
-- solo cliente. La tabla `treatments` de la migración anterior no llegó a tener datos reales.
DROP TABLE IF EXISTS treatments;

CREATE TABLE treatments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Qué servicios componen cada tratamiento (y en qué orden se sugieren).
CREATE TABLE treatment_services (
  treatment_id TEXT NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (treatment_id, service_id)
);

-- Un cliente "inscrito" en un tratamiento — appointments.treatment_id (ya existía) ahora apunta
-- acá, no directo a treatments.id, para poder tener el progreso de CADA cliente por separado
-- (incluso si repite el mismo tratamiento dos veces).
CREATE TABLE client_treatments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  treatment_id TEXT NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active', -- active | completed | cancelled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_client_treatments_client ON client_treatments(client_id);
