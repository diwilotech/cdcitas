// Clientes: lista con buscar, crear y editar, y su ficha: números, historial de citas y paquetes (con sus sesiones).
DW.ready.then(async (me) => {
  if (!me.pageAllowed) return;
  const { esc, toast, modal } = window.App;
  const C = window.App.Crud, { cit } = window.CC;
  const view = document.querySelector('[data-view]');
  view.innerHTML = '<div data-kpis class="dw-kpis mb-3"></div><div data-tabla></div>';
  const RO = me.business.readOnly;
  await window.CC.mapa();

  async function ficha(row, changed) {
    const { el } = modal(`<div class="modal-header border-0 pb-0"><h2 class="modal-title h5">${esc(row.name)}</h2><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
      <div class="modal-body"><div data-k class="dw-kpis mb-3"></div>
        <ul class="nav nav-pills small mb-3" data-tabs><li class="nav-item"><button class="nav-link active" data-t="hist">Historial</button></li><li class="nav-item"><button class="nav-link" data-t="paq">Paquetes</button></li></ul>
        <div data-body>Cargando…</div></div>`, { size: 'modal-lg' });
    const body = el.querySelector('[data-body]');
    const [st, hist] = await Promise.all([cit(`/staff/clients/${row.id}/stats`).catch(() => null), cit(`/staff/appointments?clientId=${row.id}`).catch(() => [])]);
    if (st) C.kpis(el.querySelector('[data-k]'), [['Atendidas', st.attended, '', 'bi-check2-circle'], ['Inasistencias', st.noShow, '', 'bi-person-x'], ['Canceladas', st.cancelled, '', 'bi-x-circle'], ['Última cita', st.lastDate ? window.CC.dia(st.lastDate) : '—', '', 'bi-clock-history']]);
    const verHist = () => { body.innerHTML = hist.length ? hist.map((a) => `<div class="d-flex flex-wrap gap-2 border-top py-2 small"><span class="flex-grow-1">${esc(a.session_label || a.service_name)} · ${window.CC.dia(a.date)} ${window.CC.hora(a.start)}</span>${window.CC.chipEstado(a.status)}</div>`).join('') : window.App.empty('bi-calendar-x', 'Sin citas todavía.'); };
    async function verPaq() {
      const [pq, plantillas, servicios, especialistas] = await Promise.all([cit(`/staff/clients/${row.id}/treatments`).catch(() => []), cit('/staff/treatments').catch(() => []), cit('/staff/services').catch(() => []), cit('/staff/specialists').catch(() => [])]);
      body.innerHTML = `<div class="mb-3"><button class="btn btn-sm btn-primary" data-asignar ${RO ? 'disabled' : ''}><i class="bi bi-plus-lg me-1"></i>Asignar paquete</button></div>` + (pq.length ? pq.map((t) => {
        const hechas = t.sessions.filter((s) => s.status === 'completed').length, total = t.services.length;
        return `<div class="dw-card mb-2"><div class="d-flex gap-2"><div class="flex-grow-1"><div class="fw-semibold">${esc(t.treatment_name)}</div><div class="small text-body-secondary">${total ? `${hechas} de ${total} sesiones` : `${t.sessions.length} sesión(es)`}${t.treatment_description ? ' · ' + esc(t.treatment_description) : ''}</div>
          ${total ? `<div class="progress mt-1" style="height:5px"><div class="progress-bar" style="width:${Math.min(100, hechas / total * 100)}%"></div></div>` : ''}</div>
          <button class="btn btn-sm btn-outline-secondary align-self-start" data-sesion="${t.id}" ${RO ? 'disabled' : ''}>+ Sesión</button></div>
          ${t.sessions.map((s) => `<div class="d-flex gap-2 border-top mt-2 pt-1 small"><span class="flex-grow-1">${esc(s.session_label || s.service_name)} · ${window.CC.dia(s.date)} ${window.CC.hora(s.start)}</span>${window.CC.chipEstado(s.status)}</div>`).join('')}</div>`;
      }).join('') : window.App.empty('bi-box-seam', 'Sin paquetes todavía.'));
      body.querySelector('[data-asignar]').onclick = async () => {
        const act = plantillas.filter((t) => t.active);
        if (!act.length) return toast('Primero arma un paquete en Servicios → Paquetes.', false);
        const out = await C.form({ title: 'Asignar paquete', fields: [{ k: 'treatmentId', label: 'Paquete', type: 'select', options: act.map((t) => [t.id, t.name]), required: true, full: true }], base: '' });
        if (!out) return;
        try { await cit(`/staff/clients/${row.id}/treatments`, { method: 'POST', body: out }); toast('Paquete asignado'); verPaq(); } catch (x) { toast(x.message, false); }
      };
      body.querySelectorAll('[data-sesion]').forEach((b) => (b.onclick = async () => {
        const t = pq.find((x) => x.id === b.dataset.sesion);
        const { el: m2, m } = modal(`<form><div class="modal-header border-0 pb-0"><h2 class="modal-title h5">Agregar sesión</h2><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><div class="row g-2">
          <div class="col-12"><label class="form-label small mb-1">Nombre de la sesión (opcional)</label><input class="form-control" name="lbl"></div>
          <div class="col-sm-6"><label class="form-label small mb-1">Servicio</label><select class="form-select" name="svc">${t.services.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
          <div class="col-sm-6"><label class="form-label small mb-1">Especialista</label><select class="form-select" name="esp">${especialistas.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
          <div class="col-sm-6"><label class="form-label small mb-1">Fecha</label><input class="form-control" type="date" name="fecha" required></div>
          <div class="col-sm-6"><label class="form-label small mb-1">Hora</label><select class="form-select" name="hora"><option value="">Elige fecha</option></select></div></div><div class="small text-danger mt-2" data-err></div></div>
          <div class="modal-footer border-0 pt-0"><button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancelar</button><button class="btn btn-primary">Agregar</button></div></form>`);
        const f = m2.querySelector('form');
        const horas = async () => {
          if (!f.fecha.value || !f.esp.value) return;
          const d = await cit(`/public/availability?serviceId=${f.svc.value}&specialistId=${f.esp.value}&date=${f.fecha.value}`).catch(() => ({ allSlots: [] }));
          const sl = d.allSlots || [];
          f.hora.innerHTML = sl.length ? sl.map((s) => `<option value="${s.time}">${window.CC.hora(s.time)}${s.available ? '' : ' (ocupado)'}</option>`).join('') : '<option value="">Sin horarios ese día</option>';
        };
        ['fecha', 'esp', 'svc'].forEach((k) => f[k].addEventListener('change', horas));
        f.onsubmit = async (e) => {
          e.preventDefault();
          if (!f.svc.value || !f.hora.value) return (m2.querySelector('[data-err]').textContent = 'Elige servicio, fecha y hora.');
          try { await cit(`/staff/client-treatments/${t.id}/sessions`, { method: 'POST', body: { serviceId: f.svc.value, specialistId: f.esp.value, date: f.fecha.value, start: f.hora.value, sessionLabel: f.lbl.value.trim() || null } }); m.hide(); toast('Sesión agregada'); verPaq(); changed(); }
          catch (x) { m2.querySelector('[data-err]').textContent = x.message; }
        };
      }));
    }
    verHist();
    el.querySelector('[data-tabs]').onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; el.querySelectorAll('[data-t]').forEach((x) => x.classList.toggle('active', x === b)); b.dataset.t === 'hist' ? verHist() : verPaq(); };
  }

  const t = C.table({ el: view.querySelector('[data-tabla]'), base: '', entity: 'clients', title: 'cliente', newText: 'Nuevo cliente', readOnly: false, emptyIcon: 'bi-person-lines-fill', empty: 'Aún no hay clientes. Se crean solos con cada reserva.',
    source: { list: () => cit('/staff/clients'), save: (row, out) => cit(row ? `/staff/clients/${row.id}` : '/staff/clients', { method: row ? 'PATCH' : 'POST', body: out }), remove: (row) => cit(`/staff/clients/${row.id}`, { method: 'DELETE' }) },
    fields: [{ k: 'name', label: 'Nombre', required: true, full: true }, { k: 'phone', label: 'Celular' }, { k: 'email', label: 'Correo', type: 'email' }],
    columns: [
      { label: 'Nombre', main: true, html: (r) => esc(r.name) },
      { label: 'Celular', html: (r) => (r.phone ? esc(r.phone) : '<span class="text-body-secondary">—</span>') },
      { label: 'Correo', html: (r) => (r.email ? esc(r.email) : '<span class="text-body-secondary">—</span>') }],
    rowActions: (r) => `<button class="btn btn-sm btn-outline-primary" data-act="ficha" title="Ficha: historial y paquetes" aria-label="Ficha"><i class="bi bi-person-vcard"></i></button>`,
    onAction: (a, row) => ficha(row, () => t.load()),
    onChanged: () => resumen() });
  t.load();
  async function resumen() {
    const rows = await cit('/staff/clients').catch(() => []);
    const mes = new Date().toISOString().slice(0, 7);
    C.kpis(view.querySelector('[data-kpis]'), [['Clientes', C.num(rows.length), '', 'bi-people'], ['Nuevos este mes', C.num(rows.filter((r) => String(r.created_at || '').startsWith(mes)).length), '', 'bi-person-plus'], ['Con celular', C.num(rows.filter((r) => r.phone).length), '', 'bi-phone']]);
  }
  resumen();
});
