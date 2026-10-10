import { all, first, run, uid } from "../lib/db.js";
import { json, error, readJson, notFound } from "../lib/http.js";
import { resolveBusiness } from "../lib/tenant.js";
import { requirePlatform, isExpired, createSession, sessionCookie } from "../lib/auth.js";
import { purgeArchived, purgeDate, issueSsoTicket, takeSsoTicket } from "../lib/platform-tools.js";
import { DEFAULT_TEMPLATES } from "../lib/templates.js";
import { createInvite } from "./auth.js";

// Plataforma: Diwilo Web es el único panel que crea negocios, invita usuarios y fija hasta cuándo
// está paga la suscripción (businesses.paid_until). Solo llega por RPC desde Diwilo (ver
// lib/platform-rpc.js). Contrato común a las apps de Diwilo (pedidos, nutrición, citas):
//   GET    /api/platform/businesses
//   POST   /api/platform/businesses                 { name, slug, owner_email, owner_name?, paid_until }
//   GET    /api/platform/businesses/:id
//   PATCH  /api/platform/businesses/:id             { name?, slug?, paid_until? }
//          slug = dirección /<slug>; la anterior queda como alias y redirige a la nueva.
//   POST   /api/platform/businesses/:id/users       { email, name?, role: owner|staff } -> invite_path
//   PATCH  /api/platform/businesses/:id/users/:userId { role }  solo cambia permisos
//   DELETE /api/platform/businesses/:id/users/:userId

// El negocio vive en /:slug (reserva) y /:slug/admin (panel) — estas palabras ya son rutas del
// sistema y no se pueden usar como slug (ver el ruteo de /:slug en src/index.js).
const RESERVED_SLUGS = new Set(["admin", "api", "setup", "app", "styles", "t", "platform", "login", "auth", "sso"]);

// Tipos de espacio con los que arranca todo negocio nuevo (después son editables en Reglas).
const DEFAULT_SPACE_TYPES = [
  { key: "general", label: "General" },
  { key: "barra", label: "Barra" },
  { key: "privado", label: "Privado / VIP" },
  { key: "terraza", label: "Terraza" },
];

const invitePath = (slug, token) => `/${slug}/admin#invite=${token}`;
const validDate = (v) => v === null || (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v)));
const normEmail = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

async function listBusinesses(env, id, archived = false) {
  const where = id ? "WHERE id=?" : `WHERE archived_at IS ${archived ? "NOT NULL" : "NULL"}`;
  const args = id ? [id] : [];
  const [businesses, users] = await Promise.all([
    all(env, `SELECT id, slug, name, created_at, paid_until, archived_at FROM businesses ${where} ORDER BY created_at`, ...args),
    all(env, `SELECT id, business_id, email, name, role, pin_hash IS NOT NULL AS has_password FROM users
              ${id ? "WHERE business_id=?" : ""} ORDER BY role, name`, ...args),
  ]);
  return businesses.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    created_at: String(b.created_at).replace(" ", "T") + (String(b.created_at).endsWith("Z") ? "" : "Z"),
    paid_until: b.paid_until || null,
    read_only: isExpired(b.paid_until),
    archived_at: b.archived_at || null,
    purge_on: purgeDate(b.archived_at),
    users: users.filter((u) => u.business_id === b.id).map((u) => ({
      id: u.id, email: u.email, name: u.name, role: u.role,
      status: u.has_password ? "active" : "invited",
      invite_path: null, // solo se guarda el hash: se ve al generarlo
    })),
  }));
}

