-- Negocios, accesos y suscripciones manejados desde Diwilo Web (/api/platform/*). Ya no hay super
-- admin propio: platform_admins y admin_sessions quedan sin uso (se pueden borrar más adelante).

-- 'YYYY-MM-DD' inclusive; NULL = sin límite. Vencida -> el negocio queda en solo lectura.
ALTER TABLE businesses ADD COLUMN paid_until TEXT;

-- SHA-256 del token del link para crear/restablecer la contraseña (/:slug/admin#invite=<token>).
ALTER TABLE users ADD COLUMN invite_hash TEXT;
CREATE INDEX idx_users_invite ON users(invite_hash);
