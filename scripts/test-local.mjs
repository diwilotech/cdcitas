// Prueba de punta a punta en local: Diwilo (simulado) crea negocios por RPC y se recorre la app con la capa común.
// Uso: npm run db:migrate:local && npm test   (usa Diwilo Modulos de la carpeta hermana para los módulos centrales)
import { startApp, check, failures, diwilo, client, newBusiness, newMember } from './test-helpers.mjs';

await startApp();

try {
  const A = await newBusiness('Negocio A', { login: true });
  const app = A.app, bid = A.id, slug = A.slug;
  check('Diwilo crea un negocio por RPC', A.created.status === 201 && A.created.data.invite_path, JSON.stringify(A.created.data).slice(0, 200));
  check('Desde internet /api/platform da 401', (await client()('/api/platform/businesses')).status === 401);
  check('Desde internet /api/platform/modules da 401', (await client()('/api/platform/modules')).status === 401);
  const cat = await diwilo('GET', '/modules');
  check('Diwilo lee el catálogo de módulos', cat.status === 200 && cat.data.modulos?.some((m) => m.id === 'citas') && cat.data.modulos.some((m) => m.id === 'finanzas'), JSON.stringify(cat.data).slice(0, 200));

  // --- Shell ---
  const me = await app('/api/me');
  check('/api/me trae rol, tema y módulos', me.data.role === 'owner' && me.data.settings?.tema && me.data.modules?.some((m) => m.id === 'citas'), JSON.stringify(me.data).slice(0, 250));
  check('Los módulos centrales base aparecen siempre', ['dashboard', 'marca', 'ai'].every((id) => me.data.modules.some((m) => m.id === id)));
  check('/api/me sin sesión da 401', (await client()('/api/me')).status === 401);
  const panel = await app(`/${slug}`);
  check('/<slug> con sesión sirve el panel común (como en Academia)', panel.status === 200 && panel.data.text?.includes('id="dw-frame"'), String(panel.status));
  const viejo = await app(`/${slug}/admin`, { redirect: 'manual' });
  check('/<slug>/admin con sesión lleva al panel en /<slug>', viejo.status === 302 && viejo.headers.get('location') === `/${slug}`, `${viejo.status} ${viejo.headers.get('location')}`);
  const cliente = await client()(`/${slug}?service=7`, { redirect: 'manual' });
  check('/<slug> sin sesión (link de reserva de antes) lleva a /<slug>/reservar conservando lo que traía', cliente.status === 302 && cliente.headers.get('location') === `/${slug}/reservar?service=7`, `${cliente.status} ${cliente.headers.get('location')}`);
  const reserva = await client()(`/${slug}/reservar`);
  check('/<slug>/reservar sirve la reserva del cliente', reserva.status === 200 && reserva.data.text?.includes('Reservar cita') && !reserva.data.text.includes('id="dw-frame"'), String(reserva.status));
  const login = await client()(`/${slug}/admin`);
  check('/<slug>/admin sin sesión sirve el ingreso de siempre', login.status === 200 && !login.data.text?.includes('id="dw-frame"') && login.data.text?.includes('loginView'));
  check('/staff/ sin sesión redirige al ingreso', (await client()('/staff/')).status === 302);
  const doc = await app('/staff/citas.html', { headers: { 'sec-fetch-dest': 'document' } });
  check('Una página abierta directo lleva al panel con ?go=', doc.status === 302 && doc.headers.get('location')?.includes(`/${slug}?go=`), doc.headers.get('location'));
  const citas = await app('/staff/citas', { headers: { 'sec-fetch-dest': 'iframe' } });
  check('/staff/citas trae el panel de Citas con el negocio inyectado', citas.status === 200 && citas.data.text?.includes(`name="cdc-slug" content="${slug}"`) && citas.data.text.includes('CDC_EMBED') && citas.data.text.includes('view-agenda'), String(citas.status));
  for (const pg of ['tarjeta', 'flujo', 'ajustes']) { const r = await app(`/staff/${pg}`, { headers: { 'sec-fetch-dest': 'iframe' } }); check(`/staff/${pg} abre su sección del panel`, r.status === 200 && r.data.text?.includes(`CDC_START=${JSON.stringify(pg)}`), String(r.status)); }
  const eq = await app('/staff/equipo', { headers: { 'sec-fetch-dest': 'iframe' } });
  check('/staff/equipo abre el equipo dentro de Citas', eq.status === 200 && eq.data.text?.includes('"equipo"'));
  const ini = await app('/staff/', { headers: { 'sec-fetch-dest': 'iframe' } });
  check('El Inicio trae el shell y la ayuda de Citas', ini.data.text?.includes('id="dw-shell"') && ini.data.text.includes('/js/citas.js'));
  for (const m of ['finanzas', 'marketing', 'marca', 'ai', 'whatsapp']) {
    const r = await app(`/staff/${m}`, { headers: { 'sec-fetch-dest': 'iframe' } });
    check(`Página central /staff/${m} sirve`, r.status === 200, String(r.status));
  }
  check('Escritura de la capa común sin encabezado de seguridad se rechaza', (await app('/api/settings/apariencia', { method: 'PUT', body: { tema: 'rojo' }, headers: { 'x-app': '' } })).status === 403);
  const ap = await app('/api/settings/apariencia', { method: 'PUT', body: { tema: 'rojo', modo: 'light' } });
  check('Cambia el tema del negocio', ap.status === 200 && ap.data.tema === 'rojo', JSON.stringify(ap.data));
  const fin = await app('/api/finanzas/summary');
  check('La API de un módulo central responde por la capa común', fin.status < 500, String(fin.status));

  // --- Lo propio de Citas sigue funcionando ---
  const fl = await app(`/api/${slug}/staff/flujo`);
  check('Flujo responde con especialistas, días y mejores clientes', fl.status === 200 && Array.isArray(fl.data.bySpecialist) && fl.data.byDow?.length === 7, JSON.stringify(fl.data).slice(0, 200));
  const em = await app(`/api/${slug}/staff/embudo`);
  check('El embudo de citas responde', em.status === 200 && Array.isArray(em.data.rows));
  const csv = await app(`/api/${slug}/staff/export/clientes`);
  check('Exporta clientes a CSV', csv.status === 200);
  const logout = await app('/api/auth/logout', { method: 'POST' });
  check('Salir desde el panel común cierra la sesión', logout.status === 200 && (await app('/api/me')).status === 401, String(logout.status));

  // --- Módulos por plan ---
  const B = await newBusiness('Negocio B', { login: true });
  const off = await diwilo('PUT', `/businesses/${B.id}/modules`, { modules: [{ modulo: 'finanzas', activo: true }], version: 'v1' });
  check('Diwilo asigna módulos al negocio', off.status === 200, JSON.stringify(off.data).slice(0, 200));
  const meB = await B.app('/api/me');
  check('Con Citas fuera del plan no aparece en el menú', !meB.data.modules.some((m) => m.id === 'citas') && meB.data.modules.some((m) => m.id === 'finanzas'), meB.data.modules?.map((m) => m.id).join(','));
  const ST = await newMember(bid, slug, 'staff');
  const meS = await ST.app('/api/me');
  check('El personal no ve Finanzas por defecto', meS.data.role === 'staff' && !meS.data.modules.some((m) => m.id === 'finanzas'));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
console.log(failures() ? `\n✗ ${failures()} falla(s)` : '\nTodo bien');
process.exit(failures() ? 1 : 0);
