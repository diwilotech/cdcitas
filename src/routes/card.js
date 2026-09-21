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

  // Embudo (vistas -> clicks en "Reservar" -> citas realmente agendadas) + detalle, para el
  // panel — últimos `days` (30 por defecto). Las reservas se cuentan desde
  // appointments.source_code (no card_events): ese valor viaja desde la tarjeta hasta la cita ya
  // creada (ver public.js /public/book e index.html), así se sabe cuántas visitas terminaron en
  // una cita de verdad, no solo un click. No todas las reservas salen del botón "Reservar"
  // (pueden venir del botón "Ver" de un servicio destacado), así que el embudo es aproximado, no
  // una atribución exacta por click.
  router.get("/api/:slug/staff/card-analytics", async (request, env, ctx) => {
    const days = Number(new URL(request.url).searchParams.get("days")) || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const totalViews = (await first(env,
      `SELECT COUNT(*) as n FROM card_events WHERE business_id=? AND event_type='view' AND created_at >= ?`,
      ctx.business.id, since))?.n || 0;
    const reservarClickCount = (await first(env,
      `SELECT COUNT(*) as n FROM card_events WHERE business_id=? AND event_type='click' AND target='reservar' AND created_at >= ?`,
      ctx.business.id, since))?.n || 0;
    const bookingRows = await all(env,
      `SELECT source_code, client_name, client_phone, date, start, created_at FROM appointments
       WHERE business_id=? AND source_code IS NOT NULL AND created_at >= ? ORDER BY created_at DESC`,
      ctx.business.id, since);
    const clickTargets = await all(env,
      `SELECT target, COUNT(*) as n FROM card_events WHERE business_id=? AND event_type='click' AND created_at >= ? AND target IS NOT NULL GROUP BY target ORDER BY n DESC`,
      ctx.business.id, since);

    const funnel = { views: totalViews, reservarClicks: reservarClickCount, bookings: bookingRows.length };
    // "Quién fue": las últimas reservas con fuente, para identificar de una quién agendó desde
    // dónde (nombre + celular + cuándo) — no solo el número, ver quién es la persona.
    const recentBookings = bookingRows.slice(0, 15).map((b) => ({
      source: b.source_code, clientName: b.client_name, clientPhone: b.client_phone,
      date: b.date, start: b.start, createdAt: b.created_at,
    }));

    return json({ days, clickTargets, funnel, recentBookings });
  });

  // Histograma de actividad para "Links rastreables", desglosado por fuente (para barras
  // apiladas) — 3 escalas, cada una a un zoom de tiempo distinto:
  //   día    -> últimas 12 horas (por hora real de reloj, ej. "14h", no "hace 3h")
  //   semana -> últimos 12 días
  //   mes    -> últimas 12 semanas (lunes a lunes)
  router.get("/api/:slug/staff/card-timeseries", async (request, env, ctx) => {
    const requested = new URL(request.url).searchParams.get("granularity");
    const { keys, sqlExpr, since, granularity } = bucketPlan(requested);
    const eventRows = await all(env,
      `SELECT ${sqlExpr} as bucket, COALESCE(source_code, '(sin fuente)') as source, event_type, COUNT(*) as n FROM card_events
       WHERE business_id=? AND created_at >= ? GROUP BY bucket, source, event_type`,
      ctx.business.id, since);
    const bookingRows = await all(env,
      `SELECT ${sqlExpr} as bucket, source_code as source, COUNT(*) as n FROM appointments
       WHERE business_id=? AND source_code IS NOT NULL AND created_at >= ? GROUP BY bucket, source`,
      ctx.business.id, since);

    const sourceSet = new Set();
    const bucketMap = {};
    for (const k of keys) bucketMap[k] = {};
    const cell = (bucket, source) => {
      sourceSet.add(source);
      return (bucketMap[bucket][source] ||= { views: 0, clicks: 0, bookings: 0 });
    };
    for (const r of eventRows) { if (bucketMap[r.bucket]) cell(r.bucket, r.source)[r.event_type === "view" ? "views" : "clicks"] += r.n; }
    for (const r of bookingRows) { if (bucketMap[r.bucket]) cell(r.bucket, r.source).bookings += r.n; }

    const sources = [...sourceSet].sort();
    const buckets = keys.map((k) => ({ bucket: k, bySource: bucketMap[k] }));
    return json({ granularity, sources, buckets });
  });
}

// Genera las llaves de bucket (en JS) y la expresión SQL que debe producir la MISMA llave a
// partir de created_at, para poder cruzarlas.
function bucketPlan(granularity) {
  if (granularity === "month") {
    // Últimas 12 semanas (lunes a lunes) — mismo cálculo de "lunes de la semana" que abajo.
    const keys = [];
    const monday = mondayOf(new Date());
    for (let i = 11; i >= 0; i--) keys.push(isoDate(addDays(monday, -7 * i)));
    return { keys, sqlExpr: WEEK_START_SQL, since: `${keys[0]} 00:00:00`, granularity: "month" };
  }
  if (granularity === "week") {
    // Últimos 12 días, uno por día.
    const keys = [];
    for (let i = 11; i >= 0; i--) keys.push(isoDate(addDays(new Date(), -i)));
    return { keys, sqlExpr: `substr(created_at,1,10)`, since: `${keys[0]} 00:00:00`, granularity: "week" };
  }
  // día: últimas 12 horas — ventana móvil que termina AHORA, pero cada bucket se identifica por
  // su hora real de reloj (ej. "14"), no por "hace cuántas horas" — con solo 12 de las 24 horas
  // posibles en la ventana, esa hora de reloj nunca se repite aunque la ventana cruce medianoche.
  const keys = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) keys.push(String(new Date(now.getTime() - i * 3600000).getUTCHours()).padStart(2, "0"));
  const since = new Date(now.getTime() - 12 * 3600000).toISOString().slice(0, 19).replace("T", " ");
  return { keys, sqlExpr: `strftime('%H', created_at)`, since, granularity: "day" };
}
// Lunes de la semana de created_at — el idioma "weekday 1, -7 days" que se suele recomendar para
// esto falla cuando created_at YA es lunes (se va a la semana anterior de más), por eso se calcula
// a mano con strftime('%w') (0=domingo..6=sábado) en vez de confiar en ese modificador.
const WEEK_START_SQL = `date(created_at, '-' || ((strftime('%w', created_at) + 6) % 7) || ' days')`;
function addDays(d, n) { const c = new Date(d); c.setUTCDate(c.getUTCDate() + n); return c; }
function isoDate(d) { return d.toISOString().slice(0, 10); }
function mondayOf(d) {
  const day = d.getUTCDay(); // 0=Dom..6=Sáb
  const diff = day === 0 ? 6 : day - 1;
  return addDays(d, -diff);
}
