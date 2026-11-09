// Agenda: tres secciones (Agenda del día, Calendario del mes y Espacio/distribución) y las acciones de cada una.
(function () {
  const VIEWS = ['agenda', 'calendario', 'espacio'];
  function ir(view) {
    VIEWS.forEach((v) => { document.getElementById(`view-${v}`).style.display = v === view ? 'block' : 'none'; });
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    document.querySelectorAll('.header-action').forEach((b) => b.classList.toggle('d-none', b.dataset.view !== view));
    if (view === 'agenda') window.Agenda.render();
    if (view === 'calendario') window.MonthCalendar.render();
    if (view === 'espacio') window.FloorPlan.render();
  }
  window.CitasPag.iniciar({ modulo: 'citas', titulo: 'Agenda' }).then((ok) => {
    if (!ok) return;
    document.body.classList.remove('cdc-solo');   // aquí sí hay barra de secciones
    document.querySelectorAll('.nav-btn').forEach((b) => (b.onclick = () => ir(b.dataset.view)));
    ir('agenda');
  });
})();