export function registerPlatform(router) {
  const guarded = (handler) => async (request, env, ctx) => (await requirePlatform(request, env)) || handler(request, env, ctx);

  // ?archived=1: solo los archivados (se borran por lotes a los 20 días)
  router.get("/api/platform/businesses", guarded(async (request, env) =>
    json({ businesses: await listBusinesses(env, null, new URL(request.url).searchParams.get("archived") === "1") })));

  // Crea un negocio (tenant) con su dueño, sus plantillas de mensajes y un espacio inicial.
  router.post("/api/platform/businesses", guarded(async (request, env) => {
    const body = await readJson(request);
    const slug = String(body.slug || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const ownerEmail = normEmail(body.owner_email);
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) return error("El slug debe tener 3-40 caracteres: minúsculas, números o guiones.");
    if (RESERVED_SLUGS.has(slug)) return error("Ese slug está reservado, elige otro.");
    if (!name) return error("Falta el nombre del negocio.");
    if (!validEmail(ownerEmail)) return error("Correo del dueño inválido.");
    if (!validDate(body.paid_until ?? null)) return error("Fecha de pago inválida.");
    if (await first(env, `SELECT 1 FROM businesses WHERE slug=?`, slug) || await first(env, `SELECT 1 FROM business_slug_aliases WHERE slug=?`, slug)) return error("Ese slug ya está en uso.", 409);

    const businessId = uid();
    const userId = uid();
    const stmts = [
      env.DB.prepare(`INSERT INTO businesses (id, slug, name, webhook_token, paid_until) VALUES (?,?,?,?,?)`)
        .bind(businessId, slug, name, uid(), body.paid_until ?? null),
      env.DB.prepare(`INSERT INTO users (id, business_id, email, phone, name, role) VALUES (?,?,?,?,?,'owner')`)
        .bind(userId, businessId, ownerEmail, body.owner_phone || null, String(body.owner_name || "").trim() || ownerEmail.split("@")[0]),
      ...Object.entries(DEFAULT_TEMPLATES).map(([key, tplBody]) =>
        env.DB.prepare(`INSERT INTO message_templates (id, business_id, key, body) VALUES (?,?,?,?)`).bind(uid(), businessId, key, tplBody)),
      ...DEFAULT_SPACE_TYPES.map((t) =>
        env.DB.prepare(`INSERT INTO space_types (id, business_id, key, label) VALUES (?,?,?,?)`).bind(uid(), businessId, t.key, t.label)),
      env.DB.prepare(`INSERT INTO spaces (id, business_id, label, type, shape, capacity, x, y, w, h) VALUES (?,?,'General','general','square',4,0,0,3,3)`)
        .bind(uid(), businessId),
    ];
    await env.DB.batch(stmts);
    const token = await createInvite(env, userId);
    return json({ id: businessId, slug, invite_path: invitePath(slug, token) }, { status: 201 });
  }));

  router.get("/api/platform/businesses/:id", guarded(async (request, env, ctx) => {
    const [b] = await listBusinesses(env, ctx.params.id);
    return b ? json(b) : notFound();
  }));

  router.patch("/api/platform/businesses/:id", guarded(async (request, env, ctx) => {
    const body = await readJson(request);
    if (!(await first(env, `SELECT 1 FROM businesses WHERE id=?`, ctx.params.id))) return notFound();
    if (body.name !== undefined && !String(body.name).trim()) return error("Nombre vacío.");
    if (body.paid_until !== undefined && !validDate(body.paid_until)) return error("Fecha de pago inválida.");
    const stmts = [];
    // Dirección /<slug>: la anterior queda como alias y redirige (links de reserva y QR ya compartidos).
    if (body.slug !== undefined) {
      const slug = String(body.slug || "").trim().toLowerCase();
      if (!/^[a-z0-9-]{3,40}$/.test(slug)) return error("La dirección debe tener 3-40 caracteres: minúsculas, números o guiones.");
      if (RESERVED_SLUGS.has(slug)) return error("Esa dirección está reservada, elige otra.");
      const cur = await first(env, `SELECT slug FROM businesses WHERE id=?`, ctx.params.id);
      if (slug !== cur.slug) {
        if (await first(env, `SELECT 1 FROM businesses WHERE slug=? AND id<>?`, slug, ctx.params.id)) return error("Esa dirección ya la usa otro negocio.", 409);
        if (await first(env, `SELECT 1 FROM business_slug_aliases WHERE slug=? AND business_id<>?`, slug, ctx.params.id)) return error("Esa dirección la usó antes otro negocio.", 409);
        stmts.push(env.DB.prepare(`UPDATE businesses SET slug=? WHERE id=?`).bind(slug, ctx.params.id),
          env.DB.prepare(`INSERT OR REPLACE INTO business_slug_aliases (slug, business_id) VALUES (?,?)`).bind(cur.slug, ctx.params.id),
          env.DB.prepare(`DELETE FROM business_slug_aliases WHERE slug=?`).bind(slug));
      }
    }
    if (body.name !== undefined) stmts.push(env.DB.prepare(`UPDATE businesses SET name=? WHERE id=?`).bind(String(body.name).trim(), ctx.params.id));
    if (body.paid_until !== undefined) stmts.push(env.DB.prepare(`UPDATE businesses SET paid_until=? WHERE id=?`).bind(body.paid_until, ctx.params.id));
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true });
  }));

  // Agrega un usuario (dueño o personal) o, si ya existe, le genera un link nuevo para crear o
  // restablecer su contraseña (y le actualiza el rol).
  router.post("/api/platform/businesses/:id/users", guarded(async (request, env, ctx) => {
    const business = await first(env, `SELECT id, slug FROM businesses WHERE id=?`, ctx.params.id);
    if (!business) return notFound();
    const { email, name, role, phone } = await readJson(request);
    const mail = normEmail(email);
    if (!validEmail(mail)) return error("Correo inválido.");
    const userRole = role === "owner" ? "owner" : "staff";
    let user = await first(env, `SELECT id FROM users WHERE business_id=? AND email=?`, business.id, mail);
    // Un solo dueño: si este pasa a serlo, el anterior queda como personal.
    if (userRole === "owner") await run(env, `UPDATE users SET role='staff' WHERE business_id=? AND role='owner' AND email<>?`, business.id, mail);
    if (user) {
      await run(env, `UPDATE users SET role=? WHERE id=?`, userRole, user.id);
    } else {
      user = { id: uid() };
      await run(env, `INSERT INTO users (id, business_id, email, phone, name, role) VALUES (?,?,?,?,?,?)`,
        user.id, business.id, mail, phone || null, String(name || "").trim() || mail.split("@")[0], userRole);
    }
    const token = await createInvite(env, user.id);
    return json({ id: user.id, invite_path: invitePath(business.slug, token) }, { status: 201 });
  }));

  // Cambia el rol (permisos) y/o el correo, sin link nuevo ni tocar la contraseña. Un solo dueño: al
  // asignar otro, el anterior queda como personal.
  router.patch("/api/platform/businesses/:id/users/:userId", guarded(async (request, env, ctx) => {
    const { role, email } = await readJson(request);
    const mail = email === undefined ? null : normEmail(email);
    if (role !== undefined && role !== "owner" && role !== "staff") return error("Rol no válido.");
    if (mail !== null && !validEmail(mail)) return error("Correo inválido.");
    if (role === undefined && mail === null) return error("Indica el rol o el correo.");
    const user = await first(env, `SELECT id, role, email FROM users WHERE business_id=? AND id=?`, ctx.params.id, ctx.params.userId);
    if (!user) return error("El usuario no pertenece a este negocio.", 404);
    const stmts = [];
    if (mail && mail !== user.email) {
      if (await first(env, `SELECT 1 FROM users WHERE business_id=? AND email=? AND id<>?`, ctx.params.id, mail, user.id)) return error("Ese correo ya está en este negocio.", 409);
      stmts.push(env.DB.prepare(`UPDATE users SET email=? WHERE id=?`).bind(mail, user.id));
    }
    if (role && role !== user.role) {
      if (user.role === "owner") return error("Es el dueño: para cambiarlo, asigna otro dueño.", 409);
      stmts.push(env.DB.prepare(`UPDATE users SET role='staff' WHERE business_id=? AND role='owner'`).bind(ctx.params.id),
        env.DB.prepare(`UPDATE users SET role=? WHERE id=?`).bind(role, user.id));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, role: role || user.role, email: mail || user.email });
  }));

  router.delete("/api/platform/businesses/:id/users/:userId", guarded(async (request, env, ctx) => {
    const u = await first(env, `SELECT role FROM users WHERE business_id=? AND id=?`, ctx.params.id, ctx.params.userId);
    if (u?.role === "owner") return error("No se puede quitar al dueño: primero asigna otro dueño.", 409);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM sessions WHERE business_id=? AND user_id=?`).bind(ctx.params.id, ctx.params.userId),
      env.DB.prepare(`DELETE FROM users WHERE business_id=? AND id=?`).bind(ctx.params.id, ctx.params.userId),
    ]);
    return json({ ok: true });
  }));

  // Archivar: nadie entra, la página de reservas deja de existir y sale de la lista. Se borra por lotes a
  // los 20 días (POST /api/platform/purge).
  router.delete("/api/platform/businesses/:id", guarded(async (request, env, ctx) => {
    const b = await first(env, `SELECT archived_at FROM businesses WHERE id=?`, ctx.params.id);
    if (!b) return notFound();
    const at = b.archived_at || new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`UPDATE businesses SET archived_at=? WHERE id=?`).bind(at, ctx.params.id),
      env.DB.prepare(`DELETE FROM sessions WHERE business_id=?`).bind(ctx.params.id),
    ]);
    return json({ ok: true, archived_at: at, purge_on: purgeDate(at) });
  }));

  router.post("/api/platform/businesses/:id/restore", guarded(async (request, env, ctx) => {
    const r = await env.DB.prepare(`UPDATE businesses SET archived_at=NULL WHERE id=? AND archived_at IS NOT NULL`).bind(ctx.params.id).run();
    return r.meta.changes ? json({ ok: true }) : error("No está archivado.", 404);
  }));

  router.post("/api/platform/purge", guarded(async (request, env) => {
    const body = await readJson(request).catch(() => ({}));
    const days = Math.max(1, Math.min(365, Number(body.days) || 20));
    return json(await purgeArchived(env, { table: "businesses", tenantCol: "business_id", bucket: env.FILES }, { days }));
  }));

  // Entrar como el dueño sin contraseña: pase de un solo uso que Diwilo abre en el navegador.
  router.post("/api/platform/businesses/:id/sso", guarded(async (request, env, ctx) => {
    const owner = await first(env, `SELECT u.id FROM users u JOIN businesses b ON b.id = u.business_id AND b.archived_at IS NULL
                                     WHERE u.business_id=? AND u.role='owner' ORDER BY u.created_at LIMIT 1`, ctx.params.id);
    if (!owner) return error("El negocio no tiene dueño o está archivado.", 404);
    return json({ path: `/api/sso?t=${await issueSsoTicket(env, ctx.params.id, owner.id)}` });
  }));

  router.get("/api/sso", async (request, env) => {
    const t = await takeSsoTicket(env, new URL(request.url).searchParams.get("t"));
    const u = t && await first(env, `SELECT u.id, b.slug FROM users u JOIN businesses b ON b.id = u.business_id AND b.archived_at IS NULL
                                     WHERE u.id=? AND u.business_id=? AND u.role='owner'`, t.user_id, t.business_id);
    if (!u) return new Response("Este acceso ya se usó o venció. Vuelve a abrirlo desde Diwilo.", { status: 410, headers: { "content-type": "text/plain; charset=utf-8" } });
    const token = await createSession(env, u.id, t.business_id);
    return new Response(null, { status: 302, headers: { location: `/${u.slug}/admin`, "set-cookie": sessionCookie(token), "cache-control": "no-store" } });
  });
}
