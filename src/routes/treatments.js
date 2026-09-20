import { all, first, uid, run } from "../lib/db.js";
import { json, error, notFound, readJson } from "../lib/http.js";
import { createStaffAppointment } from "./appointments.js";

// Tratamientos: el CRUD genérico de la PLANTILLA (`treatments`, con su lista de servicios en
// treatment_services) vive en resources.js. Acá van las rutas de "un cliente inscrito en un
// tratamiento" (client_treatments) — appointments.treatment_id apunta a esa inscripción, no a la
// plantilla directo, para que el progreso sea por cliente (puede repetir el mismo tratamiento).
export function registerTreatments(router) {
  // Tratamientos en los que está inscrito un cliente, con la plantilla (nombre + servicios que la
  // componen, para saber el "total") y sus sesiones ya agendadas.
  router.get("/api/:slug/staff/clients/:id/treatments", async (request, env, ctx) => {
    const client = await first(env, `SELECT id FROM clients WHERE business_id=? AND id=?`, ctx.business.id, ctx.params.id);
    if (!client) return notFound();

    const enrollments = await all(env,
      `SELECT ct.*, t.name AS treatment_name, t.description AS treatment_description
       FROM client_treatments ct JOIN treatments t ON t.id = ct.treatment_id
       WHERE ct.business_id=? AND ct.client_id=? ORDER BY ct.created_at DESC`,
      ctx.business.id, client.id);
    if (!enrollments.length) return json([]);

    const ids = enrollments.map((e) => e.id);
    const placeholders = ids.map(() => "?").join(",");
    const [allServices, allSessions] = await Promise.all([
      all(env,
        `SELECT ts.treatment_id, sv.id, sv.name FROM treatment_services ts JOIN services sv ON sv.id = ts.service_id
         WHERE ts.treatment_id IN (SELECT treatment_id FROM client_treatments WHERE id IN (${placeholders})) ORDER BY ts.position`,
        ...ids),
      all(env,
        `SELECT a.*, sp.name AS specialist_name, sv.name AS service_name
         FROM appointments a JOIN specialists sp ON sp.id=a.specialist_id JOIN services sv ON sv.id=a.service_id
         WHERE a.business_id=? AND a.treatment_id IN (${placeholders}) ORDER BY a.date, a.start`,
        ctx.business.id, ...ids),
    ]);
    const servicesByTreatment = {};
    for (const s of allServices) (servicesByTreatment[s.treatment_id] ||= []).push({ id: s.id, name: s.name });
    const sessionsByEnrollment = {};
    for (const s of allSessions) (sessionsByEnrollment[s.treatment_id] ||= []).push(s);

    return json(enrollments.map((e) => ({
      ...e,
      services: servicesByTreatment[e.treatment_id] || [],
      sessions: sessionsByEnrollment[e.id] || [],
    })));
  });

  // Inscribe a un cliente en una plantilla de tratamiento.
  router.post("/api/:slug/staff/clients/:id/treatments", async (request, env, ctx) => {
    const client = await first(env, `SELECT id FROM clients WHERE business_id=? AND id=?`, ctx.business.id, ctx.params.id);
    if (!client) return notFound();
    const { treatmentId } = await readJson(request);
    const treatment = await first(env, `SELECT id FROM treatments WHERE business_id=? AND id=?`, ctx.business.id, treatmentId);
    if (!treatment) return error("Tratamiento no encontrado.", 404);
    const id = uid();
    await run(env, `INSERT INTO client_treatments (id, business_id, client_id, treatment_id, status) VALUES (?,?,?,?,'active')`,
      id, ctx.business.id, client.id, treatment.id);
    return json({ id }, { status: 201 });
  });

  // Agrega UNA sesión a la inscripción de un cliente — igual que "Añadir cita" de staff
  // (createStaffAppointment), con treatment_id puesto a la inscripción (no a la plantilla).
  router.post("/api/:slug/staff/client-treatments/:id/sessions", async (request, env, ctx) => {
    const enrollment = await first(env, `SELECT * FROM client_treatments WHERE business_id=? AND id=?`, ctx.business.id, ctx.params.id);
    if (!enrollment) return notFound();
    const client = await first(env, `SELECT * FROM clients WHERE business_id=? AND id=?`, ctx.business.id, enrollment.client_id);
    if (!client) return notFound();

    const b = await readJson(request);
    if (!b.serviceId || !b.specialistId || !b.date || !b.start) return error("Faltan datos de la sesión.");
    const result = await createStaffAppointment(env, ctx.business, {
      clientName: client.name, clientEmail: client.email, clientPhone: client.phone,
      serviceId: b.serviceId, specialistId: b.specialistId, date: b.date, start: b.start,
      treatmentId: enrollment.id, sessionLabel: b.sessionLabel || null,
    });
    if (result.error) return error(result.error, 404);
    return json({ ok: true, appointmentId: result.id }, { status: 201 });
  });
}
