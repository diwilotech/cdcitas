// Shell del panel: login, logout, pestañas (bottom-nav) y arranque de cada módulo
// (Agenda/MonthCalendar/FloorPlan/Rules/Flujo, cada uno en su propio admin-*.js).
//
// Todo el contenido va dentro de un IIFE asignado a una propiedad de window (nunca a un
// `const`/`function` de nivel superior): admin.html carga varios <script src> en la misma
// página, y todos comparten un único scope léxico superior — si dos de ellos declararan el
// mismo `const api` o `const toast` sueltos, el navegador tira "Identifier ya declarado" y el
// script entero de esa página deja de correr (así fallaban login y datos, en silencio, en toda
// la sesión anterior). Cada admin-*.js sigue este mismo patrón.
window.AdminShell = (function () {
  const CDC = window.CDC || {};
  const api = CDC.api;
  const tenantSlug = CDC.tenantSlug;
  const toast = CDC.toast || function (msg, ok = true) {
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText = `position:fixed;top:1rem;left:50%;transform:translateX(-50%);z-index:2000;padding:.6rem 1.1rem;border-radius:12px;font-size:.9rem;box-shadow:0 8px 24px rgba(0,0,0,.18);max-width:90%;text-align:center;color:#fff;background:${ok ? "#0a3a3d" : "#c0472f"};`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  };
  if (typeof api !== "function") {
    toast("No cargó app.js. Recarga con Ctrl+Shift+R o revisa la consola del navegador (F12).", false);
  }

  const VIEWS = ["agenda", "calendario", "espacio", "reglas", "clientes", "tarjeta", "flujo", "ajustes"];
  const VIEW_TITLES = { agenda: "Agenda", calendario: "Calendario", espacio: "Espacio", reglas: "Reglas", clientes: "Clientes", tarjeta: "Tarjeta", flujo: "Flujo", ajustes: "Ajustes" };

  function syncHeaderHeight() {
    const h = document.querySelector("header.topbar").offsetHeight;
    document.documentElement.style.setProperty("--header-h", `${h}px`);
  }
  window.addEventListener("resize", syncHeaderHeight);

  function goView(view) {
    VIEWS.forEach((v) => { document.getElementById(`view-${v}`).style.display = v === view ? "block" : "none"; });
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    document.querySelectorAll(".header-action").forEach((b) => b.classList.toggle("d-none", b.dataset.view !== view));
    document.getElementById("pageTitle").textContent = VIEW_TITLES[view] || "Panel";
    syncHeaderHeight();
    if (view === "agenda") window.Agenda.render();
    if (view === "calendario") window.MonthCalendar.render();
    if (view === "espacio") window.FloorPlan.render();
    if (view === "reglas") window.Rules.render();
    if (view === "clientes") window.Clients.render();
    if (view === "tarjeta") window.Tarjeta.render();
    if (view === "flujo") window.Flujo.render();
    if (view === "ajustes") { loadAjustes(); renderTemplates(); }
  }

  async function boot() {
    // Link de invitación: /:slug/admin#invite=<token> (en el fragmento, no queda en logs).
    const invite = new URLSearchParams(location.hash.slice(1)).get("invite");
    if (invite) return showInvite(invite);
    try {
      showApp(await api("/staff/me"));
    } catch {
      showLogin();
    }
  }

  // Pantalla de ingreso: banner de Diwilo + tarjeta con el nombre y logo del negocio.
  function showAuth() {
    document.getElementById("authShell").style.display = "grid";
    if (showAuth.done) return;
    showAuth.done = true;
    api("/public/business").then((b) => {
      document.querySelectorAll("[data-bizname]").forEach((el) => { el.textContent = b.name; });
      if (b.logoKey) document.getElementById("authLogo").innerHTML = `<img src="/api/${tenantSlug()}/public/files/${b.logoKey}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
    }).catch(() => {});
  }

  function showLogin() {
    showAuth();
    document.getElementById("inviteView").style.display = "none";
    document.getElementById("loginView").style.display = "block";
  }

  // Crear (o restablecer) la contraseña con el token del link.
  async function showInvite(token, notice) {
    let info;
    try {
      info = await api(`/auth/invite?token=${encodeURIComponent(token)}`);
    } catch (e) {
      toast(e.message, false);
      history.replaceState(null, "", location.pathname);
      return showLogin();
    }
    showAuth();
    document.getElementById("loginView").style.display = "none";
    document.getElementById("inviteView").style.display = "block";
    document.getElementById("inviteTitle").textContent = info.reset ? "Nueva contraseña" : "Crea tu contraseña";
    document.getElementById("inviteWho").textContent = notice || info.email;
    document.getElementById("inviteEmail").value = info.email;
    document.getElementById("inviteName").value = info.name || "";
    document.getElementById("inviteBtn").onclick = async () => {
      const password = document.getElementById("invitePassword").value;
      if (password.length < 8) return toast("La contraseña debe tener al menos 8 caracteres.", false);
      if (password !== document.getElementById("invitePassword2").value) return toast("Las contraseñas no coinciden.", false);
      try {
        await api("/auth/invite", { method: "POST", body: { token, password, name: document.getElementById("inviteName").value.trim() } });
        history.replaceState(null, "", location.pathname);
        document.getElementById("inviteView").style.display = "none";
        showApp(await api("/staff/me"));
      } catch (e) { toast(e.message, false); }
    };
  }

  document.getElementById("loginBtn").onclick = async () => {
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    if (!email || !password) return toast("Escribe tu correo y tu contraseña.", false);
    try {
      const r = await api("/auth/login", { method: "POST", body: { email, password } });
      if (r.mustSetPassword) return showInvite(r.invite, "El PIN ya no se usa: crea una contraseña para seguir.");
      showApp(await api("/staff/me"));
    } catch (e) { toast(e.message, false); }
  };
  document.getElementById("loginPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("loginBtn").click();
  });

  document.getElementById("logoutBtn").onclick = async () => {
    await api("/auth/logout", { method: "POST" });
    location.reload();
  };

  function showApp(user) {
    document.getElementById("authShell").style.display = "none";
    document.getElementById("readOnlyBar").style.display = user.readOnly ? "block" : "none";
    document.getElementById("appView").style.display = "block";
    document.getElementById("userMenu").style.display = "block";
    document.getElementById("userNameSmall").textContent = user.name || user.email || "Usuario";
    document.querySelectorAll(".nav-btn").forEach((btn) => (btn.onclick = () => goView(btn.dataset.view)));
    goView("agenda");
  }

  document.getElementById("copyWebhookBtn").onclick = async () => {
    await navigator.clipboard.writeText(document.getElementById("setWebhookUrl").value);
    toast("Link copiado.");
  };

  document.getElementById("rotateWebhookBtn").onclick = async () => {
    if (!confirm("El link anterior dejará de funcionar. ¿Generar uno nuevo?")) return;
    const { webhookToken } = await api("/staff/webhook/rotate", { method: "POST" });
    document.getElementById("setWebhookUrl").value = `${location.origin}/api/${tenantSlug()}/webhook/evolution/${webhookToken}`;
    toast("Link nuevo generado. Actualízalo en Evolution API.");
  };

  async function loadAjustes() {
    const biz = await api("/staff/settings").catch(() => null);
    if (!biz) return;
    document.getElementById("setTimezoneOffset").value = String(biz.timezone_offset ?? -5);
    document.getElementById("setWhatsappEnabled").checked = !!biz.whatsapp_enabled;
    document.getElementById("setEvoUrl").value = biz.evolution_url || "";
    document.getElementById("setEvoInstance").value = biz.evolution_instance || "";
    document.getElementById("setEvoApiKey").value = biz.evolution_api_key || "";
    document.getElementById("setWhatsappCountryCode").value = biz.whatsapp_country_code || "57";
    document.getElementById("setWhatsappBusinessNumber").value = biz.whatsapp_business_number || "";
    document.getElementById("testWhatsappPrefix").textContent = `+${biz.whatsapp_country_code || "57"}`;
    document.getElementById("setWebhookUrl").value = `${location.origin}/api/${tenantSlug()}/webhook/evolution/${biz.webhook_token}`;
    document.getElementById("setConfirmWindow").value = biz.confirm_window_hours || 3;
    document.getElementById("setGmailUser").value = biz.gmail_user || "";
    document.getElementById("setGmailAppPassword").value = biz.gmail_app_password || "";
  }

  document.getElementById("saveWhatsappBtn").onclick = async () => {
    const countryCode = document.getElementById("setWhatsappCountryCode").value.trim().replace(/\D/g, "") || "57";
    await api("/staff/settings", { method: "PATCH", body: {
      timezoneOffset: parseInt(document.getElementById("setTimezoneOffset").value, 10),
      whatsappEnabled: document.getElementById("setWhatsappEnabled").checked,
      evolutionUrl: document.getElementById("setEvoUrl").value.trim(),
      evolutionInstance: document.getElementById("setEvoInstance").value.trim(),
      evolutionApiKey: document.getElementById("setEvoApiKey").value.trim(),
      whatsappCountryCode: countryCode,
      whatsappBusinessNumber: document.getElementById("setWhatsappBusinessNumber").value.trim().replace(/\D/g, ""),
      confirmWindowHours: Math.max(1, parseInt(document.getElementById("setConfirmWindow").value, 10) || 3),
    } });
    document.getElementById("setWhatsappCountryCode").value = countryCode;
    document.getElementById("testWhatsappPrefix").textContent = `+${countryCode}`;
    toast("Locación guardada.");
  };

  document.getElementById("testWhatsappBtn").onclick = async () => {
    const phone = document.getElementById("testWhatsappPhone").value.trim();
    if (!phone) return toast("Escribe un número.", false);
    const btn = document.getElementById("testWhatsappBtn");
    btn.disabled = true;
    try {
      await api("/staff/whatsapp/test", { method: "POST", body: { phone } });
      toast("Mensaje de prueba enviado — revisa ese WhatsApp.");
    } catch (e) { toast(e.message, false); }
    btn.disabled = false;
  };

  document.getElementById("saveEmailBtn").onclick = async () => {
    await api("/staff/settings", { method: "PATCH", body: {
      gmailUser: document.getElementById("setGmailUser").value.trim(),
      gmailAppPassword: document.getElementById("setGmailAppPassword").value.trim(),
    } });
    toast("Correo guardado.");
  };

  document.getElementById("testEmailBtn").onclick = async () => {
    const email = document.getElementById("testEmailAddress").value.trim();
    if (!email) return toast("Escribe un correo.", false);
    const btn = document.getElementById("testEmailBtn");
    btn.disabled = true;
    try {
      await api("/staff/email/test", { method: "POST", body: { email } });
      toast("Correo de prueba enviado — revisa esa bandeja de entrada.");
    } catch (e) { toast(e.message, false); }
    btn.disabled = false;
  };

  const TEMPLATE_LABELS = {
    booked: "Cita agendada", cancel: "Cancelación", reschedule: "Pedir reagendar", move: "Mover cita",
    reopen: "Reabrir cita", reminder: "Recordatorio",
    confirmWhatsapp: "Mensaje que el cliente manda por WhatsApp para confirmar", confirmEmail: "Pedir confirmación (correo)",
    confirmed: "Cita confirmada", selfCancel: "Cliente canceló (link)", selfReschedule: "Cliente se reagendó (link)",
  };

  async function renderTemplates() {
    const templates = await api("/staff/templates").catch(() => ({}));
    document.getElementById("templatesForm").innerHTML = Object.entries(templates).map(([key, body]) => `
      <div class="col-md-4">
        <label class="label-xs d-block mb-1">${TEMPLATE_LABELS[key] || key}</label>
        <textarea class="form-control" rows="4" data-key="${key}">${body}</textarea>
      </div>`).join("") + `<div class="col-12"><button class="btn btn-brand btn-sm" id="saveTemplatesBtn">Guardar plantillas</button></div>`;
    document.getElementById("saveTemplatesBtn").onclick = async () => {
      for (const ta of document.querySelectorAll("#templatesForm textarea")) {
        await api("/staff/templates", { method: "PATCH", body: { key: ta.dataset.key, body: ta.value } });
      }
      toast("Plantillas guardadas.");
    };
  }

  boot();

  return { goView };
})();
