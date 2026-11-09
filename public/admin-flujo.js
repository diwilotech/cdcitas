// Flujo: métricas de operación e ingresos, consumiendo GET /staff/flujo. Los gráficos (donut y
// barras) son SVG puro, sin librerías — se calculan acá mismo, no hay nada más que reusar.
window.Flujo = (function () {
  const { api } = window.CDC;

  function money(n) { return "$" + Number(n || 0).toLocaleString("es-CO"); }

  function donut(container, { total, segments, centerLabel, centerSub }) {
    const size = 160, stroke = 18, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    let offset = 0;
    const arcs = segments.map((seg) => {
      const frac = total > 0 ? seg.value / total : 0;
      const dash = frac * c;
      const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${stroke}"
        stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
      offset += dash;
      return el;
    });
    container.innerHTML = `<svg width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#f0eee6" stroke-width="${stroke}"/>${arcs.join("")}
    </svg><div class="center-label"><span class="metric-value" style="font-size:1.5rem;">${centerLabel}</span><span class="small text-muted">${centerSub}</span></div>`;
  }

  function bars(container, data, formatValue) {
    const max = Math.max(...data.map((d) => d.value), 1);
    container.innerHTML = data.map((d) => {
      const h = Math.max(6, Math.round((d.value / max) * 100));
      return `<div class="bar-col">
        <span class="small text-muted" style="font-size:.65rem;">${formatValue(d.value)}</span>
        <div class="bar-fill" style="height:${h}%"></div>
        <span class="small fw-semibold text-muted" style="font-size:.65rem;">${d.label}</span>
      </div>`;
    }).join("");
  }

  async function render() {
    const f = await api("/staff/flujo").catch(() => null);
    if (!f) return;

    document.getElementById("activeAgendaCount").textContent = f.activeToday;
    document.getElementById("flujoToday").textContent = money(f.todayRevenue);
    const delta = f.yesterdayRevenue > 0 ? Math.round(((f.todayRevenue - f.yesterdayRevenue) / f.yesterdayRevenue) * 100) : 0;
    document.getElementById("flujoDelta").innerHTML = `<span style="color:${delta >= 0 ? "var(--primary)" : "var(--danger)"}">
      <i class="bi bi-arrow-${delta >= 0 ? "up" : "down"}-right"></i> ${Math.abs(delta)}% vs ayer</span>`;
    document.getElementById("flujoPending").textContent = f.pendingPayments;

    document.getElementById("noShowRateValue").textContent = f.noShowRate.value + "%";
    const nsDelta = Math.round((f.noShowRate.value - f.noShowRate.previousValue) * 10) / 10;
    document.getElementById("noShowRateDelta").innerHTML = `<span style="color:${nsDelta <= 0 ? "var(--primary)" : "var(--danger)"}">
      <i class="bi bi-arrow-${nsDelta <= 0 ? "down" : "up"}-right"></i> ${Math.abs(nsDelta)}% vs período anterior</span>`;

    const sc = f.statusCounts;
    const totalStatus = sc.completed + sc.pending + sc.cancelledOrNoShow;
    donut(document.getElementById("statusDonut"), {
      total: totalStatus, centerLabel: totalStatus, centerSub: "Citas (30 días)",
      segments: [
        { value: sc.completed, color: "#12211f" },
        { value: sc.pending, color: "rgba(15,82,87,.35)" },
        { value: sc.cancelledOrNoShow, color: "#c0472f" },
      ],
    });

    const dows = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    bars(document.getElementById("flujoBars"),
      f.last7Days.map((d) => ({ label: dows[new Date(d.date + "T00:00:00").getDay()], value: d.revenue })),
      (v) => "$" + Math.round(v / 1000) + "k");

    profundidad(f).catch(() => {});

    const maxService = Math.max(...f.byService.map((s) => s.revenue), 1);
    document.getElementById("flujoByService").innerHTML = f.byService.length ? f.byService.map((s) => `
      <div>
        <div class="d-flex justify-content-between small mb-1"><span class="fw-semibold">${s.service}</span><span class="text-muted">${money(s.revenue)}</span></div>
        <div class="progress" style="height:8px;border-radius:6px;"><div class="progress-bar" style="width:${(s.revenue / maxService) * 100}%;background:var(--accent);"></div></div>
      </div>`).join("") : `<p class="text-muted small mb-0">Todavía no hay citas completadas.</p>`;
  }

  // Descarga un CSV autenticado por la cookie de sesión
  async function descargar(ruta, nombre) {
    const slug = (location.pathname.split("/").filter(Boolean)[0]) || "";
    const r = await fetch(`/api/${slug}${ruta}`, { credentials: "same-origin" });
    if (!r.ok) { window.CDC.toast("No se pudo descargar", false); return; }
    const a = document.createElement("a"); a.href = URL.createObjectURL(await r.blob()); a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  document.getElementById("csvCitas")?.addEventListener("click", () => descargar("/staff/export/citas", "citas.csv"));
  document.getElementById("csvClientes")?.addEventListener("click", () => descargar("/staff/export/clientes", "clientes.csv"));

  // Más profundidad con el kit común (dwviz): especialistas, días, mejores clientes y embudo
  async function profundidad(f) {
    const V = window.DwViz; if (!V) return;
    const num = (v) => Number(v || 0).toLocaleString("es-CO");
    if (f.bySpecialist?.length) V.ranking(document.getElementById("flujoSpec"), f.bySpecialist.map((x) => ({ nombre: x.name, valor: x.citas, detalle: money(x.revenue) })), { fmt: num });
    else V.vacio(document.getElementById("flujoSpec"), { icono: "bi-person-badge", titulo: "Sin citas todavía", texto: "Aquí verás quién atiende más." });
    const dows = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    V.barras(document.getElementById("flujoDow"), { etiquetas: dows, series: [{ nombre: "Citas", datos: f.byDow }], fmt: num });
    if (f.topClients?.length) V.ranking(document.getElementById("flujoTop"), f.topClients.map((x) => ({ nombre: x.name, valor: x.revenue, detalle: `${x.citas} ${x.citas === 1 ? "cita" : "citas"}` })), { fmt: money });
    else V.vacio(document.getElementById("flujoTop"), { icono: "bi-people", titulo: "Aún sin ingresos", texto: "Aparecen cuando completes citas." });
    await embudo();
  }
  async function embudo() {
    const V = window.DwViz, host = document.getElementById("flujoKanban"); if (!V || !host) return;
    const { rows, today } = await api("/staff/embudo").catch(() => ({ rows: [], today: "" }));
    const COLS = [["pending", "Por confirmar", "#FBBF24", (r) => r.status === "pending_confirmation"], ["confirmed", "Confirmadas", "#60A5FA", (r) => r.status === "confirmed"],
      ["reagendar", "Por reagendar", "#F472B6", (r) => r.status === "reagendar"], ["completed", "Completadas", "#34D399", (r) => r.status === "completed"], ["lost", "Canceladas / no vino", "#F87171", (r) => ["cancelled", "no-show"].includes(r.status)]];
    const pintar = () => V.kanban(host, { fmt: money,
      columnas: COLS.map(([id, titulo, color, test]) => ({ id, titulo, color, items: rows.filter(test).map((r) => ({ id: r.id, titulo: r.client, detalle: `${r.date === today ? "hoy" : r.date} ${r.start} · ${r.service} · ${r.specialist}`, valor: r.price })) })),
      mover: async (id, desde, hasta) => {
        if (hasta !== "completed") { window.CDC.toast("Para cancelar o reagendar usa la Agenda: así se avisa al cliente", false); return; }
        try { await api(`/staff/appointments/${id}/complete`, { method: "POST" }); const r = rows.find((x) => x.id === id); if (r) r.status = "completed"; window.CDC.toast("Cita completada"); pintar(); } catch (e) { window.CDC.toast(e.message || "No se pudo", false); }
      } });
    pintar();
  }

  return { render };
})();
