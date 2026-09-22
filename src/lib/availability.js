import { all, first, run, uid } from "./db.js";

const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// Fecha/hora en la que debe dispararse un recordatorio, minutesBefore minutos antes de que
// empiece la cita — en minutos (no horas) para poder representar avisos cortos como "15 min antes".
export function reminderDateTimeMinutes(date, start, minutesBefore) {
  const dt = new Date(`${date}T${start}:00`);
  dt.setMinutes(dt.getMinutes() - minutesBefore);
  const y = dt.getFullYear(), m = String(dt.getMonth() + 1).padStart(2, "0"), d = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0"), mm = String(dt.getMinutes()).padStart(2, "0");
  return { date: `${y}-${m}-${d}`, time: `${hh}:${mm}` };
}

// Crea en appointment_reminders un recordatorio por cada aviso configurado en el servicio
// (reminder_hours siempre que sea > 0; reminder_2_minutes si el negocio activó un segundo aviso,
// ej. "15 min antes") — reusada tanto por la reserva pública como por la creación manual de citas
// de staff, para no repetir esta lógica dos veces.
export async function scheduleServiceReminders(env, businessId, apptId, service, date, start) {
  const offsetsMin = [];
  if (service.reminder_hours) offsetsMin.push(service.reminder_hours * 60);
  if (service.reminder_2_minutes) offsetsMin.push(service.reminder_2_minutes);
  for (const minutesBefore of offsetsMin) {
    const r = reminderDateTimeMinutes(date, start, minutesBefore);
    await run(env,
      `INSERT INTO appointment_reminders (id, appointment_id, business_id, remind_date, remind_time, source) VALUES (?,?,?,?,?,'service')`,
      uid(), apptId, businessId, r.date, r.time);
  }
}

// Horario efectivo de un día para el negocio o para un especialista puntual. Prioridad:
// 1) excepción puntual del especialista o del negocio para esa fecha exacta (festivo, día suelto
//    con horario especial — lo que se configura en Calendario)
// 2) patrón semanal propio del especialista (work_days + open_hour/close_hour — lo que se
//    configura en Reglas → Especialistas; se aplica automático todas las semanas)
// 3) horario general del negocio
async function effectiveHours(env, business, date, specialistId) {
  const specialistEx = specialistId
    ? await first(env, `SELECT * FROM date_exceptions WHERE business_id=? AND specialist_id=? AND date=?`,
        business.id, specialistId, date)
    : null;
  const businessEx = await first(env, `SELECT * FROM date_exceptions WHERE business_id=? AND specialist_id IS NULL AND date=?`,
    business.id, date);
  const ex = specialistEx || businessEx;
  if (ex) return ex.closed ? null : { open: ex.open_hour, close: ex.close_hour };

  const dow = new Date(date + "T00:00:00").getDay();

  if (specialistId) {
    const sp = await first(env, `SELECT work_days, open_hour, close_hour FROM specialists WHERE id=?`, specialistId);
    if (sp) {
      const workDays = JSON.parse(sp.work_days || "[1,2,3,4,5,6]");
      if (!workDays.includes(dow)) return null;
      if (sp.open_hour != null && sp.close_hour != null) return { open: sp.open_hour, close: sp.close_hour };
    }
  }

  const openDays = JSON.parse(business.open_days || "[1,2,3,4,5,6]");
  if (!openDays.includes(dow)) return null;
  return { open: business.open_hour, close: business.close_hour };
}

