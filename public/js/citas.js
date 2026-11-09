// Ayudas del Inicio de Citas. El panel común (shell) ya trae el menú; aquí solo van los datos propios.
// window.DW_KEEP_APP evita pisar el App común del Dashboard.
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) => '$' + Number(n || 0).toLocaleString('es-CO');
  let slug = null;
  const api = async (path) => {
    if (!slug) slug = (await window.DW.ready).business.slug;
    const r = await fetch(`/api/${slug}${path}`, { credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
    return r.json();
  };
  window.Cit = { esc, money, api };
})();
