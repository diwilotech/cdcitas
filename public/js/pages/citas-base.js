// Base común de las páginas de Citas dentro del panel: verifica la sesión, avisa al panel qué módulo es,
// marca solo lectura si la suscripción venció y muestra la sección de la página.
window.CitasPag = {
  async iniciar({ modulo, titulo, seccion }) {
    let user;
    try { user = await window.CDC.api('/staff/me'); } catch { (window.top || window).location.replace('/'); return false; }
    document.getElementById('readOnlyBar').style.display = user.readOnly ? 'block' : 'none';
    if (window.parent !== window) window.parent.postMessage({ dw: 'page', modulo, titulo, url: location.pathname + location.search }, location.origin);
    document.body.classList.add('cdc-solo');
    if (seccion) { const s = document.getElementById(seccion); if (s) s.style.display = 'block'; }
    return user;
  },
};
