import { all, first, run, uid } from "../lib/db.js";
import { json, error, notFound, readJson } from "../lib/http.js";
import { sendApptMessage } from "../lib/messages.js";
import { reminderDateTimeMinutes, scheduleServiceReminders } from "../lib/availability.js";

const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

async function getAppt(env, businessId, id) {
  return first(env, `SELECT * FROM appointments WHERE business_id=? AND id=?`, businessId, id);
}

// Crea una cita "manual" de staff (walk-in o sesión de tratamiento) — resuelve/crea el cliente en
// clients por celular, igual que ya hace la reserva pública (public.js), para que el historial de
// un cliente quede completo sin importar si reservó él mismo o lo registró el staff. Reusada por
// POST /staff/appointments y por POST /staff/treatments/:id/sessions (treatments.js).
export async function createStaffAppointment(env, business, b) {
  const service = await first(env, `SELECT * FROM services WHERE business_id=? AND id=?`, business.id, b.serviceId);
  if (!service) return { error: "Servicio no encontrado." };

  let client = b.clientPhone
    ? await first(env, `SELECT * FROM clients WHERE business_id=? AND phone=?`, business.id, b.clientPhone)
    : null;
  if (!client) {
    const clientId = uid();
    await run(env, `INSERT INTO clients (id, business_id, name, email, phone) VALUES (?,?,?,?,?)`,
      clientId, business.id, b.clientName, b.clientEmail || null, b.clientPhone || null);
    client = { id: clientId };
  }

  const end = toHHMM(toMin(b.start) + service.duration_min);
  const id = uid();
  await run(env,
    `INSERT INTO appointments (id, business_id, client_id, client_name, client_email, client_phone, specialist_id,
      service_id, date, start, end, status, walk_in, treatment_id, session_label)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id, business.id, client.id, b.clientName, b.clientEmail || null, b.clientPhone || null, b.specialistId,
    b.serviceId, b.date, b.start, end, "confirmed", 1, b.treatmentId || null, b.sessionLabel || null);
  await scheduleServiceReminders(env, business.id, id, service, b.date, b.start);
  return { id, clientId: client.id };
}
// Ejecuta un cambio de estado + (opcionalmente) el aviso por WhatsApp correspondiente.
// Una sola función para cancelar/reagendar/reabrir, ya que las tres son "cambia estado y avisa".
async function applyStatusChange(env, ctx, appt, { status, clearSpace, templateKey, sendMessage, extra }) {
  const fields = ["status = ?"];
  const vals = [status];
  if (clearSpace) fields.push("space_id = NULL");
  await run(env, `UPDATE appointments SET ${fields.join(", ")} WHERE business_id=? AND id=?`, ...vals, ctx.business.id, appt.id);
  const updated = await getAppt(env, ctx.business.id, appt.id);
  let messageResult = null;
  if (sendMessage) messageResult = await sendApptMessage(env, ctx.business, updated, templateKey, extra || {});
  return { appointment: updated, message: messageResult };
}

export function registerAppointments(router) {
  router.get("/api/:slug/staff/appointments", async (request, env, ctx) => {
    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const clientId = url.searchParams.get("clientId");
    let sql = `SELECT a.*, sp.name AS specialist_name, sp.color AS specialist_color, sp.avatar AS specialist_avatar, sv.name AS service_name
               FROM appointments a
               JOIN specialists sp ON sp.id = a.specialist_id
               JOIN services sv ON sv.id = a.service_id
               WHERE a.business_id = ?`;
    const params = [ctx.business.id];
    if (date) { sql += ` AND a.date = ?`; params.push(date); }
    else if (from && to) { sql += ` AND a.date BETWEEN ? AND ?`; params.push(from, to); }
    if (clientId) { sql += ` AND a.client_id = ?`; params.push(clientId); }
    sql += ` ORDER BY a.date, a.start`;
    return json(await all(env, sql, ...params));
  });

  router.post("/api/:slug/staff/appointments", async (request, env, ctx) => {
    const b = await readJson(request);
    if (!b.clientName || !b.serviceId || !b.specialistId || !b.date || !b.start) return error("Faltan datos de la cita.");
    const result = await createStaffAppointment(env, ctx.business, b);
    if (result.error) return error(result.error, 404);
    return json(await getAppt(env, ctx.business.id, result.id), { status: 201 });
  });

  router.patch("/api/:slug/staff/appointments/:id", async (request, env, ctx) => {
    const appt = await getAppt(env, ctx.business.id, ctx.params.id);
    if (!appt) return notFound();
    const b = await readJson(request);
    const editable = ["space_id", "paid"];
    const present = editable.filter((f) => f in b);
    if (present.length) {
      const setSql = present.map((f) => `${f} = ?`).join(", ");
      const vals = present.map((f) => (f === "paid" ? (b[f] ? 1 : 0) : b[f]));
      await run(env, `UPDATE appointments SET ${setSql} WHERE business_id=? AND id=?`,
        ...vals, ctx.business.id, appt.id);
    }
    return json(await getAppt(env, ctx.business.id, appt.id));
  });

  router.post("/api/:slug/staff/appointments/:id/cancel", async (request, env, ctx) => {
    const appt = await getAppt(env, ctx.business.id, ctx.params.id);
    if (!appt) return notFound();
    const { sendMessage } = await readJson(request);
    return json(await applyStatusChange(env, ctx, appt, { status: "cancelled", templateKey: "cancel", sendMessage }));
  });

  router.post("/api/:slug/staff/appointments/:id/reschedule", async (request, env, ctx) => {
    const appt = await getAppt(env, ctx.business.id, ctx.params.id);
    if (!appt) return notFound();
    const { sendMessage } = await readJson(request);
    return json(await applyStatusChange(env, ctx, appt, { status: "reagendar", clearSpace: true, templateKey: "reschedule", sendMessage }));
  });

  router.post("/api/:slug/staff/appointments/:id/reopen", async (request, env, ctx) => {
    const appt = await getAppt(env, ctx.business.id, ctx.params.id);
    if (!appt) return notFound();
    const { sendMessage } = await readJson(request);
    return json(await applyStatusChange(env, ctx, appt, { status: "confirmed", templateKey: "reopen", sendMessage }));
  });

  router.post("/api/:slug/staff/appointments/:id/complete", async (request, env, ctx) => {
    const appt = await getAppt(env, ctx.business.id, ctx.params.id);
    if (!appt) return notFound();
    await run(env, `UPDATE appointments SET status='completed' WHERE business_id=? AND id=?`, ctx.business.id, appt.id);
    return json(await getAppt(env, ctx.business.id, appt.id));
  });

  router.post("/api/:slug/staff/appointments/:id/move", async (request, env, ctx) => {
    const appt = await getAppt(env, ctx.business.id, ctx.params.id);
    if (!appt) return notFound();
    const { date, start, sendMessage } = await readJson(request);
    if (!date || !start) return error("Faltan la nueva fecha y hora.");
    const durMin = toMin(appt.end) - toMin(appt.start);
    const end = toHHMM(toMin(start) + durMin);
    await run(env, `UPDATE appointments SET pending_move_date=?, pending_move_start=?, pending_move_end=? WHERE business_id=? AND id=?`,
      date, start, end, ctx.business.id, appt.id);
    const updated = await getAppt(env, ctx.business.id, appt.id);
    const message = sendMessage ? await sendApptMessage(env, ctx.business, updated, "move", { date, start }) : null;
    return json({ appointment: updated, message });
  });

  router.post("/api/:slug/staff/appointments/:id/accept-move", async (request, env, ctx) => {
    const appt = await getAppt(env, ctx.business.id, ctx.params.id);
    if (!appt || !appt.pending_move_date) return notFound();
    await run(env,
      `UPDATE appointments SET date=?, start=?, end=?, pending_move_date=NULL, pending_move_start=NULL, pending_move_end=NULL
       WHERE business_id=? AND id=?`,
      appt.pending_move_date, appt.pending_move_start, appt.pending_move_end, ctx.business.id, appt.id);
    // Los recordatorios que vinieron del servicio apuntaban a la hora VIEJA — se recalculan para
    // la nueva. Los que el staff añadió a mano desde Agenda (source='manual') se dejan tal cual,
    // es una elección puntual de fecha/hora, no algo derivado de la cita que haya que correr.
    await run(env, `DELETE FROM appointment_reminders WHERE appointment_id=? AND source='service' AND sent=0`, appt.id);
    const service = await first(env, `SELECT * FROM services WHERE id=?`, appt.service_id);
    if (service) await scheduleServiceReminders(env, ctx.business.id, appt.id, service, appt.pending_move_date, appt.pending_move_start);
    return json(await getAppt(env, ctx.business.id, appt.id));
  });

  router.post("/api/:slug/staff/appointments/:id/reject-move", async (request, env, ctx) => {
    const appt = await getAppt(env, ctx.business.id, ctx.params.id);
    if (!appt) return notFound();
    await run(env,
      `UPDATE appointments SET pending_move_date=NULL, pending_move_start=NULL, pending_move_end=NULL WHERE business_id=? AND id=?`,
      ctx.business.id, appt.id);
    return json(await getAppt(env, ctx.business.id, appt.id));
  });

  router.get("/api/:slug/staff/appointments/:id/messages", async (request, env, ctx) => {
    const appt = await getAppt(env, ctx.business.id, ctx.params.id);
    if (!appt) return notFound();
    return json(await all(env, `SELECT * FROM appointment_messages WHERE appointment_id=? ORDER BY sent_at DESC`, appt.id));
  });

  // Recordatorios automáticos de una cita — puede haber varios (el del servicio, un 2do del
  // servicio, y los que el staff añada a mano acá). Ver Agenda → tarjeta de la cita.
  router.get("/api/:slug/staff/appointments/:id/reminders", async (request, env, ctx) => {
    const appt = await getAppt(env, ctx.business.id, ctx.params.id);
    if (!appt) return notFound();
    return json(await all(env, `SELECT * FROM appointment_reminders WHERE appointment_id=? ORDER BY remind_date, remind_time`, appt.id));
  });

  router.post("/api/:slug/staff/appointments/:id/reminders", async (request, env, ctx) => {
    const appt = await getAppt(env, ctx.business.id, ctx.params.id);
    if (!appt) return notFound();
    const b = await readJson(request);
    let date, time;
    if (b.offsetMinutes) ({ date, time } = reminderDateTimeMinutes(appt.date, appt.start, Number(b.offsetMinutes)));
    else if (b.date && b.time) ({ date, time } = b);
    else return error("Falta la fecha y hora, o cuánto antes de la cita avisar.");
    const id = uid();
    await run(env,
      `INSERT INTO appointment_reminders (id, appointment_id, business_id, remind_date, remind_time, source) VALUES (?,?,?,?,?,'manual')`,
      id, appt.id, ctx.business.id, date, time);
    return json(await first(env, `SELECT * FROM appointment_reminders WHERE id=?`, id), { status: 201 });
  });

  router.delete("/api/:slug/staff/appointments/:id/reminders/:reminderId", async (request, env, ctx) => {
    await run(env, `DELETE FROM appointment_reminders WHERE business_id=? AND appointment_id=? AND id=?`,
      ctx.business.id, ctx.params.id, ctx.params.reminderId);
    return json({ ok: true });
  });
}
