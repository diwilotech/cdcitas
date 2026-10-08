import { all, first, run, nowIso } from "../lib/db.js";
import { json, error, readJson } from "../lib/http.js";
import { createSession, getCookie, sessionCookie, clearSessionCookie, SESSION_COOKIE_NAME, isExpired, requireStaff } from "../lib/auth.js";
import {
  verifyPassword, hashPassword, validatePassword, randomSalt, randomToken, sha256Hex, MIN_PASSWORD,
} from "../lib/password.js";

// Link /:slug/admin#invite=<token> para crear (o restablecer) la contraseña. Se guarda solo el
// SHA-256; generar uno nuevo invalida el anterior. Lo usan Diwilo Web (routes/platform.js) y el login
// cuando alguien entra con su PIN viejo.
export async function createInvite(env, userId) {
  const token = randomToken();
  await run(env, `UPDATE users SET invite_hash=? WHERE id=?`, await sha256Hex(token), userId);
  return token;
}

async function userByInvite(env, businessId, token) {
  if (!/^[0-9a-f]{64}$/.test(String(token || ""))) return null;
  return first(env, `SELECT * FROM users WHERE business_id=? AND invite_hash=?`, businessId, await sha256Hex(token));
}

const publicUser = (u) => ({ email: u.email, name: u.name, role: u.role });

// Bloqueo por correo: 5 intentos fallidos -> 15 minutos (tabla login_attempts, igual que las demás apps).
const MAX_FAILS = 5, LOCK_MINUTES = 15;
async function lockedOut(env, mail) {
  const a = await first(env, `SELECT locked_until FROM login_attempts WHERE email=?`, mail);
  return !!(a?.locked_until && a.locked_until > nowIso());
}
async function recordFail(env, mail) {
  const a = await first(env, `SELECT fails FROM login_attempts WHERE email=?`, mail);
  const n = (a?.fails || 0) + 1;
  const lock = n >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
  await run(env, `INSERT INTO login_attempts (email, fails, locked_until) VALUES (?,?,?)
                  ON CONFLICT(email) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until`, mail, lock ? 0 : n, lock);
}
const clearFails = (env, mail) => run(env, `DELETE FROM login_attempts WHERE email=?`, mail);
const LOCKED = "Demasiados intentos. Prueba de nuevo en unos minutos.";

