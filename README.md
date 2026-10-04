# Control de Citas

Sistema de reservas multi-negocio (multi-tenant), desplegado en Cloudflare Workers + D1.
Sin frameworks ni bundler: JavaScript plano en módulos ES, para que sea fácil de leer y editar.

## Arquitectura

- **1 solo Worker** sirve la API (`/api/...`) y los archivos estáticos (`/public`) — sin
  necesitar un proyecto Pages aparte.
- **1 base D1 compartida**, multi-tenant por fila: toda tabla tiene `business_id`. Cada negocio
  (tenant) se identifica por un `slug` en la URL: `tuapp.workers.dev/mi-negocio` (reserva) y
  `tuapp.workers.dev/mi-negocio/admin` (panel de personal).
- **Evolution API** (WhatsApp) corre en **tu propio servidor**, no en Cloudflare — Workers no
  puede alojar procesos persistentes tipo Baileys. El Worker solo le hace peticiones HTTP
  (`src/lib/whatsapp.js`), para avisos de citas (agendada/cancelada/reagendar/mover/reabrir).
- **Login general en la raíz** (`cdcitas.diwilo.com`; `/login` y `/admin` redirigen ahí): correo + contraseña, sin el negocio en la URL; la
  app lleva a cada quien a `/:slug/admin` y, si el correo está en varios negocios, deja elegir.
- **Login con correo + contraseña**: el personal de cada negocio también puede entrar en `/:slug/admin` con su
  correo y una contraseña de mínimo 8 caracteres (PBKDF2 con salt, `src/lib/password.js`). Los PIN
  de antes entran una última vez y piden crear la contraseña.
- **Diwilo Web maneja la plataforma**: crear negocios, invitar dueños y personal, y la suscripción
  se hacen desde `diwilo.com/admin`, que llama a `/api/platform/*` con
  `Authorization: Bearer PLATFORM_KEY` (`src/routes/platform.js`). Cada invitación es un link
  `/:slug/admin#invite=<token>` para crear (o restablecer) la contraseña. Ya no hay super admin
  propio en `/admin`.
- **Suscripción**: `businesses.paid_until` (`YYYY-MM-DD`; vacío = sin límite). Si la fecha ya pasó,
  el negocio queda en **solo lectura**: el panel no guarda cambios y la reserva pública no acepta
  citas nuevas (402). El login y el webhook de WhatsApp siguen funcionando.
- **WhatsApp por negocio**: cada negocio puede prender/apagar el envío de avisos por WhatsApp y
  tiene su propio link de webhook para pegar en Evolution API (Ajustes → WhatsApp en el panel del
  negocio, `src/routes/webhook.js`).

## Estructura

```
src/
  index.js            Punto de entrada: rutas bonitas (/:slug, /:slug/admin, /admin) + despacho de la API
  lib/                 Código compartido: router, D1, auth, contraseñas, WhatsApp, plantillas, CRUD genérico
  routes/               Un archivo por grupo de endpoints (platform.js = API para Diwilo Web)
public/                Frontend (HTML+JS+CSS planos, sin build)
migrations/                Esquema (0001 inicial … 0031 plataforma Diwilo: suscripción + invitaciones)
```

`src/lib/crud.js` + `src/lib/db.js#makeResource` generan las rutas CRUD de servicios,
especialistas, espacios, clientes y bloqueos desde una sola función — para no repetir el mismo
SELECT/INSERT/UPDATE/DELETE cinco veces.

## Desplegar

La base D1 (`control-de-citas-db`) ya está creada y con el esquema aplicado (14 tablas), y su
`database_id` ya está en `wrangler.toml`. Solo falta subir el código del Worker:

```bash
npm install
npx wrangler login
npm run deploy
```

Si en el futuro agregas una migración nueva (`migrations/0002_*.sql`), aplícala con:
```bash
npm run db:migrate:remote
```

### Clave de Diwilo Web (secreto, no va en el repo)

```bash
npx wrangler secret put PLATFORM_KEY   # el mismo valor que en Diwilo Web
```

### Conectar Evolution API (secretos, no van en el repo)

```bash
npx wrangler secret put EVOLUTION_API_URL          # https://tu-evolution-api.com
npx wrangler secret put EVOLUTION_API_KEY          # apikey global (si usas una sola instancia)
npx wrangler secret put EVOLUTION_DEFAULT_INSTANCE # nombre de instancia por defecto
```

Si cada negocio tendrá su propio número/instancia de WhatsApp, en vez de las variables globales
guarda `evolution_instance` y `evolution_api_key` directamente en la fila de `businesses` (ya
existen esas columnas) — desde el panel del negocio, Ajustes → WhatsApp. Ahí mismo se puede
apagar el envío de avisos por WhatsApp para ese negocio (`whatsapp_enabled`), y se muestra el
link de webhook (`/api/:slug/webhook/evolution/:token`) para pegarlo en Evolution API → esa
instancia → Webhook, así Evolution puede avisarle al Worker de eventos entrantes.

El payload que arma `src/lib/whatsapp.js` asume el contrato de Evolution API v2
(`POST /message/sendText/{instance}`, header `apikey`). Si tu versión usa otro formato, es el
único archivo que hay que tocar.

### Deploy automático

El repo está conectado a **Cloudflare Workers Builds**: cada push a `main` dispara un deploy
solo (Cloudflare clona el repo, instala dependencias y corre `wrangler deploy`). No hace falta
GitHub Actions ni secretos en GitHub — se administra desde el dashboard de Cloudflare, en
Workers & Pages → `cdcitas` → Settings → Build.

Ese deploy automático **no** aplica migraciones nuevas de D1 por sí solo. Si agregas una
migración (`migrations/0002_*.sql`), aplícala a mano antes o después del push:
```bash
npm run db:migrate:remote
```

## Crear el primer negocio

En Diwilo Web → **Negocios → Citas → Nuevo negocio** (nombre, slug y correo del dueño). Diwilo
devuelve el link de invitación para el dueño; al abrirlo crea su contraseña y entra a
`/tu-negocio/admin`. La página de reservas del cliente queda en `/tu-negocio`.

## Qué falta / roadmap

Este es un MVP funcional de punta a punta (reservar, agendar, cancelar/reagendar/mover/reabrir,
avisar por WhatsApp), deliberadamente simple. Lo que quedó fuera para no complicar el v1:

- Editor visual de plano del local (arrastrar mesas) — hoy los espacios se crean con un formulario.
- Vista de agenda tipo línea de tiempo — hoy es una lista cronológica del día.
- Que el dueño invite a su propio personal desde el panel del negocio (hoy se hace desde Diwilo Web) y Google OAuth.
- Panel de "no-show" automático (marcar inasistencia).
- Pasarela de pago para la suscripción (hoy el pago se registra a mano en Diwilo Web).
