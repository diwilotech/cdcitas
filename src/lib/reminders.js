import { all, first, run } from "./db.js";
import { sendApptMessage } from "./messages.js";

// Corre cada 15 min (ver wrangler.toml). Busca recordatorios (appointment_reminders) de citas
// confirmadas cuya hora ya venció (ventana de 20 min hacia atrás, para no perder ninguno ni
// reenviar si el cron se solapa) y que todavía no se hayan mandado. remind_date/remind_time están
// en hora LOCAL del negocio (igual que appointments.date/start) — como el cron recorre negocios
// con husos distintos, "ahora" se calcula por negocio con su propio business.timezone_offset
// (Ajustes → Locación) en vez de una sola hora global.
export async function sendDueReminders(env) {
  const nowMs = Date.now();
  const today = new Date(nowMs).toISOString().slice(0, 10);
  // Filtro amplio en SQL (por fecha, sin hora) para no barrer toda la tabla; el corte fino de
  // "¿ya toca, o todavía no, o se pasó la ventana?" se hace abajo, en JS, por negocio.
  const candidates = await all(env,
    `SELECT r.* FROM appointment_reminders r
     JOIN appointments a ON a.id = r.appointment_id
     WHERE r.sent = 0 AND a.status = 'confirmed'
       AND r.remind_date BETWEEN date(?, '-1 day') AND date(?, '+1 day')`,
    today, today);

  let checked = 0, sent = 0;
  const businessCache = {};
  for (const reminder of candidates) {
    const appt = await first(env, `SELECT * FROM appointments WHERE id=? AND status='confirmed'`, reminder.appointment_id);
    if (!appt) { await run(env, `UPDATE appointment_reminders SET sent=1 WHERE id=?`, reminder.id); continue; }

    const business = businessCache[appt.business_id] ||= await first(env, `SELECT * FROM businesses WHERE id=?`, appt.business_id);
    if (!business) continue;
    const localNow = new Date(nowMs + (business.timezone_offset ?? -5) * 3600000);
    const windowStart = new Date(localNow.getTime() - 20 * 60 * 1000);
    const key = (d) => `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
    const dueKey = `${reminder.remind_date} ${reminder.remind_time}`;
    if (dueKey > key(localNow) || dueKey < key(windowStart)) continue;

    checked++;
    const service = await first(env, `SELECT name FROM services WHERE id=?`, appt.service_id);
    const result = await sendApptMessage(env, business, appt, "reminder", { serviceName: service?.name });
    await run(env, `UPDATE appointment_reminders SET sent=1 WHERE id=?`, reminder.id);
    if (result.ok) sent++;
  }
  return { checked, sent };
}
