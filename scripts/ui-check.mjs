// Comprobación visual rápida en un navegador real (solo local, no es parte de npm test): abre el panel, recorre los módulos y reporta
// errores de JavaScript, llamadas a la API que fallan y si cada pantalla pintó contenido.  CHROME=/ruta/a/chrome   PUPPETEER=/ruta/a/puppeteer-core
import { startApp, newBusiness, APP } from './test-helpers.mjs';
const puppeteer = (await import(process.env.PUPPETEER || '/Users/yomar/Vscode/Diwilo Web Admin/tools/smoke-panel/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js')).default;
await startApp();
const A = await newBusiness(`UI Negocio ${Date.now()}`, { login: true });
const slug = A.slug;
const post = (p, b) => A.app(p, { method: 'POST', body: b });

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const problems = [];
try {
  for (const [vista, vp] of [['escritorio', { width: 1280, height: 800 }], ['celular', { width: 390, height: 800, isMobile: true }]]) {
    const page = await browser.newPage(); await page.setViewport(vp);
    const log = (m) => { if (!/favicon|fonts\.g|cdn\.jsdelivr|net::ERR/i.test(m)) problems.push(`${vista}: ${m}`); };
    page.on('pageerror', (e) => log(`pageerror ${String(e.message).slice(0, 200)}`));
    page.on('console', (m) => { if (m.type() === 'error') log(`console ${m.text().slice(0, 200)}`); });
    page.on('response', (r) => { if (r.status() === 404) if (r.url().startsWith(APP) && r.status() >= 400 && !/\/api\/(public|admin\/auth\/me)/.test(r.url())) log(`HTTP ${r.status()} ${r.url().replace(APP, '')}`); });
    await page.goto(`${APP}/`, { waitUntil: 'networkidle0' });
    await page.evaluate(async (mail, sl) => { await fetch(`/api/${sl}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: mail, password: 'clave-segura-1' }) }); }, A.mail, slug);
    await page.goto(`${APP}/${slug}/admin`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 1500));
    const shell = await page.evaluate(() => ({ top: !!document.querySelector('.dw-top'), side: !!document.querySelector('.dw-side'), links: [...document.querySelectorAll('.dw-nav a[data-mod]')].map((a) => a.dataset.mod).join(',') }));
    console.log(vista, 'shell', JSON.stringify(shell));
    if (!shell.top) problems.push(`${vista}: el shell no pintó`);
    const frame = () => page.frames().find((f) => f.parentFrame());
    const texto = async () => (await frame().evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200);
    console.log(vista, 'inicio:', await texto());
    for (const mod of ['citas', 'clientes', 'servicios', 'tarjeta', 'flujo', 'ajustes', 'equipo', 'finanzas', 'marketing', 'marca', 'ai']) {
      await page.evaluate((m) => { const a = document.querySelector(`.dw-nav a[data-mod="${m}"]`) || document.querySelector(`.dw-bottom a[data-mod="${m}"]`); if (a) a.click(); else document.getElementById('dw-frame').src = `/staff/${m}.html`; }, mod);
      await new Promise((r) => setTimeout(r, 2200));
      const t = await texto();
      console.log(vista, mod, '→', t.slice(0, 120));
      if (!t || (/Cargando…$/.test(t) && t.length < 25)) problems.push(`${vista}/${mod}: pantalla vacía o cargando`);
    }
    // vistas internas de Citas
    await page.evaluate(() => { document.getElementById('dw-frame').src = '/staff/citas'; });
    await new Promise((r) => setTimeout(r, 2500));
    for (const v of ['calendario', 'espacio', 'reglas', 'clientes', 'tarjeta', 'flujo', 'ajustes']) {
      await frame().evaluate((x) => document.querySelector(`.nav-btn[data-view="${x}"]`)?.click(), v);
      await new Promise((r) => setTimeout(r, 1200));
      console.log(vista, 'citas/' + v, '→', (await texto()).slice(0, 90));
    }
    await page.close();
  }
} finally { await browser.close(); }
console.log(problems.length ? `\nProblemas (${problems.length}):\n- ${[...new Set(problems)].join('\n- ')}` : '\nSin problemas');
process.exit(0);
