-- Base común de las apps de Diwilo para CD Citas: apariencia por negocio, módulos por negocio (los asigna Diwilo), bitácora,
-- módulos por persona del equipo y conexiones MCP. Solo agrega: no borra ni cambia lo existente.
CREATE TABLE IF NOT EXISTS business_settings (
  business_id  TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  tema         TEXT NOT NULL DEFAULT 'turquesa',
  modo         TEXT NOT NULL DEFAULT 'light',
  logo_key     TEXT,
  updated_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS business_modules (
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  modulo       TEXT NOT NULL,
  activo       INTEGER NOT NULL DEFAULT 1,
  desde        TEXT,
  hasta        TEXT,
  synced_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (business_id, modulo)
);
CREATE TABLE IF NOT EXISTS business_modules_sync (
  business_id TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id  TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      TEXT,
  origen       TEXT NOT NULL DEFAULT 'app',
  modulo       TEXT,
  accion       TEXT NOT NULL,
  detalle      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS audit_log_business ON audit_log (business_id, created_at);
-- Módulos que puede abrir cada persona del equipo. NULL = los de su rol (el propietario ve todo).
ALTER TABLE users ADD COLUMN modulos TEXT;
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id            TEXT PRIMARY KEY,
  business_id   TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at  TEXT,
  revoked_at    TEXT
);
CREATE INDEX IF NOT EXISTS mcp_tokens_business ON mcp_tokens (business_id);
