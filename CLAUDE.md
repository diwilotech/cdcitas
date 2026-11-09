# CD Citas — guía rápida

Responde en español. Modo económico: sin capturas salvo que se pidan; de las pruebas mostrar solo el resumen.

## Qué es
App `cdcitas` (cdcitas.diwilo.com): reservas multi-negocio (agenda, clientes, servicios, especialistas, espacios, tarjeta digital, WhatsApp por Evolution). Cloudflare Workers + D1 `control-de-citas-db` + R2, JS sin framework. Publica con Workers Builds al hacer push a `main`. Ver README.md para el detalle de Citas.

## Arquitectura común de las apps Diwilo (capa `src/shell/`)
Citas conserva su modelo (un usuario pertenece a UN negocio, sesión `cdc_session`, API `/api/:slug/…`, router propio en `src/routes/all.js`) y le suma una capa que lo envuelve, sin tocar sus rutas:
- `src/shell/index.js` (`shellFetch`, se llama primero en `src/index.js`): `/api/me`, `/api/settings/*` (tema y logo), `/api/ia/*` (conexiones MCP), módulos centrales (`/api/<modulo>/…`, `/staff/<modulo>`, `/m/*`, `/chat`, `/wa`, `/l`, `/c`, `/validar`), `/mcp`, y `/api/auth/logout|password` del panel común.
- `src/shell/lib/auth.js` adapta la sesión de Citas a lo que esperan los módulos comunes (`authenticate(c, 'tenant:<modulo>')`, rol owner/staff, `users.modulos`, solo lectura por `paid_until`).
- `modulos.app.json`: módulo propio `citas` (toda la agenda) y centrales (`finanzas`, `marketing`, `nomina`, `whatsapp`, `marca`, `ai`, `dashboard`=Inicio) de Diwilo Modulos por binding `MODULOS`. `src/shell/api/platform-modules.js` expone a Diwilo el catálogo y recibe los módulos por negocio (`business_modules`).
- Panel: `/<slug>/admin` con sesión sirve `public/staff/panel.html` (shell común: menú + marco); sin sesión o con link de invitación, el ingreso de siempre (`public/admin.html`). `/staff/citas` y `/staff/equipo` sirven el mismo `admin.html` en modo incrustado (`CDC_EMBED`: sin barra superior; el negocio va en `<meta name="cdc-slug">`). Inicio: `public/staff/index.html` + `public/js/pages/inicio.js`.
- IA: `src/shell/ia/` (herramientas `citas.*`; `interno.js` ejecuta las MISMAS rutas de `src/routes` con el contexto del token).
- Contrato con Diwilo (NO tocar): `src/routes/platform.js`, `src/lib/platform-rpc.js`, `export class Platform`, `paid_until`, invitación por `/:slug/admin#invite=`.

## Pruebas
- `npm run db:migrate:test && npm test` → «Todo bien». Las migraciones de producción incluyen `0023_restore_spaces` (solo válida sobre la historia real), por eso `scripts/migrate-test.mjs` arma la base local con esa en no-op. Producción usa `wrangler d1 migrations apply … --remote` normal.
- `node scripts/ui-check.mjs` recorre el panel en Chrome (CHROME=…); no es parte de `npm test`.
- Si las pruebas dan 500 en `/m/*`: wrangler viejo (≥ 4.151) o `pkill -f workerd`.

## Reglas
- Migraciones nuevas: solo agregar. Publicar Diwilo Modulos antes que esta app.
