import { Router } from "./lib/router.js";
import { json, notFound } from "./lib/http.js";
import { resolveBusiness } from "./lib/tenant.js";
import { requireStaff } from "./lib/auth.js";

import { registerSetup } from "./routes/setup.js";
import { registerPlatform } from "./routes/platform.js";
import { registerAuth } from "./routes/auth.js";
import { registerPublic } from "./routes/public.js";
import { registerAppointments } from "./routes/appointments.js";
import { registerResources } from "./routes/resources.js";
import { registerSettings } from "./routes/settings.js";
import { registerWebhook } from "./routes/webhook.js";
import { registerSchedule } from "./routes/schedule.js";
import { registerFlujo } from "./routes/flujo.js";
import { registerManage } from "./routes/manage.js";
import { registerFiles } from "./routes/files.js";
import { registerTreatments } from "./routes/treatments.js";
import { sendDueReminders } from "./lib/reminders.js";
import { releaseExpiredPending } from "./lib/confirm.js";

const router = new Router();
registerSetup(router);
registerPlatform(router);
registerAuth(router);
registerPublic(router);
registerAppointments(router);
registerResources(router);
registerSettings(router);
registerWebhook(router);
registerSchedule(router);
registerFlujo(router);
registerFiles(router);
registerManage(router);
registerTreatments(router);

// Sirve un archivo estático concreto a través del binding de assets (para las rutas bonitas
// /:slug, /:slug/admin y /admin, que no existen como archivo real).
function serveAsset(env, request, file) {
  const url = new URL(request.url);
  url.pathname = file;
  return env.ASSETS.fetch(new Request(url, request));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      const parts = url.pathname.split("/").filter(Boolean);

      // /admin (sin negocio) -> panel del super admin (setup.html administra negocios/usuarios).
      if (parts.length === 1 && parts[0] === "admin") {
        return serveAsset(env, request, "/setup");
      }

      // /:slug -> reserva del cliente, /:slug/admin -> panel de personal de ese negocio. Un slug
      // se distingue de un archivo real (styles.css, app.js, favicon.ico...) probando primero
      // contra los assets tal cual: si existe de verdad, se sirve ese archivo sin más vueltas.
      if (parts.length >= 1 && parts.length <= 2 && !parts[0].includes(".")) {
        const direct = await env.ASSETS.fetch(request);
        if (direct.status !== 404) return direct;

        if (parts.length === 1) return serveAsset(env, request, "/");
        if (parts.length === 2 && parts[1] === "admin") return serveAsset(env, request, "/admin");
        if (parts.length === 2 && parts[1] === "mis-citas") return serveAsset(env, request, "/mis-citas");
      }

      return env.ASSETS.fetch(request);
    }

    const match = router.match(request.method, url.pathname);
    if (!match) return notFound();

    const ctx = { params: match.params };

    // Todas las rutas menos /api/setup son de un negocio (tenant) identificado por :slug.
    if (match.params.slug) {
      const business = await resolveBusiness(env, match.params.slug);
      if (!business) return json({ error: "Negocio no encontrado." }, { status: 404 });
      ctx.business = business;

      // Todo lo que vive bajo /api/:slug/staff/ exige sesión de personal.
      if (url.pathname.startsWith(`/api/${match.params.slug}/staff/`)) {
        const denied = await requireStaff(request, env, ctx);
        if (denied) return denied;
      }
    }

    try {
      return await match.handler(request, env, ctx);
    } catch (err) {
      return json({ error: "Error interno", detail: String(err) }, { status: 500 });
    }
  },

  // Cron (ver wrangler.toml): manda los recordatorios de cita que ya vencieron y libera las
  // citas que quedaron pendientes de confirmar (PIN/link) y ya vencieron.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDueReminders(env));
    ctx.waitUntil(releaseExpiredPending(env));
  },
};
