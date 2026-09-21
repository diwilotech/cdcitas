// Tarjeta digital (link-in-bio): contenido (bio/dirección), links, fuentes rastreables y su
// analítica. Mismo molde IIFE que los demás módulos del panel (ver nota en admin-rules.js).
window.Tarjeta = (function () {
  const { api, toast, tenantSlug } = window.CDC;

  let cardLinksCache = [];
  let editCardLinkModal = null;
  let editingCardLinkId = null;

  async function render() {
    const url = `${location.origin}/${tenantSlug()}/tarjeta`;
    document.getElementById("cardPreviewLink").href = url;

    const business = await api("/staff/settings").catch(() => null);
    if (business) {
      document.getElementById("cardBioInput").value = business.card_bio || "";
      document.getElementById("cardAddressInput").value = business.card_address || "";
    }

    await renderCardLinks();
    await renderCardSources();
    await renderAnalytics();
  }

  document.getElementById("cardContentSaveBtn").onclick = async () => {
    try {
      await api("/staff/settings", { method: "PATCH", body: {
        cardBio: document.getElementById("cardBioInput").value.trim() || null,
        cardAddress: document.getElementById("cardAddressInput").value.trim() || null,
      } });
      toast("Guardado.");
    } catch (e) { toast(e.message, false); }
  };

  /* ---------- Links ---------- */
  async function renderCardLinks() {
    cardLinksCache = await api("/staff/card-links").catch(() => []);
    const wrap = document.getElementById("cardLinksList");
    wrap.innerHTML = cardLinksCache.length ? cardLinksCache.map((l) => `
      <div class="d-flex justify-content-between align-items-center border-top py-2">
        <div class="d-flex align-items-center gap-2">
          <i class="bi ${l.icon || "bi-link-45deg"}"></i>
          <div>
            <div class="fw-semibold small">${l.label}</div>
            <div class="text-muted small">${l.url}</div>
          </div>
        </div>
        <button class="btn btn-sm btn-outline-dark flex-shrink-0" data-edit-link="${l.id}"><i class="bi bi-pencil"></i></button>
      </div>`).join("") : `<p class="text-muted small mb-0">Sin links todavía.</p>`;
    wrap.querySelectorAll("[data-edit-link]").forEach((el) => (el.onclick = () => openEditCardLink(el.dataset.editLink)));
  }

  function openEditCardLink(id) {
    const l = cardLinksCache.find((l) => l.id === id);
    if (!l) return;
    editingCardLinkId = id;
    document.getElementById("editCardLinkModalTitle").textContent = "Editar link";
    document.getElementById("editCardLinkDeleteBtn").style.display = "inline-block";
    document.getElementById("editCardLinkLabel").value = l.label;
    document.getElementById("editCardLinkIcon").value = l.icon || "";
    document.getElementById("editCardLinkUrl").value = l.url;
    editCardLinkModal = editCardLinkModal || new bootstrap.Modal(document.getElementById("editCardLinkModal"));
    editCardLinkModal.show();
  }

  document.getElementById("addCardLinkOpenBtn").onclick = () => {
    editingCardLinkId = null;
    document.getElementById("editCardLinkModalTitle").textContent = "Añadir link";
    document.getElementById("editCardLinkDeleteBtn").style.display = "none";
    document.getElementById("editCardLinkLabel").value = "";
    document.getElementById("editCardLinkIcon").value = "";
    document.getElementById("editCardLinkUrl").value = "";
    editCardLinkModal = editCardLinkModal || new bootstrap.Modal(document.getElementById("editCardLinkModal"));
    editCardLinkModal.show();
  };

  document.getElementById("editCardLinkSaveBtn").onclick = async () => {
    const label = document.getElementById("editCardLinkLabel").value.trim();
    const url = document.getElementById("editCardLinkUrl").value.trim();
    if (!label || !url) return toast("Ponle un nombre y una URL al link.", false);
    const data = { label, url, icon: document.getElementById("editCardLinkIcon").value.trim() || null };
    try {
      if (editingCardLinkId === null) await api("/staff/card-links", { method: "POST", body: { ...data, position: cardLinksCache.length } });
      else await api(`/staff/card-links/${editingCardLinkId}`, { method: "PATCH", body: data });
      editCardLinkModal.hide();
      toast("Link guardado.");
      renderCardLinks();
    } catch (e) { toast(e.message, false); }
  };
  document.getElementById("editCardLinkDeleteBtn").onclick = async () => {
    if (!confirm("¿Eliminar este link? No se puede deshacer.")) return;
    await api(`/staff/card-links/${editingCardLinkId}`, { method: "DELETE" });
    editCardLinkModal.hide();
    toast("Link eliminado.");
    renderCardLinks();
  };

  /* ---------- Fuentes rastreables ---------- */
  async function renderCardSources() {
    const sources = await api("/staff/card-sources").catch(() => []);
    const wrap = document.getElementById("cardSourcesList");
    wrap.innerHTML = sources.length ? sources.map((s) => {
      const link = `${location.origin}/${tenantSlug()}/tarjeta?src=${encodeURIComponent(s.code)}`;
      return `
      <div class="d-flex justify-content-between align-items-center border-top py-2">
        <div class="flex-grow-1 me-2" style="min-width:0;">
          <div class="fw-semibold small">${s.label}</div>
          <div class="text-muted small text-truncate">${link}</div>
        </div>
        <div class="d-flex gap-1 flex-shrink-0">
          <button class="btn btn-sm btn-outline-dark" data-copy-source="${link}"><i class="bi bi-clipboard"></i></button>
          <button class="btn btn-sm btn-outline-danger" data-del-source="${s.id}"><i class="bi bi-trash3"></i></button>
        </div>
      </div>`;
    }).join("") : `<p class="text-muted small mb-0">Sin fuentes todavía — crea la primera arriba.</p>`;
    wrap.querySelectorAll("[data-copy-source]").forEach((el) => (el.onclick = async () => {
      await navigator.clipboard.writeText(el.dataset.copySource);
      toast("Link copiado.");
    }));
    wrap.querySelectorAll("[data-del-source]").forEach((el) => (el.onclick = async () => {
      if (!confirm("¿Eliminar esta fuente? El link con ese código deja de funcionar para nuevas visitas (las estadísticas ya guardadas se conservan).")) return;
      await api(`/staff/card-sources/${el.dataset.delSource}`, { method: "DELETE" });
      renderCardSources();
    }));
  }

  document.getElementById("addCardSourceBtn").onclick = async () => {
    const input = document.getElementById("newCardSourceLabel");
    const label = input.value.trim();
    if (!label) return toast("Escribe un nombre para la fuente.", false);
    try {
      await api("/staff/card-sources", { method: "POST", body: { label } });
      input.value = "";
      renderCardSources();
    } catch (e) { toast(e.message, false); }
  };

  /* ---------- Analítica ---------- */
  async function renderAnalytics() {
    const wrap = document.getElementById("cardAnalyticsTable");
    const data = await api("/staff/card-analytics?days=30").catch(() => null);
    if (!data || !data.bySource.length) { wrap.innerHTML = `<p class="text-muted small mb-0">Sin visitas todavía en los últimos 30 días.</p>`; return; }
    wrap.innerHTML = `
      <div class="table-responsive">
        <table class="table table-sm">
          <thead><tr><th>Fuente</th><th class="text-end">Vistas</th><th class="text-end">Clicks</th></tr></thead>
          <tbody>
            ${data.bySource.map((s) => `<tr><td>${s.source}</td><td class="text-end">${s.views}</td><td class="text-end">${s.clicks}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
      ${data.clickTargets.length ? `<p class="label-xs mb-2 mt-2">Qué tocaron</p>
        <div class="d-flex flex-wrap gap-2">
          ${data.clickTargets.map((t) => `<span class="badge rounded-pill" style="background:#f0eee6;color:var(--ink);font-size:.75rem;padding:.4rem .7rem;">${t.target}: ${t.n}</span>`).join("")}
        </div>` : ""}`;
  }

  return { render };
})();
