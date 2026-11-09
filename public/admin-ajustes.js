// Ajustes del negocio: zona horaria, WhatsApp (Evolution), correo y plantillas de mensajes. Con /staff/equipo abre además la ventana del equipo.
(function () {
  const { api, tenantSlug, toast } = window.CDC;
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


  window.CitasPag.iniciar({ modulo: window.CDC_START === 'equipo' ? 'equipo' : 'ajustes', titulo: window.CDC_START === 'equipo' ? 'Equipo' : 'Ajustes', seccion: 'view-ajustes' }).then((ok) => {
    if (!ok) return;
    loadAjustes(); renderTemplates();
    if (window.CDC_START === 'equipo') setTimeout(() => window.Equipo.open(), 300);
  });
})();
