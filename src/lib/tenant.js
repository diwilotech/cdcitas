import { first } from "./db.js";

// Resuelve el negocio (tenant) a partir del slug en la URL: /api/:slug/...
export async function resolveBusiness(env, slug) {
  // Un negocio archivado desde Diwilo no existe para la app (reservas, panel ni login).
  return first(env, `SELECT * FROM businesses WHERE slug = ? AND archived_at IS NULL`, slug);
}
