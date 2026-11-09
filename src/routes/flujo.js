import { all, first } from "../lib/db.js";
import { json } from "../lib/http.js";

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

// Ingresos = suma del precio del servicio de las citas completadas (lo único que cuenta como
// "pasó de verdad"). No hay pasarela de pago; "pagado" es un check manual del staff.
export function registerFlujo(router) {
  router.get("/api/:slug/staff/flujo", async (request, env, ctx) => {
    const businessId = ctx.business.id;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = addDays(today, -1);
    const weekAgo = addDays(today, -6);
    const monthAgo = addDays(today, -29);
    const prevMonthAgo = addDays(today, -59);

    const revenueOn = async (date) => {
      const row = await first(env,
        `SELECT COALESCE(SUM(sv.price),0) AS revenue FROM appointments a
         JOIN services sv ON sv.id = a.service_id
         WHERE a.business_id=? AND a.date=? AND a.status='completed'`, businessId, date);
      return row.revenue;
    };

    const [todayRevenue, yesterdayRevenue, activeToday, pendingRow, last7Rows, byServiceRows, noShowNow, noShowPrev, statusRow] =
      await Promise.all([
        revenueOn(today),
        revenueOn(yesterday),
        first(env, `SELECT COUNT(*) AS n FROM appointments WHERE business_id=? AND date=? AND status IN ('confirmed','pending_confirmation')`, businessId, today)
          .then((r) => r.n),
        first(env, `SELECT COUNT(*) AS n FROM appointments WHERE business_id=? AND status='completed' AND paid=0`, businessId),
        all(env,
          `SELECT a.date, COALESCE(SUM(sv.price),0) AS revenue FROM appointments a
           JOIN services sv ON sv.id = a.service_id
           WHERE a.business_id=? AND a.status='completed' AND a.date BETWEEN ? AND ?
           GROUP BY a.date`, businessId, weekAgo, today),
        all(env,
          `SELECT sv.name AS service, COALESCE(SUM(sv.price),0) AS revenue FROM appointments a
           JOIN services sv ON sv.id = a.service_id
           WHERE a.business_id=? AND a.status='completed' AND a.date BETWEEN ? AND ?
           GROUP BY sv.id ORDER BY revenue DESC`, businessId, monthAgo, today),
        first(env,
          `SELECT SUM(CASE WHEN status='no-show' THEN 1 ELSE 0 END) AS noShow, COUNT(*) AS total
           FROM appointments WHERE business_id=? AND date BETWEEN ? AND ? AND status IN ('completed','no-show')`,
          businessId, monthAgo, today),
        first(env,
          `SELECT SUM(CASE WHEN status='no-show' THEN 1 ELSE 0 END) AS noShow, COUNT(*) AS total
           FROM appointments WHERE business_id=? AND date BETWEEN ? AND ? AND status IN ('completed','no-show')`,
          businessId, prevMonthAgo, addDays(monthAgo, -1)),
        first(env,
          `SELECT
             SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN status IN ('confirmed','reagendar','pending_confirmation') THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN status IN ('cancelled','no-show') THEN 1 ELSE 0 END) AS cancelledOrNoShow
           FROM appointments WHERE business_id=? AND date BETWEEN ? AND ?`,
          businessId, monthAgo, today),
      ]);

    const revenueByDate = Object.fromEntries(last7Rows.map((r) => [r.date, r.revenue]));
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(weekAgo, i);
      return { date, revenue: revenueByDate[date] || 0 };
    });

    // Más profundidad: quién atiende, qué días se llena la agenda y quién deja más (últimos 30 días / 90 días)
    const [bySpecialist, byDow, topClients, nuevos] = await Promise.all([
      all(env, `SELECT sp.name AS name, COUNT(*) AS citas, COALESCE(SUM(CASE WHEN a.status='completed' THEN sv.price ELSE 0 END),0) AS revenue
        FROM appointments a JOIN specialists sp ON sp.id=a.specialist_id JOIN services sv ON sv.id=a.service_id
        WHERE a.business_id=? AND a.date BETWEEN ? AND ? AND a.status IN ('completed','confirmed','pending_confirmation') GROUP BY sp.id ORDER BY citas DESC LIMIT 8`, businessId, monthAgo, today),
      all(env, `SELECT CAST(strftime('%w', date) AS INTEGER) AS dow, COUNT(*) AS n FROM appointments
        WHERE business_id=? AND date BETWEEN ? AND ? AND status IN ('completed','confirmed','pending_confirmation','no-show') GROUP BY dow`, businessId, monthAgo, today),
      all(env, `SELECT COALESCE(c.name, a.client_name) AS name, COUNT(*) AS citas, COALESCE(SUM(sv.price),0) AS revenue FROM appointments a
        JOIN services sv ON sv.id=a.service_id LEFT JOIN clients c ON c.id=a.client_id
        WHERE a.business_id=? AND a.status='completed' AND a.date BETWEEN ? AND ? GROUP BY COALESCE(a.client_id, a.client_name) ORDER BY revenue DESC LIMIT 6`, businessId, addDays(today, -89), today),
      first(env, `SELECT SUM(CASE WHEN substr(created_at,1,10) >= ? THEN 1 ELSE 0 END) AS este, SUM(CASE WHEN substr(created_at,1,10) < ? AND substr(created_at,1,10) >= ? THEN 1 ELSE 0 END) AS antes FROM clients WHERE business_id=?`, monthAgo, monthAgo, prevMonthAgo, businessId),
    ]);
    const dowCounts = Array.from({ length: 7 }, (_, d) => byDow.find((x) => x.dow === d)?.n || 0);

    const rate = (row) => (row.total ? Math.round((row.noShow / row.total) * 1000) / 10 : 0);

    return json({
      todayRevenue, yesterdayRevenue, activeToday,
      pendingPayments: pendingRow.n,
      noShowRate: { value: rate(noShowNow), previousValue: rate(noShowPrev) },
      last7Days,
      byService: byServiceRows, bySpecialist, byDow: dowCounts, topClients, newClients: { value: nuevos?.este || 0, previousValue: nuevos?.antes || 0 },
      statusCounts: { completed: statusRow.completed || 0, pending: statusRow.pending || 0, cancelledOrNoShow: statusRow.cancelledOrNoShow || 0 },
    });
  });

  // Embudo: las citas recientes y próximas por estado (para arrastrar a «Completada»)
  router.get("/api/:slug/staff/embudo", async (request, env, ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await all(env,
      `SELECT a.id, a.date, a.start, a.status, COALESCE(c.name, a.client_name) AS client, sv.name AS service, sv.price AS price, sp.name AS specialist
       FROM appointments a JOIN services sv ON sv.id=a.service_id JOIN specialists sp ON sp.id=a.specialist_id LEFT JOIN clients c ON c.id=a.client_id
       WHERE a.business_id=? AND a.date BETWEEN ? AND ? ORDER BY a.date, a.start LIMIT 400`, ctx.business.id, addDays(today, -7), addDays(today, 14));
    return json({ today, rows });
  });

  // CSV de citas (rango opcional ?from=&to=) y de clientes, con los mismos permisos del panel
  const cel = (v) => { const t = String(v ?? "").replace(/\r?\n/g, " "); return /[",;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = (filas, nombre) => new Response("\uFEFF" + filas.map((f) => f.map(cel).join(",")).join("\r\n"),
    { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${nombre}.csv"`, "cache-control": "no-store" } });
  router.get("/api/:slug/staff/export/citas", async (request, env, ctx) => {
    const url = new URL(request.url), today = new Date().toISOString().slice(0, 10);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : addDays(today, -89);
    const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") || "") ? url.searchParams.get("to") : addDays(today, 30);
    const rows = await all(env,
      `SELECT a.date, a.start, a.end, a.status, a.client_name, a.client_phone, a.client_email, sv.name AS service, sv.price AS price, sp.name AS specialist
       FROM appointments a JOIN services sv ON sv.id=a.service_id JOIN specialists sp ON sp.id=a.specialist_id
       WHERE a.business_id=? AND a.date BETWEEN ? AND ? ORDER BY a.date, a.start`, ctx.business.id, from, to);
    return csv([["Fecha", "Inicio", "Fin", "Estado", "Cliente", "Celular", "Correo", "Servicio", "Precio", "Especialista"],
      ...rows.map((r) => [r.date, r.start, r.end, r.status, r.client_name, r.client_phone || "", r.client_email || "", r.service, r.price, r.specialist])], `citas-${from}_${to}`);
  });
  router.get("/api/:slug/staff/export/clientes", async (request, env, ctx) => {
    const rows = await all(env,
      `SELECT c.name, c.phone, c.email, c.created_at, (SELECT COUNT(*) FROM appointments a WHERE a.client_id=c.id AND a.status='completed') AS completadas,
              (SELECT MAX(a.date) FROM appointments a WHERE a.client_id=c.id) AS ultima
       FROM clients c WHERE c.business_id=? ORDER BY c.name`, ctx.business.id);
    return csv([["Nombre", "Celular", "Correo", "Cliente desde", "Citas completadas", "Última cita"],
      ...rows.map((r) => [r.name, r.phone || "", r.email || "", String(r.created_at).slice(0, 10), r.completadas, r.ultima || ""])], "clientes");
  });
}
