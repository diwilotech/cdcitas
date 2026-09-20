-- appointments.treatment_id quedó con la llave foránea apuntando a treatments(id) desde la
-- migración 0017 — la 0018 cambió el modelo para que treatment_id en realidad apunte a
-- client_treatments(id) (la inscripción del cliente), pero SQLite no permite editar una llave
-- foránea existente, así que hay que recrear la tabla. Se hizo directo contra D1 verificando
-- antes que ninguna cita tuviera treatment_id puesto (0 filas), y comparando cantidad de filas +
-- IDs entre la tabla vieja y la nueva antes de borrar la vieja.
ALTER TABLE appointments RENAME TO appointments_old;

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL,
  client_email TEXT,
  client_phone TEXT,
  specialist_id TEXT NOT NULL REFERENCES specialists(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  start TEXT NOT NULL,
  end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed',
  pending_move_date TEXT,
  pending_move_start TEXT,
  pending_move_end TEXT,
  confirmation_date TEXT,
  confirmation_time TEXT,
  walk_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid INTEGER NOT NULL DEFAULT 0,
  confirm_channel TEXT,
  confirm_pin TEXT,
  confirm_token TEXT,
  confirm_expires_at TEXT,
  treatment_id TEXT REFERENCES client_treatments(id) ON DELETE SET NULL,
  session_label TEXT
);

INSERT INTO appointments SELECT * FROM appointments_old;
DROP TABLE appointments_old;

CREATE INDEX idx_appt_business_date ON appointments(business_id, date);
CREATE INDEX idx_appt_specialist_date ON appointments(specialist_id, date);
