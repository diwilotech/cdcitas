import { run, uid } from "../lib/db.js";
import { json, error, readJson } from "../lib/http.js";
import { resolveBusiness } from "../lib/tenant.js";
import { requirePlatformAdmin } from "../lib/auth.js";
import { hashPin, randomSalt, validatePinFormat } from "../lib/pin.js";
import { DEFAULT_TEMPLATES } from "../lib/templates.js";

// El negocio vive en /:slug (reserva) y /:slug/admin (panel) — estas palabras ya son rutas del
// sistema y no se pueden usar como slug (ver el ruteo de /:slug en src/index.js).
const RESERVED_SLUGS = new Set(["admin", "api", "setup", "app", "styles", "t"]);

// Tipos de espacio con los que arranca todo negocio nuevo (después son editables en Reglas).
const DEFAULT_SPACE_TYPES = [
  { key: "general", label: "General" },
  { key: "barra", label: "Barra" },
  { key: "privado", label: "Privado / VIP" },
  { key: "terraza", label: "Terraza" },
];

// Crea un negocio nuevo (tenant) con su primer usuario dueño. Solo el super admin de la
// plataforma puede hacerlo (ver routes/platform.js).
export function registerSetup(router) {
  router.post("/api/setup", async (request, env, ctx) => {
    const denied = await requirePlatformAdmin(request, env, ctx);
    if (denied) return denied;

    const body = await readJson(request);
    const slug = String(body.slug || "").trim().toLowerCase();
    if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
      return error("El slug debe tener 3-40 caracteres: minúsculas, números o guiones.");
    }
    if (RESERVED_SLUGS.has(slug)) return error("Ese slug está reservado, elige otro.");
    if (!body.businessName || !body.ownerEmail || !body.ownerName) {
      return error("Faltan businessName, ownerName u ownerEmail.");
    }
    if (!validatePinFormat(body.ownerPin)) return error("El PIN del dueño debe tener 4-8 dígitos.");
    if (await resolveBusiness(env, slug)) return error("Ese slug ya está en uso.", 409);

    const businessId = uid();
    await run(env, `INSERT INTO businesses (id, slug, name, webhook_token) VALUES (?,?,?,?)`,
      businessId, slug, body.businessName, uid());

    const userId = uid();
    const salt = randomSalt();
    await run(env,
      `INSERT INTO users (id, business_id, email, phone, name, role, pin_hash, pin_salt) VALUES (?,?,?,?,?,'owner',?,?)`,
      userId, businessId, String(body.ownerEmail).toLowerCase(), body.ownerPhone || null, body.ownerName,
      await hashPin(body.ownerPin, salt), salt);

    for (const [key, tplBody] of Object.entries(DEFAULT_TEMPLATES)) {
      await run(env, `INSERT INTO message_templates (id, business_id, key, body) VALUES (?,?,?,?)`,
        uid(), businessId, key, tplBody);
    }

    for (const t of DEFAULT_SPACE_TYPES) {
      await run(env, `INSERT INTO space_types (id, business_id, key, label) VALUES (?,?,?,?)`,
        uid(), businessId, t.key, t.label);
    }

    await run(env,
      `INSERT INTO spaces (id, business_id, label, type, shape, capacity, x, y, w, h) VALUES (?,?,'General','general','square',4,0,0,3,3)`,
      uid(), businessId);

    return json({ slug, ownerEmail: body.ownerEmail }, { status: 201 });
  });
}
