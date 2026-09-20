-- Un paquete puede repetir el mismo servicio varias veces (ej. "3 cortes" = Corte de cabello x3),
-- así que treatment_id+service_id ya no puede ser la llave primaria (impedía duplicados). Se
-- cambia a un id propio por fila. Preserva las filas que ya existan.
ALTER TABLE treatment_services RENAME TO treatment_services_old;

CREATE TABLE treatment_services (
  id TEXT PRIMARY KEY,
  treatment_id TEXT NOT NULL REFERENCES treatments(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0
);

INSERT INTO treatment_services (id, treatment_id, service_id, position)
SELECT lower(hex(randomblob(16))), treatment_id, service_id, position FROM treatment_services_old;

DROP TABLE treatment_services_old;