// Login directo: correo + contraseña.
export function registerAuth(router) {
  // Login general (/login), sin el negocio en la URL: busca el correo en todos los negocios y lo
  // lleva al suyo. Si la misma clave sirve en varios, devuelve la lista para que elija (el ingreso a
  // ese negocio lo hace después /api/:slug/auth/login).
  router.post("/api/auth/login", async (request, env) => {
    const { email, password } = await readJson(request);
    const pw = String(password || "");
    const mail = String(email || "").trim().toLowerCase();
    if (await lockedOut(env, mail)) return error(LOCKED, 429);
    const users = await all(env,
      `SELECT u.id, u.business_id, u.pin_hash, u.pin_salt, b.slug, b.name AS business_name
         FROM users u JOIN businesses b ON b.id = u.business_id WHERE u.email=? ORDER BY b.name`,
      mail);
    const matches = [];
    for (const u of users) if (await verifyPassword(pw, u.pin_salt, u.pin_hash)) matches.push(u);
    if (!matches.length) { await recordFail(env, mail); return error("Correo o contraseña incorrectos.", 401); }
    await clearFails(env, mail);
    if (matches.length > 1) return json({ choose: matches.map((u) => ({ slug: u.slug, name: u.business_name })) });
    const u = matches[0];
    if (pw.length < MIN_PASSWORD) return json({ slug: u.slug, mustSetPassword: true, invite: await createInvite(env, u.id) });
    const token = await createSession(env, u.id, u.business_id);
    return json({ slug: u.slug }, { headers: { "set-cookie": sessionCookie(token) } });
  });

  // ¿Ya hay una sesión abierta? /login la usa para mandar directo al panel del negocio.
  router.get("/api/auth/session", async (request, env) => {
    const token = getCookie(request, SESSION_COOKIE_NAME);
    const s = token && await first(env,
      `SELECT b.slug FROM sessions s JOIN businesses b ON b.id = s.business_id WHERE s.id=? AND s.expires_at > ?`,
      token, nowIso());
    return json({ slug: s ? s.slug : null });
  });

  router.post("/api/:slug/auth/login", async (request, env, ctx) => {
    const { email, password } = await readJson(request);
    const mail = String(email || "").trim().toLowerCase();
    if (await lockedOut(env, mail)) return error(LOCKED, 429);
    const user = await first(env, `SELECT * FROM users WHERE business_id=? AND email=?`, ctx.business.id, mail);
    if (!user || !(await verifyPassword(String(password || ""), user.pin_salt, user.pin_hash))) {
      await recordFail(env, mail);
      return error("Correo o contraseña incorrectos.", 401);
    }
    await clearFails(env, mail);
    // Entró con el PIN de antes: se acepta una vez y pide crear la contraseña.
    if (String(password).length < MIN_PASSWORD) {
      return json({ mustSetPassword: true, invite: await createInvite(env, user.id) });
    }
    const token = await createSession(env, user.id, ctx.business.id);
    return json({ user: publicUser(user) }, { headers: { "set-cookie": sessionCookie(token) } });
  });

  router.get("/api/:slug/auth/invite", async (request, env, ctx) => {
    const user = await userByInvite(env, ctx.business.id, new URL(request.url).searchParams.get("token"));
    if (!user) return error("Este link ya no es válido. Pide uno nuevo.", 404);
    return json({ email: user.email, name: user.name, reset: !!user.pin_hash });
  });

  router.post("/api/:slug/auth/invite", async (request, env, ctx) => {
    const { token, password, name } = await readJson(request);
    const user = await userByInvite(env, ctx.business.id, token);
    if (!user) return error("Este link ya no es válido. Pide uno nuevo.", 404);
    if (!validatePassword(password)) return error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
    const salt = randomSalt();
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET pin_hash=?, pin_salt=?, invite_hash=NULL, name=COALESCE(NULLIF(?, ''), name) WHERE id=?`)
        .bind(await hashPassword(password, salt), salt, String(name || "").trim().slice(0, 100), user.id),
      env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(user.id),
    ]);
    const sessionToken = await createSession(env, user.id, ctx.business.id);
    return json({ user: publicUser({ ...user, name: String(name || "").trim() || user.name }) },
      { headers: { "set-cookie": sessionCookie(sessionToken) } });
  });

  // Cambiar la contraseña desde el panel (sirve aunque la suscripción esté vencida). Cierra las demás sesiones.
  router.post("/api/:slug/auth/password", async (request, env, ctx) => {
    const denied = await requireStaff(request, env, ctx);
    if (denied) return denied;
    const { current, password } = await readJson(request);
    const user = await first(env, `SELECT id, pin_hash, pin_salt FROM users WHERE id=?`, ctx.user.user_id);
    if (!(await verifyPassword(String(current || ""), user.pin_salt, user.pin_hash))) return error("La contraseña actual no es correcta.", 401);
    if (!validatePassword(password)) return error(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
    const salt = randomSalt();
    await env.DB.batch([
      env.DB.prepare(`UPDATE users SET pin_hash=?, pin_salt=?, invite_hash=NULL WHERE id=?`).bind(await hashPassword(password, salt), salt, user.id),
      env.DB.prepare(`DELETE FROM sessions WHERE user_id=? AND id<>?`).bind(user.id, ctx.user.id),
    ]);
    return json({ ok: true });
  });

  router.post("/api/:slug/auth/logout", async (request, env, ctx) => {
    const token = getCookie(request, SESSION_COOKIE_NAME);
    if (token) await run(env, `DELETE FROM sessions WHERE id=?`, token);
    return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
  });

  router.get("/api/:slug/staff/me", async (request, env, ctx) =>
    json({
      email: ctx.user.email, name: ctx.user.name, role: ctx.user.role,
      readOnly: isExpired(ctx.business.paid_until), paidUntil: ctx.business.paid_until || null,
    }));
}
