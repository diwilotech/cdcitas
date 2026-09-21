import { all, run, uid } from "../lib/db.js";
import { json, error, readJson } from "../lib/http.js";
import { sendApptMessage } from "../lib/messages.js";
import { dayOccupancy } from "../lib/availability.js";

// Marca a un especialista libre un día puntual: crea la excepción de horario (la misma que ya usa
// availableSlots() para bloquear reservas nuevas) y pasa a "por reagendar" las citas que ya tenía
// ese día, avisando por WhatsApp si se pide. Volver a marcarlo "trabaja" es solo borrar la
// excepción, con el DELETE de /staff/date-exceptions que ya existe — no hace falta otro endpoint.
export function registerSchedule(router) {
  // Grilla visual de ocupado/libre de un especialista ese día, sin depender de un servicio — la
  // usan los selectores de hora de Bloqueos/Añadir cita/Mover cita en el panel de staff.
  router.get("/api/:slug/staff/day-occupancy", async (request, env, ctx) => {
    const url = new URL(request.url);
    const specialistId = url.searchParams.get("specialistId");
    const date = url.searchParams.get("date");
    if (!specialistId || !date) return error("Faltan specialistId o date.");
    return json(await dayOccupancy(env, ctx.business, { specialistId, date }));
  });

  router.post("/api/:slug/staff/specialists/:id/day-off", async (request, env, ctx) => {
    const { date, notify } = await readJson(request);
    if (!date) return error("Falta la fecha.");

    await run(env, `DELETE FROM date_exceptions WHERE business_id=? AND date=? AND specialist_id=?`,
      ctx.business.id, date, ctx.params.id);
    await run(env,
      `INSERT INTO date_exceptions (id, business_id, specialist_id, date, closed) VALUES (?,?,?,?,1)`,
      uid(), ctx.business.id, ctx.params.id, date);

    const affected = await all(env,
      `SELECT * FROM appointments WHERE business_id=? AND specialist_id=? AND date=? AND status IN ('confirmed','reagendar','pending_confirmation')`,
      ctx.business.id, ctx.params.id, date);

    for (const appt of affected) {
      await run(env, `UPDATE appointments SET status='reagendar', space_id=NULL WHERE id=?`, appt.id);
      if (notify) await sendApptMessage(env, ctx.business, appt, "reschedule");
    }

    return json({ affectedCount: affected.length });
  });
}
