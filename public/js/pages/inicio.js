// Inicio = el módulo Dashboard de Diwilo Modulos (saludo con la marca, alertas, resúmenes de Finanzas, Marketing…, accesos directos).
// Aquí se registra lo PROPIO de Citas: a la izquierda el Asistente IA (abre el chat) y a su lado una tarjeta pequeña por módulo
// (dos filas de cuatro, bajan si son más). Al tocar un módulo se ve SU AGENTE: ejecutarlo, preguntarle con texto, sus ejecuciones y aprobar lo que propone; luego va el calendario.
window.DwSinFigura = true;    // sin «Así funciona tu negocio»
window.DwSinComoVa = true;    // sin las tarjetas de «Cómo va»
window.DwSinAgentes = true;   // la sección de agentes la pinta este archivo
(window.DwDashboard = window.DwDashboard || []).push({
  id: 'citas',
  titulo: 'Tu negocio',
  async mount(host, { me }) {
    const { api, esc } = window.App;
    const C = window.App.Crud;
    const BASES = new Set(['dashboard', 'inicio', 'ai', 'marca', 'ajustes']);
    const COLORES = ['#22D3EE', '#A78BFA', '#34D399', '#FBBF24', '#F472B6', '#FB7185', '#60A5FA', '#A3E635'];
    const mods = me.modules.filter((m) => m.ruta && !m.oculto && !BASES.has(m.id)).map((m, i) => ({ ...m, color: COLORES[i % COLORES.length] }));
    const ia = me.modules.find((m) => m.id === 'ai');
    const ir = (ruta) => { if (ruta) location.href = ruta; };
    let sel = null, AG = { agentes: [] };
    const hace = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'ahora' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`; };
    const agenteDe = (m) => AG.agentes.find((a) => a.modulo === m.id) || AG.agentes.find((a) => !a.modulo && a.herramientas.length && a.herramientas.filter((n) => n.startsWith(`${m.id}.`)).length * 2 > a.herramientas.length) || null;   // el de módulo (exacto) y, si no, un agente libre que use sobre todo sus herramientas

    host.innerHTML = `<style>
        .ac-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:16px}
        .ac-core{grid-column:1/-1}
        @media (min-width:992px){.ac-grid{grid-template-columns:repeat(5,minmax(0,1fr))}.ac-core{grid-column:span 2;grid-row:span 2}}
        .ac-core{--c:#A78BFA;display:flex;flex-direction:column;gap:10px;text-align:left;width:100%;padding:20px;border-radius:16px;border:1px solid color-mix(in srgb,var(--c) 45%,transparent);background:linear-gradient(160deg,color-mix(in srgb,var(--c) 16%,var(--bs-body-bg)),var(--bs-body-bg) 65%);color:inherit;cursor:pointer;transition:transform .12s}
        .ac-core:hover{transform:translateY(-2px)}
        .ac-core .ic{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;font-size:2rem;color:var(--c);background:color-mix(in srgb,var(--c) 15%,transparent);border:1px solid color-mix(in srgb,var(--c) 40%,transparent)}
        .ac-mod{--c:var(--dw-p,#6d28d9);display:flex;flex-direction:column;gap:2px;text-align:left;width:100%;padding:12px;border-radius:14px;border:1px solid var(--bs-border-color);background:var(--bs-body-bg);color:inherit;cursor:pointer;transition:transform .12s,border-color .12s,opacity .12s}
        .ac-mod:hover{transform:translateY(-2px);border-color:var(--c)}.ac-mod.on{border-color:var(--c);box-shadow:0 0 0 1px var(--c)}.ac-grid.sel .ac-mod:not(.on){opacity:.5}
        .ac-mod .ic{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;font-size:1.15rem;color:var(--c);background:color-mix(in srgb,var(--c) 15%,transparent);margin-bottom:6px}
        .ac-mod .n{font-weight:600}.ac-mod .v{font-size:.8rem;color:var(--bs-secondary-color)}
        .ac-det{--c:var(--dw-p,#6d28d9);margin-bottom:16px}
        .ac-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
        .ac-kpi{display:block;padding:14px;border-radius:14px;border:1px solid var(--bs-border-color);border-top:3px solid var(--c);background:var(--bs-body-bg);color:inherit;text-decoration:none}
        .ac-kpi .v{font-size:1.7rem;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}.ac-kpi .l{font-size:.85rem;color:var(--bs-secondary-color)}.ac-kpi .d{font-size:.78rem;color:var(--bs-secondary-color)}
        .ac-charts{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;margin-top:16px}
        .ac-ch{padding:14px;border-radius:14px;border:1px solid var(--bs-border-color)}
        .ac-cols{display:flex;align-items:flex-end;gap:8px;height:130px}.ac-cols>div{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;min-width:0}
        .ac-cols i{display:block;width:100%;max-width:36px;border-radius:6px 6px 3px 3px;background:var(--c)}.ac-cols small{font-size:.7rem;color:var(--bs-secondary-color);white-space:nowrap}
        .ac-ag{padding:14px;border-radius:14px;border:1px solid var(--bs-border-color);background:color-mix(in srgb,var(--c) 6%,transparent)}
        .ac-ag .pt{width:9px;height:9px;border-radius:50%;background:#34D399;display:inline-block}.ac-ag .pt.pend{background:#f59e0b}.ac-ag .pt.error{background:#dc3545}
        .ac-ch .progress-bar{background:var(--c)}
        @media (prefers-reduced-motion:reduce){.ac-core,.ac-mod{transition:none}}
      </style>
      <div class="ac-grid" data-mods>${ia ? `<button type="button" class="ac-core" data-ia><span class="ic"><i class="bi bi-cpu"></i></span><span><span class="d-block small fw-bold" style="color:var(--c);letter-spacing:.12em">ASISTENTE IA</span><span class="d-block h4 fw-bold mb-1">Pregúntale a tu negocio</span><span class="d-block text-body-secondary small">Abre el chat: te responde con los datos de todos tus módulos y hace tareas por ti.</span></span><span class="mt-auto small fw-semibold" style="color:var(--c)">Abrir el chat <i class="bi bi-arrow-right"></i></span></button>` : ''}</div>
      <div data-det></div>
      <section class="mt-4" data-sec-semana hidden><h2 class="h6 mb-3">Hoy</h2><div data-semana></div></section>`;
    const $ = (s) => host.querySelector(s);

    // El agente del módulo es lo primero: estado, ejecutar, preguntarle con texto y sus ejecuciones (lo que hizo y lo que propone)
    const ESTADO_EJ = { ok: ['success', 'Listo'], error: ['danger', 'Con error'], en_curso: ['secondary', 'Trabajando…'] };
    const PASO = { hecha: 'Hecho', consultada: 'Consultó', propuesta: 'Propone', rechazada: 'Rechazada', error: 'Error' };
    function agenteHtml(m) {
      const a = agenteDe(m);
      if (!a) return `<div class="ac-ag d-flex flex-wrap align-items-center gap-2"><i class="bi bi-robot fs-4" style="color:var(--c)"></i><div class="flex-grow-1"><div class="fw-semibold">Preparando el agente</div><div class="small text-body-secondary">Cada módulo tiene su agente: aparece aquí en cuanto el módulo tenga herramientas para ${esc(m.nombre)}.</div></div></div>`;
      return `<div class="ac-ag" data-ag="${a.id}"><div class="d-flex flex-wrap align-items-center gap-2"><span class="pt ${a.pendientes ? 'pend' : a.estado === 'error' ? 'error' : ''}"></span><div class="flex-grow-1"><div class="fw-semibold">${esc(a.nombre)}</div>
          <div class="small text-body-secondary">${a.autonomia === 'ejecutar' ? 'Actúa solo' : 'Tú apruebas lo que cambie datos'}${a.programacion !== 'manual' ? ` · ${esc(a.programacion)}` : ''} · ${a.total} ${a.total === 1 ? 'ejecución' : 'ejecuciones'} esta semana</div></div>
          <button type="button" class="btn btn-sm btn-primary" data-correr="${a.id}"><i class="bi bi-play-fill"></i> Ejecutar ahora</button>
          <a class="btn btn-sm btn-outline-secondary" href="${esc(m.ruta)}">Abrir ${esc(m.nombre)}</a>${ia ? `<a class="btn btn-sm btn-outline-secondary" href="${esc(ia.ruta)}#agentes" title="Escribe lo que debe vigilar y proponer">Estrategia</a>` : ''}</div>
        <form class="d-flex gap-2 mt-3" data-pregunta><input class="form-control" name="pedido" maxlength="500" placeholder="Pregúntale o pídele algo: ¿qué has hecho?, ¿qué está pendiente?, revisa lo vencido…" aria-label="Pregúntale al agente"><button class="btn btn-primary" type="submit"><i class="bi bi-send"></i></button></form>
        <div class="mt-3" data-ejec><div class="small text-body-secondary">Cargando ejecuciones…</div></div></div>`;
    }
    // Ejecuciones del agente: qué hizo (resumen), sus pasos y, si propone cambios, aprobar o rechazar
    async function cargarEjecuciones(id) {
      const box = host.querySelector('[data-ejec]'); if (!box) return;
      let rows = []; try { rows = (await api(`/api/ai/ejecuciones?agente=${id}`)).rows.slice(0, 8); } catch (x) { box.innerHTML = `<div class="small text-danger">${esc(x.message)}</div>`; return; }
      if (!rows.length) { box.innerHTML = '<div class="small text-body-secondary">Aún no ha trabajado. Pulsa «Ejecutar ahora» o pregúntale algo.</div>'; return; }
      box.innerHTML = rows.map((e) => `<div class="border-top pt-2 pb-2"><div class="d-flex flex-wrap align-items-center gap-2 small"><span class="badge text-bg-${(ESTADO_EJ[e.estado] || ESTADO_EJ.ok)[0]}">${(ESTADO_EJ[e.estado] || ESTADO_EJ.ok)[1]}</span><b>${hace(e.created_at)}</b><span class="text-body-secondary">${e.disparador === 'programado' ? 'programada' : e.disparador === 'manual' ? 'manual' : esc(e.disparador)}${e.por ? ` · ${esc(e.por)}` : ''}</span>${e.pendientes ? `<span class="badge text-bg-warning">${e.pendientes} por aprobar</span>` : ''}</div>
        <div class="mt-1" style="white-space:pre-wrap">${esc(e.resumen || (e.estado === 'en_curso' ? 'Trabajando…' : 'Terminó sin novedades.'))}</div>
        ${(e.pasos || []).filter((p) => p.tipo === 'escritura' || p.estado === 'error').map((p, i) => `<div class="small d-flex flex-wrap align-items-center gap-2 mt-1"><span class="badge text-bg-light">${PASO[p.estado] || esc(p.estado)}</span><code>${esc(p.herramienta)}</code><span class="text-body-secondary text-truncate" style="max-width:340px">${esc(JSON.stringify(p.args || {}))}</span>${p.estado === 'propuesta' ? `<button class="btn btn-sm btn-primary py-0" data-ap="${e.id}:${e.pasos.indexOf(p)}">Aprobar</button><button class="btn btn-sm btn-light py-0" data-re="${e.id}:${e.pasos.indexOf(p)}">Rechazar</button>` : ''}</div>`).join('')}</div>`).join('');
    }
    async function cargarAgentes() { AG = await api('/api/dashboard/agentes').catch(() => ({ agentes: [] })); }
    // Ejecutar ahora (sin pedido) o preguntarle con texto (pedido puntual); al terminar se ve su respuesta en la lista
    async function correrAgente(id, pedido, btn) {
      const marca = btn?.innerHTML; if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Trabajando…'; }
      try { await api(`/api/ai/agentes/${id}/ejecutar`, { method: 'POST', body: pedido ? { pedido } : {} }); } catch (x) { window.App.toast?.(x.message, false); }
      if (btn) { btn.disabled = false; btn.innerHTML = marca; }
      await cargarAgentes(); pintar();
    }

    function pintar() {
      $('[data-mods]').classList.toggle('sel', !!sel);
      $('[data-mods]').querySelectorAll('.ac-mod').forEach((e) => e.remove());
      $('[data-mods]').insertAdjacentHTML('beforeend', mods.map((m) => {
        const g = agenteDe(m);
        return `<button type="button" class="ac-mod ${sel === m ? 'on' : ''}" style="--c:${m.color}" data-mod="${esc(m.id)}" aria-pressed="${sel === m}"><span class="ic"><i class="bi ${esc(m.icono || 'bi-grid')}"></i></span><span class="n">${esc(m.nombre)}</span><span class="v"><i class="bi bi-circle-fill ${agenteDe(m) ? 'text-success' : 'text-secondary'}" style="font-size:.5rem"></i> ${agenteDe(m) ? `Agente activo · ${agenteDe(m).total} ${agenteDe(m).total === 1 ? 'tarea' : 'tareas'}` : 'Sin agente'}</span></button>`;
      }).join(''));

      const det = $('[data-det]');
      if (!sel) { det.innerHTML = ''; return; }
      det.innerHTML = `<div class="dw-card ac-det" style="--c:${sel.color}"><div class="d-flex flex-wrap align-items-center gap-2 mb-3"><h2 class="h6 mb-0 flex-grow-1">Agente · <span style="color:var(--c)">${esc(sel.nombre)}</span></h2><button type="button" class="btn btn-sm btn-outline-secondary" data-cerrar aria-label="Cerrar"><i class="bi bi-x-lg"></i></button></div>${agenteHtml(sel)}</div>`;
      const ag = agenteDe(sel); if (ag) cargarEjecuciones(ag.id);
    }

    host.addEventListener('submit', (e) => {
      const f = e.target.closest('[data-pregunta]'); if (!f) return; e.preventDefault();
      const pedido = f.pedido.value.trim(); if (pedido) correrAgente(f.closest('[data-ag]').dataset.ag, pedido, f.querySelector('button'));
    });

    host.addEventListener('click', (e) => {
      const co = e.target.closest('[data-correr]'); if (co) return correrAgente(co.dataset.correr, '', co);
      if (e.target.closest('[data-cerrar]')) { sel = null; return pintar(); }
      const ar = e.target.closest('[data-ap],[data-re]'); if (ar) { const [id, indice] = (ar.dataset.ap || ar.dataset.re).split(':'); ar.disabled = true;
        return api(`/api/ai/ejecuciones/${id}/aprobar`, { method: 'POST', body: { indice: Number(indice), aprobar: !!ar.dataset.ap } }).then(() => window.App.toast?.(ar.dataset.ap ? 'Aprobada y ejecutada' : 'Rechazada')).catch((x) => window.App.toast?.(x.message, false)).finally(() => cargarEjecuciones(agenteDe(sel).id)); }
      if (e.target.closest('[data-ia]')) { const f = (() => { for (const w of [window.parent, window.top]) { try { if (w.DwIA?.open) return w.DwIA; } catch (_) { /* otro origen */ } } return null; })(); return f ? f.open() : ir(ia.ruta); }
      if (e.target.closest('[data-abrir]')) return ir(sel?.ruta);
      const b = e.target.closest('[data-mod]');
      if (!b) return;
      const m = mods.find((x) => x.id === b.dataset.mod);
      sel = sel === m ? null : m;
      pintar();
    });

    pintar();
    await cargarAgentes();
    pintar();

    // El día del negocio: indicadores y agenda de hoy (propio de Citas)
    $('[data-sec-semana]').hidden = false;
    const { esc: e2, money, api: capi } = window.Cit;
    const hoy = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10);
    try {
      const [f, citas] = await Promise.all([capi('/staff/flujo'), capi(`/staff/appointments?date=${hoy}`).catch(() => [])]);
      const lista = (Array.isArray(citas) ? citas : citas.rows || []).filter((a) => ['confirmed', 'pending_confirmation', 'completed'].includes(a.status)).sort((a, b) => String(a.start).localeCompare(String(b.start)));
      C.kpis($('[data-semana]'), [
        ['Citas activas hoy', f.activeToday, 'Confirmadas', 'bi-calendar-check'],
        ['Ingresos de hoy', money(f.todayRevenue), `Ayer ${money(f.yesterdayRevenue)}`, 'bi-cash-coin'],
        ['Inasistencia', `${f.noShowRate.value}%`, 'Últimos 30 días', 'bi-person-x'],
        ['Pagos pendientes', f.pendingPayments, 'Completadas sin cobrar', 'bi-hourglass-split']]);
      $('[data-semana]').className = 'ac-kpis mb-3';
      $('[data-semana]').insertAdjacentHTML('afterend', `<div class="dw-card"><div class="d-flex justify-content-between mb-2"><h3 class="h6 mb-0"><i class="bi bi-clock me-2"></i>Agenda de hoy</h3><a href="/staff/citas.html" data-go="/staff/citas.html" class="small">Abrir la agenda</a></div>
        ${lista.length ? lista.map((x) => `<div class="d-flex gap-3 py-1 border-top"><b>${e2(x.start)}</b><span class="flex-grow-1 text-truncate">${e2(x.client_name || x.clientName || '')}</span><span class="small text-body-secondary">${e2(x.service_name || x.serviceName || '')}</span></div>`).join('') : '<div class="text-body-secondary small">No hay citas para hoy.</div>'}</div>`);
    } catch (x) { $('[data-semana]').innerHTML = `<div class="small text-danger">${e2(x.message)}</div>`; }
  },
});
