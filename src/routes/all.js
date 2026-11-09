// Todas las rutas propias de Citas en un solo Router (las usa el Worker y el puente de IA/MCP).
import { Router } from "../lib/router.js";
import { registerPlatform } from "./platform.js";
import { registerAuth } from "./auth.js";
import { registerPublic } from "./public.js";
import { registerAppointments } from "./appointments.js";
import { registerResources } from "./resources.js";
import { registerSettings } from "./settings.js";
import { registerWebhook } from "./webhook.js";
import { registerSchedule } from "./schedule.js";
import { registerFlujo } from "./flujo.js";
import { registerManage } from "./manage.js";
import { registerFiles } from "./files.js";
import { registerTreatments } from "./treatments.js";
import { registerCard } from "./card.js";
import { registerTeam } from "./team.js";

export const router = new Router();
registerPlatform(router); // primero: /api/platform/... no debe caer en una ruta /api/:slug/...
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
registerCard(router);
registerTeam(router);

