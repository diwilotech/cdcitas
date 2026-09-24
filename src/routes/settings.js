import { all, first, run, uid } from "../lib/db.js";
import { json, error, readJson } from "../lib/http.js";
import { DEFAULT_TEMPLATES } from "../lib/templates.js";
import { sendWhatsApp } from "../lib/whatsapp.js";
import { sendEmail } from "../lib/mailer.js";
import { geocodeQuery } from "../lib/geocode.js";

export function registerSettings(router) {
  router.get("/api/:slug/staff/settings", async (request, env, ctx) => json(ctx.business));

  router.patch("/api/:slug/staff/settings", async (request, env, ctx) => {
    const b = await readJson(request);
    const fields = { name: b.name, open_hour: b.openHour, close_hour: b.closeHour,
      open_days: b.openDays ? JSON.stringify(b.openDays) : undefined,
      timezone_offset: b.timezoneOffset === undefined ? undefined : Number(b.timezoneOffset),
      evolution_url: b.evolutionUrl, evolution_instance: b.evolutionInstance, evolution_api_key: b.evolutionApiKey,
      whatsapp_country_code: b.whatsappCountryCode,
      whatsapp_business_number: b.whatsappBusinessNumber,
      whatsapp_enabled: b.whatsappEnabled === undefined ? undefined : (b.whatsappEnabled ? 1 : 0),
      gmail_user: b.gmailUser, gmail_app_password: b.gmailAppPassword,
      confirm_window_hours: b.confirmWindowHours, logo_key: b.logoKey,
      card_bio: b.cardBio, card_address: b.cardAddress,
      card_lat: b.cardLat === undefined ? undefined : (b.cardLat === null ? null : Number(b.cardLat)),
      card_lng: b.cardLng === undefined ? undefined : (b.cardLng === null ? null : Number(b.cardLng)) };
    const present = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (!present.length) return json(ctx.business);
    await run(env, `UPDATE businesses SET ${present.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
      ...present.map(([, v]) => v), ctx.business.id);
    return json(await first(env, `SELECT * FROM businesses WHERE id=?`, ctx.business.id));
  });

  // Coordenadas a partir de una dirección en texto o un link de Google Maps (para el mapa y la
  // distancia de la tarjeta digital) — alternativa a "Usar mi ubicación actual" del navegador,
  // para cuando el negocio prefiere no depender del permiso de ubicación o no está en el local.
  router.post("/api/:slug/staff/geocode", async (request, env, ctx) => {
    const { query } = await readJson(request);
    if (!query || !query.trim()) return error("Escribe una dirección o pega un link de Google Maps.");
    const result = await geocodeQuery(query.trim());
    if (!result) return error("No pudimos encontrar esa ubicación — prueba con el link de Google Maps de tu negocio, o sé más específico con la dirección.");
    return json(result);
  });

  // Nuevo link de webhook (por si el anterior se filtró) — invalida el que estaba pegado en Evolution API.
  router.post("/api/:slug/staff/webhook/rotate", async (request, env, ctx) => {
    const token = uid();
    await run(env, `UPDATE businesses SET webhook_token=? WHERE id=?`, token, ctx.business.id);
    return json({ webhookToken: token });
  });

  // Manda un WhatsApp de prueba a un número cualquiera, para confirmar que Evolution API está
  // bien conectada sin tener que esperar a una cita real. Reusa sendWhatsApp tal cual.
  router.post("/api/:slug/staff/whatsapp/test", async (request, env, ctx) => {
    const { phone } = await readJson(request);
    if (!phone) return error("Falta el número.");
    const result = await sendWhatsApp(env, ctx.business, phone,
      `Mensaje de prueba de ${ctx.business.name} (Control de Citas). Si lo recibiste, WhatsApp está bien conectado. ✅`);
    if (!result.ok) return error(result.error || "No se pudo enviar.", 502);
    return json({ ok: true });
  });

  // Manda un correo de prueba (SMTP con el Gmail configurado), mismo patrón que el de WhatsApp.
  router.post("/api/:slug/staff/email/test", async (request, env, ctx) => {
    const { email } = await readJson(request);
    if (!email) return error("Falta el correo.");
    const result = await sendEmail(env, ctx.business, email, `Correo de prueba — ${ctx.business.name}`,
      `Mensaje de prueba de ${ctx.business.name} (Control de Citas). Si lo recibiste, el correo está bien conectado. ✅`);
    if (!result.ok) return error(result.error || "No se pudo enviar.", 502);
    return json({ ok: true });
  });

  // Excepciones de horario por fecha (del negocio si specialistId es null, o de un especialista).
  router.get("/api/:slug/staff/date-exceptions", async (request, env, ctx) =>
    json(await all(env, `SELECT * FROM date_exceptions WHERE business_id=? ORDER BY date`, ctx.business.id)));

  router.post("/api/:slug/staff/date-exceptions", async (request, env, ctx) => {
    const b = await readJson(request);
    if (!b.date) return error("Falta la fecha.");
    await run(env, `DELETE FROM date_exceptions WHERE business_id=? AND date=? AND specialist_id IS ?`,
      ctx.business.id, b.date, b.specialistId || null);
    const id = uid();
    await run(env,
      `INSERT INTO date_exceptions (id, business_id, specialist_id, date, closed, open_hour, close_hour) VALUES (?,?,?,?,?,?,?)`,
      id, ctx.business.id, b.specialistId || null, b.date, b.closed ? 1 : 0, b.openHour ?? null, b.closeHour ?? null);
    return json({ id }, { status: 201 });
  });

  router.delete("/api/:slug/staff/date-exceptions/:id", async (request, env, ctx) => {
    await run(env, `DELETE FROM date_exceptions WHERE business_id=? AND id=?`, ctx.business.id, ctx.params.id);
    return json({ ok: true });
  });

  // Plantillas de mensajes (cancel/reschedule/move/reopen/booked).
  router.get("/api/:slug/staff/templates", async (request, env, ctx) => {
    const rows = await all(env, `SELECT key, body FROM message_templates WHERE business_id=?`, ctx.business.id);
    const map = { ...DEFAULT_TEMPLATES };
    for (const r of rows) map[r.key] = r.body;
    return json(map);
  });

  router.patch("/api/:slug/staff/templates", async (request, env, ctx) => {
    const { key, body } = await readJson(request);
    if (!key || !body) return error("Faltan key y body.");
    const existing = await first(env, `SELECT id FROM message_templates WHERE business_id=? AND key=?`, ctx.business.id, key);
    if (existing) await run(env, `UPDATE message_templates SET body=? WHERE id=?`, body, existing.id);
    else await run(env, `INSERT INTO message_templates (id, business_id, key, body) VALUES (?,?,?,?)`, uid(), ctx.business.id, key, body);
    return json({ ok: true });
  });
}
