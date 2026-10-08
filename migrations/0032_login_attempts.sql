-- Bloqueo de ingreso: 5 intentos fallidos del mismo correo bloquean 15 minutos (como las demás apps de Diwilo).
CREATE TABLE IF NOT EXISTS login_attempts (
  email TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
