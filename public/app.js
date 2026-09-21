// Cliente de API compartido por index.html (reserva pública), admin.html y setup.html. Todo va
// envuelto en un IIFE para no dejar `api`/`toast`/`tenantSlug` como identificadores globales: las
// páginas que consumen esto hacen `const { api, toast } = window.CDC`, y si esos mismos nombres
// quedaran declarados sueltos acá, el navegador tira "Identifier ya declarado" y el script entero
// de esa página deja de correr (así fallaban login y datos, en silencio, en todas las páginas).
(function () {
  // El negocio vive en /:slug (reserva) o /:slug/admin (panel) — siempre el primer segmento.
  function tenantSlug() {
    const parts = location.pathname.split("/").filter(Boolean);
    return parts[0] || new URLSearchParams(location.search).get("t");
  }

  async function request(url, opts = {}) {
    const res = await fetch(url, {
      method: opts.method || "GET",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  async function api(path, opts = {}) {
    const slug = tenantSlug();
    if (!slug) throw new Error("Falta el negocio en la URL (usa /tu-negocio).");
    return request(`/api/${slug}${path}`, opts);
  }

  // Endpoints que no son de un negocio (el super admin de la plataforma: /api/admin/...).
  async function apiRoot(path, opts = {}) {
    return request(`/api${path}`, opts);
  }

  function toast(msg, ok = true) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.style.cssText = "position:fixed;top:1rem;left:50%;transform:translateX(-50%);z-index:2000;padding:.6rem 1.1rem;border-radius:12px;font-size:.9rem;box-shadow:0 8px 24px rgba(0,0,0,.18);display:none;max-width:90%;text-align:center;color:#fff;";
      document.body.appendChild(el);
    }
    el.style.background = ok ? "#0a3a3d" : "#c0472f";
    el.textContent = msg;
    el.style.display = "block";
    clearTimeout(el._t);
    el._t = setTimeout(() => (el.style.display = "none"), 3200);
  }

  // ---- Helpers de fecha/hora + layout de solapes, compartidos por los módulos del panel admin
  // (admin-agenda.js, admin-calendar.js, admin-floorplan.js) para no repetir esta cuenta tres veces.
  const timeToMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
  const minToHHMM = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  const todayISO = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  };
  const dateToISO = (d) => {
    const c = new Date(d);
    c.setMinutes(c.getMinutes() - c.getTimezoneOffset());
    return c.toISOString().slice(0, 10);
  };
  function formatAMPM(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    const suffix = h < 12 ? "AM" : "PM";
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
  }
  function formatHourAMPM(h) {
    const suffix = h < 12 ? "AM" : "PM";
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return `${h12} ${suffix}`;
  }
  const MES_CORTO = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  function formatDateHuman(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return `${String(d).padStart(2, "0")} ${MES_CORTO[m - 1]} ${y}`;
  }

  // Agrupa items que se solapan en el tiempo (según getStart/getEnd, "HH:MM") y les asigna una
  // columna para mostrarlos lado a lado; marca item._conflict cuando comparte columna con otro.
  function layoutOverlaps(items, getStart, getEnd) {
    const arr = items.map((it) => ({ ref: it, sM: timeToMin(getStart(it)), eM: timeToMin(getEnd(it)) }))
      .sort((a, b) => a.sM - b.sM);
    let cluster = [], clusterEnd = -Infinity, clusters = [];
    arr.forEach((it) => {
      if (cluster.length && it.sM < clusterEnd) { cluster.push(it); clusterEnd = Math.max(clusterEnd, it.eM); }
      else { if (cluster.length) clusters.push(cluster); cluster = [it]; clusterEnd = it.eM; }
    });
    if (cluster.length) clusters.push(cluster);
    clusters.forEach((cl) => {
      const colEnds = [];
      cl.forEach((it) => {
        let col = colEnds.findIndex((end) => it.sM >= end);
        if (col === -1) { col = colEnds.length; colEnds.push(it.eM); } else { colEnds[col] = it.eM; }
        it.col = col;
      });
      const cols = colEnds.length;
      cl.forEach((it) => { it.cols = cols; it.ref._conflict = cols > 1; });
    });
    return arr;
  }

  // Horario efectivo de un día para el negocio o un especialista puntual — espejo en el cliente
  // de effectiveHours() en src/lib/availability.js. Prioridad: excepción puntual (especialista o
  // negocio) > patrón semanal propio del especialista (work_days/open_hour/close_hour) > horario
  // general del negocio. `specialist` es opcional (fila de specialists, no solo el id).
  function effectiveHours(business, exceptions, date, specialistId, specialist) {
    const specialistEx = specialistId ? exceptions.find((e) => e.specialist_id === specialistId && e.date === date) : null;
    const businessEx = exceptions.find((e) => !e.specialist_id && e.date === date);
    const ex = specialistEx || businessEx;
    if (ex) return ex.closed ? null : { open: ex.open_hour, close: ex.close_hour };

    const dow = new Date(date + "T00:00:00").getDay();

    if (specialist) {
      const workDays = JSON.parse(specialist.work_days || "[1,2,3,4,5,6]");
      if (!workDays.includes(dow)) return null;
      if (specialist.open_hour != null && specialist.close_hour != null) {
        return { open: specialist.open_hour, close: specialist.close_hour };
      }
    }

    const openDays = JSON.parse(business.open_days || "[1,2,3,4,5,6]");
    if (!openDays.includes(dow)) return null;
    return { open: business.open_hour, close: business.close_hour };
  }

  // Selector de color compartido (especialistas, espacios): 8 colores de ejemplo + uno "a tu
  // gusto" (input nativo type=color, mostrado como un círculo más con un ícono de gotero). Pinta
  // dentro de `container` y llama a onPick(hexColor) — quien lo usa se encarga de guardar el
  // valor y volver a llamar renderColorPicker para que se vea cuál quedó seleccionado.
  const PRESET_COLORS = ["#0f5257", "#d97a3f", "#3a6bc7", "#7a5a92", "#c0472f", "#1e6b45", "#8a6b4f", "#495057"];
  function renderColorPicker(container, current, onPick) {
    const isPreset = PRESET_COLORS.includes(current);
    container.innerHTML = PRESET_COLORS.map((c) => `
      <button type="button" class="color-swatch ${c === current ? "selected" : ""}" data-color="${c}" style="background:${c};" aria-label="${c}"></button>
    `).join("") + `
      <label class="color-swatch color-swatch-custom ${!isPreset && current ? "selected" : ""}" style="background:${!isPreset && current ? current : "#fff"};" title="Otro color">
        <input type="color" value="${!isPreset && current ? current : "#0f5257"}">
        <i class="bi bi-eyedropper"></i>
      </label>`;
    container.querySelectorAll("[data-color]").forEach((el) => (el.onclick = () => onPick(el.dataset.color)));
    container.querySelector(".color-swatch-custom input").oninput = (e) => onPick(e.target.value);
  }

  // Variantes de un color de tipo (espacios): traslúcido para fondos suaves, oscurecido para
  // bordes con más contraste — así un mismo color de tipo no se ve tan "plano"/saturado al llenar
  // un cuadro entero.
  function hexToRgb(hex) {
    let h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    if (isNaN(n) || h.length !== 6) return { r: 15, g: 82, b: 87 }; // #0f5257 (--primary) si no es un hex válido
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function colorAlpha(hex, alpha) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  function colorDarken(hex, amount = 0.3) {
    const { r, g, b } = hexToRgb(hex);
    const f = (c) => Math.max(0, Math.round(c * (1 - amount)));
    return `rgb(${f(r)},${f(g)},${f(b)})`;
  }

  window.CDC = {
    api, apiRoot, tenantSlug, toast,
    timeToMin, minToHHMM, todayISO, dateToISO, formatAMPM, formatHourAMPM, formatDateHuman,
    layoutOverlaps, effectiveHours, renderColorPicker, colorAlpha, colorDarken,
  };
})();
