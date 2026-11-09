// Herramientas de IA hechas a mano: el resumen en vivo del negocio.
import { db } from '../lib/db.js';

const S = (props, required = []) => ({ type: 'object', properties: props, required, additionalProperties: false });
const add = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default [
  {
    name: 'citas.resumen_en_vivo', modulo: 'citas', rol: 'staff', tipo: 'lectura',
    description: 'Resumen en vivo del negocio: citas de hoy y de la semana, por reagendar, clientes nuevos del mes e ingresos de los últimos 30 días.',
    inputSchema: S({}),
    run: async (c) => {
      const hoy = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10), bid = c.businessId, d = db(c.env);
      const k = await d.first(
        `SELECT (SELECT COUNT(*) FROM appointments WHERE business_id = ?1 AND date = ?2 AND status IN ('confirmed','pending_confirmation')) AS citas_hoy,
                (SELECT COUNT(*) FROM appointments WHERE business_id = ?1 AND date > ?2 AND date <= ?3 AND status IN ('confirmed','pending_confirmation')) AS citas_proximos_7_dias,
                (SELECT COUNT(*) FROM appointments WHERE business_id = ?1 AND status = 'reagendar') AS por_reagendar,
                (SELECT COUNT(*) FROM clients WHERE business_id = ?1 AND substr(created_at, 1, 10) >= ?4) AS clientes_nuevos_30_dias,
                (SELECT COALESCE(SUM(sv.price), 0) FROM appointments a JOIN services sv ON sv.id = a.service_id WHERE a.business_id = ?1 AND a.status = 'completed' AND a.date >= ?4) AS ingresos_30_dias`,
        bid, hoy, add(hoy, 7), add(hoy, -30));
      return { hoy, ...k };
    },
  },
];
