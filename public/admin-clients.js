// Panel de Clientes: lista + detalle (datos, estadísticas, historial de citas) y Paquetes
// (paquetes de varias sesiones — cada sesión es una cita normal, enlazada por treatment_id).
// El selector de horario de las sesiones reusa Agenda.renderSlotGrid (misma grilla verde/gris que
// ya usan Bloqueos/Añadir cita/Mover cita) en vez de duplicar esa lógica acá.
window.Clients = (function () {
  const { api, toast, formatAMPM, formatDateHuman } = window.CDC;

  const STATUS_LABELS = { confirmed: "Confirmada", pending_confirmation: "Pendiente", completed: "Completada", cancelled: "Cancelada", "no-show": "Inasistencia", reagendar: "Por reagendar" };

  let clientsCache = [];
  let servicesCache = [];
  let specialistsCache = [];
  let treatmentTemplatesCache = [];
  let clientTreatmentsCache = [];
  let currentClientId = null;
  let currentEnrollmentId = null;
  let clientDetailModal = null, assignTreatmentModal = null, addSessionModal = null;

  async function render() {
    [clientsCache, servicesCache, specialistsCache, treatmentTemplatesCache] = await Promise.all([
      api("/staff/clients").catch(() => []),
      api("/staff/services").catch(() => []),
      api("/staff/specialists").catch(() => []),
      api("/staff/treatments").catch(() => []),
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

  /* ---------- Paquetes (inscripciones del cliente en plantillas de Reglas) ---------- */
  async function renderTreatments() {
    clientTreatmentsCache = await api(`/staff/clients/${currentClientId}/treatments`).catch(() => []);
    const wrap = document.getElementById("clientTreatmentsList");
    wrap.innerHTML = clientTreatmentsCache.length ? clientTreatmentsCache.map((t) => {
      const done = t.sessions.filter((s) => s.status === "completed").length;
      const total = t.services.length;
      const progress = total ? `${done} de ${total} sesiones` : `${t.sessions.length} sesión(es)`;
      return `
        <div class="card-panel p-3 mb-2">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-semibold">${t.treatment_name}</div>
              <div class="text-muted small">${progress}${t.treatment_description ? " · " + t.treatment_description : ""}</div>
            </div>
            <button class="btn btn-sm btn-outline-dark flex-shrink-0" data-add-session="${t.id}">+ Sesión</button>
          </div>
          ${t.sessions.length ? `<div class="mt-2 small">${t.sessions.map((s) => `
            <div class="d-flex justify-content-between border-top py-1">
              <span>${s.session_label || s.service_name} · ${formatDateHuman(s.date)} ${formatAMPM(s.start)}</span>
              <span class="text-muted">${STATUS_LABELS[s.status] || s.status}</span>
            </div>`).join("")}</div>` : ""}
        </div>`;
    }).join("") : `<p class="text-muted small mb-0">Sin paquetes todavía.</p>`;
    wrap.querySelectorAll("[data-add-session]").forEach((el) => (el.onclick = () => openAddSession(el.dataset.addSession)));
  }

  document.getElementById("addTreatmentOpenBtn").onclick = () => {
    const active = treatmentTemplatesCache.filter((t) => t.active);
    if (!active.length) return toast("Todavía no hay paquetes creados — arma uno en Reglas → Paquetes.", false);
    document.getElementById("assignTreatmentSelect").innerHTML = selectOptions(active);
    updateAssignTreatmentHint();
    assignTreatmentModal = assignTreatmentModal || new bootstrap.Modal(document.getElementById("assignTreatmentModal"));
    assignTreatmentModal.show();
  };
  async function updateAssignTreatmentHint() {
    const id = document.getElementById("assignTreatmentSelect").value;
    const serviceIds = id ? await api(`/staff/treatments/${id}/services`).catch(() => []) : [];
    const names = serviceIds.map((sid) => servicesCache.find((s) => s.id === sid)?.name).filter(Boolean);
    document.getElementById("assignTreatmentServicesHint").textContent = names.length ? "Incluye: " + names.join(", ") : "Este paquete todavía no tiene servicios elegidos.";
  }
  document.getElementById("assignTreatmentSelect").onchange = updateAssignTreatmentHint;

  document.getElementById("assignTreatmentSaveBtn").onclick = async () => {
    const treatmentId = document.getElementById("assignTreatmentSelect").value;
    if (!treatmentId) return toast("Elige un paquete.", false);
    try {
      await api(`/staff/clients/${currentClientId}/treatments`, { method: "POST", body: { treatmentId } });
      assignTreatmentModal.hide();
      toast("Paquete asignado.");
      renderTreatments();
    } catch (e) { toast(e.message, false); }
  };

  function openAddSession(enrollmentId) {
    currentEnrollmentId = enrollmentId;
    const enrollment = clientTreatmentsCache.find((t) => t.id === enrollmentId);
    document.getElementById("addSessionLabel").value = "";
    document.getElementById("addSessionService").innerHTML = selectOptions(enrollment ? enrollment.services : []);
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
    if (!serviceId) return toast("Este paquete no tiene servicios — agrégalos en Reglas → Paquetes.", false);
    if (!date || !start) return toast("Elige fecha y hora.", false);
    try {
      await api(`/staff/client-treatments/${currentEnrollmentId}/sessions`, { method: "POST", body: {
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
