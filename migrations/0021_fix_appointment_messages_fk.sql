-- appointment_messages.appointment_id quedó apuntando a "appointments_old" — SQLite reescribe
-- automáticamente las llaves foráneas de OTRAS tablas cuando se hace ALTER TABLE ... RENAME, así
-- que al renombrar appointments -> appointments_old (migración 0019) esta FK quedó re-escrita
-- para apuntar ahí, y se quedó así incluso después de crear la nueva tabla appointments y borrar
-- appointments_old. Cualquier INSERT en appointment_messages fallaba con "no such table:
-- appointments_old" (ej. al mandar el aviso de "cita confirmada"), aunque la cita ya se hubiera
-- creado bien. 0 filas en la tabla al momento de este fix — no hace falta preservar datos.
DROP TABLE appointment_messages;

CREATE TABLE appointment_messages (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
