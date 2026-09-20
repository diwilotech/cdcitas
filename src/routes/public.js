import { all, first, run, uid } from "../lib/db.js";
import { json, error, readJson } from "../lib/http.js";
import { availableSlots, reminderDateTime } from "../lib/availability.js";
import { sendConfirmationRequest, sendConfirmedNotice } from "../lib/confirm.js";

// Endpoints públicos para la página de reserva del cliente (sin login).
export function registerPublic(router) {
  router.get("/api/:slug/public/business", async (request, env, ctx) => {
    const services = await all(env, `SELECT id, name, duration_min, price, photo_key FROM services WHERE business_id=?`, ctx.business.id);
    const specialists = await all(env,
      `SELECT id, name, role, avatar, color FROM specialists WHERE business_id=?`, ctx.business.id);
    const links = await all(env,
      `SELECT specialist_id, service_id FROM specialist_services ss
       JOIN specialists s ON s.id = ss.specialist_id WHERE s.business_id=?`, ctx.business.id);
    const byService = {};
    for (const l of links) (byService[l.service_id] ||= []).push(l.specialist_id);

    // Excepciones del negocio (no de un especialista puntual) en las próximas semanas, para que
    // la reserva pueda marcar como cerrados los días que correspondan en el selector de fecha.
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(); horizon.setDate(horizon.getDate() + 30);
    const dateExceptions = await all(env,
      `SELECT date, closed, open_hour, close_hour FROM date_exceptions
       WHERE business_id=? AND specialist_id IS NULL AND date BETWEEN ? AND ?`,
      ctx.business.id, today, horizon.toISOString().slice(0, 10));

    return json({
      name: ctx.business.name,
      logoKey: ctx.business.logo_key,
      openHour: ctx.business.open_hour,
      closeHour: ctx.business.close_hour,
      openDays: JSON.parse(ctx.business.open_days || "[1,2,3,4,5,6]"),
      dateExceptions,
      services,
      specialists,
      specialistsByService: byService,
    });
  });

  // Promociones vigentes hoy (activas y dentro de su rango de fechas, si tienen) — se muestran en
  // la reserva y en "mis citas".
  router.get("/api/:slug/public/promotions", async (request, env, ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const promos = await all(env,
      `SELECT id, title, description, code, starts_at, ends_at FROM promotions
       WHERE business_id=? AND active=1 AND (starts_at IS NULL OR starts_at <= ?) AND (ends_at IS NULL OR ends_at >= ?)
       ORDER BY created_at DESC`,
      ctx.business.id, today, today);
    return json(promos);
  });

  router.get("/api/:slug/public/availability", async (request, env, ctx) => {
    const url = new URL(request.url);
    const serviceId = url.searchParams.get("serviceId");
    const specialistId = url.searchParams.get("specialistId");
    const date = url.searchParams.get("date");
    if (!serviceId || !specialistId || !date) return error("Faltan serviceId, specialistId o date.");
    return json(await availableSlots(env, ctx.business, { serviceId, specialistId, date }));
  });

  // Al reservar se pide el celular primero: si ya existe un cliente con ese número no hace falta
  // volver a pedirle nombre/correo (se usan los que ya tiene guardados), y si además ya está
  // verificado (confirmó una cita antes por WhatsApp) la nueva reserva queda confirmada de una.
  router.get("/api/:slug/public/client-check", async (request, env, ctx) => {
    const phone = new URL(request.url).searchParams.get("phone");
    if (!phone) return json({ found: false });
    const client = await first(env, `SELECT name, email, verified FROM clients WHERE business_id=? AND phone=?`, ctx.business.id, phone);
    if (!client) return json({ found: false });
    return json({ found: true, verified: !!client.verified, name: client.name, email: client.email });
  });

  router.post("/api/:slug/public/book", async (request, env, ctx) => {
    const body = await readJson(request);
    const { serviceId, specialistId, date, start, clientName, clientEmail, clientPhone } = body;
    const channel = body.channel === "email" ? "email" : "whatsapp";
    if (!serviceId || !specialistId || !date || !start || !clientName) return error("Faltan datos de la reserva.");
    if (channel === "whatsapp" && !clientPhone) return error("Escribe tu celular para mandarte el código por WhatsApp.");
    if (channel === "email" && !clientEmail) return error("Escribe tu correo para mandarte el link de confirmación.");

    const service = await first(env, `SELECT * FROM services WHERE business_id=? AND id=?`, ctx.business.id, serviceId);
    if (!service) return error("Servicio no encontrado.", 404);

    // Si es un cliente que ya reservó antes (mismo celular), se busca ANTES del chequeo de
    // disponibilidad para poder bloquear también los horarios donde ya tiene otra cita suya ese
    // día (con cualquier especialista) — si no, podía terminar con dos citas que se cruzan.
    let client = clientPhone
      ? await first(env, `SELECT * FROM clients WHERE business_id=? AND phone=?`, ctx.business.id, clientPhone)
      : null;

    const { slots } = await availableSlots(env, ctx.business, { serviceId, specialistId, date, clientId: client?.id });
    if (!slots.includes(start)) return error("Ese horario ya no está disponible (o se cruza con otra cita tuya); elige otro.", 409);

    if (!client) {
      const clientId = uid();
      await run(env, `INSERT INTO clients (id, business_id, name, email, phone) VALUES (?,?,?,?,?)`,
        clientId, ctx.business.id, clientName, clientEmail || null, clientPhone || null);
      client = { id: clientId };
    }

    const endMin = toMin(start) + service.duration_min;
    const end = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
    const reminder = reminderDateTime(date, start, service.reminder_hours);
    const apptId = uid();
    // Un cliente que ya confirmó una cita antes (por ese mismo celular) ya demostró que el número
    // es real y suyo — no hace falta pedirle el PIN otra vez, la cita queda confirmada de una.
    const skipConfirmation = channel === "whatsapp" && !!client.verified;
    const status = skipConfirmation ? "confirmed" : "pending_confirmation";
    await run(env,
      `INSERT INTO appointments (id, business_id, client_id, client_name, client_email, client_phone,
        specialist_id, service_id, date, start, end, status, confirm_channel, confirmation_date, confirmation_time)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      apptId, ctx.business.id, client.id, clientName, clientEmail || null, clientPhone || null,
      specialistId, serviceId, date, start, end, status, channel, reminder.date, reminder.time);

    const appt = await first(env, `SELECT * FROM appointments WHERE id=?`, apptId);
    const origin = new URL(request.url).origin;
    // Si no hace falta confirmar, se manda directo el aviso de "cita confirmada" (con el link de
    // mis-citas) — mismo mensaje que recibiría después de responder el PIN, solo que de una vez.
    const messageResult = skipConfirmation
      ? await sendConfirmedNotice(env, ctx.business, appt, service, origin)
      : await sendConfirmationRequest(env, ctx.business, appt, service, origin);

    return json({ appointment: appt, channel, alreadyConfirmed: skipConfirmation, messageResult }, { status: 201 });
  });
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
