// Tarjeta digital (link-in-bio): contenido (bio/dirección), links, fuentes rastreables y su
// analítica. Mismo molde IIFE que los demás módulos del panel (ver nota en admin-rules.js).
window.Tarjeta = (function () {
  const { api, toast, tenantSlug } = window.CDC;

  // Catálogo de redes/páginas comunes — evita que el negocio tenga que adivinar el nombre de una
  // clase de bootstrap-icons a mano; elige de la lista y el ícono/nombre se llenan solos. "Otro"
  // queda al final para cualquier cosa que no esté en la lista (sitio propio de reservas, etc.).
  const PLATFORMS = [
    { label: "Instagram", icon: "bi-instagram" },
    { label: "Facebook", icon: "bi-facebook" },
    { label: "WhatsApp", icon: "bi-whatsapp" },
    { label: "TikTok", icon: "bi-tiktok" },
    { label: "YouTube", icon: "bi-youtube" },
    { label: "X (Twitter)", icon: "bi-twitter-x" },
    { label: "Threads", icon: "bi-threads" },
    { label: "LinkedIn", icon: "bi-linkedin" },
    { label: "Pinterest", icon: "bi-pinterest" },
    { label: "Snapchat", icon: "bi-snapchat" },
    { label: "Telegram", icon: "bi-telegram" },
    { label: "Discord", icon: "bi-discord" },
    { label: "Spotify", icon: "bi-spotify" },
    { label: "Sitio web", icon: "bi-globe" },
    { label: "Ubicación / Google Maps", icon: "bi-geo-alt-fill" },
    { label: "Correo", icon: "bi-envelope-fill" },
    { label: "Teléfono", icon: "bi-telephone-fill" },
    { label: "Otro", icon: "bi-link-45deg" },
  ];
  const OTHER_INDEX = PLATFORMS.length - 1;

  function fillPlatformSelect(select) {
    select.innerHTML = PLATFORMS.map((p, i) => `<option value="${i}">${p.label}</option>`).join("");
  }

  let cardLinksCache = [];
  let editCardLinkModal = null;
  let editingCardLinkId = null;
  let currentBusiness = null;
  let pendingCardLat = null;
  let pendingCardLng = null;

  // La tarjeta se edita mostrándose a sí misma (no un formulario aparte) — se pinta igual que
  // tarjeta.html y cada pieza (bio, dirección, destacados, links) se edita tocándola ahí mismo.
  async function render() {
    const url = `${location.origin}/${tenantSlug()}/tarjeta`;
    document.getElementById("cardPreviewLink").href = url;

    fillPlatformSelect(document.getElementById("editCardLinkPlatform"));
    fillPlatformSelect(document.getElementById("newCardSourcePlatform"));

    currentBusiness = await api("/staff/settings").catch(() => null);
    if (currentBusiness) {
      document.getElementById("cardNamePreview").textContent = currentBusiness.name;
      if (currentBusiness.logo_key) {
        document.getElementById("cardLogoPreview").innerHTML = `<img src="/api/${tenantSlug()}/public/files/${currentBusiness.logo_key}" style="width:100%;height:100%;object-fit:cover;">`;
      }
      renderBioDisplay(currentBusiness.card_bio);
      renderAddressDisplay(currentBusiness.card_address, currentBusiness.card_lat, currentBusiness.card_lng);
      document.getElementById("cardHoursPreview").textContent = hoursText(
        JSON.parse(currentBusiness.open_days || "[1,2,3,4,5,6]"), currentBusiness.open_hour, currentBusiness.close_hour);
    }

    await renderCardLinks();
    await renderFeaturedPicker();
    await renderCardSources();
    await renderAnalytics();
  }

  /* ---------- Logo (clic para cambiarlo) ---------- */
  // Se ve como círculo en la tarjeta — se recorta cuadrado (aspectRatio 1) igual que antes en
  // Ajustes, pero acá se sube de una vez, sin un botón "Guardar" aparte, para que se sienta como
  // parte de la tarjeta y no como un formulario.
  async function pickAndUploadLogo() {
    const input = document.getElementById("cardLogoFile");
    input.value = "";
    input.click();
  }
  document.getElementById("cardLogoPreview").onclick = pickAndUploadLogo;
  document.getElementById("cardLogoEditBtn").onclick = pickAndUploadLogo;
  document.getElementById("cardLogoFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const blob = await window.ImgCropper.open(file, { aspectRatio: 1 });
    if (!blob) return;
    try {
      const fd = new FormData();
      fd.append("file", blob, "logo.png");
      const res = await fetch(`/api/${tenantSlug()}/staff/upload`, { method: "POST", credentials: "include", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo subir la imagen.");
      await api("/staff/settings", { method: "PATCH", body: { logoKey: data.name } });
      currentBusiness.logo_key = data.name;
      document.getElementById("cardLogoPreview").innerHTML = `<img src="/api/${tenantSlug()}/public/files/${data.name}" style="width:100%;height:100%;object-fit:cover;">`;
      toast("Logo guardado.");
    } catch (e) { toast(e.message, false); }
  });

  function hoursText(openDays, openHour, closeHour) {
    const dows = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    const to12h = (h) => { const ap = h >= 12 ? "PM" : "AM"; let h12 = h % 12; if (h12 === 0) h12 = 12; return `${h12}${ap}`; };
    const sorted = [...openDays].sort();
    const days = sorted.length === 7 ? "Todos los días" : sorted.map((d) => dows[d]).join(", ");
    return `${days} · ${to12h(openHour)} - ${to12h(closeHour)}`;
  }

  /* ---------- Bio (clic para editar) ---------- */
  function renderBioDisplay(bio) {
    const display = document.getElementById("cardBioDisplay");
    display.textContent = bio || "Toca para escribir una bio corta";
    display.classList.toggle("fst-italic", !bio);
  }
  document.getElementById("cardBioDisplay").onclick = () => {
    document.getElementById("cardBioInput").value = currentBusiness.card_bio || "";
    document.getElementById("cardBioDisplay").style.display = "none";
    document.getElementById("cardBioEditor").style.display = "block";
    document.getElementById("cardBioInput").focus();
  };
  document.getElementById("cardBioCancelBtn").onclick = () => {
    document.getElementById("cardBioEditor").style.display = "none";
    document.getElementById("cardBioDisplay").style.display = "block";
  };
  document.getElementById("cardBioSaveBtn").onclick = async () => {
    const value = document.getElementById("cardBioInput").value.trim() || null;
    try {
      await api("/staff/settings", { method: "PATCH", body: { cardBio: value } });
      currentBusiness.card_bio = value;
      renderBioDisplay(value);
      document.getElementById("cardBioEditor").style.display = "none";
      document.getElementById("cardBioDisplay").style.display = "block";
    } catch (e) { toast(e.message, false); }
  };

  /* ---------- Dirección (clic para editar) ---------- */
  // El estado del mapa se muestra SIEMPRE visible (no solo al entrar a editar) — así se nota de
  // una si falta configurarlo, sin tener que tocar la dirección primero para descubrirlo.
  function renderAddressDisplay(address, lat, lng) {
    document.getElementById("cardAddressText").textContent = address || "Toca para poner la dirección";
    document.getElementById("cardMapStatusBadge").innerHTML = (lat != null && lng != null)
      ? `<span style="color:#1e6b45;"><i class="bi bi-check-circle-fill"></i> Mapa configurado</span>`
      : `<span style="color:var(--danger);"><i class="bi bi-exclamation-circle-fill"></i> Sin ubicación en el mapa — toca aquí para configurarla</span>`;
  }
  function renderLocationStatus() {
    const status = document.getElementById("cardLocationStatus");
    const preview = document.getElementById("cardLocationPreview");
    if (pendingCardLat != null && pendingCardLng != null) {
      status.textContent = "Ubicación en el mapa: guardada ✓ — revisa abajo que el pin quede en el lugar correcto.";
      document.getElementById("cardLocationPreviewFrame").src = `https://maps.google.com/maps?q=${pendingCardLat},${pendingCardLng}&z=16&output=embed`;
      preview.style.display = "block";
    } else {
      status.textContent = "Sin ubicación en el mapa todavía (el mapa y la distancia no se muestran sin esto).";
      preview.style.display = "none";
    }
  }
  document.getElementById("cardAddressDisplay").onclick = () => {
    document.getElementById("cardAddressInput").value = currentBusiness.card_address || "";
    document.getElementById("cardMapLinkInput").value = "";
    pendingCardLat = currentBusiness.card_lat;
    pendingCardLng = currentBusiness.card_lng;
    renderLocationStatus();
    document.getElementById("cardAddressDisplay").style.display = "none";
    document.getElementById("cardAddressEditor").style.display = "block";
    document.getElementById("cardAddressInput").focus();
  };
  // Tres formas de conseguir lat/lng, sin API de mapas con costo/llave:
  // 1) la ubicación del NAVEGADOR DEL NEGOCIO (quien está editando, parado en el local),
  // 2) un link de Google Maps pegado a mano (incluye links cortos, se sigue la redirección),
  // 3) buscar el texto de la dirección con Nominatim (OpenStreetMap) — la más imprecisa de las
  //    tres para direcciones colombianas, por eso siempre se muestra el mapa para confirmar.
  document.getElementById("cardLocationBtn").onclick = () => {
    if (!navigator.geolocation) return toast("Tu navegador no soporta ubicación.", false);
    const btn = document.getElementById("cardLocationBtn");
    btn.disabled = true;
    navigator.geolocation.getCurrentPosition((pos) => {
      pendingCardLat = pos.coords.latitude;
      pendingCardLng = pos.coords.longitude;
      renderLocationStatus();
      btn.disabled = false;
    }, () => {
      toast("No se pudo obtener tu ubicación — revisa el permiso del navegador, o usa el link de Google Maps.", false);
      btn.disabled = false;
    }, { enableHighAccuracy: true, timeout: 10000 });
  };
  async function geocodeInto(query, btn, busyLabel) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = busyLabel;
    try {
      const { lat, lng } = await api("/staff/geocode", { method: "POST", body: { query } });
      pendingCardLat = lat;
      pendingCardLng = lng;
      renderLocationStatus();
    } catch (e) { toast(e.message, false); }
    btn.disabled = false;
    btn.textContent = original;
  }
  document.getElementById("cardGeocodeAddressBtn").onclick = () => {
    const address = document.getElementById("cardAddressInput").value.trim();
    if (!address) return toast("Escribe la dirección primero.", false);
    geocodeInto(address, document.getElementById("cardGeocodeAddressBtn"), "Buscando…");
  };
  document.getElementById("cardGeocodeLinkBtn").onclick = () => {
    const link = document.getElementById("cardMapLinkInput").value.trim();
    if (!link) return toast("Pega un link de Google Maps.", false);
    geocodeInto(link, document.getElementById("cardGeocodeLinkBtn"), "Buscando…");
  };
  document.getElementById("cardAddressCancelBtn").onclick = () => {
    document.getElementById("cardAddressEditor").style.display = "none";
    document.getElementById("cardAddressDisplay").style.display = "flex";
  };
  document.getElementById("cardAddressSaveBtn").onclick = async () => {
    const value = document.getElementById("cardAddressInput").value.trim() || null;
    try {
      await api("/staff/settings", { method: "PATCH", body: { cardAddress: value, cardLat: pendingCardLat, cardLng: pendingCardLng } });
      currentBusiness.card_address = value;
      currentBusiness.card_lat = pendingCardLat;
      currentBusiness.card_lng = pendingCardLng;
      renderAddressDisplay(value, pendingCardLat, pendingCardLng);
      document.getElementById("cardAddressEditor").style.display = "none";
      document.getElementById("cardAddressDisplay").style.display = "flex";
    } catch (e) { toast(e.message, false); }
  };

  /* ---------- Servicios destacados (clic para marcar/quitar) ---------- */
  async function renderFeaturedPicker() {
    const services = await api("/staff/services").catch(() => []);
    const wrap = document.getElementById("cardFeaturedPicker");
    wrap.innerHTML = services.length ? services.map((s) => `
      <button type="button" class="chip ${s.featured ? "active" : ""}" data-toggle-featured="${s.id}">
        <i class="bi ${s.featured ? "bi-star-fill" : "bi-star"}"></i> ${s.name}
      </button>`).join("") : `<p class="text-muted small mb-0">Crea servicios en Reglas primero.</p>`;
    wrap.querySelectorAll("[data-toggle-featured]").forEach((el) => (el.onclick = async () => {
      const svc = services.find((s) => s.id === el.dataset.toggleFeatured);
      try {
        await api(`/staff/services/${svc.id}`, { method: "PATCH", body: { featured: !svc.featured } });
        renderFeaturedPicker();
      } catch (e) { toast(e.message, false); }
    }));
  }

  /* ---------- Links ---------- */
  async function renderCardLinks() {
    cardLinksCache = await api("/staff/card-links").catch(() => []);
    const wrap = document.getElementById("cardLinksList");
    wrap.innerHTML = cardLinksCache.length ? cardLinksCache.map((l) => `
      <div class="d-flex justify-content-between align-items-center gap-2 p-2" style="border:1px solid var(--line);border-radius:10px;">
        <div class="d-flex align-items-center gap-2" style="min-width:0;">
          <i class="bi ${l.icon || "bi-link-45deg"}" style="color:var(--primary);"></i>
          <span class="fw-semibold small text-truncate">${l.label}</span>
        </div>
        <button class="btn btn-sm btn-outline-dark flex-shrink-0" data-edit-link="${l.id}"><i class="bi bi-pencil"></i></button>
      </div>`).join("") : `<p class="text-muted small mb-0">Sin links todavía.</p>`;
    wrap.querySelectorAll("[data-edit-link]").forEach((el) => (el.onclick = () => openEditCardLink(el.dataset.editLink)));
  }

  // Refleja la plataforma elegida: ícono de vista previa, y el campo de ícono personalizado solo
  // se muestra para "Otro" (con las demás, el ícono lo decide el catálogo, no hay que escribirlo).
  function applyPlatformSelection(autoFillLabel) {
    const idx = Number(document.getElementById("editCardLinkPlatform").value);
    const platform = PLATFORMS[idx] || PLATFORMS[OTHER_INDEX];
    const isOther = idx === OTHER_INDEX;
    document.getElementById("editCardLinkIconWrap").style.display = isOther ? "block" : "none";
    const icon = isOther ? (document.getElementById("editCardLinkIcon").value.trim() || platform.icon) : platform.icon;
    document.getElementById("editCardLinkIconPreview").className = `bi ${icon}`;
    if (autoFillLabel && !isOther) {
      const labelInput = document.getElementById("editCardLinkLabel");
      if (!labelInput.value.trim()) labelInput.value = platform.label;
    }
  }
  document.getElementById("editCardLinkPlatform").onchange = () => applyPlatformSelection(true);
  document.getElementById("editCardLinkIcon").addEventListener("input", () => applyPlatformSelection(false));

  function platformIndexForIcon(icon) {
    const idx = PLATFORMS.findIndex((p) => p.icon === icon);
    return idx === -1 ? OTHER_INDEX : idx;
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
    document.getElementById("editCardLinkPlatform").value = platformIndexForIcon(l.icon);
    applyPlatformSelection(false);
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
    document.getElementById("editCardLinkPlatform").value = 0;
    applyPlatformSelection(true);
    editCardLinkModal = editCardLinkModal || new bootstrap.Modal(document.getElementById("editCardLinkModal"));
    editCardLinkModal.show();
  };

  document.getElementById("editCardLinkSaveBtn").onclick = async () => {
    const label = document.getElementById("editCardLinkLabel").value.trim();
    const url = document.getElementById("editCardLinkUrl").value.trim();
    if (!label || !url) return toast("Ponle un nombre y una URL al link.", false);
    const idx = Number(document.getElementById("editCardLinkPlatform").value);
    const isOther = idx === OTHER_INDEX;
    const icon = isOther ? (document.getElementById("editCardLinkIcon").value.trim() || null) : PLATFORMS[idx].icon;
    const data = { label, url, icon };
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

  /* ---------- Fuentes rastreables (cada una con su propia gráfica de actividad debajo) ----------
     Los tabs Día/Semana/Mes viven arriba de toda la lista (un solo control para todas las
     tarjetas), pero la gráfica de cada fuente es independiente: barra apilada por MÉTRICA
     (vista/click/reserva, no por fuente — acá cada gráfica ya es de una sola fuente). */
  const METRIC_COLORS = { views: "#0f5257", clicks: "#3a6bc7", bookings: "#1e6b45" };
  let tsGranularity = "day";

  document.querySelectorAll("#cardTsTabs .chip").forEach((btn) => (btn.onclick = () => {
    tsGranularity = btn.dataset.g;
    renderCardSources();
  }));

  function bucketLabel(bucket, granularity) {
    if (granularity === "day") return `${Number(bucket)}h`; // hora del día: "00".."23" -> "0h".."23h"
    const parts = bucket.split("-"); // YYYY-MM-DD
    if (granularity === "week") {
      const dows = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
      return `${dows[new Date(bucket + "T12:00:00Z").getUTCDay()]} ${parts[2]}`;
    }
    return `${parts[2]}/${parts[1]}`; // mes: fecha en que empieza esa semana
  }

  const TREND_COLOR = "#e0a339"; // --amber, se distingue bien de los 3 colores de métrica

  // La línea de tendencia sigue las VISITAS (no el total apilado) — queda justo en el borde de
  // arriba del segmento de vistas de cada barra (que va abajo del todo en el stack), así se ve de
  // una si las visitas van subiendo o bajando en el período elegido.
  function sourceChartHTML(buckets, sourceCode, granularity) {
    const perBucket = buckets.map((b) => b.bySource[sourceCode] || { views: 0, clicks: 0, bookings: 0 });
    const totals = perBucket.map((s) => (s.views || 0) + (s.clicks || 0) + (s.bookings || 0));
    const max = Math.max(...totals, 1);
    const n = buckets.length;
    const points = perBucket.map((s, i) => {
      const x = ((i + 0.5) / n) * 100;
      const y = 100 - Math.min(((s.views || 0) / max) * 100, 100);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
    return `<div class="ts-chart-wrap">
      <svg class="ts-trend" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points="${points}" fill="none" stroke="${TREND_COLOR}" stroke-width="2.5" vector-effect="non-scaling-stroke" />
      </svg>
      <div class="ts-chart-full">
        ${buckets.map((b, i) => {
          const s = perBucket[i];
          return `
          <div class="ts-bucket-full" title="Vistas: ${s.views} · Clicks: ${s.clicks} · Reservas: ${s.bookings}">
            <div class="ts-bar-stack-full">
              ${["views", "clicks", "bookings"].map((k) => s[k] ? `<div style="height:${Math.max((s[k] / max) * 100, 3)}%;background:${METRIC_COLORS[k]};"></div>` : "").join("")}
            </div>
            <span class="ts-label">${bucketLabel(b.bucket, granularity)}</span>
          </div>`;
        }).join("")}
      </div>
    </div>`;
  }

  function sourceBlockHTML(source, buckets, granularity) {
    const header = source.link ? `
      <div class="d-flex justify-content-between align-items-center mb-2">
        <div class="flex-grow-1 me-2" style="min-width:0;">
          <div class="fw-semibold small">${source.label}</div>
          <div class="text-muted small text-truncate">${source.link}</div>
        </div>
        <div class="d-flex gap-1 flex-shrink-0">
          <button class="btn btn-sm btn-outline-dark" data-copy-source="${source.link}"><i class="bi bi-clipboard"></i></button>
          <button class="btn btn-sm btn-outline-danger" data-del-source="${source.id}"><i class="bi bi-trash3"></i></button>
        </div>
      </div>` : `
      <div class="fw-semibold small mb-2">${source.label} <span class="text-muted fw-normal">— visitas directas a la tarjeta, sin link rastreable</span></div>`;
    return `<div class="p-3" style="border:1px solid var(--line);border-radius:12px;min-width:0;">
      ${header}
      ${sourceChartHTML(buckets, source.code, granularity)}
    </div>`;
  }

  async function renderCardSources() {
    document.querySelectorAll("#cardTsTabs .chip").forEach((b) => b.classList.toggle("active", b.dataset.g === tsGranularity));
    const [sources, tsData] = await Promise.all([
      api("/staff/card-sources").catch(() => []),
      api(`/staff/card-timeseries?granularity=${tsGranularity}`).catch(() => null),
    ]);
    const buckets = tsData ? tsData.buckets : [];
    const granularity = tsData ? tsData.granularity : tsGranularity;

    const blocks = sources.map((s) => sourceBlockHTML({
      label: s.label, id: s.id, code: s.code,
      link: `${location.origin}/${tenantSlug()}/tarjeta?src=${encodeURIComponent(s.code)}`,
    }, buckets, granularity));

    // Visitas directas a la tarjeta (sin ?src=) — se muestran solo si de verdad tuvieron actividad.
    const directHasActivity = buckets.some((b) => { const c = b.bySource["(sin fuente)"]; return c && (c.views || c.clicks || c.bookings); });
    if (directHasActivity) blocks.push(sourceBlockHTML({ label: "(sin fuente)", code: "(sin fuente)", link: null }, buckets, granularity));

    const wrap = document.getElementById("cardSourcesList");
    wrap.innerHTML = blocks.length ? `
      <div class="d-flex flex-wrap gap-3 mb-3">
        <span class="small text-muted"><span class="ts-legend-dot" style="background:${METRIC_COLORS.views};"></span>Vistas</span>
        <span class="small text-muted"><span class="ts-legend-dot" style="background:${METRIC_COLORS.clicks};"></span>Clicks</span>
        <span class="small text-muted"><span class="ts-legend-dot" style="background:${METRIC_COLORS.bookings};"></span>Reservas</span>
        <span class="small text-muted"><span class="ts-legend-line" style="background:${TREND_COLOR};"></span>Tendencia de vistas</span>
      </div>
      <div class="card-sources-grid">${blocks.join("")}</div>` : `<p class="text-muted small mb-0">Sin fuentes todavía — crea la primera arriba.</p>`;

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

  // El select solo llena el texto (no manda un ícono ni nada más) — la fuente sigue siendo un
  // simple nombre; así se puede escribir algo como "Instagram" y luego ajustarlo a "Instagram -
  // Bio" o "Instagram - Historia" para separar varias fuentes de la misma red.
  document.getElementById("newCardSourcePlatform").onchange = () => {
    const idx = Number(document.getElementById("newCardSourcePlatform").value);
    const label = document.getElementById("newCardSourceLabel");
    if (!label.value.trim() && PLATFORMS[idx]) label.value = PLATFORMS[idx].label;
  };

  document.getElementById("addCardSourceBtn").onclick = async () => {
    const input = document.getElementById("newCardSourceLabel");
    const label = input.value.trim();
    if (!label) return toast("Escribe o elige un nombre para la fuente.", false);
    try {
      await api("/staff/card-sources", { method: "POST", body: { label } });
      input.value = "";
      document.getElementById("newCardSourcePlatform").value = 0;
      renderCardSources();
    } catch (e) { toast(e.message, false); }
  };

  /* ---------- Analítica ---------- */
  async function renderAnalytics() {
    const data = await api("/staff/card-analytics?days=30").catch(() => null);
    renderFunnel(data);
    renderClickTargets(data);
    renderRecentBookings(data);
  }

  // Embudo: vistas de la tarjeta -> clicks en "Reservar" -> citas realmente agendadas (con
  // cualquier fuente, ver src/routes/card.js). Cada barra se compara contra las vistas (el tope),
  // y se muestra qué % pasó del escalón anterior al siguiente.
  function renderFunnel(data) {
    const wrap = document.getElementById("cardFunnel");
    if (!data) { wrap.innerHTML = `<p class="text-muted small mb-0">Sin datos todavía.</p>`; return; }
    const stages = [
      { label: "Vistas de la tarjeta", value: data.funnel.views, color: "#0f5257" },
      { label: 'Clicks en "Reservar"', value: data.funnel.reservarClicks, color: "#3a6bc7" },
      { label: "Citas agendadas", value: data.funnel.bookings, color: "#1e6b45" },
    ];
    if (!stages[0].value) { wrap.innerHTML = `<p class="text-muted small mb-0">Sin visitas todavía en los últimos 30 días.</p>`; return; }
    const max = stages[0].value;
    wrap.innerHTML = stages.map((s, i) => {
      const pct = Math.max(Math.round((s.value / max) * 100), s.value > 0 ? 3 : 0);
      const fromPrev = i > 0 && stages[i - 1].value > 0 ? Math.round((s.value / stages[i - 1].value) * 100) : null;
      return `
        <div class="mb-3">
          <div class="d-flex justify-content-between small mb-1">
            <span class="fw-semibold">${s.label}</span>
            <span class="text-muted">${s.value}${fromPrev !== null ? ` · ${fromPrev}% del paso anterior` : ""}</span>
          </div>
          <div style="background:#f0eee6;border-radius:8px;height:24px;overflow:hidden;">
            <div style="width:${pct}%;background:${s.color};height:100%;"></div>
          </div>
        </div>`;
    }).join("");
  }

  function renderClickTargets(data) {
    const wrap = document.getElementById("cardClickTargets");
    if (!data || !data.clickTargets.length) { wrap.innerHTML = ""; return; }
    wrap.innerHTML = `<p class="label-xs mb-2">Qué tocaron</p>
      <div class="d-flex flex-wrap gap-2">
        ${data.clickTargets.map((t) => `<span class="badge rounded-pill" style="background:#f0eee6;color:var(--ink);font-size:.75rem;padding:.4rem .7rem;">${t.target}: ${t.n}</span>`).join("")}
      </div>`;
  }

  // Quién agendó desde cada fuente (nombre + celular) — para identificar de verdad quién llegó
  // por dónde, no solo cuántos.
  function renderRecentBookings(data) {
    const wrap = document.getElementById("cardRecentBookings");
    if (!data || !data.recentBookings.length) { wrap.innerHTML = ""; return; }
    wrap.innerHTML = `<p class="label-xs mb-2">Quién agendó (últimas ${data.recentBookings.length})</p>
      <div class="table-responsive">
        <table class="table table-sm">
          <thead><tr><th>Fuente</th><th>Cliente</th><th>Celular</th><th>Cita</th></tr></thead>
          <tbody>
            ${data.recentBookings.map((b) => `<tr><td>${b.source}</td><td>${b.clientName}</td><td>${b.clientPhone || "—"}</td><td>${b.date} ${b.start}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  return { render };
})();
