import { all, first, run } from "../lib/db.js";
import { json, error, notFound, readJson } from "../lib/http.js";
import { availableSlots } from "../lib/availability.js";
import { ensureManageToken, sendConfirmedNotice, sendSelfServiceNotice, markClientVerified, requestClientLogin } from "../lib/confirm.js";

// Rutas públicas (sin sesión de staff) para que el cliente confirme su cita por correo y para la
// página "mis citas" (ver/cancelar/reagendar a un horario disponible) — mismo estilo que public.js.
function withinCancelWindow(appt) {
  const startMs = new Date(`${appt.date}T${appt.start}:00`).getTime();
  return startMs - Date.now() < (appt.cancel_window_hours || 0) * 3600000;
}
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export function registerManage(router) {
  // Clic en el link de confirmación que llega por correo.
  router.get("/api/:slug/public/confirm-email/:apptId/:token", async (request, env, ctx) => {
    const appt = await first(env, `SELECT * FROM appointments WHERE business_id=? AND id=?`, ctx.business.id, ctx.params.apptId);
    const manageUrl = new URL(`/${ctx.business.slug}/mis-citas`, request.url);

    if (!appt || appt.confirm_token !== ctx.params.token || appt.status !== "pending_confirmation") {
      manageUrl.searchParams.set("err", "confirm");
      return Response.redirect(manageUrl.toString(), 302);
    }
    if (appt.confirm_expires_at && new Date(appt.confirm_expires_at) < new Date()) {
      manageUrl.searchParams.set("err", "expired");
      return Response.redirect(manageUrl.toString(), 302);
    }

    await run(env, `UPDATE appointments SET status='confirmed', confirm_token=NULL WHERE id=?`, appt.id);
    await markClientVerified(env, appt.client_id);
    const updated = await first(env, `SELECT * FROM appointments WHERE id=?`, appt.id);
    const service = await first(env, `SELECT name FROM services WHERE id=?`, appt.service_id);
    await sendConfirmedNotice(env, ctx.business, updated, service, new URL(request.url).origin);

    const manageToken = await ensureManageToken(env, appt.client_id);
    manageUrl.searchParams.set("t", manageToken);
    manageUrl.searchParams.set("justConfirmed", "1");
    return Response.redirect(manageUrl.toString(), 302);
  });

  // "Ver mis citas" con solo el celular (si se perdió el link original que llegó al confirmar).
  router.post("/api/:slug/public/login-request", async (request, env, ctx) => {
    const { phone } = await readJson(request);
    if (!phone) return error("Falta el celular.");
    const result = await requestClientLogin(env, ctx.business, phone);
    if (!result.ok) return error(result.error, 404);
    return json({ waLink: result.waLink });
  });

  // El navegador consulta esto cada pocos segundos después de mandar el WhatsApp con el PIN —
  // cuando el webhook lo procese, login_pin queda en NULL y aparece el manage_token.
  router.get("/api/:slug/public/login-check", async (request, env, ctx) => {
    const phone = new URL(request.url).searchParams.get("phone");
    if (!phone) return json({ ready: false });
    const client = await first(env, `SELECT manage_token, login_pin FROM clients WHERE business_id=? AND phone=?`, ctx.business.id, phone);
    if (client && !client.login_pin && client.manage_token) return json({ ready: true, manageToken: client.manage_token });
    return json({ ready: false });
  });

  router.get("/api/:slug/public/my-appointments/:token", async (request, env, ctx) => {
    const client = await first(env, `SELECT * FROM clients WHERE business_id=? AND manage_token=?`, ctx.business.id, ctx.params.token);
    if (!client) return notFound();
    const appointments = await all(env,
      `SELECT a.*, sp.name AS specialist_name, sv.name AS service_name, sv.cancel_window_hours,
              t.name AS treatment_name,
              (SELECT COUNT(*) FROM treatment_services WHERE treatment_id = t.id) AS treatment_total_sessions
       FROM appointments a JOIN specialists sp ON sp.id=a.specialist_id JOIN services sv ON sv.id=a.service_id
       LEFT JOIN client_treatments ct ON ct.id=a.treatment_id
       LEFT JOIN treatments t ON t.id=ct.treatment_id
       WHERE a.client_id=? ORDER BY a.date DESC, a.start DESC`, client.id);
    return json({ client: { name: client.name, email: client.email }, business: { name: ctx.business.name }, appointments });
  });

  // El cliente puede corregir su nombre/correo desde el link de mis-citas. El celular NO se puede
  // cambiar acá — es la llave con la que entra (login-request/webhook lo usan tal cual).
  router.patch("/api/:slug/public/my-appointments/:token/profile", async (request, env, ctx) => {
    const client = await first(env, `SELECT * FROM clients WHERE business_id=? AND manage_token=?`, ctx.business.id, ctx.params.token);
    if (!client) return notFound();
    const { name, email } = await readJson(request);
    if (!name || !String(name).trim()) return error("Escribe tu nombre.");
    await run(env, `UPDATE clients SET name=?, email=? WHERE id=?`, String(name).trim(), email ? String(email).trim() : null, client.id);
    return json({ ok: true, name: String(name).trim(), email: email ? String(email).trim() : null });
  });

  router.post("/api/:slug/public/my-appointments/:token/:apptId/cancel", async (request, env, ctx) => {
    const client = await first(env, `SELECT * FROM clients WHERE business_id=? AND manage_token=?`, ctx.business.id, ctx.params.token);
    if (!client) return notFound();
    const appt = await first(env,
      `SELECT a.*, sv.cancel_window_hours, sv.name AS service_name FROM appointments a JOIN services sv ON sv.id=a.service_id
       WHERE a.id=? AND a.client_id=?`, ctx.params.apptId, client.id);
    if (!appt) return notFound();
    if (!["confirmed", "pending_confirmation", "reagendar"].includes(appt.status)) return error("Esta cita ya no se puede cancelar.", 409);
    if (appt.status !== "reagendar" && withinCancelWindow(appt)) return error(`Ya no se puede cancelar en línea (menos de ${appt.cancel_window_hours}h antes de la cita) — contacta al negocio.`, 409);

    await run(env, `UPDATE appointments SET status='cancelled' WHERE id=?`, appt.id);
    const updated = await first(env, `SELECT * FROM appointments WHERE id=?`, appt.id);
    await sendSelfServiceNotice(env, ctx.business, updated, { name: appt.service_name }, "selfCancel");
    return json({ ok: true });
  });

  // Devuelve los horarios disponibles del mismo servicio+especialista de la cita, para que el
  // cliente pueda reagendarla a un horario que sí esté libre (mismo chequeo que usa la reserva).
  router.get("/api/:slug/public/my-appointments/:token/:apptId/reschedule-slots", async (request, env, ctx) => {
    const client = await first(env, `SELECT * FROM clients WHERE business_id=? AND manage_token=?`, ctx.business.id, ctx.params.token);
    if (!client) return notFound();
    const appt = await first(env, `SELECT * FROM appointments WHERE id=? AND client_id=?`, ctx.params.apptId, client.id);
    if (!appt) return notFound();
    const date = new URL(request.url).searchParams.get("date");
    if (!date) return error("Falta la fecha.");
    return json(await availableSlots(env, ctx.business, {
      serviceId: appt.service_id, specialistId: appt.specialist_id, date, clientId: appt.client_id, excludeApptId: appt.id,
    }));
  });

  router.post("/api/:slug/public/my-appointments/:token/:apptId/reschedule", async (request, env, ctx) => {
    const client = await first(env, `SELECT * FROM clients WHERE business_id=? AND manage_token=?`, ctx.business.id, ctx.params.token);
    if (!client) return notFound();
    const appt = await first(env,
      `SELECT a.*, sv.cancel_window_hours, sv.name AS service_name, sv.duration_min FROM appointments a JOIN services sv ON sv.id=a.service_id
       WHERE a.id=? AND a.client_id=?`, ctx.params.apptId, client.id);
    if (!appt) return notFound();
    if (!["confirmed", "pending_confirmation", "reagendar"].includes(appt.status)) return error("Esta cita ya no se puede reagendar.", 409);
    if (appt.status !== "reagendar" && withinCancelWindow(appt)) return error(`Ya no se puede reagendar en línea (menos de ${appt.cancel_window_hours}h antes de la cita) — contacta al negocio.`, 409);

    const { date, start } = await readJson(request);
    if (!date || !start) return error("Falta la fecha y hora nuevas.");
    const { slots } = await availableSlots(env, ctx.business, {
      serviceId: appt.service_id, specialistId: appt.specialist_id, date, clientId: appt.client_id, excludeApptId: appt.id,
    });
    if (!slots.includes(start)) return error("Ese horario ya no está disponible (o se cruza con otra cita tuya); elige otro.", 409);

    const end = toHHMM(toMin(start) + appt.duration_min);
    // 'reagendar' quedaba "resuelta" (el cliente eligió una hora nueva) así que pasa a confirmed.
    // 'pending_confirmation' se queda igual — todavía no probó que el celular/correo es suyo, y
    // reagendar no debe ser un atajo para saltarse esa verificación.
    const newStatus = appt.status === "reagendar" ? "confirmed" : appt.status;
    await run(env, `UPDATE appointments SET date=?, start=?, end=?, status=?, space_type=NULL WHERE id=?`, date, start, end, newStatus, appt.id);
    const updated = await first(env, `SELECT * FROM appointments WHERE id=?`, appt.id);
    await sendSelfServiceNotice(env, ctx.business, updated, { name: appt.service_name }, "selfReschedule");
    return json({ ok: true, appointment: updated });
  });
}
