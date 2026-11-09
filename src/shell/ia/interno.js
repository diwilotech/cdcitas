// Despachador interno para las herramientas de IA: ejecuta las MISMAS rutas de la API (src/api/*.js) dentro del Worker,
// con el contexto del token del MCP. Así cada herramienta hereda validaciones, permisos por rol/módulo, bitácora y reglas de negocio
// sin duplicar lógica. Solo entran rutas del equipo (tenant | manager | any); nunca las del estudiante, de plataforma o públicas.
import { HttpError } from '../lib/http.js';
import { requireModule } from '../lib/modules.js';
import { router as citasRouter } from '../../routes/all.js';

// Listas muy largas se recortan para no llenar el contexto del asistente.
export function recortar(v, max = 150) {
  if (Array.isArray(v)) return v.length > max ? [...v.slice(0, max).map((x) => recortar(x, max)), { aviso: `Hay ${v.length - max} más; acota con filtros` }] : v.map((x) => recortar(x, max));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, recortar(x, max)]));
  return v;
}

// Las rutas propias de Citas (/api/:slug/staff/…) se ejecutan dentro del Worker con el contexto del token: mismas validaciones y avisos.
export async function llamar(c, metodo, ruta, { query, body } = {}) {
  if (!/^\/api\/[a-z0-9-]+\/staff\//.test(ruta) && !ruta.startsWith('/api/:slug/staff/')) throw new HttpError(403, 'Esa acción no está disponible por la IA');
  const biz = await c.env.DB.prepare('SELECT * FROM businesses WHERE id = ? AND archived_at IS NULL').bind(c.businessId).first();
  if (!biz) throw new HttpError(404, 'Negocio no encontrado');
  const url = new URL(ruta.replace('/api/:slug/', `/api/${biz.slug}/`), c.url.origin);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  if (metodo !== 'GET' && c.readOnly) throw new HttpError(402, 'La suscripción del negocio está vencida: solo lectura.');
  const m = citasRouter.match(metodo, url.pathname);
  if (!m) throw new HttpError(404, 'Ruta no encontrada');
  const req = new Request(url, { method: metodo, headers: { 'content-type': 'application/json' }, body: metodo === 'GET' || body === undefined ? undefined : JSON.stringify(body) });
  const res = await m.handler(req, c.env, { business: biz, params: { ...m.params, slug: biz.slug }, user: { user_id: c.user?.id, email: c.user?.email, name: c.user?.name, role: c.role } });
  if (!(res.headers.get('content-type') || '').includes('json')) throw new HttpError(415, 'Esa respuesta es un archivo o página: se ve desde la app');
  const data = await res.json();
  if (res.status >= 400) throw new HttpError(res.status, data?.error || 'No se pudo completar');
  return recortar(data);
}

// Define una herramienta que llama a una ruta de la API. Los parámetros :x de la ruta salen de los argumentos;
// el resto va como consulta (GET) o como cuerpo JSON (POST, PUT, PATCH, DELETE).
export function herramienta({ name, modulo, rol = 'staff', tipo, description, props = {}, required = [], ruta: [metodo, patron], salida }) {
  return {
    name, modulo, rol, tipo, description,
    inputSchema: { type: 'object', properties: props, required, additionalProperties: false },
    run: async (c, a) => {
      const resto = { ...a };
      const ruta = patron.replace(/:(\w+)/g, (_, k) => { if (k === 'slug') return ':slug'; const v = resto[k]; delete resto[k]; if (v === undefined || v === null || v === '') throw new HttpError(400, `Falta ${k}`); return encodeURIComponent(v); });
      const out = await llamar(c, metodo, ruta, metodo === 'GET' ? { query: resto } : { body: resto });
      return salida ? salida(out, a) : out;
    },
  };
}

// Listar / crear / editar / borrar de una entidad con el CRUD genérico (/api/<base>/<entidad>).
// Nombres: <modulo>.listar_<plural>, crear_<singular>, editar_<singular>, borrar_<singular>.
// `filtros`: filtros extra del listado (f_<campo>); `escribe`/`borra`: nivel mínimo de rol; `sin`: acciones que no se publican.
export function crudHerramientas({ modulo, base, entidad, singular, plural, props, required = [], filtros = {}, escribe = 'staff', borra = 'admin', sin = [] }) {
  const ruta = `/api/${base}/${entidad}`, art = `${singular}`;
  const todas = {
    listar: () => herramienta({ name: `${modulo}.listar_${plural}`, modulo, tipo: 'lectura', description: `Lista ${plural} (busca por texto y filtra) con todos sus datos.`,
      props: { q: { type: 'string', description: 'Texto a buscar' }, limit: { type: 'integer', description: 'Máximo de filas (por defecto 500)' }, ...Object.fromEntries(Object.entries(filtros).map(([k, d]) => [`f_${k}`, { type: 'string', description: d }])) },
      ruta: ['GET', ruta], salida: (o) => ({ [plural]: o.rows ?? o }) }),
    crear: () => herramienta({ name: `${modulo}.crear_${singular}`, modulo, rol: escribe, tipo: 'escritura', description: `Crea ${art}.`, props, required, ruta: ['POST', ruta] }),
    editar: () => herramienta({ name: `${modulo}.editar_${singular}`, modulo, rol: escribe, tipo: 'escritura', description: `Edita ${art}: solo cambian los campos que envíes.`, props: { id: { type: 'integer' }, ...props }, required: ['id'], ruta: ['PATCH', `${ruta}/:id`] }),
    borrar: () => herramienta({ name: `${modulo}.borrar_${singular}`, modulo, rol: borra, tipo: 'escritura', description: `Borra ${art} (no se puede deshacer; si tiene datos asociados la app lo rechaza).`, props: { id: { type: 'integer' } }, required: ['id'], ruta: ['DELETE', `${ruta}/:id`] }),
  };
  return Object.entries(todas).filter(([k]) => !sin.includes(k)).map(([, f]) => f());
}
