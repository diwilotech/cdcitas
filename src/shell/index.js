// Capa común de las apps Diwilo dentro de Citas: /api/me, módulos centrales (Finanzas, Marketing, Mensajes, Nómina, Marca, IA, Inicio),
// módulos por negocio asignados por Diwilo, MCP y las páginas del panel (/staff/*). Citas conserva sus rutas y su sesión (cdc_session);
// esta capa solo las envuelve. Ver CLAUDE.md.
import { Router } from './router.js';
import { HttpError, errorResponse, json } from './lib/http.js';
import { authenticate, loadSession } from './lib/auth.js';
import { CENTRALES } from './lib/modules.js';
import { isCentralApi, centralModuleOf, centralApi, centralPage, centralAsset, centralPublic } from './lib/central.js';
import * as platformModulesApi from './api/platform-modules.js';
import * as meApi from './api/me.js';
import * as settingsApi from './api/settings.js';
import * as mcpApi from './api/mcp.js';
import { router as citasRouter } from '../routes/all.js';
import { resolveBusiness } from '../lib/tenant.js';

const router = new Router();
for (const mod of [platformModulesApi, meApi, settingsApi, mcpApi]) mod.routes(router);

const SECURITY_HEADERS = { 'x-frame-options': 'SAMEORIGIN', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' };
const withHeaders = (res, headers) => { const out = new Response(res.body, res); for (const [k, v] of Object.entries(headers)) out.headers.set(k, v); return out; };

const COMUN = (p) => p === '/api/me' || p.startsWith('/api/settings/') || p.startsWith('/api/ia/') || p === '/api/platform/modules' || p === '/api/platform/modules/sync'
  || /^\/api\/platform\/businesses\/[^/]+\/modules$/.test(p) || /^\/api\/auth\/(logout|password)$/.test(p);

async function handleApi(req, env, ctx, url) {
  // Salir y cambiar la contraseña desde el panel común: se apoyan en las rutas de siempre de Citas
  if (/^\/api\/auth\/(logout|password)$/.test(url.pathname)) {
    const s = await loadSession(req, env);
    if (!s) throw new HttpError(401, 'Inicia sesión', 'NO_SESSION');
    if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido');
    if (req.headers.get('x-app') !== '1') throw new HttpError(403, 'Solicitud no permitida');
    const business = await resolveBusiness(env, s.business_slug);
    const path = `/api/${s.business_slug}/auth/${url.pathname.endsWith('logout') ? 'logout' : 'password'}`;
    const m = citasRouter.match('POST', path);
    return m.handler(new Request(new URL(path, url.origin), req), env, { business, params: { slug: s.business_slug, ...m.params } });
  }
  const { route, params } = router.match(req.method, url.pathname);
  if (req.method !== 'GET' && route.auth !== 'platform' && req.headers.get('x-app') !== '1') throw new HttpError(403, 'Solicitud no permitida');
  const c = { req, env, ctx, url, params };
  await authenticate(c, route.auth);
  return route.handler(c);
}

// Módulos centrales: la app verifica sesión, negocio, rol, módulo activo y CSRF; Diwilo Modulos hace el resto.
async function handleCentral(req, env, ctx, url) {
  if (req.method !== 'GET' && req.headers.get('x-app') !== '1') throw new HttpError(403, 'Solicitud no permitida');
  const c = { req, env, ctx, url, params: {} };
  await authenticate(c, `tenant:${centralModuleOf(url.pathname)}`);
  if (req.method === 'GET' && /^\/api\/[a-z]+\/mcp$/.test(url.pathname)) return json(await mcpApi.guiaDeModulo(c, centralModuleOf(url.pathname), url.origin));
  return centralApi(c);
}

const aPanel = (url, slug, go) => Response.redirect(`${url.origin}/${slug}/admin${go ? `?go=${encodeURIComponent(go)}` : ''}`, 302);

// Página de Citas dentro del panel: el mismo panel de siempre (admin.html) sin su barra, con el negocio inyectado.
async function embedCitas(env, req, slug, start) {
  const u = new URL(req.url); u.pathname = '/admin'; u.search = '';
  const res = await env.ASSETS.fetch(new Request(u, { headers: req.headers }));
  return new HTMLRewriter().on('head', { element(e) { e.prepend(`<meta name="cdc-slug" content="${slug}"><script>window.CDC_EMBED=1;window.CDC_START=${JSON.stringify(start || '')};</script>`, { html: true }); } }).transform(
    new Response(res.body, { status: res.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }));
}

// Devuelve la respuesta si la ruta es de la capa común; null si es de Citas.
export async function shellFetch(req, env, ctx) {
  const url = new URL(req.url), p = url.pathname;
  try {
    if (p.startsWith('/api/')) {
      if (isCentralApi(p)) return withHeaders(await handleCentral(req, env, ctx, url), SECURITY_HEADERS);
      if (COMUN(p)) return withHeaders(await handleApi(req, env, ctx, url), SECURITY_HEADERS);
      return null;
    }
    if (p === '/mcp') return withHeaders(await mcpApi.mcpFetch(req, env, ctx), SECURITY_HEADERS);
    if (p.startsWith('/chat/') || p.startsWith('/v1/') || p.startsWith('/wa/')) return withHeaders(await centralPublic(env, url, req), { 'x-content-type-options': 'nosniff' });
    if (p.startsWith('/l/') || p.startsWith('/validar/') || p.startsWith('/c/')) return withHeaders(await centralPublic(env, url, req), SECURITY_HEADERS);
    if (p.startsWith('/m/')) return withHeaders(await centralAsset(env, p), SECURITY_HEADERS);
    if (p === '/staff' || p.startsWith('/staff/')) {
      const s = await loadSession(req, env);
      if (!s) return Response.redirect(`${url.origin}/`, 302);
      const page = p.replace(/^\/staff\/?/, '').replace(/\.html$/, '').replace(/\/$/, '');
      if (req.method === 'GET' && req.headers.get('sec-fetch-dest') === 'document' && !p.startsWith('/staff/panel') && (page === '' || p.endsWith('.html'))) return aPanel(url, s.business_slug, p + url.search);
      if (page === 'citas') return withHeaders(await embedCitas(env, req, s.business_slug, ''), SECURITY_HEADERS);
      if (page === 'equipo') return withHeaders(await embedCitas(env, req, s.business_slug, 'equipo'), SECURITY_HEADERS);
      const central = CENTRALES.find((id) => page === id);
      if (central) return withHeaders(await centralPage(env, req, central), SECURITY_HEADERS);
      return withHeaders(await env.ASSETS.fetch(req), { ...SECURITY_HEADERS, 'cache-control': 'no-store' });
    }
    return null;
  } catch (err) {
    if (p.startsWith('/api/')) return errorResponse(err);
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    return new Response(`<!doctype html><meta charset="utf-8"><title>Acceso</title><body style="font-family:system-ui;padding:2rem"><h1 style="font-size:1.25rem">${status === 404 ? 'Página no encontrada' : 'No se pudo abrir la página'}</h1></body>`, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
}

// ¿Esta sesión es del negocio de la dirección? (para servir el panel en /<slug>/admin)
export async function sesionDe(req, env, slug) {
  const s = await loadSession(req, env);
  return s && s.business_slug === slug ? s : null;
}
