// Equipo: el dueño invita y quita a su personal. (El dueño solo lo cambia Diwilo.)
window.Equipo = (function () {
  const { api, toast } = window.CDC;
  const ROLE_TXT = { owner: "Dueño", staff: "Personal" };
  async function openTeam() {
    let m = document.getElementById("teamModal");
    if (!m) {
      m = document.createElement("div");
      m.className = "modal fade"; m.id = "teamModal"; m.tabIndex = -1;
      m.innerHTML = `<div class="modal-dialog modal-dialog-scrollable"><div class="modal-content">
        <div class="modal-header"><h5 class="modal-title">Equipo</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Cerrar"></button></div>
        <div class="modal-body"><ul class="list-group mb-3" id="teamList"></ul>
          <form id="teamForm" class="d-grid gap-2"><div class="small fw-semibold">Invitar a alguien del equipo</div>
            <input class="form-control" type="email" name="email" placeholder="Correo" required>
            <input class="form-control" name="name" placeholder="Nombre (opcional)" maxlength="100">
            <button class="btn btn-brand">Invitar</button></form>
          <div class="small text-muted mt-2" id="teamNote"></div>
          <div class="alert alert-light border mt-3 small" id="teamLink" style="display:none"></div></div></div></div>`;
      document.body.appendChild(m);
      m.querySelector("#teamForm").onsubmit = async (e) => {
        e.preventDefault();
        const f = e.target;
        try { const r = await api("/staff/team", { method: "POST", body: { email: f.email.value, name: f.name.value } }); f.reset(); showTeamLink(r.invite_url, f.email.value); loadTeam(); }
        catch (x) { toast(x.message, false); }
      };
      m.querySelector("#teamList").onclick = async (e) => {
        const li = e.target.closest("[data-id]"); if (!li) return;
        if (e.target.closest("[data-link]")) {
          try { const r = await api(`/staff/team/${li.dataset.id}/invite`, { method: "POST" }); showTeamLink(r.invite_url, li.dataset.email); } catch (x) { toast(x.message, false); }
        }
        if (e.target.closest("[data-del]")) {
          if (!li.classList.contains("confirm")) { li.classList.add("confirm"); e.target.closest("[data-del]").textContent = "¿Quitar?"; return; }
          try { await api(`/staff/team/${li.dataset.id}`, { method: "DELETE" }); toast("Quitado del equipo."); loadTeam(); } catch (x) { toast(x.message, false); }
        }
      };
    }
    m.querySelector("#teamLink").style.display = "none";
    await loadTeam();
    bootstrap.Modal.getOrCreateInstance(m).show();
  }
  function showTeamLink(url, who) {
    const el = document.getElementById("teamLink");
    el.style.display = "block";
    el.innerHTML = `<div class="mb-1">Link para <b></b>: con él crea (o restablece) su contraseña. Sirve una sola vez.</div><code class="d-block text-break"></code>
      <div class="d-flex gap-2 mt-2"><button class="btn btn-sm btn-outline-dark" type="button" data-copy>Copiar</button><a class="btn btn-sm btn-outline-success" target="_blank" rel="noopener">WhatsApp</a></div>`;
    el.querySelector("b").textContent = who; el.querySelector("code").textContent = url;
    el.querySelector("a").href = "https://wa.me/?text=" + encodeURIComponent("Crea tu contraseña para entrar a la agenda: " + url);
    el.querySelector("[data-copy]").onclick = async () => { await navigator.clipboard.writeText(url); toast("Link copiado."); };
  }
  async function loadTeam() {
    const { users, canManage } = await api("/staff/team");
    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    document.getElementById("teamList").innerHTML = users.map((u) => `<li class="list-group-item d-flex align-items-center gap-2" data-id="${esc(u.id)}" data-email="${esc(u.email)}">
      <div class="flex-grow-1"><div class="fw-semibold">${esc(u.name || u.email)}</div><div class="small text-muted">${esc(u.email)} · ${ROLE_TXT[u.role] || esc(u.role)}${u.status === "invited" ? " · invitación pendiente" : ""}</div></div>
      ${canManage && u.role !== "owner" ? `<button class="btn btn-sm btn-outline-dark" data-link title="Link para crear o restablecer su contraseña"><i class="bi bi-key"></i></button><button class="btn btn-sm btn-outline-danger" data-del>Quitar</button>` : ""}</li>`).join("");
    document.getElementById("teamForm").style.display = canManage ? "grid" : "none";
    document.getElementById("teamNote").textContent = canManage ? "El dueño del negocio solo se cambia desde Diwilo." : "Solo el dueño puede invitar o quitar personas del equipo.";
  }

  return { open: () => openTeam().catch((x) => toast(x.message, false)) };
})();
