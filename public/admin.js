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

  // Esta página es solo el ingreso (y el link de invitación). Con sesión, el servidor entrega el panel común y cada módulo
  // vive en su propia página: public/staff/{citas,tarjeta,flujo,ajustes}.html.
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
        location.reload();
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
      location.reload();
    } catch (e) { toast(e.message, false); }
  };
  document.getElementById("loginPassword").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("loginBtn").click();
  });



  async function boot() {
    // Link de invitación: /:slug/admin#invite=<token> (en el fragmento, no queda en logs).
    const invite = new URLSearchParams(location.hash.slice(1)).get("invite");
    if (invite) return showInvite(invite);
    try { await api("/staff/me"); location.reload(); } catch { showLogin(); }
  }

  boot();
})();
