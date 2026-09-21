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

  // Vistas, clicks y reservas agrupadas por fuente, para el panel — últimos `days` (30 por
  // defecto). Las reservas se cuentan desde appointments.source_code (no card_events): ese
  // valor viaja desde la tarjeta hasta la cita ya creada (ver public.js /public/book e
  // index.html), así se sabe cuántas visitas terminaron en una cita de verdad, no solo un click.
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
      (bySource[key] ||= { source: key, views: 0, clicks: 0, bookings: 0 })[r.event_type === "view" ? "views" : "clicks"] += r.n;
    }
    const bookingRows = await all(env,
      `SELECT source_code, client_name, client_phone, date, start, created_at FROM appointments
       WHERE business_id=? AND source_code IS NOT NULL AND created_at >= ? ORDER BY created_at DESC`,
      ctx.business.id, since);
    for (const b of bookingRows) {
      const key = b.source_code || "(sin fuente)";
      (bySource[key] ||= { source: key, views: 0, clicks: 0, bookings: 0 }).bookings += 1;
    }
    const clickTargets = await all(env,
      `SELECT target, COUNT(*) as n FROM card_events WHERE business_id=? AND event_type='click' AND created_at >= ? AND target IS NOT NULL GROUP BY target ORDER BY n DESC`,
      ctx.business.id, since);

    // Embudo: vistas de la tarjeta -> clicks en "Reservar" -> citas realmente agendadas (con
    // cualquier fuente). No todas salen del botón "Reservar" (pueden venir del botón "Ver" de un
    // servicio destacado), así que es un embudo aproximado, no una atribución exacta por click.
    const totalViews = rows.filter((r) => r.event_type === "view").reduce((s, r) => s + r.n, 0);
    const reservarClickCount = (await first(env,
      `SELECT COUNT(*) as n FROM card_events WHERE business_id=? AND event_type='click' AND target='reservar' AND created_at >= ?`,
      ctx.business.id, since))?.n || 0;
    const funnel = { views: totalViews, reservarClicks: reservarClickCount, bookings: bookingRows.length };

    // "Quién fue": las últimas reservas con fuente, para identificar de una quién agendó desde
    // dónde (nombre + celular + cuándo) — no solo el número, ver quién es la persona.
    const recentBookings = bookingRows.slice(0, 15).map((b) => ({
      source: b.source_code, clientName: b.client_name, clientPhone: b.client_phone,
      date: b.date, start: b.start, createdAt: b.created_at,
    }));

    return json({
      days,
      bySource: Object.values(bySource).sort((a, b) => b.views - a.views),
      clickTargets,
      funnel,
      recentBookings,
    });
  });
}
