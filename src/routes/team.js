import { all, first, run, uid } from "../lib/db.js";
import { json, error, readJson } from "../lib/http.js";
import { createInvite } from "./auth.js";

// Equipo del negocio: el dueño invita y quita a su personal desde el panel. El dueño solo lo asigna
// Diwilo Web (ver routes/platform.js). Rutas bajo /staff/, así que ya exigen sesión (src/index.js).
const ownerOnly = (ctx) => (ctx.user.role === "owner" ? null : error("Solo el dueño administra el equipo.", 403));
const normEmail = (e) => String(e || "").trim().toLowerCase();
const inviteUrl = (request, slug, token) => `${new URL(request.url).origin}/${slug}/admin#invite=${token}`;

export function registerTeam(router) {
  router.get("/api/:slug/staff/team", async (request, env, ctx) => {
    const users = await all(env, `SELECT id, email, name, role, pin_hash IS NOT NULL AS has_password FROM users WHERE business_id=? ORDER BY role, name`, ctx.business.id);
    return json({ users: users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, status: u.has_password ? "active" : "invited" })), canManage: ctx.user.role === "owner" });
  });

  // Invita a una persona del equipo (rol personal) y devuelve su link para crear la contraseña.
  router.post("/api/:slug/staff/team", async (request, env, ctx) => {
    const denied = ownerOnly(ctx); if (denied) return denied;
    const { email, name } = await readJson(request);
    const mail = normEmail(email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return error("Correo inválido.");
    if (await first(env, `SELECT 1 FROM users WHERE business_id=? AND email=?`, ctx.business.id, mail)) return error("Esa persona ya está en el equipo.", 409);
    const id = uid();
    await run(env, `INSERT INTO users (id, business_id, email, name, role) VALUES (?,?,?,?, 'staff')`, id, ctx.business.id, mail, String(name || "").trim().slice(0, 100) || mail.split("@")[0]);
    return json({ id, invite_url: inviteUrl(request, ctx.business.slug, await createInvite(env, id)) }, { status: 201 });
  });

  // Link nuevo para crear o restablecer la contraseña de alguien del equipo.
  router.post("/api/:slug/staff/team/:id/invite", async (request, env, ctx) => {
    const denied = ownerOnly(ctx); if (denied) return denied;
    const u = await first(env, `SELECT id, role FROM users WHERE id=? AND business_id=?`, ctx.params.id, ctx.business.id);
    if (!u) return error("No está en el equipo.", 404);
    return json({ invite_url: inviteUrl(request, ctx.business.slug, await createInvite(env, u.id)) });
  });

  router.delete("/api/:slug/staff/team/:id", async (request, env, ctx) => {
    const denied = ownerOnly(ctx); if (denied) return denied;
    const u = await first(env, `SELECT role FROM users WHERE id=? AND business_id=?`, ctx.params.id, ctx.business.id);
    if (!u) return error("No está en el equipo.", 404);
    if (u.role === "owner") return error("El dueño solo se cambia desde Diwilo.", 409);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(ctx.params.id),
      env.DB.prepare(`DELETE FROM users WHERE id=? AND business_id=?`).bind(ctx.params.id, ctx.business.id),
    ]);
    return json({ ok: true });
  });
}
