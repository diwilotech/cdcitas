// Espacio: plano del local arrastrable/redimensionable. Cada mueve/resize dispara un PATCH a
// /staff/spaces/:id (ya existe, acepta x/y/w/h/status/type/label) — no hay estado en memoria
// más allá de lo necesario para el arrastre en curso.
window.FloorPlan = (function () {
  const { api, toast, formatAMPM, todayISO, layoutOverlaps, renderColorPicker, colorAlpha, colorDarken } = window.CDC;
  // El tamaño de celda se achica en pantallas angostas para que el plano quepa sin obligar a
  // hacer scroll horizontal en el celular — antes era un canvas fijo de 1600x720px en todos lados.
  let CELL = 80;
  function updateCellSize() {
    CELL = window.innerWidth < 480 ? 44 : window.innerWidth < 768 ? 56 : window.innerWidth < 1200 ? 68 : 80;
  }
  function canvasCols() {
    const grid = document.getElementById("floorGrid");
    const viewCols = Math.max(6, Math.floor(((grid && grid.parentElement && grid.parentElement.clientWidth) || 320) / CELL));
    const maxX = spacesCache.length ? Math.max(...spacesCache.map((t) => t.x + t.w)) : 0;
    return Math.max(viewCols, maxX + 2);
  }
  function canvasRows() {
    const maxY = spacesCache.length ? Math.max(...spacesCache.map((t) => t.y + t.h)) : 0;
    return Math.max(8, maxY + 2);
  }
  function sizeCanvas() {
    const grid = document.getElementById("floorGrid");
    grid.style.width = `${canvasCols() * CELL}px`;
    grid.style.height = `${canvasRows() * CELL}px`;
    grid.style.backgroundSize = `${CELL}px ${CELL}px`;
  }
  const SHAPES = {
    square: { label: "Cuadrada", w: 3, h: 3, capacity: 2, shape: "square" },
    rectH: { label: "Rectangular horizontal", w: 5, h: 3, capacity: 6, shape: "rect-h" },
    rectV: { label: "Rectangular vertical", w: 3, h: 5, capacity: 6, shape: "rect-v" },
  };
  const STATUSES = ["libre", "ocupada", "reservada"];

  let spacesCache = [];
  let spaceTypesCache = [];
  let todayApptsCache = [];
  let editMode = false;
  let dragCtx = null, resizeCtx = null;
  let editingId = null;
  let editSpaceModal = null, scheduleModal = null;
  let editSpaceTypeModal = null;
  let editingSpaceTypeId = null;

  function typeLabel(key) { return spaceTypesCache.find((t) => t.key === key)?.label || key; }
  // El color de la mesa en el plano sale del TIPO (no es un color propio por mesa) — así todas
  // las mesas de un mismo tipo se ven igual, y cambiar el color de un tipo (pestaña Espacio →
  // Tipos de espacio) repinta de una todas las mesas que lo usan.
  function typeColor(key) { return spaceTypesCache.find((t) => t.key === key)?.color || "#0f5257"; }
  // Nombre para mostrar: "Tipo:Nombre" (ej. "General:M1") — así se identifica de una tanto el
  // tipo como la mesa puntual, sin tener que abrir el detalle.
  function spaceDisplayName(t) { return `${typeLabel(t.type)}:${t.label}`; }

  async function render() {
    [spacesCache, spaceTypesCache] = await Promise.all([
      api("/staff/spaces").catch(() => []),
      api("/staff/space-types").catch(() => []),
    ]);
    updateCellSize();
    renderSpaceTypesList();
    renderToolbar();
    renderModeUI();
    renderTables();
  }

  /* ---------- Tipos de espacio (antes vivía en Reglas — se administra acá, junto al plano) ---------- */
  function slugify(label) {
    return label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tipo";
  }

  function renderSpaceTypesList() {
    const wrap = document.getElementById("spaceTypesList");
    wrap.innerHTML = spaceTypesCache.length ? spaceTypesCache.map((t) => `
      <div class="d-flex justify-content-between align-items-center border-top py-2">
        <div class="d-flex align-items-center gap-2">
          <span style="width:16px;height:16px;border-radius:50%;flex-shrink:0;background:${t.color || "#ccc"};"></span>
          <div>
            <div class="fw-semibold">${t.label}</div>
            ${t.description ? `<div class="text-muted small mt-1">${t.description}</div>` : ""}
          </div>
        </div>
        <button class="btn btn-sm btn-outline-dark flex-shrink-0" data-edit-type="${t.id}"><i class="bi bi-pencil"></i></button>
      </div>`).join("") : `<p class="text-muted small mb-0">Sin tipos todavía — añade el primero.</p>`;
    wrap.querySelectorAll("[data-edit-type]").forEach((el) => (el.onclick = () => openEditSpaceType(el.dataset.editType)));
  }

  function pickSpaceTypeColor(color) {
    document.getElementById("editSpaceTypeColor").value = color;
    renderColorPicker(document.getElementById("editSpaceTypeColorPicker"), color, pickSpaceTypeColor);
  }

  function openEditSpaceType(id) {
    const t = spaceTypesCache.find((t) => t.id === id);
    if (!t) return;
    editingSpaceTypeId = id;
    document.getElementById("editSpaceTypeModalTitle").textContent = "Editar tipo de espacio";
    document.getElementById("editSpaceTypeDeleteBtn").style.display = "inline-block";
    document.getElementById("editSpaceTypeLabel").value = t.label;
    document.getElementById("editSpaceTypeDescription").value = t.description || "";
    pickSpaceTypeColor(t.color || "#0f5257");
    editSpaceTypeModal = editSpaceTypeModal || new bootstrap.Modal(document.getElementById("editSpaceTypeModal"));
    editSpaceTypeModal.show();
  }

  document.getElementById("addSpaceTypeOpenBtn").onclick = () => {
    editingSpaceTypeId = null;
    document.getElementById("editSpaceTypeModalTitle").textContent = "Añadir tipo de espacio";
    document.getElementById("editSpaceTypeDeleteBtn").style.display = "none";
    document.getElementById("editSpaceTypeLabel").value = "";
    document.getElementById("editSpaceTypeDescription").value = "";
    pickSpaceTypeColor("#0f5257");
    editSpaceTypeModal = editSpaceTypeModal || new bootstrap.Modal(document.getElementById("editSpaceTypeModal"));
    editSpaceTypeModal.show();
  };

  document.getElementById("editSpaceTypeSaveBtn").onclick = async () => {
    const label = document.getElementById("editSpaceTypeLabel").value.trim();
    if (!label) return toast("Ponle un nombre al tipo de espacio.", false);
    const data = {
      label,
      description: document.getElementById("editSpaceTypeDescription").value.trim() || null,
      color: document.getElementById("editSpaceTypeColor").value,
    };
    try {
      if (editingSpaceTypeId === null) await api("/staff/space-types", { method: "POST", body: { ...data, key: slugify(label) } });
      else await api(`/staff/space-types/${editingSpaceTypeId}`, { method: "PATCH", body: data });
      editSpaceTypeModal.hide();
      toast("Tipo de espacio guardado.");
      spaceTypesCache = await api("/staff/space-types").catch(() => []);
      renderSpaceTypesList();
    } catch (e) { toast(e.message, false); }
  };
  document.getElementById("editSpaceTypeDeleteBtn").onclick = async () => {
    if (!confirm("¿Eliminar este tipo de espacio? Los espacios/servicios que ya lo usan quedan con una referencia suelta.")) return;
    await api(`/staff/space-types/${editingSpaceTypeId}`, { method: "DELETE" });
    editSpaceTypeModal.hide();
    toast("Tipo de espacio eliminado.");
    spaceTypesCache = await api("/staff/space-types").catch(() => []);
    renderSpaceTypesList();
  };

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (document.getElementById("view-espacio").style.display === "none") return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { updateCellSize(); renderTables(); }, 150);
  });

  function toggleEdit() { editMode = !editMode; render(); }
  document.getElementById("spaceEditToggle").onclick = toggleEdit;

  function renderModeUI() {
    const btn = document.getElementById("spaceEditToggle");
    btn.innerHTML = editMode ? `<i class="bi bi-check-lg"></i> Terminar edición` : `<i class="bi bi-pencil"></i> Editar distribución`;
    // El plano se ve siempre — "Editar distribución" solo habilita arrastrar/redimensionar/
    // renombrar sobre él, y muestra la gestión de tipos de espacio debajo.
    document.getElementById("spaceTypesSection").style.display = editMode ? "block" : "none";
    document.querySelectorAll(".space-add-btn").forEach((b) => (b.disabled = !editMode));
    document.getElementById("spaceModeHint").textContent = editMode
      ? "Modo edición: arrastra, redimensiona o renombra los espacios."
      : "Distribución del local: haz clic en un espacio para ver las citas de hoy.";
    document.getElementById("spaceFooterHint").innerHTML = editMode
      ? `<i class="bi bi-info-circle"></i> Arrastra para mover, la esquina inferior derecha para redimensionar, el lápiz para renombrar y el punto de color para el estado.`
      : `<i class="bi bi-info-circle"></i> Haz clic en "Editar distribución" para moverlos, cambiarlos o gestionar los tipos de espacio.`;
  }

  function renderToolbar() {
    document.getElementById("spaceToolbar").innerHTML = Object.entries(SHAPES).map(([key, s]) =>
      `<button class="space-add-btn" ${editMode ? "" : "disabled"} data-shape="${key}"><i class="bi bi-square"></i> ${s.label}</button>`).join("");
    document.querySelectorAll(".space-add-btn").forEach((b) => (b.onclick = () => addTable(b.dataset.shape)));
  }

  function nextLabel() {
    const nums = spacesCache.map((t) => parseInt((t.label.match(/\d+/) || [0])[0], 10)).filter((n) => !isNaN(n));
    return "M" + ((nums.length ? Math.max(...nums) : 0) + 1);
  }

  function findFreeSpot(w, h) {
    const cols = canvasCols();
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x <= cols - w; x++) {
        const overlaps = spacesCache.some((t) => x < t.x + t.w && x + w > t.x && y < t.y + t.h && y + h > t.y);
        if (!overlaps) return { x, y };
      }
    }
    return { x: 0, y: 0 };
  }

  async function addTable(shapeKey) {
    if (!editMode) return;
    const def = SHAPES[shapeKey];
    const spot = findFreeSpot(def.w, def.h);
    await api("/staff/spaces", { method: "POST", body: {
      label: nextLabel(), type: "general", shape: def.shape, capacity: def.capacity,
      x: spot.x, y: spot.y, w: def.w, h: def.h,
    } });
    toast("Espacio agregado.");
    render();
  }

  async function removeTable(id) {
    if (!editMode) return;
    await api(`/staff/spaces/${id}`, { method: "DELETE" });
    render();
  }

  function openEditSpace(id) {
    if (!editMode) return;
    const t = spacesCache.find((t) => t.id === id);
    if (!t) return;
    editingId = id;
    document.getElementById("editSpaceName").value = t.label;
    document.getElementById("editSpaceType").innerHTML = spaceTypesCache.map((st) => `<option value="${st.key}">${st.label}</option>`).join("");
    document.getElementById("editSpaceType").value = t.type;
    editSpaceModal = editSpaceModal || new bootstrap.Modal(document.getElementById("editSpaceModal"));
    editSpaceModal.show();
  }
  document.getElementById("editSpaceSaveBtn").onclick = async () => {
    const name = document.getElementById("editSpaceName").value.trim();
    const type = document.getElementById("editSpaceType").value;
    if (!name) return toast("Ponle un nombre.", false);
    await api(`/staff/spaces/${editingId}`, { method: "PATCH", body: { label: name, type } });
    editSpaceModal.hide();
    toast("Espacio actualizado.");
    render();
  };

  async function cycleStatus(id) {
    const t = spacesCache.find((t) => t.id === id);
    if (!t) return;
    const status = STATUSES[(STATUSES.indexOf(t.status) + 1) % STATUSES.length];
    await api(`/staff/spaces/${id}`, { method: "PATCH", body: { status } });
    render();
  }

  function apptsForTableToday(tableId) {
    return todayApptsCache.filter((a) => a.space_id === tableId && a.status !== "cancelled");
  }

  function miniScheduleHTML(t) {
    const appts = apptsForTableToday(t.id).sort((a, b) => a.start.localeCompare(b.start));
    if (!appts.length) return `<div class="t-empty-day">Sin citas hoy</div>`;
    layoutOverlaps(appts, (a) => a.start, (a) => a.end);
    const maxShown = 3;
    const shown = appts.slice(0, maxShown).map((a) => `
      <div class="t-mini-appt ${a._conflict ? "conflict" : ""}" title="${a.specialist_name} · ${a.client_name} · ${a.service_name}">
        <span class="d-flex align-items-center gap-1" style="min-width:0;">
          <span class="mini-avatar" style="background:${a.specialist_color};flex-shrink:0;">${a.specialist_avatar || ""}</span>
          <span>${formatAMPM(a.start)}-${formatAMPM(a.end)}</span>
        </span>
        <span>${a.client_name.split(" ")[0]}</span>
      </div>`).join("");
    const more = appts.length > maxShown ? `<div class="t-mini-more">+${appts.length - maxShown} más</div>` : "";
    const conflict = appts.some((a) => a._conflict) ? `<div class="t-mini-more" style="color:var(--danger);font-weight:700;"><i class="bi bi-exclamation-triangle-fill"></i> Cruce de horario</div>` : "";
    return `<div class="t-mini-schedule">${shown}${more}${conflict}</div>`;
  }

  async function renderTables() {
    todayApptsCache = await api(`/staff/appointments?date=${todayISO()}`).catch(() => []);
    const grid = document.getElementById("floorGrid");
    sizeCanvas();
    grid.innerHTML = spacesCache.map((t) => `
      <div class="table-item ${editMode ? "" : "locked"} shape-${t.shape} status-${t.status}" data-id="${t.id}"
        style="left:${t.x * CELL}px; top:${t.y * CELL}px; width:${t.w * CELL}px; height:${t.h * CELL}px; background:${colorAlpha(typeColor(t.type), .18)}; border-color:${colorDarken(typeColor(t.type), .3)};">
        <button class="t-status-dot" title="Cambiar estado" data-status-id="${t.id}"></button>
        ${editMode ? `<button class="t-remove" title="Eliminar" data-remove-id="${t.id}">✕</button>` : ""}
        <span class="t-label">${spaceDisplayName(t)} ${editMode ? `<i class="bi bi-pencil-fill" role="button" data-edit-id="${t.id}"></i>` : ""}</span>
        <span class="t-cap"><i class="bi bi-people-fill"></i> ${t.capacity}</span>
        ${miniScheduleHTML(t)}
        ${editMode ? `<div class="t-resize" data-resize-id="${t.id}"></div>` : ""}
      </div>`).join("");

    grid.querySelectorAll("[data-status-id]").forEach((el) => (el.onclick = (e) => { e.stopPropagation(); cycleStatus(el.dataset.statusId); }));
    grid.querySelectorAll("[data-remove-id]").forEach((el) => (el.onclick = (e) => { e.stopPropagation(); removeTable(el.dataset.removeId); }));
    grid.querySelectorAll("[data-edit-id]").forEach((el) => (el.onclick = (e) => { e.stopPropagation(); openEditSpace(el.dataset.editId); }));
    grid.querySelectorAll("[data-resize-id]").forEach((el) => (el.onmousedown = (e) => startResize(e, el.dataset.resizeId)));

    grid.querySelectorAll(".table-item").forEach((el) => {
      el.addEventListener("mousedown", (e) => {
        if (!editMode) return;
        if (e.target.closest(".t-resize, .t-remove, .t-status-dot, .bi-pencil-fill")) return;
        startDrag(e, el.dataset.id);
      });
      el.addEventListener("click", (e) => {
        if (editMode) return;
        if (e.target.closest(".t-status-dot")) return;
        openSchedule(el.dataset.id);
      });
    });
  }

  function openSchedule(id) {
    const t = spacesCache.find((t) => t.id === id);
    if (!t) return;
    const appts = apptsForTableToday(id).sort((a, b) => a.start.localeCompare(b.start));
    document.getElementById("tableScheduleTitle").textContent = `Horario de ${spaceDisplayName(t)} (hoy)`;
    document.getElementById("tableScheduleEmpty").style.display = appts.length ? "none" : "block";
    document.getElementById("tableScheduleConflictBanner").style.display = appts.some((a) => a._conflict) ? "block" : "none";
    document.getElementById("tableScheduleTimeline").innerHTML = buildTimelineHTML(appts);
    scheduleModal = scheduleModal || new bootstrap.Modal(document.getElementById("tableScheduleModal"));
    scheduleModal.show();
  }

  const ROWPX = 50;
  function buildTimelineHTML(appts) {
    const rangeStartH = 7, rangeEndH = 22;
    const rangeStartM = rangeStartH * 60;
    const totalHeight = (rangeEndH - rangeStartH) * ROWPX;
    const labels = [];
    for (let h = rangeStartH; h <= rangeEndH; h++) labels.push(`<div class="t-timeline-label">${window.CDC.formatHourAMPM(((h % 24) + 24) % 24)}</div>`);

    const items = layoutOverlaps(appts, (a) => a.start, (a) => a.end);
    const cards = items.map(({ ref: a, sM, eM, col, cols }) => {
      const top = ((sM - rangeStartM) / 60) * ROWPX;
      const height = Math.max(22, ((eM - sM) / 60) * ROWPX);
      const width = 100 / cols, left = col * width;
      return `<div class="t-timeline-appt ${a._conflict ? "conflict" : ""}" style="top:${top}px; height:${height}px; left:calc(${left}% + 2px); width:calc(${width}% - 4px);">
        <span class="tt-time d-flex align-items-center gap-1">
          <span class="mini-avatar" style="background:${a.specialist_color};flex-shrink:0;">${a.specialist_avatar || ""}</span>
          ${formatAMPM(a.start)} - ${formatAMPM(a.end)}${a._conflict ? ' · <i class="bi bi-exclamation-triangle-fill"></i> Cruce' : ""}
        </span>
        <span class="tt-title">${a.service_name}</span>
        <span class="tt-client"><i class="bi bi-person"></i> ${a.client_name}</span>
      </div>`;
    }).join("");

    const now = new Date();
    const nowM = now.getHours() * 60 + now.getMinutes();
    const nowLine = nowM >= rangeStartM && nowM <= rangeEndH * 60 ? `<div class="t-timeline-now" style="top:${((nowM - rangeStartM) / 60) * ROWPX}px;"></div>` : "";

    return `<div class="t-timeline-labels">${labels.join("")}</div>
      <div class="t-timeline-track" style="height:${totalHeight}px; background-size:100% ${ROWPX}px;">${cards}${nowLine}</div>`;
  }

  function startDrag(e, id) {
    const t = spacesCache.find((t) => t.id === id);
    const el = document.querySelector(`.table-item[data-id="${id}"]`);
    if (!t || !el) return;
    dragCtx = { id, startX: e.clientX, startY: e.clientY, origX: t.x * CELL, origY: t.y * CELL, el };
    el.classList.add("dragging");
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
    e.preventDefault();
  }
  function onDragMove(e) {
    if (!dragCtx) return;
    dragCtx.el.style.left = Math.max(0, dragCtx.origX + (e.clientX - dragCtx.startX)) + "px";
    dragCtx.el.style.top = Math.max(0, dragCtx.origY + (e.clientY - dragCtx.startY)) + "px";
  }
  async function onDragEnd() {
    if (!dragCtx) return;
    const x = Math.max(0, Math.round(parseFloat(dragCtx.el.style.left) / CELL));
    const y = Math.max(0, Math.round(parseFloat(dragCtx.el.style.top) / CELL));
    dragCtx.el.classList.remove("dragging");
    const id = dragCtx.id;
    dragCtx = null;
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    await api(`/staff/spaces/${id}`, { method: "PATCH", body: { x, y } });
    render();
  }

  function startResize(e, id) {
    const t = spacesCache.find((t) => t.id === id);
    const el = document.querySelector(`.table-item[data-id="${id}"]`);
    if (!t || !el) return;
    resizeCtx = { id, startX: e.clientX, startY: e.clientY, origW: t.w * CELL, origH: t.h * CELL, el };
    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", onResizeEnd);
    e.preventDefault();
    e.stopPropagation();
  }
  function onResizeMove(e) {
    if (!resizeCtx) return;
    resizeCtx.el.style.width = Math.max(CELL * 2, resizeCtx.origW + (e.clientX - resizeCtx.startX)) + "px";
    resizeCtx.el.style.height = Math.max(CELL * 2, resizeCtx.origH + (e.clientY - resizeCtx.startY)) + "px";
  }
  async function onResizeEnd() {
    if (!resizeCtx) return;
    const w = Math.max(2, Math.round(parseFloat(resizeCtx.el.style.width) / CELL));
    const h = Math.max(2, Math.round(parseFloat(resizeCtx.el.style.height) / CELL));
    const id = resizeCtx.id;
    resizeCtx = null;
    document.removeEventListener("mousemove", onResizeMove);
    document.removeEventListener("mouseup", onResizeEnd);
    await api(`/staff/spaces/${id}`, { method: "PATCH", body: { w, h } });
    render();
  }

  return { render };
})();
