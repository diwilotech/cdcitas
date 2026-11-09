// Ayudas comunes de las pantallas de Citas (clientes, servicios…): API del negocio, textos y datos de consulta.
window.CC = (() => {
  const { api, esc } = window.App;
  let slug;
  const cit = async (path, opts) => { slug = slug || (await window.DW.ready).business.slug; return api(`/api/${slug}${path}`, opts); };
  const mapa = async () => (slug = slug || (await window.DW.ready).business.slug);
  const parse = (v, def) => { try { return Array.isArray(v) ? v : JSON.parse(v || 'null') ?? def; } catch { return def; } };
  const hora = (t) => { const [h, m] = String(t || '').split(':').map(Number); return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
  const dia = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');
  const ESTADO = { confirmed: ['ok', 'Confirmada'], pending_confirmation: ['soon', 'Pendiente'], completed: ['ok', 'Completada'], cancelled: ['free', 'Cancelada'], 'no-show': ['bad', 'Inasistencia'], reagendar: ['soon', 'Por reagendar'] };
  const chipEstado = (s) => window.App.Crud.chip((ESTADO[s] || ['free', s])[0], (ESTADO[s] || [0, s])[1]);
  const fotoUrl = (k) => `/api/${slug}/public/files/${k}`;   // usar tras await CC.mapa()
  // Foto de un servicio: se sube y devuelve el nombre guardado
  const subir = async (file) => {
    const fd = new FormData(); fd.append('file', file, file.name || 'foto.png');
    const r = await fetch(`/api/${await mapa()}/staff/upload`, { method: 'POST', credentials: 'include', body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo subir la imagen.');
    return d.name;
  };
  return { cit, mapa, parse, hora, dia, chipEstado, fotoUrl, subir, esc };
})();
