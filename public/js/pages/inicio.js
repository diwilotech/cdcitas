// Inicio = el módulo Dashboard de Diwilo Modulos. Aquí solo se registra lo PROPIO de Citas: el día del negocio (indicadores y agenda de hoy).
(() => {
  const { esc, money, api } = window.Cit;
  (window.DwDashboard = window.DwDashboard || []).push({
    id: 'citas',
    titulo: 'Tu agenda',
    async mount(host) {
      host.innerHTML = '<div class="empty small">Cargando…</div>';
      const hoy = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
      let f, citas;
      try { [f, citas] = await Promise.all([api('/staff/flujo'), api(`/staff/appointments?date=${hoy}`).catch(() => [])]); } catch (e) { host.innerHTML = `<div class="empty small">${esc(e.message)}</div>`; return; }
      const lista = (Array.isArray(citas) ? citas : citas.rows || []).filter((a) => ['confirmed', 'pending_confirmation', 'completed'].includes(a.status)).sort((a, b) => String(a.start).localeCompare(String(b.start)));
      const card = ([icon, label, value, sub]) => `<div class="col-6 col-lg-3"><div class="card kpi h-100"><div class="d-flex justify-content-between align-items-start"><div class="kpi-label">${label}</div><i class="bi ${icon} kpi-icon"></i></div><div class="kpi-value mt-1">${esc(value)}</div><div class="small text-body-secondary mt-1">${esc(sub)}</div></div></div>`;
      host.innerHTML = `<div class="row g-3 mb-3">${[
        ['bi-calendar-check', 'Citas activas hoy', f.activeToday, 'Confirmadas'],
        ['bi-cash-coin', 'Ingresos de hoy', money(f.todayRevenue), `Ayer ${money(f.yesterdayRevenue)}`],
        ['bi-person-x', 'Inasistencia', `${f.noShowRate.value}%`, 'Últimos 30 días'],
        ['bi-hourglass-split', 'Pagos pendientes', f.pendingPayments, 'Completadas sin cobrar'],
      ].map(card).join('')}</div>
      <div class="card"><div class="card-header d-flex justify-content-between align-items-center py-3"><span><i class="bi bi-clock me-2"></i>Agenda de hoy</span><a href="/staff/citas.html" data-go="/staff/citas.html" class="small">Abrir la agenda</a></div>
        <div class="list-group list-group-flush">${lista.length ? lista.map((a) => `<div class="list-group-item d-flex gap-3 py-2"><span class="appt-time">${esc(a.start)}</span><span class="flex-grow-1 text-truncate">${esc(a.client_name || a.clientName || '')}</span><span class="small text-body-secondary">${esc(a.service_name || a.serviceName || '')}</span></div>`).join('') : '<div class="empty small"><i class="bi bi-cup-hot d-block fs-3 mb-1"></i>No hay citas para hoy</div>'}</div></div>`;
    },
  });
})();
