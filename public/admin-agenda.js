// Agenda (línea de tiempo por especialista) + los modales que se abren desde ahí: asignar
// espacio a una cita, mover, añadir cita, y gestión de bloqueos. Ver la nota de scope en
// admin.js — por eso todo cuelga de un solo `window.Agenda = (function(){...})()`.
window.Agenda = (function () {
  const { api, toast, timeToMin, minToHHMM, formatAMPM, formatHourAMPM, formatDateHuman, todayISO, dateToISO, layoutOverlaps, effectiveHours } = window.CDC;

  const ROWPX = 150;
  const DOW_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const MES_LABELS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const STATUS_LABELS = { confirmed: "Confirmada", pending_confirmation: "Pendiente de confirmar", completed: "Completada", cancelled: "Cancelada", "no-show": "Inasistencia", reagendar: "Por reagendar" };

  // Grilla visual de horarios (verde=libre, gris=ocupado) para Bloqueos/Añadir cita/Mover cita.
  // serviceId opcional: con servicio usa /public/availability (respeta su duración); sin
  // servicio (Bloqueos no tiene uno) usa /staff/day-occupancy (grilla genérica de 30 min). A
  // diferencia de la reserva del cliente, acá NADA queda deshabilitado — el staff puede elegir
  // un horario marcado ocupado igual, para corregir datos o forzar un caso puntual.
  async function renderSlotGrid(container, { specialistId, serviceId, date, selected, onPick }) {
    if (!specialistId || !date) { container.innerHTML = `<p class="text-muted small mb-0">Elige especialista y fecha.</p>`; return; }
    container.innerHTML = `<p class="text-muted small mb-0">Cargando…</p>`;
    const data = serviceId
      ? await api(`/public/availability?serviceId=${serviceId}&specialistId=${specialistId}&date=${date}`).catch(() => ({ allSlots: [] }))
      : await api(`/staff/day-occupancy?specialistId=${specialistId}&date=${date}`).catch(() => ({ allSlots: [] }));
    const slots = data.allSlots || [];
    if (!slots.length) { container.innerHTML = `<p class="text-muted small mb-0">Sin horarios ese día.</p>`; return; }
    container.innerHTML = slots.map((s) =>
      `<button type="button" class="btn slot-btn ${s.available ? "available" : "unavailable"} ${selected === s.time ? "active" : ""}" data-slot="${s.time}">${s.time}</button>`
    ).join("");
    container.querySelectorAll(".slot-btn").forEach((b) => b.onclick = () => {
      container.querySelectorAll(".slot-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      onPick(b.dataset.slot);
    });
  }

  let currentDate = new Date(); currentDate.setHours(0, 0, 0, 0);
  let viewMode = "day";
  let activeSpecialist = "all";
  let specialistsCache = [];
  let spacesCache = [];
  let spaceTypesCache = [];
  let businessCache = null;
  let exceptionsCache = [];

  async function loadCatalog() {
    [specialistsCache, spacesCache, spaceTypesCache, businessCache, exceptionsCache] = await Promise.all([
      api("/staff/specialists").catch(() => []),
      api("/staff/spaces").catch(() => []),
      api("/staff/space-types").catch(() => []),
      api("/staff/settings").catch(() => null),
      api("/staff/date-exceptions").catch(() => []),
    ]);
  }

  async function render() {
    await loadCatalog();
    renderFilter();
    renderDayNav();
    await renderTimeline();
    renderBlockForm();
  }

  function renderFilter() {
    const chip = (id, label, avatar, color) => `
      <button class="chip ${activeSpecialist === id ? "active" : ""}" data-sp="${id}">
        ${avatar ? `<span class="mini-avatar" style="background:${color}">${avatar}</span>` : ""}${label}
      </button>`;
    document.getElementById("specialistFilter").innerHTML =
      chip("all", "Todos") + specialistsCache.map((sp) => chip(sp.id, sp.name, sp.avatar, sp.color)).join("");
    document.querySelectorAll("#specialistFilter .chip").forEach((b) => (b.onclick = () => {
      activeSpecialist = b.dataset.sp; renderFilter(); renderTimeline();
    }));
  }

  function renderDayNav() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (viewMode === "multi") {
      const end = new Date(currentDate); end.setDate(currentDate.getDate() + 3);
      document.getElementById("agendaDayLabel").textContent =
        `${String(currentDate.getDate()).padStart(2, "0")} ${MES_LABELS[currentDate.getMonth()]} — ${String(end.getDate()).padStart(2, "0")} ${MES_LABELS[end.getMonth()]}`;
    } else {
      const same = dateToISO(currentDate) === dateToISO(today);
      document.getElementById("agendaDayLabel").textContent =
        `${DOW_LABELS[currentDate.getDay()]} ${String(currentDate.getDate()).padStart(2, "0")} ${MES_LABELS[currentDate.getMonth()]}` + (same ? " · Hoy" : "");
    }
    document.getElementById("viewModeDayBtn").classList.toggle("active", viewMode === "day");
    document.getElementById("viewModeMultiBtn").classList.toggle("active", viewMode === "multi");

    const strip = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today); d.setDate(today.getDate() + i);
      const active = dateToISO(d) === dateToISO(currentDate);
      strip.push(`<button class="chip ${active ? "active" : ""}" data-date="${dateToISO(d)}">${i === 0 ? "Hoy" : DOW_LABELS[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}</button>`);
    }
    document.getElementById("dayStrip").innerHTML = strip.join("");
    document.querySelectorAll("#dayStrip .chip").forEach((b) => (b.onclick = () => goToDate(b.dataset.date)));
  }

  function goToDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    currentDate = new Date(y, m - 1, d);
    renderDayNav(); renderTimeline();
  }

  const rangeStartH = () => (businessCache ? businessCache.open_hour - 1 : 8);
  const rangeEndH = () => (businessCache ? businessCache.close_hour + 1 : 20);
  const totalHeight = () => (rangeEndH() - rangeStartH()) * ROWPX;

  function hourTicksHtml() {
    const ticks = [];
    for (let h = rangeStartH(); h <= rangeEndH(); h++) {
      ticks.push(`<div class="agenda-hour-tick" style="top:${(h - rangeStartH()) * ROWPX}px;">${formatHourAMPM(((h % 24) + 24) % 24)}</div>`);
    }
    return ticks.join("");
  }

  function closedBandsHtml(hours) {
    if (!hours) return `<div class="agenda-closed-band" style="top:0px; height:${totalHeight()}px;"></div>`;
    const openTop = (hours.open - rangeStartH()) * ROWPX;
    const closeTop = (hours.close - rangeStartH()) * ROWPX;
    return `<div class="agenda-closed-band" style="top:0px; height:${openTop}px;"></div>
      <div class="agenda-closed-band" style="top:${closeTop}px; height:${totalHeight() - closeTop}px;"></div>`;
  }

  function nowLineHtml() {
    const now = new Date();
    const nowM = now.getHours() * 60 + now.getMinutes();
    const startM = rangeStartH() * 60, endM = rangeEndH() * 60;
    if (nowM < startM || nowM > endM) return "";
    return `<div class="agenda-now-line" style="top:${((nowM - startM) / 60) * ROWPX}px;"></div>`;
  }

  function typeLabel(key) { return spaceTypesCache.find((t) => t.key === key)?.label || key; }
  function typeColor(key) { return spaceTypesCache.find((t) => t.key === key)?.color || "var(--primary)"; }
  // Mismo formato "Tipo:Nombre" (ej. "General:M1") que en la pestaña Espacio, y el color viene
  // del tipo de esa mesa — así el badge de la Agenda se ve igual que el cuadro en el plano.
  function spaceInfo(id) {
    const s = spacesCache.find((s) => s.id === id);
    if (!s) return null;
    return { name: `${typeLabel(s.type)}:${s.label}`, color: typeColor(s.type) };
  }

  function apptCardHTML(a, compact) {
    const cls = { confirmed: "", completed: "st-completed", cancelled: "st-cancelled", "no-show": "st-no-show", reagendar: "st-reagendar", pending_confirmation: "st-pending" }[a.status] || "";
    const badgeStyle = a.status === "confirmed" ? "background:rgba(15,82,87,.1);color:var(--primary);"
      : a.status === "completed" ? "background:#f0eee6;color:var(--muted);"
      : a.status === "reagendar" || a.status === "pending_confirmation" ? "background:#fff3d6;color:#8a6d1f;" : "background:#f4e6e3;color:var(--danger);";
    const space = spaceInfo(a.space_id);
    // Si es una sesión de tratamiento, se muestra su etiqueta ("Sesión 2: Aplicación") en vez del
    // nombre genérico del servicio — así se distinguen entre sí en la Agenda.
    const title = a.session_label || a.service_name;
    // En citas cortas (ej. 15-20 min) no cabe toda la ficha sin que el texto se corte — se
    // muestra una versión de una sola línea con lo esencial (hora + servicio + cliente).
    if (compact) {
      return `
        <div class="appt-card compact ${cls}" data-appt="${a.id}">
          <span class="appt-time">${formatAMPM(a.start)}</span>
          <span class="appt-title">${title}</span>
          <span class="appt-meta"><i class="bi bi-person"></i> ${a.client_name}</span>
        </div>`;
    }
    const spaceBadge = space
      ? `<span class="badge rounded-pill" style="background:${space.color};color:#fff;"><i class="bi bi-geo-alt-fill"></i> ${space.name}</span>`
      : `<span class="badge rounded-pill" style="background:#f4e6e3;color:var(--accent);"><i class="bi bi-geo-alt"></i> Sin espacio</span>`;
    return `
      <div class="appt-card ${cls}" data-appt="${a.id}">
        <div class="appt-time">${formatAMPM(a.start)} - ${formatAMPM(a.end)}</div>
        <div class="appt-title">${title}</div>
        <div class="appt-meta">
          <span><i class="bi bi-person"></i> ${a.client_name}</span>
          <span><span class="mini-avatar" style="background:${a.specialist_color}"></span> ${a.specialist_name}</span>
          <span class="badge rounded-pill" style="${badgeStyle}">${STATUS_LABELS[a.status] || a.status}</span>
          ${spaceBadge}
          ${a.pending_move_date ? `<span class="badge rounded-pill" style="background:#fff3d6;color:#8a6d1f;"><i class="bi bi-hourglass-split"></i> Propuesta pendiente</span>` : ""}
        </div>
      </div>`;
  }

  function blockCardHTML(b) {
    return `<div class="block-card">
      <div class="appt-time">${formatAMPM(b.start)} - ${formatAMPM(b.end)}</div>
      <div class="appt-title"><i class="bi bi-slash-circle"></i> ${b.reason || "Bloqueado"}</div>
    </div>`;
  }

  function trackContentHtml(appts, blocks) {
    const startM = rangeStartH() * 60;
    const apptsHtml = layoutOverlaps(appts, (a) => a.start, (a) => a.end).map(({ ref: a, sM, eM, col, cols }) => {
      const top = ((sM - startM) / 60) * ROWPX;
      const height = Math.max(30, ((eM - sM) / 60) * ROWPX);
      const width = 100 / cols, left = col * width;
      return `<div class="agenda-tl-item ${a._conflict ? "conflict" : ""}" style="top:${top}px; height:${height}px; left:calc(${left}% + 2px); width:calc(${width}% - 4px);">${apptCardHTML(a, height < 56)}</div>`;
    }).join("");
    const blocksHtml = blocks.map((b) => {
      const sM = timeToMin(b.start), eM = timeToMin(b.end);
      const top = ((sM - startM) / 60) * ROWPX;
      const height = Math.max(30, ((eM - sM) / 60) * ROWPX);
      return `<div class="agenda-tl-item" style="top:${top}px; height:${height}px; left:2px; width:calc(100% - 4px);">${blockCardHTML(b)}</div>`;
    }).join("");
    return apptsHtml + blocksHtml;
  }

  // Reusado también por Calendario (vista previa del día) — arma head+body de la línea de tiempo
  // de un día concreto para las columnas (especialistas) dadas.
  async function buildDaySchedule(dateISO, cols) {
    const gridCols = `64px repeat(${cols.length}, minmax(160px,1fr))`;
    const [list, blocks] = await Promise.all([
      api(`/staff/appointments?date=${dateISO}`).catch(() => []),
      api("/staff/blocks").catch(() => []),
    ]);
    const filtered = list.filter((a) => cols.some((sp) => sp.id === a.specialist_id));

    const headHtml = `
      <div class="agenda-head-row" style="grid-template-columns:${gridCols}">
        <div class="hour-label">Hora</div>
        ${cols.map((sp) => `<div class="col-head"><span class="mini-avatar" style="background:${sp.color}">${sp.avatar}</span> ${sp.name}</div>`).join("")}
      </div>`;

    const isToday = dateISO === todayISO();
    const tracks = cols.map((sp) => {
      const hours = effectiveHours(businessCache, exceptionsCache, dateISO, sp.id, sp);
      const appts = filtered.filter((a) => a.specialist_id === sp.id);
      const spBlocks = blocks.filter((b) => b.specialist_id === sp.id && b.date === dateISO);
      return `<div class="agenda-day-track" style="height:${totalHeight()}px; --agenda-rowpx:${ROWPX}px;">
        ${closedBandsHtml(hours)}
        ${trackContentHtml(appts, spBlocks)}
        ${isToday ? nowLineHtml() : ""}
      </div>`;
    }).join("");

    const bodyHtml = `<div style="display:grid; grid-template-columns:${gridCols}; position:relative;">
      <div class="agenda-hour-labels" style="height:${totalHeight()}px;">${hourTicksHtml()}</div>${tracks}
    </div>`;
    return { headHtml, bodyHtml, count: filtered.length };
  }

  async function renderTimeline() {
    if (viewMode === "multi") await renderMultiDayView(); else await renderSingleDayView();
  }

  async function renderSingleDayView() {
    const cols = activeSpecialist === "all" ? specialistsCache : specialistsCache.filter((sp) => sp.id === activeSpecialist);
    const { headHtml, bodyHtml, count } = await buildDaySchedule(dateToISO(currentDate), cols);
    document.getElementById("totalApptsBadge").innerHTML = `<i class="bi bi-calendar2-check"></i> ${count} cita${count === 1 ? "" : "s"}`;
    document.getElementById("agendaHead").innerHTML = headHtml;
    document.getElementById("agendaFull").innerHTML = bodyHtml;
    wireApptClicks();
  }

  async function renderMultiDayView() {
    const days = [0, 1, 2, 3].map((i) => { const d = new Date(currentDate); d.setDate(currentDate.getDate() + i); return d; });
    const gridCols = `64px repeat(${days.length}, minmax(200px,1fr))`;
    const dayISOs = days.map(dateToISO);
    const [all, blocks] = await Promise.all([
      Promise.all(dayISOs.map((iso) => api(`/staff/appointments?date=${iso}`).catch(() => []))),
      api("/staff/blocks").catch(() => []),
    ]);
    const list = all.flat().filter((a) => activeSpecialist === "all" || a.specialist_id === activeSpecialist);
    document.getElementById("totalApptsBadge").innerHTML = `<i class="bi bi-calendar2-range"></i> ${list.length} citas en 4 días`;

    const today = todayISO();
    document.getElementById("agendaHead").innerHTML = `
      <div class="agenda-head-row" style="grid-template-columns:${gridCols}">
        <div class="hour-label">Hora</div>
        ${days.map((d) => `<div class="col-head">${DOW_LABELS[d.getDay()]} ${String(d.getDate()).padStart(2, "0")} ${MES_LABELS[d.getMonth()]}${dateToISO(d) === today ? ' <span class="badge rounded-pill" style="background:rgba(15,82,87,.1);color:var(--primary);font-size:.62rem;">Hoy</span>' : ""}</div>`).join("")}
      </div>`;

    const blocksFiltered = blocks.filter((b) => activeSpecialist === "all" || b.specialist_id === activeSpecialist);
    const tracks = days.map((d) => {
      const iso = dateToISO(d);
      const appts = list.filter((a) => a.date === iso);
      const hours = effectiveHours(businessCache, exceptionsCache, iso, null);
      return `<div class="agenda-day-track" style="height:${totalHeight()}px; --agenda-rowpx:${ROWPX}px;">
        ${closedBandsHtml(hours)}
        ${trackContentHtml(appts, blocksFiltered.filter((b) => b.date === iso))}
        ${iso === today ? nowLineHtml() : ""}
      </div>`;
    }).join("");

    document.getElementById("agendaFull").innerHTML = `<div style="display:grid; grid-template-columns:${gridCols}; position:relative;">
      <div class="agenda-hour-labels" style="height:${totalHeight()}px;">${hourTicksHtml()}</div>${tracks}
    </div>`;
    wireApptClicks();
  }

  function wireApptClicks() {
    document.querySelectorAll("[data-appt]").forEach((el) => (el.onclick = () => AssignSpace.open(el.dataset.appt)));
  }

  function prevDay() { currentDate.setDate(currentDate.getDate() - (viewMode === "multi" ? 4 : 1)); renderDayNav(); renderTimeline(); }
  function nextDay() { currentDate.setDate(currentDate.getDate() + (viewMode === "multi" ? 4 : 1)); renderDayNav(); renderTimeline(); }
  function goToday() { currentDate = new Date(); currentDate.setHours(0, 0, 0, 0); renderDayNav(); renderTimeline(); }
  function setViewMode(mode) { viewMode = mode; renderDayNav(); renderTimeline(); }

  document.getElementById("agendaPrevBtn").onclick = prevDay;
  document.getElementById("agendaNextBtn").onclick = nextDay;
  document.getElementById("agendaTodayBtn").onclick = goToday;
  document.getElementById("viewModeDayBtn").onclick = () => setViewMode("day");
  document.getElementById("viewModeMultiBtn").onclick = () => setViewMode("multi");

  /* ---------- Bloqueos ---------- */
  function renderBlockForm() {
    document.getElementById("blockSpecialist").innerHTML = specialistsCache.map((sp) => `<option value="${sp.id}">${sp.name}</option>`).join("");
    document.getElementById("blockDate").value = document.getElementById("blockDate").value || todayISO();
    renderBlocksList();
    renderBlockSlotGrid();
  }
  function renderBlockSlotGrid() {
    renderSlotGrid(document.getElementById("blockSlotGrid"), {
      specialistId: document.getElementById("blockSpecialist").value,
      date: document.getElementById("blockDate").value,
      selected: document.getElementById("blockStart").value,
      onPick: (time) => { document.getElementById("blockStart").value = time; },
    });
  }
  document.getElementById("blockSpecialist").onchange = renderBlockSlotGrid;
  document.getElementById("blockDate").onchange = renderBlockSlotGrid;
  async function renderBlocksList() {
    const blocks = await api("/staff/blocks").catch(() => []);
    const wrap = document.getElementById("blocksList");
    wrap.innerHTML = blocks.length ? "" : `<p class="text-muted">Sin bloqueos activos.</p>`;
    blocks.forEach((b) => {
      const sp = specialistsCache.find((s) => s.id === b.specialist_id);
      const row = document.createElement("div");
      row.className = "d-flex justify-content-between border-top py-2";
      row.innerHTML = `<span>${sp ? sp.name : "-"} · ${formatDateHuman(b.date)} · ${formatAMPM(b.start)}–${formatAMPM(b.end)} <span class="text-muted">(${b.reason || "Bloqueado"})</span></span>`;
      const btn = document.createElement("button");
      btn.className = "btn btn-sm btn-link text-danger p-0";
      btn.innerHTML = `<i class="bi bi-trash"></i>`;
      btn.onclick = async () => { await api(`/staff/blocks/${b.id}`, { method: "DELETE" }); toast("Bloqueo eliminado."); renderBlocksList(); renderTimeline(); };
      row.appendChild(btn);
      wrap.appendChild(row);
    });
  }
  document.getElementById("blockAddBtn").onclick = async () => {
    const specialistId = document.getElementById("blockSpecialist").value;
    const date = document.getElementById("blockDate").value;
    const start = document.getElementById("blockStart").value;
    const end = document.getElementById("blockEnd").value;
    const reason = document.getElementById("blockReason").value.trim() || "Bloqueado";
    if (!specialistId || !date || !start || !end) return toast("Faltan datos del bloqueo.", false);
    await api("/staff/blocks", { method: "POST", body: { specialist_id: specialistId, date, start, end, reason } });
    document.getElementById("blockReason").value = "";
    toast("Bloqueo aplicado.");
    renderBlocksList(); renderTimeline(); renderBlockSlotGrid();
  };

  /* ---------- Añadir cita ---------- */
  let walkInServices = [];
  function renderWalkInSlotGrid() {
    renderSlotGrid(document.getElementById("walkInSlotGrid"), {
      specialistId: document.getElementById("walkInSpecialist").value,
      serviceId: document.getElementById("walkInService").value,
      date: document.getElementById("walkInDate").value,
      selected: document.getElementById("walkInStart").value,
      onPick: (time) => { document.getElementById("walkInStart").value = time; },
    });
  }
  document.getElementById("walkInService").onchange = renderWalkInSlotGrid;
  document.getElementById("walkInSpecialist").onchange = renderWalkInSlotGrid;
  document.getElementById("walkInDate").onchange = renderWalkInSlotGrid;

  document.getElementById("walkInOpenBtn").onclick = async () => {
    await loadCatalog();
    walkInServices = await api("/staff/services").catch(() => []);
    document.getElementById("walkInName").value = "";
    document.getElementById("walkInEmail").value = "";
    document.getElementById("walkInPhone").value = "";
    document.getElementById("walkInService").innerHTML = walkInServices.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
    document.getElementById("walkInSpecialist").innerHTML = specialistsCache.map((sp) => `<option value="${sp.id}">${sp.name}</option>`).join("");
    document.getElementById("walkInDate").value = dateToISO(currentDate);
    document.getElementById("walkInStart").value = "";
    new bootstrap.Modal(document.getElementById("walkInModal")).show();
    renderWalkInSlotGrid();
  };
  document.getElementById("walkInSaveBtn").onclick = async () => {
    const clientName = document.getElementById("walkInName").value.trim();
    const date = document.getElementById("walkInDate").value;
    const start = document.getElementById("walkInStart").value;
    const serviceId = document.getElementById("walkInService").value;
    const specialistId = document.getElementById("walkInSpecialist").value;
    if (!clientName) return toast("Escribe el nombre del cliente.", false);
    if (!date || !start) return toast("Elige fecha y hora.", false);
    if (!serviceId || !specialistId) return toast("Crea primero un servicio y un especialista.", false);
    try {
      await api("/staff/appointments", { method: "POST", body: {
        clientName, clientEmail: document.getElementById("walkInEmail").value.trim(),
        clientPhone: document.getElementById("walkInPhone").value.trim(), serviceId, specialistId, date, start,
      } });
      bootstrap.Modal.getInstance(document.getElementById("walkInModal")).hide();
      toast("Cita registrada.");
      renderTimeline();
    } catch (e) { toast(e.message, false); }
  };

  /* ---------- Mover cita ---------- */
  const MoveBox = (() => {
    let currentApptId = null, modal = null, currentAppt = null;
    function renderGrid() {
      renderSlotGrid(document.getElementById("moveSlotGrid"), {
        specialistId: currentAppt.specialist_id,
        serviceId: currentAppt.service_id,
        date: document.getElementById("moveModalDate").value,
        selected: document.getElementById("moveModalStart").value,
        onPick: (time) => { document.getElementById("moveModalStart").value = time; },
      });
    }
    function open(apptId, appt) {
      currentApptId = apptId;
      currentAppt = appt;
      document.getElementById("moveModalDate").value = appt.date;
      document.getElementById("moveModalStart").value = appt.start;
      modal = modal || new bootstrap.Modal(document.getElementById("moveModal"));
      modal.show();
      renderGrid();
    }
    async function send(sendMessage) {
      const date = document.getElementById("moveModalDate").value;
      const start = document.getElementById("moveModalStart").value;
      if (!date || !start) return toast("Elige la fecha y hora nueva a proponer.", false);
      try {
        await api(`/staff/appointments/${currentApptId}/move`, { method: "POST", body: { date, start, sendMessage } });
        modal.hide();
        toast(sendMessage ? "Propuesta enviada por WhatsApp." : "Propuesta guardada (sin enviar mensaje).");
        renderTimeline();
      } catch (e) { toast(e.message, false); }
    }
    return { open, send, renderGrid };
  })();
  document.getElementById("moveSendBtn").onclick = () => MoveBox.send(true);
  document.getElementById("moveNoSendBtn").onclick = () => MoveBox.send(false);
  document.getElementById("moveModalDate").onchange = () => MoveBox.renderGrid();

  /* ---------- Asignar espacio / detalle de cita ---------- */
  const AssignSpace = (() => {
    let currentAppt = null, modal = null, pendingSpaceId = null, pendingAction = null;

    async function open(apptId) {
      const appt = await findAppt(apptId);
      if (!appt) return;
      currentAppt = appt;
      pendingSpaceId = appt.space_id;
      pendingAction = null;
      await renderModal();
      modal = modal || new bootstrap.Modal(document.getElementById("assignSpaceModal"));
      modal.show();
    }

    async function findAppt(apptId) {
      const rows = await api(`/staff/appointments?date=${dateToISO(currentDate)}`).catch(() => []);
      let found = rows.find((a) => a.id === apptId);
      if (found) return found;
      // Vista de varios días: buscamos en los próximos 4.
      for (let i = 0; i < 4; i++) {
        const d = new Date(currentDate); d.setDate(currentDate.getDate() + i);
        const day = await api(`/staff/appointments?date=${dateToISO(d)}`).catch(() => []);
        found = day.find((a) => a.id === apptId);
        if (found) return found;
      }
      return null;
    }

    async function renderModal() {
      const a = currentAppt;
      document.getElementById("assignSpaceTitle").textContent = a.client_name;
      document.getElementById("assignSpaceCurrent").innerHTML =
        `<p class="text-muted small mb-0"><i class="bi bi-clock"></i> ${formatAMPM(a.start)} - ${formatAMPM(a.end)} · ${a.service_name}</p>`;

      const clientBox = document.getElementById("assignSpaceClientInfo");
      const initials = a.client_name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      let statsHtml = "";
      if (a.client_id) {
        const stats = await api(`/staff/clients/${a.client_id}/stats`).catch(() => null);
        if (stats) {
          statsHtml = `<div class="d-flex flex-wrap gap-2">
            <span class="badge rounded-pill" style="background:#f0eee6;color:var(--ink);">${stats.attended} asistió</span>
            ${stats.noShow ? `<span class="badge rounded-pill" style="background:#f4e6e3;color:var(--danger);"><i class="bi bi-exclamation-circle"></i> ${stats.noShow} inasistencia${stats.noShow === 1 ? "" : "s"}</span>` : ""}
            <span class="badge rounded-pill" style="background:${stats.cancelled ? "#f4e6e3" : "#f0eee6"};color:${stats.cancelled ? "var(--danger)" : "var(--muted)"};">${stats.cancelled} cancelaciones</span>
          </div>`;
        }
      }
      clientBox.innerHTML = `<div class="p-3" style="background:#f9f8f3;border-radius:10px;">
        <div class="d-flex align-items-center gap-2 mb-3">
          <span class="avatar-badge" style="background:var(--primary)">${initials}</span>
          <div><div class="fw-semibold">${a.client_name}</div></div>
        </div>
        ${statsHtml}
        ${(a.client_email || a.client_phone) ? `<div class="text-muted small mt-3">
          ${a.client_email ? `<div><i class="bi bi-envelope"></i> ${a.client_email}</div>` : ""}
          ${a.client_phone ? `<div><i class="bi bi-telephone"></i> ${a.client_phone}</div>` : ""}
        </div>` : ""}</div>`;

      const pendingBox = document.getElementById("assignSpacePendingMove");
      if (a.pending_move_date) {
        pendingBox.style.display = "block";
        pendingBox.innerHTML = `<div class="p-3" style="background:#fff8ec;border:1px solid var(--amber);border-radius:10px;">
          <p class="small fw-semibold mb-1" style="color:#8a6d1f;"><i class="bi bi-hourglass-split"></i> Propuesta pendiente</p>
          <p class="small text-muted mb-2">Se propuso mover a <strong>${formatDateHuman(a.pending_move_date)} · ${formatAMPM(a.pending_move_start)}</strong>.</p>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-brand flex-fill" id="asAcceptMove"><i class="bi bi-check-lg"></i> Cliente aceptó</button>
            <button class="btn btn-sm btn-outline-danger flex-fill" id="asRejectMove"><i class="bi bi-x-lg"></i> Cliente rechazó</button>
          </div></div>`;
        document.getElementById("asAcceptMove").onclick = () => runAction(`/staff/appointments/${a.id}/accept-move`);
        document.getElementById("asRejectMove").onclick = () => runAction(`/staff/appointments/${a.id}/reject-move`);
      } else { pendingBox.style.display = "none"; pendingBox.innerHTML = ""; }

      renderActions();

      document.getElementById("assignSpaceConfirmTime").innerHTML = `
        <label class="label-xs d-block mb-1">Fecha y hora del recordatorio automático</label>
        <div class="d-flex align-items-center gap-2 flex-wrap">
          <input type="date" class="form-control form-control-sm" style="max-width:160px;" id="asConfirmDate" value="${a.confirmation_date || ""}">
          <input type="time" class="form-control form-control-sm" style="max-width:140px;" id="asConfirmTime" value="${a.confirmation_time || ""}">
          <button class="btn btn-sm btn-outline-dark" id="asConfirmSave">Guardar</button>
        </div>`;
      document.getElementById("asConfirmSave").onclick = async () => {
        const date = document.getElementById("asConfirmDate").value;
        const time = document.getElementById("asConfirmTime").value;
        if (!date || !time) return toast("Elige fecha y hora.", false);
        await api(`/staff/appointments/${a.id}`, { method: "PATCH", body: { confirmation_date: date, confirmation_time: time } });
        toast("Recordatorio actualizado.");
      };

      const messages = await api(`/staff/appointments/${a.id}/messages`).catch(() => []);
      const logBox = document.getElementById("assignSpaceMessageLog");
      if (messages.length) {
        logBox.style.display = "block";
        logBox.innerHTML = `<label class="label-xs d-block mb-2"><i class="bi bi-clock-history"></i> Mensajes enviados</label>
          <div class="d-flex flex-column gap-2">${messages.map((m) => `
            <div class="p-2 small" style="background:#f9f8f3;border-radius:8px;">
              <div class="text-muted" style="font-size:.68rem;">${new Date(m.sent_at).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })} · ${m.status === "sent" ? "enviado" : m.status === "skipped" ? "omitido" : "falló"}</div>
              <div>${m.body}</div>
            </div>`).join("")}</div>`;
      } else { logBox.style.display = "none"; logBox.innerHTML = ""; }

      await renderMiniMap();
    }

    function renderActions() {
      const a = currentAppt;
      const actionable = ["confirmed", "reagendar"].includes(a.status) && !a.pending_move_date;
      const box = document.getElementById("assignSpaceActions");

      if (pendingAction) {
        const intros = { cancel: "Vas a cancelar esta cita.", reschedule: "Vas a dejarla por reagendar.", reopen: "Vas a reabrir esta cita cancelada." };
        box.innerHTML = `<div class="w-100">
          <p class="small mb-2">${intros[pendingAction]}<br><i class="bi bi-question-circle"></i> ¿Avisar a ${a.client_name} por WhatsApp?</p>
          <div class="d-flex gap-2">
            <button class="btn btn-brand btn-sm flex-fill" id="asConfirmYes">Sí, enviar</button>
            <button class="btn btn-outline-dark btn-sm flex-fill" id="asConfirmNo">No enviar</button>
          </div>
          <button class="btn btn-sm btn-link text-muted p-0 mt-2" id="asConfirmBack">Volver</button>
        </div>`;
        document.getElementById("asConfirmYes").onclick = () => confirmAction(true);
        document.getElementById("asConfirmNo").onclick = () => confirmAction(false);
        document.getElementById("asConfirmBack").onclick = () => { pendingAction = null; renderActions(); };
        return;
      }

      box.innerHTML = actionable ? `
        ${a.status === "reagendar" ? `<p class="text-muted small w-100 mb-1"><i class="bi bi-hourglass-split"></i> Esta cita quedó por reagendar.</p>` : ""}
        <button class="btn btn-outline-danger btn-sm flex-fill" id="asCancel"><i class="bi bi-x-circle"></i> Cancelar</button>
        <button class="btn btn-outline-warning btn-sm flex-fill" id="asReschedule"><i class="bi bi-arrow-repeat"></i> Reagendar</button>
        <button class="btn btn-outline-primary btn-sm flex-fill" id="asMove"><i class="bi bi-calendar2-event"></i> Mover</button>
        <button class="btn btn-outline-success btn-sm flex-fill" id="asComplete"><i class="bi bi-check2-circle"></i> Completada</button>
      ` : a.status === "pending_confirmation" && !a.pending_move_date ? `
        <p class="text-muted small w-100 mb-2"><i class="bi bi-hourglass-split"></i> Pendiente de que el cliente confirme por ${a.confirm_channel === "email" ? "correo" : "WhatsApp"}.</p>
        <button class="btn btn-outline-danger btn-sm flex-fill" id="asCancel"><i class="bi bi-x-circle"></i> Cancelar</button>
      ` : a.pending_move_date ? "" : a.status === "cancelled" ? `
        <p class="text-muted small w-100 mb-2"><i class="bi bi-info-circle"></i> Esta cita está cancelada.</p>
        <button class="btn btn-outline-primary btn-sm flex-fill" id="asReopen"><i class="bi bi-arrow-counterclockwise"></i> Reabrir</button>
      ` : `<p class="text-muted small w-100 mb-0"><i class="bi bi-info-circle"></i> Esta cita ya está ${a.status === "completed" ? "completada" : "marcada como inasistencia"}.
        ${a.status === "completed" ? `</p><div class="form-check mt-2"><input class="form-check-input" type="checkbox" id="asPaid" ${a.paid ? "checked" : ""}><label class="form-check-label small" for="asPaid">Ya se cobró</label></div>` : "</p>"}`;

      if (document.getElementById("asCancel")) document.getElementById("asCancel").onclick = () => { pendingAction = "cancel"; renderActions(); };
      if (document.getElementById("asReschedule")) document.getElementById("asReschedule").onclick = () => { pendingAction = "reschedule"; renderActions(); };
      if (document.getElementById("asMove")) document.getElementById("asMove").onclick = () => { modal.hide(); MoveBox.open(a.id, a); };
      if (document.getElementById("asComplete")) document.getElementById("asComplete").onclick = () => runAction(`/staff/appointments/${a.id}/complete`);
      if (document.getElementById("asReopen")) document.getElementById("asReopen").onclick = () => { pendingAction = "reopen"; renderActions(); };
      if (document.getElementById("asPaid")) document.getElementById("asPaid").onchange = async (e) => {
        await api(`/staff/appointments/${a.id}`, { method: "PATCH", body: { paid: e.target.checked } });
        toast(e.target.checked ? "Marcada como pagada." : "Marcada como no pagada.");
      };
    }

    async function confirmAction(sendMessage) {
      const a = currentAppt;
      const endpoint = { cancel: "cancel", reschedule: "reschedule", reopen: "reopen" }[pendingAction];
      pendingAction = null;
      await runAction(`/staff/appointments/${a.id}/${endpoint}`, { sendMessage });
    }

    async function runAction(path, body) {
      try {
        await api(path, { method: "POST", body: body || {} });
        currentAppt = await findAppt(currentAppt.id) || currentAppt;
        await renderModal();
        renderTimeline();
      } catch (e) { toast(e.message, false); }
    }

    async function renderMiniMap() {
      const a = currentAppt;
      const spaces = spacesCache.length ? spacesCache : (spacesCache = await api("/staff/spaces").catch(() => []));
      document.getElementById("assignSpaceEmpty").style.display = spaces.length ? "none" : "block";
      const map = document.getElementById("assignSpaceMiniMap");
      if (!spaces.length) { map.innerHTML = ""; document.getElementById("assignSpaceSaveWrap").style.display = "none"; return; }

      const dayAppts = await api(`/staff/appointments?date=${a.date}`).catch(() => []);
      const svc = await api("/staff/services").catch(() => []);
      const service = svc.find((s) => s.id === a.service_id);
      let allowed = null;
      try { allowed = service ? JSON.parse(service.allowed_space_types || "[]") : null; } catch { allowed = null; }
      if (allowed && !allowed.length) allowed = null;

      const MINI_CELL = 22;
      const maxX = Math.max(...spaces.map((t) => t.x + t.w), 1);
      const maxY = Math.max(...spaces.map((t) => t.y + t.h), 1);
      map.className = "mini-map";
      map.style.width = `${maxX * MINI_CELL}px`;
      map.style.height = `${maxY * MINI_CELL}px`;
      map.style.backgroundSize = `${MINI_CELL}px ${MINI_CELL}px`;
      const overlaps = (o) => timeToMin(o.start) < timeToMin(a.end) && timeToMin(a.start) < timeToMin(o.end);
      map.innerHTML = spaces.map((t) => {
        const occupiedBy = dayAppts.find((o) => o.space_id === t.id && o.id !== a.id && ["confirmed", "completed", "pending_confirmation"].includes(o.status) && overlaps(o));
        const compatible = !allowed || allowed.includes(t.type);
        const canSelect = compatible && !occupiedBy;
        const isSelected = pendingSpaceId === t.id;
        const color = isSelected ? "#1e6b45" : canSelect ? "#3a9a6d" : "#b7bbb2";
        const name = `${typeLabel(t.type)}:${t.label}`;
        return `<div class="mini-map-table ${isSelected ? "current" : ""} ${!canSelect ? "incompatible" : ""}" data-id="${t.id}" data-can="${canSelect}"
          style="left:${t.x * MINI_CELL}px; top:${t.y * MINI_CELL}px; width:${t.w * MINI_CELL}px; height:${t.h * MINI_CELL}px; background:${color};"
          title="${name}${occupiedBy ? " · Ocupado por " + occupiedBy.client_name : ""}">${name}</div>`;
      }).join("");
      map.querySelectorAll(".mini-map-table").forEach((el) => (el.onclick = () => {
        if (el.dataset.can !== "true") { toast("Ese espacio no está disponible.", false); return; }
        pendingSpaceId = pendingSpaceId === el.dataset.id ? null : el.dataset.id;
        renderMiniMap();
      }));
      document.getElementById("assignSpaceRemoveBtn").style.display = pendingSpaceId ? "inline-block" : "none";
      document.getElementById("assignSpaceRemoveBtn").onclick = () => { pendingSpaceId = null; renderMiniMap(); };
      document.getElementById("assignSpaceSaveWrap").style.display = pendingSpaceId !== a.space_id ? "block" : "none";
    }

    document.getElementById("assignSpaceSaveBtn").onclick = async () => {
      await api(`/staff/appointments/${currentAppt.id}`, { method: "PATCH", body: { space_id: pendingSpaceId } });
      currentAppt.space_id = pendingSpaceId;
      toast(pendingSpaceId ? "Espacio guardado." : "Espacio removido.");
      await renderMiniMap();
      renderTimeline();
    };

    return { open };
  })();

  return { render, buildDaySchedule, renderTimeline, renderSlotGrid, businessCache: () => businessCache, exceptionsCache: () => exceptionsCache };
})();
