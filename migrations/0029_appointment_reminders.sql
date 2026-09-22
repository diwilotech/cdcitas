-- Varios recordatorios por cita: el servicio puede definir un 2do aviso (además de reminder_hours),
-- y el staff puede añadir otros puntuales desde Agenda. Reemplaza a appointments.confirmation_date/
-- confirmation_time (quedan en la tabla sin usarse, no se borran para no tocar el esquema en vivo).
ALTER TABLE services ADD COLUMN reminder_2_minutes INTEGER;

CREATE TABLE appointment_reminders (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  remind_date TEXT NOT NULL,
  remind_time TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_appointment_reminders_appt ON appointment_reminders(appointment_id);
CREATE INDEX idx_appointment_reminders_due ON appointment_reminders(business_id, sent, remind_date, remind_time);