// Calcula los horarios de inicio disponibles (grilla de 15 min) para un servicio+especialista+fecha.
// clientId (opcional): si se manda, también se bloquean los horarios donde ese MISMO cliente ya
// tiene otra cita ese día con OTRO especialista — si no, un cliente con varias citas podía terminar
// con dos que se cruzan entre sí (excludeApptId es la cita que se está reagendando, para no
// chocar contra ella misma).
export async function availableSlots(env, business, { serviceId, specialistId, date, clientId, excludeApptId }) {
  const service = await first(env, `SELECT * FROM services WHERE business_id=? AND id=?`, business.id, serviceId);
  if (!service) return { error: "Servicio no encontrado" };

  const hours = await effectiveHours(env, business, date, specialistId);
  if (!hours) return { slots: [] };

  const busy = [];
  const appts = await all(env,
    // pending_confirmation también ocupa el horario: si no, dos personas podrían reservar el
    // mismo cupo mientras la primera todavía no responde el PIN/confirma el correo. excludeApptId
    // (al reagendar) es la propia cita — si no se excluye acá, su horario ACTUAL bloquea su propio
    // reagendamiento (incluso a la misma hora que ya tenía).
    `SELECT start, end FROM appointments WHERE business_id=? AND specialist_id=? AND date=? AND status IN ('confirmed','completed','pending_confirmation') AND id != ?`,
    business.id, specialistId, date, excludeApptId || "");
  const blocks = await all(env,
    `SELECT start, end FROM blocks WHERE business_id=? AND specialist_id=? AND date=?`,
    business.id, specialistId, date);
  for (const row of [...appts, ...blocks]) busy.push([toMin(row.start), toMin(row.end)]);

  if (clientId) {
    // 'reagendar' también cuenta como que el cliente "tiene algo ahí" — aunque el especialista sí
    // queda libre para otra persona en ese horario (por eso NO se agrega arriba, en el chequeo del
    // especialista), el cliente no debería poder agendar otra cita suya encima de una que todavía
    // no movió/canceló, porque en la lista se ve como que sigue ahí.
    const clientAppts = await all(env,
      `SELECT start, end FROM appointments WHERE business_id=? AND client_id=? AND date=? AND status IN ('confirmed','pending_confirmation','reagendar') AND id != ?`,
      business.id, clientId, date, excludeApptId || "");
    for (const row of clientAppts) busy.push([toMin(row.start), toMin(row.end)]);
  }

  // Si la fecha pedida es hoy, un horario que ya pasó tampoco cuenta como disponible — sin esto,
  // se podía reservar (y el cliente veía como libre) un horario de esta misma mañana ya pasado.
  // Las fechas/horas de toda la app son hora local del negocio (business.timezone_offset,
  // configurable en Ajustes → Locación, por defecto Colombia UTC-5); el Worker corre en UTC, así
  // que hay que sumar el offset primero para comparar "ahora" contra esa misma grilla.
  const localNow = new Date(Date.now() + (business.timezone_offset ?? -5) * 3600000);
  const nowMin = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  const isToday = date === localNow.toISOString().slice(0, 10);

  const step = 15;
  const startMin = hours.open * 60;
  const endMin = hours.close * 60;
  const slots = [];
  const allSlots = [];
  for (let t = startMin; t + service.duration_min <= endMin; t += step) {
    const overlaps = busy.some(([bs, be]) => t < be && t + service.duration_min > bs);
    const past = isToday && t <= nowMin;
    const time = toHHMM(t);
    allSlots.push({ time, available: !overlaps && !past });
    if (!overlaps && !past) slots.push(time);
  }
  return { slots, allSlots, durationMin: service.duration_min };
}

// Grilla de 30 min ocupado/libre para un especialista+fecha, SIN un servicio de por medio (a
// diferencia de availableSlots) — la usan los selectores de hora del panel de staff (Bloqueos,
// Añadir cita, Mover cita) solo como referencia visual. A propósito no filtra horas pasadas ni
// bloquea nada: el staff puede elegir cualquier horario igual, incluso uno marcado ocupado, para
// corregir datos o forzar un caso puntual.
export async function dayOccupancy(env, business, { specialistId, date }) {
  const hours = await effectiveHours(env, business, date, specialistId);
  if (!hours) return { allSlots: [] };

  const busy = [];
  const appts = await all(env,
    `SELECT start, end FROM appointments WHERE business_id=? AND specialist_id=? AND date=? AND status IN ('confirmed','completed','pending_confirmation')`,
    business.id, specialistId, date);
  const blocks = await all(env,
    `SELECT start, end FROM blocks WHERE business_id=? AND specialist_id=? AND date=?`,
    business.id, specialistId, date);
  for (const row of [...appts, ...blocks]) busy.push([toMin(row.start), toMin(row.end)]);

  const step = 30;
  const startMin = hours.open * 60;
  const endMin = hours.close * 60;
  const allSlots = [];
  for (let t = startMin; t < endMin; t += step) {
    const overlaps = busy.some(([bs, be]) => t < be && t + step > bs);
    allSlots.push({ time: toHHMM(t), available: !overlaps });
  }
  return { allSlots };
}
