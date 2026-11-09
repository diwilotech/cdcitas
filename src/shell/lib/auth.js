// Sesión y permisos de la capa común (módulos centrales, IA/MCP, Inicio) sobre el modelo de usuarios de Citas:
// un usuario pertenece a UN negocio (users.business_id, rol owner | staff) y la sesión es la cookie cdc_session (tabla sessions).
import { HttpError, getCookie } from './http.js';
import { db } from './db.js';
import { parseModulos, requireModule } from './modules.js';
import { isPlatformCall } from '../../lib/platform-rpc.js';

export const SESSION_COOKIE = 'cdc_session';
export const todayBogota = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
export const isExpired = (paidUntil) => !!paidUntil && paidUntil < todayBogota();

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Negocios donde la persona (por correo) tiene acceso.
export async function userBusinesses(env, user) {
  return db(env).all(
    `SELECT b.id, b.name, b.slug FROM users u JOIN businesses b ON b.id = u.business_id AND b.archived_at IS NULL
      WHERE lower(u.email) = (SELECT lower(email) FROM users WHERE id = ?) ORDER BY b.name`,
    user.id,
  );
}

export async function loadSession(req, env) {
  const token = getCookie(req, SESSION_COOKIE);
  if (!token) return null;
  return db(env).first(
    `SELECT s.id AS session_id, s.user_id, s.business_id, u.email, u.name, u.role, u.modulos,
            b.name AS business_name, b.slug AS business_slug, b.paid_until
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN businesses b ON b.id = s.business_id AND b.archived_at IS NULL
      WHERE s.id = ? AND s.expires_at > ?`,
    token, new Date().toISOString(),
  );
}

// 'tenant:<modulo>' | 'manager:<modulo>' | 'session' | 'platform' | 'public'. Igual que en las demás apps de Diwilo.
export async function authenticate(c, spec) {
  const [level, moduleId] = String(spec).split(':');
  if (level === 'public') return;
  if (level === 'platform') { if (!isPlatformCall(c.req)) throw new HttpError(401, 'No autorizado'); return; }
  const s = await loadSession(c.req, c.env);
  if (!s) throw new HttpError(401, 'Inicia sesión', 'NO_SESSION');
  c.session = s;
  c.user = { id: s.user_id, email: s.email, name: s.name };
  if (level === 'session') return;
  c.businessId = s.business_id;
  c.role = s.role === 'owner' ? 'owner' : 'staff';
  c.modulos = parseModulos(s.modulos);
  c.readOnly = isExpired(s.paid_until);
  c.timezone = 'America/Bogota';
  if (c.readOnly && c.req.method !== 'GET' && c.req.method !== 'HEAD') throw new HttpError(402, 'La suscripción del negocio está vencida: solo lectura.');
  if (level === 'manager' && c.role !== 'owner') throw new HttpError(403, 'Solo el propietario');
  if (moduleId) await requireModule(c, moduleId);
}
