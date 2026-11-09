// Prueba en Chrome de las pantallas comunes de Citas con datos: crea por la interfaz un servicio, un especialista, un paquete, una promoción y un cliente, y abre su ficha.
import { startApp, newBusiness, APP } from './test-helpers.mjs';
const puppeteer = (await import(process.env.PUPPETEER || '/Users/yomar/Vscode/Diwilo Web Admin/tools/smoke-panel/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js')).default;
await startApp();
const A = await newBusiness(`UI Flujo ${Date.now()}`, { login: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const problems = [], ok = [];
const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 900 });
page.on('pageerror', (e) => problems.push('pageerror ' + e.message.slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) problems.push('console ' + m.text().slice(0, 160)); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0' });
  await page.evaluate(async (mail, sl) => { await fetch(`/api/${sl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: mail, password: 'clave-segura-1' }) }); }, A.mail, A.slug);
  const ir = async (p) => { await page.goto(`${APP}/staff/${p}`, { waitUntil: 'networkidle0' }); await wait(600); };
  // el panel redirige las navegaciones directas; se abre la página dentro del marco como lo hace el menú
  await page.goto(`${APP}/${A.slug}/admin`, { waitUntil: 'networkidle0' }); await wait(1200);
  const marco = async (p) => { await page.evaluate((u) => { document.getElementById('dw-frame').src = u; }, `/staff/${p}`); await wait(1800); return page.frames().find((f) => f.parentFrame()); };
  const llenar = async (f, sel, v) => { await f.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }, v); };
  const guardar = async (f) => { await f.evaluate(() => document.querySelector('.modal.show form')?.requestSubmit()); await wait(1800); };
  const texto = async (f) => (await f.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');

  let f = await marco('servicios.html');
  await f.evaluate(() => document.querySelector('[data-new]').click()); await wait(600);
  await llenar(f, '[name=name]', 'Corte de cabello'); await llenar(f, '[name=price]', '30000'); await llenar(f, '[name=duration_min]', '45'); await guardar(f);
  ok.push(['servicio creado', (await texto(f)).includes('Corte de cabello') && (await texto(f)).includes('$30.000')]);

  await f.evaluate(() => document.querySelector('[data-k=especialistas]').click()); await wait(900);
  await f.evaluate(() => document.querySelector('[data-new]').click()); await wait(600);
  await llenar(f, '[name=name]', 'Ana Pérez'); await f.evaluate(() => { document.querySelector('.modal.show [data-multi=work_days] input').checked = true; document.querySelector('.modal.show [data-multi=serviceIds] input').checked = true; }); await guardar(f);
  ok.push(['especialista creado con su servicio', (await texto(f)).includes('Ana Pérez') && (await texto(f)).includes('Corte de cabello')]);

  await f.evaluate(() => document.querySelector('[data-k=paquetes]').click()); await wait(900);
  await f.evaluate(() => document.querySelector('[data-new]').click()); await wait(600);
  await llenar(f, '.modal.show [name=name]', '3 cortes');
  await f.click('.modal.show [data-add]'); await f.click('.modal.show [data-add]'); await f.click('.modal.show [data-add]'); await guardar(f);
  ok.push(['sin ventana abierta tras guardar', await f.evaluate(() => !document.querySelector('.modal.show, .modal-backdrop'))]); ok.push(['paquete con 3 servicios', (await texto(f)).includes('3 cortes') && (await texto(f)).includes('Corte de cabello → Corte de cabello → Corte de cabello')]);

  await f.evaluate(() => document.querySelector('[data-k=promociones]').click()); await wait(900);
  await f.evaluate(() => document.querySelector('[data-new]').click()); await wait(600);
  await llenar(f, '[name=title]', '20% martes'); await guardar(f);
  ok.push(['promoción vigente', (await texto(f)).includes('20% martes') && (await texto(f)).includes('Vigente')]);

  f = await marco('clientes.html');
  await f.evaluate(() => document.querySelector('[data-new]').click()); await wait(600);
  await llenar(f, '[name=name]', 'Laura Gómez'); await llenar(f, '[name=phone]', '3001112233'); await guardar(f);
  ok.push(['cliente creado', (await texto(f)).includes('Laura Gómez')]);
  await f.click('[data-act=ficha]'); await wait(1500);
  ok.push(['ficha con historial', (await texto(f)).includes('Historial') && (await texto(f)).includes('Atendidas')]);
  await f.click('[data-t=paq]'); await wait(1200);
  await f.click('[data-asignar]'); await wait(700);
  await guardar(f);
  await wait(800);
  ok.push(['paquete asignado al cliente', (await texto(f)).includes('0 de 3 sesiones')]);
  await f.click('[data-sesion]'); await wait(700);
  const dia = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);
  await llenar(f, '.modal.show [name=fecha]', dia); await wait(1200);
  const hay = await f.$eval('.modal.show [name=hora]', (e) => e.options.length > 0 && !!e.value);
  ok.push(['horarios disponibles para la sesión', hay]);
  if (hay) { await guardar(f); ok.push(['sesión agregada', (await texto(f)).includes('Corte de cabello ·')]); }
} catch (e) { problems.push('flujo: ' + e.message); }
await browser.close();
for (const [n, v] of ok) console.log(v ? '✓' : '✗', n);
console.log(problems.length ? 'Problemas:\n' + problems.join('\n') : 'Sin errores de JavaScript');
process.exit(problems.length || ok.some(([, v]) => !v) ? 1 : 0);
