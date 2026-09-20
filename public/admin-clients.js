// Panel de Clientes: lista + detalle (datos, estadísticas, historial de citas) y Tratamientos
// (paquetes de varias sesiones — cada sesión es una cita normal, enlazada por treatment_id).
// El selector de horario de las sesiones reusa Agenda.renderSlotGrid (misma grilla verde/gris que
// ya usan Bloqueos/Añadir cita/Mover cita) en vez de duplicar esa lógica acá.
window.Clients = (function () {
  const { api, toast, formatAMPM, formatDateHuman } = window.CDC;

  const STATUS_LABELS = { confirmed: "Confirmada", pending_confirmation: "Pendiente", completed: "Completada", cancelled: "Cancelada", "no-show": "Inasistencia", reagendar: "Por reagendar" };

  let clientsCache = [];
  let servicesCache = [];
  let specialistsCache = [];
  let currentClientId = null;
  let currentTreatmentId = null;
  let clientDetailModal = null, newTreatmentModal = null, addSessionModal = null;

  async function render() {
    [clientsCache, servicesCache, specialistsCache] = await Promise.all([
      api("/staff/clients").catch(() => []),
      api("/staff/services").catch(() => []),
      api("/staff/specialists").catch(() => []),
    ]);
    renderClientsList();
  }

  function renderClientsList() {
    const q = document.getElementById("clientSearch").value.trim().toLowerCase();
    const list = q
      ? clientsCache.filter((c) => (c.name || "").toLowerCase().includes(q) || (c.phone || "").includes(q))
      : clientsCache;
    const wrap = document.getElementById("clientsList");
    if (!list.length) { wrap.innerHTML = `<p class="text-muted small">Sin clientes${q ? " que calcen con esa búsqueda" : " todavía"}.</p>`; return; }
    wrap.innerHTML = list.map((c) => `
      <div class="card-panel p-3 d-flex justify-content-between align-items-center" style="cursor:pointer;" data-open-client="${c.id}">
        <div>
          <div class="fw-semibold">${c.name}</div>
          <div class="text-muted small">${c.phone || "sin celular"}${c.email ? " · " + c.email : ""}</div>
        </div>
        <i class="bi bi-chevron-right text-muted"></i>
      </div>`).join("");
    wrap.querySelectorAll("[data-open-client]").forEach((el) => (el.onclick = () => openClientDetail(el.dataset.openClient)));
  }
  document.getElementById("clientSearch").addEventListener("input", renderClientsList);

  function selectOptions(list) {
    return list.map((x) => `<option value="${x.id}">${x.name}</option>`).join("");
  }

  async function openClientDetail(id) {
    currentClientId = id;
    const client = clientsCache.find((c) => c.id === id);
    if (!client) return;
    document.getElementById("clientDetailName").textContent = client.name;
    document.getElementById("clientDetailNameInput").value = client.name;
    document.getElementById("clientDetailPhone").value = client.phone || "";
    document.getElementById("clientDetailEmail").value = client.email || "";

    clientDetailModal = clientDetailModal || new bootstrap.Modal(document.getElementById("clientDetailModal"));
    clientDetailModal.show();

    const [stats, history] = await Promise.all([
      api(`/staff/clients/${id}/stats`).catch(() => null),
      api(`/staff/appointments?clientId=${id}`).catch(() => []),
    ]);
    if (stats) {
      document.getElementById("clientStatAttended").textContent = stats.attended;
      document.getElementById("clientStatNoShow").textContent = stats.noShow;
      document.getElementById("clientStatCancelled").textContent = stats.cancelled;
      document.getElementById("clientStatLast").textContent = stats.lastDate ? formatDateHuman(stats.lastDate) : "—";
    }
    document.getElementById("clientHistoryList").innerHTML = history.length ? history.map((a) => `
      <div class="d-flex justify-content-between border-top py-2 small">
        <span>${a.session_label || a.service_name} · ${formatDateHuman(a.date)} ${formatAMPM(a.start)}</span>
        <span class="text-muted">${STATUS_LABELS[a.status] || a.status}</span>
      </div>`).join("") : `<p class="text-muted small mb-0">Sin citas todavía.</p>`;

    renderTreatments();
  }

  document.getElementById("clientDetailSaveBtn").onclick = async () => {
    const name = document.getElementById("clientDetailNameInput").value.trim();
    if (!name) return toast("Escribe el nombre.", false);
    try {
      await api(`/staff/clients/${currentClientId}`, { method: "PATCH", body: {
        name, phone: document.getElementById("clientDetailPhone").value.trim(),
        email: document.getElementById("clientDetailEmail").value.trim(),
      } });
      toast("Datos guardados.");
      await render();
      const c = clientsCache.find((c) => c.id === currentClientId);
      if (c) document.getElementById("clientDetailName").textContent = c.name;
    } catch (e) { toast(e.message, false); }
  };

  /* ---------- Tratamientos ---------- */
  async function renderTreatments() {
    const treatments = await api(`/staff/clients/${currentClientId}/treatments`).catch(() => []);
    const wrap = document.getElementById("clientTreatmentsList");
    wrap.innerHTML = treatments.length ? treatments.map((t) => {
      const done = t.sessions.filter((s) => s.status === "completed").length;
      const progress = t.total_sessions ? `${done} de ${t.total_sessions} sesiones` : `${t.sessions.length} sesión(es)`;
      return `
        <div class="card-panel p-3 mb-2">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-semibold">${t.name}</div>
              <div class="text-muted small">${progress}${t.notes ? " · " + t.notes : ""}</div>
            </div>
            <button class="btn btn-sm btn-outline-dark flex-shrink-0" data-add-session="${t.id}">+ Sesión</button>
          </div>
          ${t.sessions.length ? `<div class="mt-2 small">${t.sessions.map((s) => `
            <div class="d-flex justify-content-between border-top py-1">
              <span>${s.session_label || s.service_name} · ${formatDateHuman(s.date)} ${formatAMPM(s.start)}</span>
              <span class="text-muted">${STATUS_LABELS[s.status] || s.status}</span>
            </div>`).join("")}</div>` : ""}
        </div>`;
    }).join("") : `<p class="text-muted small mb-0">Sin tratamientos todavía.</p>`;
    wrap.querySelectorAll("[data-add-session]").forEach((el) => (el.onclick = () => openAddSession(el.dataset.addSession)));
  }

  document.getElementById("addTreatmentOpenBtn").onclick = () => {
    document.getElementById("newTreatmentName").value = "";
    document.getElementById("newTreatmentNotes").value = "";
    document.getElementById("newTreatmentTotal").value = "";
    document.getElementById("newTreatmentSessionLabel").value = "Sesión 1";
    document.getElementById("newTreatmentService").innerHTML = selectOptions(servicesCache);
    document.getElementById("newTreatmentSpecialist").innerHTML = selectOptions(specialistsCache);
    document.getElementById("newTreatmentDate").value = "";
    document.getElementById("newTreatmentStart").value = "";
    document.getElementById("newTreatmentSlotGrid").innerHTML = `<p class="text-muted small mb-0">Elige fecha.</p>`;
    newTreatmentModal = newTreatmentModal || new bootstrap.Modal(document.getElementById("newTreatmentModal"));
    newTreatmentModal.show();
  };
  function renderNewTreatmentGrid() {
    window.Agenda.renderSlotGrid(document.getElementById("newTreatmentSlotGrid"), {
      specialistId: document.getElementById("newTreatmentSpecialist").value,
      serviceId: document.getElementById("newTreatmentService").value,
      date: document.getElementById("newTreatmentDate").value,
      selected: document.getElementById("newTreatmentStart").value,
      onPick: (time) => { document.getElementById("newTreatmentStart").value = time; },
    });
  }
  document.getElementById("newTreatmentService").onchange = renderNewTreatmentGrid;
  document.getElementById("newTreatmentSpecialist").onchange = renderNewTreatmentGrid;
  document.getElementById("newTreatmentDate").onchange = renderNewTreatmentGrid;

  document.getElementById("newTreatmentSaveBtn").onclick = async () => {
    const name = document.getElementById("newTreatmentName").value.trim();
    const date = document.getElementById("newTreatmentDate").value;
    const start = document.getElementById("newTreatmentStart").value;
    const serviceId = document.getElementById("newTreatmentService").value;
    const specialistId = document.getElementById("newTreatmentSpecialist").value;
    if (!name) return toast("Ponle un nombre al tratamiento.", false);
    if (!date || !start) return toast("Elige fecha y hora de la primera sesión.", false);
    if (!serviceId || !specialistId) return toast("Crea primero un servicio y un especialista.", false);
    try {
      const total = document.getElementById("newTreatmentTotal").value;
      const treatment = await api("/staff/treatments", { method: "POST", body: {
        client_id: currentClientId, name, notes: document.getElementById("newTreatmentNotes").value.trim() || null,
        total_sessions: total ? parseInt(total, 10) : null, status: "active",
      } });
      await api(`/staff/treatments/${treatment.id}/sessions`, { method: "POST", body: {
        serviceId, specialistId, date, start,
        sessionLabel: document.getElementById("newTreatmentSessionLabel").value.trim() || null,
      } });
      newTreatmentModal.hide();
      toast("Tratamiento creado.");
      renderTreatments();
    } catch (e) { toast(e.message, false); }
  };

  function openAddSession(treatmentId) {
    currentTreatmentId = treatmentId;
    document.getElementById("addSessionLabel").value = "";
    document.getElementById("addSessionService").innerHTML = selectOptions(servicesCache);
    document.getElementById("addSessionSpecialist").innerHTML = selectOptions(specialistsCache);
    document.getElementById("addSessionDate").value = "";
    document.getElementById("addSessionStart").value = "";
    document.getElementById("addSessionSlotGrid").innerHTML = `<p class="text-muted small mb-0">Elige fecha.</p>`;
    addSessionModal = addSessionModal || new bootstrap.Modal(document.getElementById("addSessionModal"));
    addSessionModal.show();
  }
  function renderAddSessionGrid() {
    window.Agenda.renderSlotGrid(document.getElementById("addSessionSlotGrid"), {
      specialistId: document.getElementById("addSessionSpecialist").value,
      serviceId: document.getElementById("addSessionService").value,
      date: document.getElementById("addSessionDate").value,
      selected: document.getElementById("addSessionStart").value,
      onPick: (time) => { document.getElementById("addSessionStart").value = time; },
    });
  }
  document.getElementById("addSessionService").onchange = renderAddSessionGrid;
  document.getElementById("addSessionSpecialist").onchange = renderAddSessionGrid;
  document.getElementById("addSessionDate").onchange = renderAddSessionGrid;

  document.getElementById("addSessionSaveBtn").onclick = async () => {
    const date = document.getElementById("addSessionDate").value;
    const start = document.getElementById("addSessionStart").value;
    const serviceId = document.getElementById("addSessionService").value;
    const specialistId = document.getElementById("addSessionSpecialist").value;
    if (!date || !start) return toast("Elige fecha y hora.", false);
    try {
      await api(`/staff/treatments/${currentTreatmentId}/sessions`, { method: "POST", body: {
        serviceId, specialistId, date, start,
        sessionLabel: document.getElementById("addSessionLabel").value.trim() || null,
      } });
      addSessionModal.hide();
      toast("Sesión agregada.");
      renderTreatments();
    } catch (e) { toast(e.message, false); }
  };

  return { render };
})();
