// Tipos de espacio (ej. "Mesa", "Cabina") — antes esto vivía junto con un plano visual de mesas
// individuales con posición/forma; se quitó porque esa asignación nunca afectó la disponibilidad
// de horarios (solo era informativa) y añadía complejidad sin aportar nada. Ahora un "tipo" es
// solo nombre+descripción: sirve para restringir qué servicios lo admiten (Reglas → Servicios) y
// para que el personal indique qué tipo de espacio usó una cita (ver AssignSpace en
// admin-agenda.js). Mismo molde IIFE que los demás módulos (ver nota en admin-rules.js).
window.SpaceTypes = (function () {
  const { api, toast } = window.CDC;

  let spaceTypesCache = [];
  let editSpaceTypeModal = null;
  let editingSpaceTypeId = null;

  function slugify(label) {
    return label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tipo";
  }

  async function render() {
    spaceTypesCache = await api("/staff/space-types").catch(() => []);
    const wrap = document.getElementById("spaceTypesList");
    wrap.innerHTML = spaceTypesCache.length ? spaceTypesCache.map((t) => `
      <div class="d-flex justify-content-between align-items-start border-top py-2">
        <div>
          <div class="fw-semibold">${t.label}</div>
          ${t.description ? `<div class="text-muted small mt-1">${t.description}</div>` : ""}
        </div>
        <button class="btn btn-sm btn-outline-dark flex-shrink-0" data-edit-type="${t.id}"><i class="bi bi-pencil"></i></button>
      </div>`).join("") : `<p class="text-muted small mb-0">Sin tipos todavía — añade el primero.</p>`;
    wrap.querySelectorAll("[data-edit-type]").forEach((el) => (el.onclick = () => openEditSpaceType(el.dataset.editType)));
  }

  function openEditSpaceType(id) {
    const t = spaceTypesCache.find((t) => t.id === id);
    if (!t) return;
    editingSpaceTypeId = id;
    document.getElementById("editSpaceTypeModalTitle").textContent = "Editar tipo de espacio";
    document.getElementById("editSpaceTypeDeleteBtn").style.display = "inline-block";
    document.getElementById("editSpaceTypeLabel").value = t.label;
    document.getElementById("editSpaceTypeDescription").value = t.description || "";
    editSpaceTypeModal = editSpaceTypeModal || new bootstrap.Modal(document.getElementById("editSpaceTypeModal"));
    editSpaceTypeModal.show();
  }

  document.getElementById("addSpaceTypeOpenBtn").onclick = () => {
    editingSpaceTypeId = null;
    document.getElementById("editSpaceTypeModalTitle").textContent = "Añadir tipo de espacio";
    document.getElementById("editSpaceTypeDeleteBtn").style.display = "none";
    document.getElementById("editSpaceTypeLabel").value = "";
    document.getElementById("editSpaceTypeDescription").value = "";
    editSpaceTypeModal = editSpaceTypeModal || new bootstrap.Modal(document.getElementById("editSpaceTypeModal"));
    editSpaceTypeModal.show();
  };

  document.getElementById("editSpaceTypeSaveBtn").onclick = async () => {
    const label = document.getElementById("editSpaceTypeLabel").value.trim();
    if (!label) return toast("Ponle un nombre al tipo de espacio.", false);
    const description = document.getElementById("editSpaceTypeDescription").value.trim() || null;
    try {
      if (editingSpaceTypeId === null) await api("/staff/space-types", { method: "POST", body: { key: slugify(label), label, description } });
      else await api(`/staff/space-types/${editingSpaceTypeId}`, { method: "PATCH", body: { label, description } });
      editSpaceTypeModal.hide();
      toast("Tipo de espacio guardado.");
      render();
    } catch (e) { toast(e.message, false); }
  };
  document.getElementById("editSpaceTypeDeleteBtn").onclick = async () => {
    if (!confirm("¿Eliminar este tipo de espacio? Los servicios y citas que ya lo usan quedan con una referencia suelta.")) return;
    await api(`/staff/space-types/${editingSpaceTypeId}`, { method: "DELETE" });
    editSpaceTypeModal.hide();
    toast("Tipo de espacio eliminado.");
    render();
  };

  return { render };
})();
