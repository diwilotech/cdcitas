import { all, first, run, uid } from "../lib/db.js";
import { json, error, readJson } from "../lib/http.js";

// Tarjeta digital pública (link-in-bio) de un negocio: contenido en GET /public/card, y un
// registro de vistas/clicks por fuente (?src=) en POST /public/card/track para poder ver desde el
// panel de dónde entra cada visita (Instagram, WhatsApp, un flyer, etc.).
export function registerCard(router) {
  router.get("/api/:slug/public/card", async (request, env, ctx) => {
    const b = ctx.business;
    const links = await all(env, `SELECT id, label, icon, url FROM card_links WHERE business_id=? ORDER BY position`, b.id);
    const featuredServices = await all(env,
      `SELECT id, name, price, duration_min, photo_key FROM services WHERE business_id=? AND featured=1`, b.id);
    return json({
      name: b.name,
      logoKey: b.logo_key,
      bio: b.card_bio,
      address: b.card_address,
      openHour: b.open_hour,
      closeHour: b.close_hour,
      openDays: JSON.parse(b.open_days || "[1,2,3,4,5,6]"),
      links,
      featuredServices,
    });
  });

  router.post("/api/:slug/public/card/track", async (request, env, ctx) => {
    const { sourceCode, eventType, target } = await readJson(request);
    if (eventType !== "view" && eventType !== "click") return error("eventType inválido.");
    await run(env, `INSERT INTO card_events (id, business_id, source_code, event_type, target) VALUES (?,?,?,?,?)`,
      uid(), ctx.business.id, sourceCode || null, eventType, target || null);
    return json({ ok: true }, { status: 201 });
  });

  // Vistas y clicks agrupados por fuente, para el panel — últimos `days` (30 por defecto).
  router.get("/api/:slug/staff/card-analytics", async (request, env, ctx) => {
    const days = Number(new URL(request.url).searchParams.get("days")) || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const rows = await all(env,
      `SELECT source_code, event_type, COUNT(*) as n FROM card_events
       WHERE business_id=? AND created_at >= ? GROUP BY source_code, event_type`,
      ctx.business.id, since);
    const bySource = {};
    for (const r of rows) {
      const key = r.source_code || "(sin fuente)";
      (bySource[key] ||= { source: key, views: 0, clicks: 0 })[r.event_type === "view" ? "views" : "clicks"] += r.n;
    }
    const clickTargets = await all(env,
      `SELECT target, COUNT(*) as n FROM card_events WHERE business_id=? AND event_type='click' AND created_at >= ? AND target IS NOT NULL GROUP BY target ORDER BY n DESC`,
      ctx.business.id, since);
    return json({ days, bySource: Object.values(bySource).sort((a, b) => b.views - a.views), clickTargets });
  });
}
