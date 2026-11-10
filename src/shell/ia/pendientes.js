// Pendientes de la agenda para la IA proactiva (botón «IA Diwilo» → «Lo de hoy»). Los pide el módulo central de IA por
// ctx.propias.pendientes() (src/shell/lib/central.js). Sin IA: usa las mismas herramientas de lectura del MCP (`usar` respeta módulo activo y rol).
// Cada uno: { id, nivel: mala|aviso|info, icono, texto, ruta, pregunta } — `pregunta` es lo que la persona le pediría a la IA para atenderlo.
const pl = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

export async function pendientesDe(usar) {
  const r = await usar('citas.resumen_en_vivo');
  if (!r) return [];
  const out = [];
  if (r.por_reagendar > 0) out.push({ id: 'cc-reagendar', nivel: 'aviso', icono: 'bi-arrow-repeat', texto: `${pl(r.por_reagendar, 'cita por reagendar', 'citas por reagendar')}`, ruta: '/staff/citas.html', pregunta: '¿Qué citas debo reagendar y a quién le escribo?' });
  if (r.citas_hoy > 0) out.push({ id: 'cc-hoy', nivel: 'info', icono: 'bi-calendar2-check', texto: `Hoy hay ${pl(r.citas_hoy, 'cita', 'citas')} y ${r.citas_proximos_7_dias || 0} más en los próximos 7 días`, ruta: '/staff/citas.html', pregunta: '¿Qué citas tengo hoy?' });
  else if (r.citas_proximos_7_dias === 0) out.push({ id: 'cc-vacia', nivel: 'aviso', icono: 'bi-calendar-x', texto: 'La agenda de los próximos 7 días está vacía', ruta: '/staff/citas.html', pregunta: '¿A qué clientes puedo invitar a volver esta semana?' });
  return out;
}
