// Reglas de negocio: servicios y especialistas (con sus modales de editar/añadir) y tipos de
// espacio. Las plantillas de mensajes viven en Ajustes (admin.js), junto con el resto de
// WhatsApp. Las columnas allowed_space_types/work_days y la tabla puente specialist_services ya
// existían en el backend — esto solo les pone interfaz.
window.Rules = (function () {
  const { api, toast, tenantSlug } = window.CDC;
  const DOW_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  let servicesCache = [], specialistsCache = [], spaceTypesCache = [], promotionsCache = [], treatmentTemplatesCache = [];
  let editServiceModal = null, editSpecialistModal = null, editPromoModal = null, editTreatmentTemplateModal = null;
  let editingServiceId = null, editingSpecialistId = null, editingPromoId = null, editingTreatmentTemplateId = null;
  let pendingServicePhotoBlob = null;

  function typeLabel(key) { return spaceTypesCache.find((t) => t.key === key)?.label || key; }

  async function render() {
    await renderSpaceTypes();
    await renderPromotions();
    await renderServices();
    await renderTreatmentTemplates();
    await renderSpecialists();
  }

  /* ---------- Promociones ---------- */
  async function renderPromotions() {
    promotionsCache = await api("/staff/promotions").catch(() => []);
    const wrap = document.getElementById("promotionsList");
    wrap.innerHTML = promotionsCache.length ? "" : `<p class="text-muted small mb-0">Sin promociones todavía.</p>`;
    const today = new Date().toISOString().slice(0, 10);
    promotionsCache.forEach((p) => {
      const vigente = !!p.active && (!p.starts_at || p.starts_at <= today) && (!p.ends_at || p.ends_at >= today);
      const row = document.createElement("div");
      row.className = "d-flex justify-content-between align-items-start border-top py-2";
      const range = [p.starts_at, p.ends_at].filter(Boolean).join(" – ");
      row.innerHTML = `
        <div>
          <div class="fw-semibold">${p.title} ${vigente ? `<span class="badge rounded-pill" style="background:rgba(15,82,87,.1);color:var(--primary);font-size:.68rem;">Vigente</span>` : `<span class="badge rounded-pill" style="background:#f0eee6;color:var(--muted);font-size:.68rem;">Inactiva</span>`}</div>
          ${p.description ? `<div class="text-muted small mt-1">${p.description}</div>` : ""}
          <div class="text-muted small mt-1">${[p.code ? `Código: ${p.code}` : "", range].filter(Boolean).join(" · ")}</div>
        </div>
        <button class="btn btn-sm btn-outline-dark flex-shrink-0" data-edit-promo="${p.id}"><i class="bi bi-pencil"></i></button>`;
      wrap.appendChild(row);
    });
    document.querySelectorAll("[data-edit-promo]").forEach((el) => (el.onclick = () => openEditPromo(el.dataset.editPromo)));
  }

  function readPromoForm() {
    return {
      title: document.getElementById("editPromoTitle").value.trim(),
      description: document.getElementById("editPromoDescription").value.trim() || null,
      code: document.getElementById("editPromoCode").value.trim() || null,
      starts_at: document.getElementById("editPromoStart").value || null,
      ends_at: document.getElementById("editPromoEnd").value || null,
      active: document.getElementById("editPromoActive").checked,
    };
  }

  function openEditPromo(id) {
    const p = promotionsCache.find((p) => p.id === id);
    if (!p) return;
    editingPromoId = id;
    document.getElementById("editPromoModalTitle").textContent = "Editar promoción";
    document.getElementById("editPromoDeleteBtn").style.display = "inline-block";
    document.getElementById("editPromoTitle").value = p.title;
    document.getElementById("editPromoDescription").value = p.description || "";
    document.getElementById("editPromoCode").value = p.code || "";
    document.getElementById("editPromoStart").value = p.starts_at || "";
    document.getElementById("editPromoEnd").value = p.ends_at || "";
    document.getElementById("editPromoActive").checked = !!p.active;
    editPromoModal = editPromoModal || new bootstrap.Modal(document.getElementById("editPromoModal"));
    editPromoModal.show();
  }

  document.getElementById("addPromoOpenBtn").onclick = () => {
    editingPromoId = null;
    document.getElementById("editPromoModalTitle").textContent = "Añadir promoción";
    document.getElementById("editPromoDeleteBtn").style.display = "none";
    document.getElementById("editPromoTitle").value = "";
    document.getElementById("editPromoDescription").value = "";
    document.getElementById("editPromoCode").value = "";
    document.getElementById("editPromoStart").value = "";
    document.getElementById("editPromoEnd").value = "";
    document.getElementById("editPromoActive").checked = true;
    editPromoModal = editPromoModal || new bootstrap.Modal(document.getElementById("editPromoModal"));
    editPromoModal.show();
  };

  document.getElementById("editPromoSaveBtn").onclick = async () => {
    const data = readPromoForm();
    if (!data.title) return toast("Ponle un título a la promoción.", false);
    try {
      if (editingPromoId === null) await api("/staff/promotions", { method: "POST", body: data });
      else await api(`/staff/promotions/${editingPromoId}`, { method: "PATCH", body: data });
      editPromoModal.hide();
      toast("Promoción guardada.");
      renderPromotions();
    } catch (e) { toast(e.message, false); }
  };
  document.getElementById("editPromoDeleteBtn").onclick = async () => {
    if (!confirm("¿Eliminar esta promoción? No se puede deshacer.")) return;
    await api(`/staff/promotions/${editingPromoId}`, { method: "DELETE" });
    editPromoModal.hide();
    toast("Promoción eliminada.");
    renderPromotions();
  };

  /* ---------- Tipos de espacio ---------- */
  function slugify(label) {
    return label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tipo";
  }

  async function renderSpaceTypes() {
    spaceTypesCache = await api("/staff/space-types").catch(() => []);
    document.getElementById("spaceTypesList").innerHTML = spaceTypesCache.length ? spaceTypesCache.map((t) => `
      <span class="badge rounded-pill d-inline-flex align-items-center gap-2" style="background:#f0eee6;color:var(--ink);font-size:.82rem;padding:.4rem .7rem;">
        ${t.label}
        <button type="button" class="btn-close" style="font-size:.55rem;" data-del-type="${t.id}" aria-label="Eliminar"></button>
      </span>`).join("") : `<p class="text-muted small mb-0">Sin tipos todavía — añade el primero abajo.</p>`;
    document.querySelectorAll("[data-del-type]").forEach((el) => (el.onclick = async () => {
      if (!confirm("¿Eliminar este tipo de espacio? Los espacios/servicios que ya lo usan quedan con una referencia suelta.")) return;
      await api(`/staff/space-types/${el.dataset.delType}`, { method: "DELETE" });
      renderSpaceTypes();
    }));
  }

  document.getElementById("addSpaceTypeBtn").onclick = async () => {
    const input = document.getElementById("newSpaceTypeLabel");
    const label = input.value.trim();
    if (!label) return toast("Escribe un nombre.", false);
    try {
      await api("/staff/space-types", { method: "POST", body: { key: slugify(label), label } });
      input.value = "";
      renderSpaceTypes();
    } catch (e) { toast(e.message, false); }
  };

  /* ---------- Paquetes (llamados "treatment" por dentro — nombre técnico, no se muestra al
     usuario; internamente son plantillas: nombre + qué servicios lo componen, en orden, pudiendo
     repetir el mismo servicio varias veces — ej. "3 cortes" = Corte de cabello × 3) ---------- */
  let currentTemplateServiceIds = []; // ordenada, puede repetir

  async function renderTreatmentTemplates() {
    treatmentTemplatesCache = await api("/staff/treatments").catch(() => []);
    const wrap = document.getElementById("treatmentTemplatesList");
    if (!treatmentTemplatesCache.length) { wrap.innerHTML = `<p class="text-muted small mb-0">Sin paquetes todavía.</p>`; return; }
    const withServices = await Promise.all(treatmentTemplatesCache.map(async (t) => ({
      ...t, serviceIds: await api(`/staff/treatments/${t.id}/services`).catch(() => []),
    })));
    wrap.innerHTML = withServices.map((t) => {
      const names = t.serviceIds.map((id) => servicesCache.find((s) => s.id === id)?.name).filter(Boolean);
      return `
        <div class="d-flex justify-content-between align-items-start border-top py-2">
          <div>
            <div class="fw-semibold">${t.name} ${t.active ? "" : `<span class="badge rounded-pill" style="background:#f0eee6;color:var(--muted);font-size:.68rem;">Inactivo</span>`}</div>
            <div class="text-muted small mt-1">${names.length ? names.join(" → ") : "Sin servicios elegidos todavía"}</div>
          </div>
          <button class="btn btn-sm btn-outline-dark flex-shrink-0" data-edit-treatment-template="${t.id}"><i class="bi bi-pencil"></i></button>
        </div>`;
    }).join("");
    document.querySelectorAll("[data-edit-treatment-template]").forEach((el) => (el.onclick = () => openEditTreatmentTemplate(el.dataset.editTreatmentTemplate)));
  }

  // Lista tipo "carrito": select + botón agrega una instancia al final (puede repetirse el mismo
  // servicio varias veces); cada fila tiene su propio botón de quitar. Reemplaza el viejo
  // checkbox list, que por naturaleza no podía tener un mismo servicio marcado dos veces.
  function renderTemplateServiceCart() {
    const wrap = document.getElementById("editTreatmentTemplateServices");
    wrap.innerHTML = currentTemplateServiceIds.length ? currentTemplateServiceIds.map((id, i) => {
      const name = servicesCache.find((s) => s.id === id)?.name || "?";
      return `<div class="d-flex justify-content-between align-items-center" style="background:#f9f8f3;border-radius:8px;padding:.35rem .6rem;">
        <span class="small">${i + 1}. ${name}</span>
        <button type="button" class="btn-close" style="font-size:.6rem;" data-remove-idx="${i}" aria-label="Quitar"></button>
      </div>`;
    }).join("") : `<p class="text-muted small mb-0">Todavía no agregaste ningún servicio.</p>`;
    wrap.querySelectorAll("[data-remove-idx]").forEach((el) => (el.onclick = () => {
      currentTemplateServiceIds.splice(parseInt(el.dataset.removeIdx, 10), 1);
      renderTemplateServiceCart();
    }));
  }
  document.getElementById("editTreatmentTemplateAddServiceBtn").onclick = () => {
    const id = document.getElementById("editTreatmentTemplateServiceSelect").value;
    if (!id) return;
    currentTemplateServiceIds.push(id);
    renderTemplateServiceCart();
  };

  function fillTemplateServiceSelect() {
    const sel = document.getElementById("editTreatmentTemplateServiceSelect");
    sel.innerHTML = servicesCache.length
      ? servicesCache.map((s) => `<option value="${s.id}">${s.name}</option>`).join("")
      : `<option value="">Sin servicios creados</option>`;
  }

  async function openEditTreatmentTemplate(id) {
    const t = treatmentTemplatesCache.find((t) => t.id === id);
    if (!t) return;
    editingTreatmentTemplateId = id;
    document.getElementById("editTreatmentTemplateModalTitle").textContent = "Editar paquete";
    document.getElementById("editTreatmentTemplateDeleteBtn").style.display = "inline-block";
    document.getElementById("editTreatmentTemplateName").value = t.name;
    document.getElementById("editTreatmentTemplateDescription").value = t.description || "";
    document.getElementById("editTreatmentTemplateActive").checked = !!t.active;
    fillTemplateServiceSelect();
    currentTemplateServiceIds = await api(`/staff/treatments/${id}/services`).catch(() => []);
    renderTemplateServiceCart();
    editTreatmentTemplateModal = editTreatmentTemplateModal || new bootstrap.Modal(document.getElementById("editTreatmentTemplateModal"));
    editTreatmentTemplateModal.show();
  }

  document.getElementById("addTreatmentTemplateOpenBtn").onclick = () => {
    editingTreatmentTemplateId = null;
    document.getElementById("editTreatmentTemplateModalTitle").textContent = "Añadir paquete";
    document.getElementById("editTreatmentTemplateDeleteBtn").style.display = "none";
    document.getElementById("editTreatmentTemplateName").value = "";
    document.getElementById("editTreatmentTemplateDescription").value = "";
    document.getElementById("editTreatmentTemplateActive").checked = true;
    fillTemplateServiceSelect();
    currentTemplateServiceIds = [];
    renderTemplateServiceCart();
    editTreatmentTemplateModal = editTreatmentTemplateModal || new bootstrap.Modal(document.getElementById("editTreatmentTemplateModal"));
    editTreatmentTemplateModal.show();
  };

  document.getElementById("editTreatmentTemplateSaveBtn").onclick = async () => {
    const name = document.getElementById("editTreatmentTemplateName").value.trim();
    if (!name) return toast("Ponle un nombre al paquete.", false);
    const data = {
      name, description: document.getElementById("editTreatmentTemplateDescription").value.trim() || null,
      active: document.getElementById("editTreatmentTemplateActive").checked,
    };
    try {
      let id = editingTreatmentTemplateId;
      if (id === null) id = (await api("/staff/treatments", { method: "POST", body: data })).id;
      else await api(`/staff/treatments/${id}`, { method: "PATCH", body: data });
      await api(`/staff/treatments/${id}/services`, { method: "PUT", body: { serviceIds: currentTemplateServiceIds } });
      editTreatmentTemplateModal.hide();
      toast("Paquete guardado.");
      renderTreatmentTemplates();
    } catch (e) { toast(e.message, false); }
  };
  document.getElementById("editTreatmentTemplateDeleteBtn").onclick = async () => {
    if (!confirm("¿Eliminar este paquete? No se puede deshacer.")) return;
    await api(`/staff/treatments/${editingTreatmentTemplateId}`, { method: "DELETE" });
    editTreatmentTemplateModal.hide();
    toast("Paquete eliminado.");
    renderTreatmentTemplates();
  };

  /* ---------- Servicios ---------- */
  async function renderServices() {
    servicesCache = await api("/staff/services").catch(() => []);
    document.getElementById("servicesList").innerHTML = servicesCache.map((s) => {
      let allowed = []; try { allowed = JSON.parse(s.allowed_space_types || "[]"); } catch { allowed = []; }
      const thumb = s.photo_key
        ? `<img src="${servicePhotoUrl(s.photo_key)}" style="width:52px;height:52px;object-fit:cover;border-radius:10px;flex-shrink:0;">`
        : `<div style="width:52px;height:52px;border-radius:10px;flex-shrink:0;background:#f0eee6;display:flex;align-items:center;justify-content:center;color:var(--muted);"><i class="bi bi-image"></i></div>`;
      return `<div class="service-row d-flex justify-content-between align-items-start gap-2">
        <div class="d-flex gap-2">
          ${thumb}
          <div>
            <div class="d-flex align-items-center gap-2 flex-wrap">
              <span class="fw-semibold">${s.name}</span>
              <span class="badge rounded-pill" style="background:rgba(15,82,87,.1);color:var(--primary);">$${s.price.toLocaleString("es-CO")}</span>
            </div>
            <div class="text-muted small mt-1">${s.duration_min} min · Cancela ${s.cancel_window_hours}h antes · Recordatorio ${s.reminder_hours}h antes</div>
            <div class="d-flex flex-wrap gap-1 mt-2">
              ${allowed.length ? allowed.map((k) => `<span class="badge rounded-pill" style="background:#f0eee6;color:var(--ink);font-size:.68rem;">${typeLabel(k)}</span>`).join("")
                : `<span class="text-muted small" style="font-size:.72rem;">Admite cualquier espacio</span>`}
            </div>
          </div>
        </div>
        <button class="btn btn-sm btn-outline-dark flex-shrink-0" data-edit-svc="${s.id}"><i class="bi bi-pencil"></i></button>
      </div>`;
    }).join("");
    document.querySelectorAll("[data-edit-svc]").forEach((el) => (el.onclick = () => openEditService(el.dataset.editSvc)));
  }

  function serviceTypeCheckboxes(selected) {
    if (!spaceTypesCache.length) return `<p class="text-muted small mb-0">Todavía no hay tipos de espacio — créalos arriba, en "Tipos de espacio".</p>`;
    return spaceTypesCache.map(({ key, label }) => `
      <div class="form-check"><input class="form-check-input" type="checkbox" value="${key}" id="svcType_${key}" ${selected.includes(key) ? "checked" : ""}>
      <label class="form-check-label small" for="svcType_${key}">${label}</label></div>`).join("");
  }

  function servicePhotoUrl(key) { return `/api/${tenantSlug()}/public/files/${key}`; }

  function resetServicePhotoField(existingKey) {
    document.getElementById("editServicePhoto").value = "";
    pendingServicePhotoBlob = null;
    const preview = document.getElementById("editServicePhotoPreview");
    const recropBtn = document.getElementById("editServiceRecropBtn");
    if (existingKey) { preview.src = servicePhotoUrl(existingKey); preview.style.display = "block"; recropBtn.style.display = "inline-block"; }
    else { preview.style.display = "none"; recropBtn.style.display = "none"; }
  }

  async function recropServicePreview() {
    const preview = document.getElementById("editServicePhotoPreview");
    if (!preview.src) return;
    const currentBlob = await fetch(preview.src).then((r) => r.blob());
    const blob = await window.ImgCropper.open(currentBlob, { aspectRatio: 2.4 });
    if (!blob) return;
    pendingServicePhotoBlob = blob;
    preview.src = URL.createObjectURL(blob);
  }
  document.getElementById("editServiceRecropBtn").onclick = recropServicePreview;

  // Al elegir un archivo se abre el recortador (Cropper.js) en vez de subirlo tal cual — la
  // franja de foto de servicio es ancha y baja (background-size:cover), así que se sugiere ese
  // recuadro; el negocio puede agrandarlo más allá de la foto para rellenar con un color.
  document.getElementById("editServicePhoto").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const blob = await window.ImgCropper.open(file, { aspectRatio: 2.4 });
    if (!blob) return;
    pendingServicePhotoBlob = blob;
    const preview = document.getElementById("editServicePhotoPreview");
    preview.src = URL.createObjectURL(blob);
    preview.style.display = "block";
    document.getElementById("editServiceRecropBtn").style.display = "inline-block";
  });

  async function uploadServicePhoto(blob) {
    const fd = new FormData();
    fd.append("file", blob, "foto.png");
    const res = await fetch(`/api/${tenantSlug()}/staff/upload`, { method: "POST", credentials: "include", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No se pudo subir la imagen.");
    return data.name;
  }

  function openEditService(id) {
    const s = servicesCache.find((s) => s.id === id);
    if (!s) return;
    let allowed = []; try { allowed = JSON.parse(s.allowed_space_types || "[]"); } catch { allowed = []; }
    editingServiceId = id;
    document.getElementById("editServiceModalTitle").textContent = "Editar servicio";
    document.getElementById("editServiceDeleteBtn").style.display = "inline-block";
    document.getElementById("editServiceName").value = s.name;
    document.getElementById("editServiceDuration").value = s.duration_min;
    document.getElementById("editServicePrice").value = s.price;
    document.getElementById("editServiceCancel").value = s.cancel_window_hours;
    document.getElementById("editServiceReminder").value = s.reminder_hours;
    document.getElementById("editServiceFeatured").checked = !!s.featured;
    document.getElementById("editServiceTypes").innerHTML = serviceTypeCheckboxes(allowed);
    resetServicePhotoField(s.photo_key);
    editServiceModal = editServiceModal || new bootstrap.Modal(document.getElementById("editServiceModal"));
    editServiceModal.show();
  }

  document.getElementById("addServiceOpenBtn").onclick = () => {
    editingServiceId = null;
    document.getElementById("editServiceModalTitle").textContent = "Añadir servicio";
    document.getElementById("editServiceDeleteBtn").style.display = "none";
    document.getElementById("editServiceName").value = "";
    document.getElementById("editServiceDuration").value = 30;
    document.getElementById("editServicePrice").value = 0;
    document.getElementById("editServiceCancel").value = 4;
    document.getElementById("editServiceReminder").value = 12;
    document.getElementById("editServiceFeatured").checked = false;
    document.getElementById("editServiceTypes").innerHTML = serviceTypeCheckboxes([]);
    resetServicePhotoField(null);
    editServiceModal = editServiceModal || new bootstrap.Modal(document.getElementById("editServiceModal"));
    editServiceModal.show();
  };

  function readServiceForm() {
    return {
      name: document.getElementById("editServiceName").value.trim(),
      duration_min: Math.max(0, parseInt(document.getElementById("editServiceDuration").value, 10) || 0),
      price: Math.max(0, parseInt(document.getElementById("editServicePrice").value, 10) || 0),
      cancel_window_hours: Math.max(0, parseInt(document.getElementById("editServiceCancel").value, 10) || 0),
      reminder_hours: Math.max(0, parseInt(document.getElementById("editServiceReminder").value, 10) || 0),
      featured: document.getElementById("editServiceFeatured").checked,
      allowed_space_types: Array.from(document.querySelectorAll("#editServiceTypes input:checked")).map((el) => el.value),
    };
  }

  document.getElementById("editServiceSaveBtn").onclick = async () => {
    const data = readServiceForm();
    if (!data.name) return toast("Ponle un nombre al servicio.", false);
    const btn = document.getElementById("editServiceSaveBtn");
    btn.disabled = true;
    try {
      // La foto (ya recortada) se sube ANTES de guardar el servicio — solo si el negocio eligió
      // una nueva; si no tocó el campo, photo_key ni se manda y conserva la que ya tenía.
      if (pendingServicePhotoBlob) data.photo_key = await uploadServicePhoto(pendingServicePhotoBlob);
      if (editingServiceId === null) await api("/staff/services", { method: "POST", body: data });
      else await api(`/staff/services/${editingServiceId}`, { method: "PATCH", body: data });
      editServiceModal.hide();
      pendingServicePhotoBlob = null;
      toast("Servicio guardado.");
      renderServices();
    } catch (e) { toast(e.message, false); }
    btn.disabled = false;
  };
  document.getElementById("editServiceDeleteBtn").onclick = async () => {
    if (!confirm("¿Eliminar este servicio? No se puede deshacer.")) return;
    await api(`/staff/services/${editingServiceId}`, { method: "DELETE" });
    editServiceModal.hide();
    toast("Servicio eliminado.");
    renderServices();
  };

  /* ---------- Especialistas ---------- */
  async function renderSpecialists() {
    specialistsCache = await api("/staff/specialists").catch(() => []);
    document.getElementById("specialistsList").innerHTML = specialistsCache.map((sp) => `
      <div class="specialist-row d-flex justify-content-between align-items-start gap-2">
        <div>
          <div class="d-flex align-items-center gap-2 mb-2">
            <span class="avatar-badge" style="background:${sp.color}">${sp.avatar}</span>
            <div><div class="fw-semibold">${sp.name}</div><div class="text-muted small">${sp.role || ""}</div></div>
          </div>
          <div id="svcBadges-${sp.id}" class="d-flex flex-wrap gap-1"><span class="text-muted small" style="font-size:.72rem;">Cargando…</span></div>
        </div>
        <button class="btn btn-sm btn-outline-dark flex-shrink-0" data-edit-sp="${sp.id}"><i class="bi bi-pencil"></i></button>
      </div>`).join("");
    document.querySelectorAll("[data-edit-sp]").forEach((el) => (el.onclick = () => openEditSpecialist(el.dataset.editSp)));

    for (const sp of specialistsCache) {
      const ids = await api(`/staff/specialists/${sp.id}/services`).catch(() => []);
      const names = ids.map((id) => servicesCache.find((s) => s.id === id)?.name).filter(Boolean);
      const box = document.getElementById(`svcBadges-${sp.id}`);
      if (box) box.innerHTML = names.length
        ? names.map((n) => `<span class="badge rounded-pill" style="background:rgba(15,82,87,.1);color:var(--primary);font-size:.68rem;">${n}</span>`).join("")
        : `<span class="text-muted small" style="font-size:.72rem;">Sin servicios asignados</span>`;
    }
  }

  function specialistServiceCheckboxes(selectedIds) {
    return servicesCache.map((s) => `<div class="form-check"><input class="form-check-input" type="checkbox" value="${s.id}" id="spSvc_${s.id}" ${selectedIds.includes(s.id) ? "checked" : ""}>
      <label class="form-check-label small" for="spSvc_${s.id}">${s.name}</label></div>`).join("");
  }

  function renderDayChips(selectedDows) {
    document.getElementById("editSpecialistDays").innerHTML = DOW_SHORT.map((label, dow) =>
      `<span class="chip ${selectedDows.includes(dow) ? "active" : ""}" data-dow="${dow}">${label}</span>`).join("");
    document.querySelectorAll("#editSpecialistDays .chip").forEach((el) => (el.onclick = () => el.classList.toggle("active")));
  }
  function selectedDayChips() {
    return Array.from(document.querySelectorAll("#editSpecialistDays .chip.active")).map((el) => Number(el.dataset.dow));
  }

  async function openEditSpecialist(id) {
    const sp = specialistsCache.find((sp) => sp.id === id);
    if (!sp) return;
    editingSpecialistId = id;
    document.getElementById("editSpecialistModalTitle").textContent = "Editar especialista";
    document.getElementById("editSpecialistDeleteBtn").style.display = "inline-block";
    document.getElementById("editSpecialistName").value = sp.name;
    document.getElementById("editSpecialistRole").value = sp.role || "";
    document.getElementById("editSpecialistAvatar").value = sp.avatar;
    document.getElementById("editSpecialistColor").value = sp.color;
    let workDays = [1, 2, 3, 4, 5, 6]; try { workDays = JSON.parse(sp.work_days || "[1,2,3,4,5,6]"); } catch { /* usa el default */ }
    renderDayChips(workDays);
    document.getElementById("editSpecialistOpenHour").value = sp.open_hour ?? "";
    document.getElementById("editSpecialistCloseHour").value = sp.close_hour ?? "";
    const selected = await api(`/staff/specialists/${id}/services`).catch(() => []);
    document.getElementById("editSpecialistServices").innerHTML = specialistServiceCheckboxes(selected);
    editSpecialistModal = editSpecialistModal || new bootstrap.Modal(document.getElementById("editSpecialistModal"));
    editSpecialistModal.show();
  }

  document.getElementById("addSpecialistOpenBtn").onclick = () => {
    editingSpecialistId = null;
    document.getElementById("editSpecialistModalTitle").textContent = "Añadir especialista";
    document.getElementById("editSpecialistDeleteBtn").style.display = "none";
    document.getElementById("editSpecialistName").value = "";
    document.getElementById("editSpecialistRole").value = "";
    document.getElementById("editSpecialistAvatar").value = "";
    document.getElementById("editSpecialistColor").value = "#0f5257";
    renderDayChips([1, 2, 3, 4, 5, 6]);
    document.getElementById("editSpecialistOpenHour").value = "";
    document.getElementById("editSpecialistCloseHour").value = "";
    document.getElementById("editSpecialistServices").innerHTML = specialistServiceCheckboxes([]);
    editSpecialistModal = editSpecialistModal || new bootstrap.Modal(document.getElementById("editSpecialistModal"));
    editSpecialistModal.show();
  };

  document.getElementById("editSpecialistSaveBtn").onclick = async () => {
    const name = document.getElementById("editSpecialistName").value.trim();
    if (!name) return toast("Ponle un nombre.", false);
    const role = document.getElementById("editSpecialistRole").value.trim();
    const avatar = (document.getElementById("editSpecialistAvatar").value.trim() || name.slice(0, 2)).slice(0, 2).toUpperCase();
    const color = document.getElementById("editSpecialistColor").value;
    const serviceIds = Array.from(document.querySelectorAll("#editSpecialistServices input:checked")).map((el) => el.value);
    const workDays = selectedDayChips();
    if (!workDays.length) return toast("Marca al menos un día que trabaje.", false);
    const openHourRaw = document.getElementById("editSpecialistOpenHour").value.trim();
    const closeHourRaw = document.getElementById("editSpecialistCloseHour").value.trim();
    const open_hour = openHourRaw === "" ? null : Number(openHourRaw);
    const close_hour = closeHourRaw === "" ? null : Number(closeHourRaw);
    if ((open_hour === null) !== (close_hour === null)) return toast("Pon apertura y cierre, o deja los dos vacíos.", false);
    if (open_hour !== null && !(close_hour > open_hour)) return toast("La hora de cierre debe ser después de la apertura.", false);

    let id = editingSpecialistId;
    const body = { name, role, avatar, color, work_days: workDays, open_hour, close_hour };
    if (id === null) {
      const created = await api("/staff/specialists", { method: "POST", body });
      id = created.id;
    } else {
      await api(`/staff/specialists/${id}`, { method: "PATCH", body });
    }
    await api(`/staff/specialists/${id}/services`, { method: "PUT", body: { serviceIds } });
    editSpecialistModal.hide();
    toast("Especialista guardado.");
    renderSpecialists();
  };
  document.getElementById("editSpecialistDeleteBtn").onclick = async () => {
    if (!confirm("¿Eliminar a este especialista? No se puede deshacer.")) return;
    await api(`/staff/specialists/${editingSpecialistId}`, { method: "DELETE" });
    editSpecialistModal.hide();
    toast("Especialista eliminado.");
    renderSpecialists();
  };

  return { render };
})();
