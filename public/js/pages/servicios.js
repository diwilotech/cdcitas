// Servicios: lo que ofreces (con foto y espacios permitidos), los especialistas (días, horario y servicios), los paquetes por sesiones y las promociones.
DW.ready.then(async (me) => {
  if (!me.pageAllowed) return;
  const { esc, toast, modal } = window.App;
  const C = window.App.Crud, CC = window.CC, { cit } = CC;
  const view = document.querySelector('[data-view]');
  const RO = me.business.readOnly;
  await CC.mapa();
  const money = (n) => `$${Number(n || 0).toLocaleString('es-CO')}`;
  const crud = (ruta) => ({
    list: () => cit(`/staff/${ruta}`),
    save: (row, out) => cit(row ? `/staff/${ruta}/${row.id}` : `/staff/${ruta}`, { method: row ? 'PATCH' : 'POST', body: out }),
    remove: (row) => cit(`/staff/${ruta}/${row.id}`, { method: 'DELETE' }),
  });
  const vacio = '<span class="text-body-secondary">—</span>';
  const nombresDe = (ids, lista) => ids.map((id) => lista.find((s) => s.id === id)?.name).filter(Boolean);

  const SECC = {
    async servicios(host) {
      const tipos = await cit('/staff/space-types').catch(() => []);
      const base = crud('services');
      C.table({ el: host, base: '', entity: 'services', title: 'servicio', newText: 'Nuevo servicio', readOnly: RO, emptyIcon: 'bi-scissors', empty: 'Aún no hay servicios.',
        source: { ...base, list: async () => (await base.list()).map((r) => ({ ...r, allowed_space_types: CC.parse(r.allowed_space_types, []) })), async save(row, out) {
          const body = { ...out, duration_min: Math.max(0, +out.duration_min || 0), price: Math.max(0, +out.price || 0), cancel_window_hours: Math.max(0, +out.cancel_window_hours || 0), reminder_hours: Math.max(0, +out.reminder_hours || 0), reminder_2_minutes: out.reminder_2_minutes ? +out.reminder_2_minutes : null };
          delete body.photo;
          if (out.photo) body.photo_key = await CC.subir(out.photo);
          if (!body.name) throw new Error('Ponle un nombre al servicio.');
          return base.save(row, body);
        } },
        fields: [{ k: 'name', label: 'Nombre', required: true, full: true }, { k: 'duration_min', label: 'Duración (min)', type: 'int', default: 30 }, { k: 'price', label: 'Precio', type: 'money', default: 0 },
          { k: 'cancel_window_hours', label: 'Cancelar hasta (horas antes)', type: 'int', default: 4 }, { k: 'reminder_hours', label: 'Recordatorio (horas antes)', type: 'int', default: 12 },
          { k: 'reminder_2_minutes', label: '2.º recordatorio (minutos antes)', type: 'int', hint: 'opcional' }, { k: 'featured', label: 'Destacado', type: 'bool', check: 'Mostrar destacado en la tarjeta' },
          { k: 'allowed_space_types', label: 'Espacios permitidos', type: 'multi', options: tipos.map((t) => [t.key, t.label]), empty: 'Crea tipos de espacio en Agenda → Espacio. Sin ninguno, admite cualquiera.', full: true },
          { k: 'photo', label: 'Foto', type: 'image', full: true, hint: 'opcional' }],
        columns: [
          { label: 'Servicio', main: true, html: (r) => `<div class="d-flex align-items-center gap-2">${r.photo_key ? `<img src="${esc(CC.fotoUrl(r.photo_key))}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:8px">` : ''}<div>${esc(r.name)}${r.featured ? ' <i class="bi bi-star-fill text-warning" title="Destacado"></i>' : ''}</div></div>` },
          { label: 'Precio', html: (r) => money(r.price) }, { label: 'Duración', html: (r) => `${r.duration_min} min` },
          { label: 'Avisos', html: (r) => `<span class="small text-body-secondary">Cancela ${r.cancel_window_hours} h · recuerda ${r.reminder_hours} h</span>` },
          { label: 'Espacios', html: (r) => { const a = CC.parse(r.allowed_space_types, []); return a.length ? a.map((k) => `<span class="badge text-bg-light me-1">${esc(tipos.find((t) => t.key === k)?.label || k)}</span>`).join('') : '<span class="small text-body-secondary">Cualquiera</span>'; } }],
        defaults: () => ({ allowed_space_types: [] }),
      }).load();
    },
    async especialistas(host) {
      const servicios = await cit('/staff/services').catch(() => []);
      const vinculos = {};
      await Promise.all((await cit('/staff/specialists').catch(() => [])).map(async (s) => { vinculos[s.id] = await cit(`/staff/specialists/${s.id}/services`).catch(() => []); }));
      const base = crud('specialists');
      C.table({ el: host, base: '', entity: 'specialists', title: 'especialista', newText: 'Nuevo especialista', readOnly: RO, emptyIcon: 'bi-person-badge', empty: 'Aún no hay especialistas.',
        source: { ...base, async save(row, out) {
          if (!out.name) throw new Error('Ponle un nombre.');
          if (!out.work_days.length) throw new Error('Marca al menos un día que trabaje.');
          const oh = out.open_hour === '' ? null : Number(out.open_hour), ch = out.close_hour === '' ? null : Number(out.close_hour);
          if ((oh === null) !== (ch === null)) throw new Error('Pon apertura y cierre, o deja los dos vacíos.');
          if (oh !== null && !(ch > oh)) throw new Error('La hora de cierre debe ser después de la apertura.');
          const body = { name: out.name, role: out.role, avatar: (out.avatar || out.name.slice(0, 2)).slice(0, 2).toUpperCase(), color: out.color, work_days: out.work_days, open_hour: oh, close_hour: ch };
          const r = await base.save(row, body);
          const id = row?.id || r.id;
          await cit(`/staff/specialists/${id}/services`, { method: 'PUT', body: { serviceIds: out.serviceIds } });
        }, async list() { const rows = await base.list(); await Promise.all(rows.map(async (s) => { vinculos[s.id] = await cit(`/staff/specialists/${s.id}/services`).catch(() => []); })); return rows.map((r) => ({ ...r, serviceIds: vinculos[r.id] || [], work_days: CC.parse(r.work_days, [1, 2, 3, 4, 5, 6]) })); } },
        fields: [{ k: 'name', label: 'Nombre', required: true }, { k: 'role', label: 'Cargo' }, { k: 'avatar', label: 'Iniciales', hint: '2 letras' }, { k: 'color', label: 'Color', type: 'color' },
          { k: 'work_days', label: 'Días que trabaja', type: 'days', full: true }, { k: 'open_hour', label: 'Entra (hora 0-24)', type: 'int', hint: 'vacío = horario del negocio' }, { k: 'close_hour', label: 'Sale (hora 0-24)', type: 'int' },
          { k: 'serviceIds', label: 'Servicios que hace', type: 'multi', options: servicios.map((s) => [s.id, s.name]), empty: 'Crea servicios primero.', full: true }],
        defaults: () => ({ work_days: [1, 2, 3, 4, 5, 6], color: '#0f5257', serviceIds: [] }),
        columns: [
          { label: 'Especialista', main: true, html: (r) => `<div class="d-flex align-items-center gap-2"><span class="rounded-circle d-inline-flex align-items-center justify-content-center text-white small fw-bold" style="width:34px;height:34px;background:${esc(r.color)}">${esc(r.avatar)}</span><div>${esc(r.name)}<div class="small text-body-secondary fw-normal">${esc(r.role || '')}</div></div></div>` },
          { label: 'Días', html: (r) => ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].filter((_, i) => r.work_days.includes(i)).join(' ') },
          { label: 'Horario', html: (r) => (r.open_hour != null ? `${r.open_hour}:00 – ${r.close_hour}:00` : '<span class="text-body-secondary small">Del negocio</span>') },
          { label: 'Servicios', html: (r) => { const n = nombresDe(r.serviceIds, servicios); return n.length ? n.map((x) => `<span class="badge text-bg-light me-1">${esc(x)}</span>`).join('') : '<span class="small text-body-secondary">Sin servicios</span>'; } }],
      }).load();
    },
    async paquetes(host) {
      const servicios = await cit('/staff/services').catch(() => []);
      const base = crud('treatments');
      const t = C.table({ el: host, base: '', entity: 'treatments', title: 'paquete', newText: 'Nuevo paquete', readOnly: RO, emptyIcon: 'bi-box-seam', empty: 'Aún no hay paquetes (ej. «3 cortes»).',
        source: { ...base, async list() { const rows = await base.list(); return Promise.all(rows.map(async (r) => ({ ...r, ids: await cit(`/staff/treatments/${r.id}/services`).catch(() => []) }))); } },
        columns: [{ label: 'Paquete', main: true, html: (r) => `${esc(r.name)}${r.description ? `<div class="small text-body-secondary fw-normal">${esc(r.description)}</div>` : ''}` },
          { label: 'Servicios', html: (r) => { const n = nombresDe(r.ids, servicios); return n.length ? esc(n.join(' → ')) : '<span class="text-body-secondary small">Sin servicios elegidos</span>'; } },
          { label: 'Estado', html: (r) => (r.active ? C.chip('ok', 'Activo') : C.chip('free', 'Inactivo')) }],
        onEdit: (row, changed) => {
          if (RO) return;
          let ids = [...(row?.ids || [])];
          const { el, m } = modal(`<form><div class="modal-header border-0 pb-0"><h2 class="modal-title h5">${row ? 'Editar paquete' : 'Nuevo paquete'}</h2><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body">
            <label class="form-label small mb-1">Nombre</label><input class="form-control mb-2" name="name" required value="${esc(row?.name || '')}" placeholder="3 cortes, Depilación láser…">
            <label class="form-label small mb-1">Descripción</label><textarea class="form-control mb-2" name="description" rows="2">${esc(row?.description || '')}</textarea>
            <label class="form-label small mb-1">Servicios, en orden (se puede repetir el mismo)</label>
            <div class="input-group mb-2"><select class="form-select" data-svc>${servicios.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><button type="button" class="btn btn-outline-primary" data-add>+ Agregar</button></div>
            <div data-cart class="d-flex flex-column gap-1 mb-2"></div>
            <div class="form-check form-switch"><input class="form-check-input" type="checkbox" name="active" id="pqa" ${row?.active ?? true ? 'checked' : ''}><label class="form-check-label" for="pqa">Activo (se puede asignar a clientes)</label></div><div class="small text-danger mt-2" data-err></div></div>
            <div class="modal-footer border-0 pt-0 justify-content-between"><span>${row ? '<button type="button" class="btn btn-outline-danger btn-sm" data-del><i class="bi bi-trash me-1"></i>Borrar</button>' : ''}</span><span><button type="button" class="btn btn-light" data-bs-dismiss="modal">Cancelar</button> <button class="btn btn-primary">Guardar</button></span></div></form>`, { size: 'modal-lg' });
          const pintar = () => { el.querySelector('[data-cart]').innerHTML = ids.length ? ids.map((id, i) => `<div class="d-flex align-items-center justify-content-between bg-body-tertiary rounded px-2 py-1"><span class="small">${i + 1}. ${esc(servicios.find((s) => s.id === id)?.name || '?')}</span><button type="button" class="btn-close" style="font-size:.6rem" data-q="${i}" aria-label="Quitar"></button></div>`).join('') : '<p class="small text-body-secondary mb-0">Todavía no agregaste servicios.</p>'; };
          pintar();
          el.querySelector('[data-add]').onclick = () => { const v = el.querySelector('[data-svc]').value; if (v) { ids.push(v); pintar(); } };
          el.querySelector('[data-cart]').onclick = (e) => { const b = e.target.closest('[data-q]'); if (b) { ids.splice(+b.dataset.q, 1); pintar(); } };
          el.querySelector('[data-del]')?.addEventListener('click', async () => { if (!(await window.App.confirm({ title: '¿Borrar este paquete?', text: 'No se puede deshacer.' }))) return; try { await base.remove(row); m.hide(); toast('Borrado'); changed(); } catch (x) { el.querySelector('[data-err]').textContent = x.message; } });
          el.querySelector('form').onsubmit = async (e) => {
            e.preventDefault(); const f = e.target;
            try { const r = await base.save(row, { name: f.name.value.trim(), description: f.description.value.trim() || null, active: f.active.checked }); await cit(`/staff/treatments/${row?.id || r.id}/services`, { method: 'PUT', body: { serviceIds: ids } }); m.hide(); toast('Guardado'); changed(); }
            catch (x) { el.querySelector('[data-err]').textContent = x.message; }
          };
        } });
      t.load();
    },
    promociones(host) {
      const hoy = new Date().toISOString().slice(0, 10);
      const base = crud('promotions');
      C.table({ el: host, base: '', entity: 'promotions', title: 'promoción', newText: 'Nueva promoción', readOnly: RO, emptyIcon: 'bi-megaphone', empty: 'Aún no hay promociones. Se ven en la reserva y en «mis citas» mientras estén vigentes.',
        source: { ...base, save: (row, out) => { if (!out.title) throw new Error('Ponle un título a la promoción.'); return base.save(row, { ...out, description: out.description || null, code: out.code || null, starts_at: out.starts_at || null, ends_at: out.ends_at || null }); } },
        fields: [{ k: 'title', label: 'Título', required: true, full: true, placeholder: '20% en cortes los martes' }, { k: 'description', label: 'Descripción', type: 'long' }, { k: 'code', label: 'Código', placeholder: 'MARTES20' },
          { k: 'starts_at', label: 'Desde', type: 'date' }, { k: 'ends_at', label: 'Hasta', type: 'date' }, { k: 'active', label: 'Activa', type: 'bool', check: 'Se muestra a los clientes', default: true }],
        columns: [{ label: 'Promoción', main: true, html: (r) => `${esc(r.title)}${r.description ? `<div class="small text-body-secondary fw-normal">${esc(r.description)}</div>` : ''}` },
          { label: 'Código', html: (r) => (r.code ? `<code>${esc(r.code)}</code>` : vacio) },
          { label: 'Vigencia', html: (r) => [r.starts_at, r.ends_at].filter(Boolean).map(CC.dia).join(' – ') || vacio },
          { label: 'Estado', html: (r) => (r.active && (!r.starts_at || r.starts_at <= hoy) && (!r.ends_at || r.ends_at >= hoy) ? C.chip('ok', 'Vigente') : C.chip('free', 'Inactiva')) }],
      }).load();
    },
  };
  view.innerHTML = '<div data-sec></div>';
  const seg = document.querySelector('[data-seg]');
  C.seg(seg, [['servicios', 'Servicios'], ['especialistas', 'Especialistas'], ['paquetes', 'Paquetes'], ['promociones', 'Promociones']], (k) => { location.hash = k; SECC[k](view.querySelector('[data-sec]')); }, location.hash.slice(1) in SECC ? location.hash.slice(1) : 'servicios');
  SECC[location.hash.slice(1) in SECC ? location.hash.slice(1) : 'servicios'](view.querySelector('[data-sec]'));
});
