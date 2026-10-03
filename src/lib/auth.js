import { first, run, uid, nowIso } from "./db.js";
import { unauthorized } from "./http.js";
import { sha256Hex, timingSafeEqual } from "./password.js";

const SESSION_DAYS = 30;

export function getCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Fábrica de sesiones por cookie (personal de un negocio).
function sessionKit(cookieName, table, ownerColumn) {
  const cookie = (token, days = SESSION_DAYS) =>
    `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${days * 86400}`;
  const clear = () => `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  async function create(env, ownerId, extra = {}) {
    const token = uid();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
    const extraCols = Object.keys(extra);
    const cols = ["id", ownerColumn, "expires_at", ...extraCols];
    const vals = [token, ownerId, expiresAt, ...extraCols.map((k) => extra[k])];
    await run(env, `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, ...vals);
    return token;
  }
  return { cookieName, cookie, clear, create };
}

const staffKit = sessionKit("cdc_session", "sessions", "user_id");

export const SESSION_COOKIE_NAME = staffKit.cookieName;
export const sessionCookie = staffKit.cookie;
export const clearSessionCookie = staffKit.clear;
export const createSession = (env, userId, businessId) => staffKit.create(env, userId, { business_id: businessId });


// Middleware: exige sesión válida de personal para el negocio actual (ctx.business ya resuelto).
export async function requireStaff(request, env, ctx) {
  const token = getCookie(request, SESSION_COOKIE_NAME);
  if (!token) return unauthorized();
  const session = await first(env,
    `SELECT s.*, u.email, u.name, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.business_id = ? AND s.expires_at > ?`,
    token, ctx.business.id, nowIso());
  if (!session) return unauthorized();
  ctx.user = session;
  return null; // null = sigue adelante
}

// Middleware: Diwilo Web (crea negocios, invita usuarios, maneja suscripciones) se autentica con
// "Authorization: Bearer PLATFORM_KEY" — el mismo secreto en los dos proyectos.
export async function requirePlatform(request, env) {
  const key = env.PLATFORM_KEY;
  const auth = request.headers.get("authorization") || "";
  if (!key || !timingSafeEqual(await sha256Hex(auth), await sha256Hex(`Bearer ${key}`))) return unauthorized();
  return null;
}

// Suscripción: businesses.paid_until ('YYYY-MM-DD', inclusive) lo fija Diwilo Web. NULL = sin límite.
const todayBogota = () => new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
export const isExpired = (paidUntil) => !!paidUntil && paidUntil < todayBogota();
