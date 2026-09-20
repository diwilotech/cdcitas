import { all, first } from "../lib/db.js";
import { json, error, notFound, readJson } from "../lib/http.js";
import { createStaffAppointment } from "./appointments.js";

// Tratamientos (paquetes de varias sesiones) — el CRUD genérico de la tabla `treatments` ya vive
// en resources.js; acá van las dos rutas que necesitan más que un simple INSERT/UPDATE.
export function registerTreatments(router) {
  // Cada tratamiento del cliente con sus sesiones (appointments con ese treatment_id) para
  // pintar el progreso ("2 de 5 sesiones") en el panel de Clientes.
  router.get("/api/:slug/staff/clients/:id/treatments", async (request, env, ctx) => {
    const client = await first(env, `SELECT id FROM clients WHERE business_id=? AND id=?`, ctx.business.id, ctx.params.id);
    if (!client) return notFound();
    const treatments = await all(env,
      `SELECT * FROM treatments WHERE business_id=? AND client_id=? ORDER BY created_at DESC`,
      ctx.business.id, client.id);
    const sessions = await all(env,
      `SELECT a.*, sp.name AS specialist_name, sv.name AS service_name
       FROM appointments a JOIN specialists sp ON sp.id=a.specialist_id JOIN services sv ON sv.id=a.service_id
       WHERE a.business_id=? AND a.treatment_id IN (SELECT id FROM treatments WHERE business_id=? AND client_id=?)
       ORDER BY a.date, a.start`,
      ctx.business.id, ctx.business.id, client.id);
    const byTreatment = {};
    for (const s of sessions) (byTreatment[s.treatment_id] ||= []).push(s);
    return json(treatments.map((t) => ({ ...t, sessions: byTreatment[t.id] || [] })));
  });

  // Agrega UNA sesión a un tratamiento existente — crea la cita (mismo camino que "Añadir cita"
  // de staff, createStaffAppointment) con treatment_id/session_label puestos.
  router.post("/api/:slug/staff/treatments/:id/sessions", async (request, env, ctx) => {
    const treatment = await first(env, `SELECT * FROM treatments WHERE business_id=? AND id=?`, ctx.business.id, ctx.params.id);
    if (!treatment) return notFound();
    const client = await first(env, `SELECT * FROM clients WHERE business_id=? AND id=?`, ctx.business.id, treatment.client_id);
    if (!client) return notFound();

    const b = await readJson(request);
    if (!b.serviceId || !b.specialistId || !b.date || !b.start) return error("Faltan datos de la sesión.");
    const result = await createStaffAppointment(env, ctx.business, {
      clientName: client.name, clientEmail: client.email, clientPhone: client.phone,
      serviceId: b.serviceId, specialistId: b.specialistId, date: b.date, start: b.start,
      treatmentId: treatment.id, sessionLabel: b.sessionLabel || null,
    });
    if (result.error) return error(result.error, 404);
    return json({ ok: true, appointmentId: result.id }, { status: 201 });
  });
}
