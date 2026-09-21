import { makeResource, all, first, run, uid } from "../lib/db.js";
import { registerCrud } from "../lib/crud.js";
import { json, error, readJson } from "../lib/http.js";

const services = makeResource("services", ["name", "duration_min", "price", "cancel_window_hours", "reminder_hours", "allowed_space_types", "photo_key", "featured"]);
const specialists = makeResource("specialists", ["name", "role", "avatar", "color", "work_days", "open_hour", "close_hour"]);
const spaces = makeResource("spaces", ["label", "type", "shape", "capacity", "x", "y", "w", "h", "status", "color"]);
const clients = makeResource("clients", ["name", "email", "phone"]);
const blocks = makeResource("blocks", ["specialist_id", "date", "start", "end", "reason"]);
const spaceTypes = makeResource("space_types", ["key", "label", "description", "color"]);
const promotions = makeResource("promotions", ["title", "description", "code", "starts_at", "ends_at", "active"]);
const treatments = makeResource("treatments", ["name", "description", "active"]);
const cardLinks = makeResource("card_links", ["label", "icon", "url", "position"]);

export function registerResources(router) {
  registerCrud(router, "services", services, "name");
  registerCrud(router, "specialists", specialists, "name");
  registerCrud(router, "spaces", spaces, "rowid");
  registerCrud(router, "clients", clients, "name");
  registerCrud(router, "blocks", blocks, "date");
  registerCrud(router, "space-types", spaceTypes, "label");
  registerCrud(router, "promotions", promotions, "created_at DESC");
  registerCrud(router, "treatments", treatments, "created_at DESC");
  registerCrud(router, "card-links", cardLinks, "position");

  // Fuentes con nombre para armar links rastreables de la tarjeta digital (ej. "Bio de Instagram"
  // -> https://.../:slug/tarjeta?src=bio-de-instagram). Solo crear/listar/borrar — para "editar" el
  // negocio borra y crea de nuevo, así el link queda limpio.
  router.get("/api/:slug/staff/card-sources", async (request, env, ctx) =>
    json(await all(env, `SELECT * FROM card_sources WHERE business_id=? ORDER BY created_at DESC`, ctx.business.id)));

  router.post("/api/:slug/staff/card-sources", async (request, env, ctx) => {
    const { label } = await readJson(request);
    if (!label) return error("Escribe un nombre para la fuente.");
    const base = String(label).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "fuente";
    let code = base, n = 1;
    while (await first(env, `SELECT id FROM card_sources WHERE business_id=? AND code=?`, ctx.business.id, code)) {
      code = `${base}-${++n}`;
    }
    const id = uid();
    await run(env, `INSERT INTO card_sources (id, business_id, label, code) VALUES (?,?,?,?)`, id, ctx.business.id, label, code);
    return json(await first(env, `SELECT * FROM card_sources WHERE id=?`, id), { status: 201 });
  });

  router.delete("/api/:slug/staff/card-sources/:id", async (request, env, ctx) => {
    await run(env, `DELETE FROM card_sources WHERE business_id=? AND id=?`, ctx.business.id, ctx.params.id);
    return json({ ok: true });
  });

  // Servicios que ofrece un especialista (tabla puente specialist_services).
  router.put("/api/:slug/staff/specialists/:id/services", async (request, env, ctx) => {
    const { serviceIds } = await readJson(request);
    await run(env,
      `DELETE FROM specialist_services WHERE specialist_id IN (SELECT id FROM specialists WHERE id=? AND business_id=?)`,
      ctx.params.id, ctx.business.id);
    for (const serviceId of serviceIds || []) {
      await run(env, `INSERT INTO specialist_services (specialist_id, service_id) VALUES (?,?)`, ctx.params.id, serviceId);
    }
    return json({ ok: true });
  });
  router.get("/api/:slug/staff/specialists/:id/services", async (request, env, ctx) => {
    const rows = await all(env, `SELECT service_id FROM specialist_services WHERE specialist_id=?`, ctx.params.id);
    return json(rows.map((r) => r.service_id));
  });

  // Servicios que componen un paquete (tabla puente treatment_services) — a diferencia de
  // specialist_services, acá SÍ puede repetirse el mismo service_id (ej. "3 cortes" = el mismo
  // servicio tres veces), por eso cada fila tiene su propio id en vez de una llave compuesta.
  router.put("/api/:slug/staff/treatments/:id/services", async (request, env, ctx) => {
    const { serviceIds } = await readJson(request);
    await run(env,
      `DELETE FROM treatment_services WHERE treatment_id IN (SELECT id FROM treatments WHERE id=? AND business_id=?)`,
      ctx.params.id, ctx.business.id);
    let position = 0;
    for (const serviceId of serviceIds || []) {
      await run(env, `INSERT INTO treatment_services (id, treatment_id, service_id, position) VALUES (?,?,?,?)`, uid(), ctx.params.id, serviceId, position++);
    }
    return json({ ok: true });
  });
  router.get("/api/:slug/staff/treatments/:id/services", async (request, env, ctx) => {
    const rows = await all(env, `SELECT service_id FROM treatment_services WHERE treatment_id=? ORDER BY position`, ctx.params.id);
    return json(rows.map((r) => r.service_id));
  });

  // Estadísticas de un cliente: asistencia, inasistencias, cancelaciones, última visita.
  router.get("/api/:slug/staff/clients/:id/stats", async (request, env, ctx) => {
    const client = await first(env, `SELECT * FROM clients WHERE business_id=? AND id=?`, ctx.business.id, ctx.params.id);
    if (!client) return error("Cliente no encontrado.", 404);
    const appts = await all(env, `SELECT status, date FROM appointments WHERE business_id=? AND client_id=?`, ctx.business.id, client.id);
    const stats = { attended: 0, noShow: 0, cancelled: 0, lastDate: null };
    for (const a of appts) {
      if (a.status === "completed") stats.attended++;
      if (a.status === "no-show") stats.noShow++;
      if (a.status === "cancelled") stats.cancelled++;
      if (!stats.lastDate || a.date > stats.lastDate) stats.lastDate = a.date;
    }
    return json(stats);
  });
}
