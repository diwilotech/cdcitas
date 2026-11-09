// Control por IA del módulo Citas: cada herramienta ejecuta la MISMA ruta de la API (src/routes/*.js) con el contexto del token,
// así hereda validaciones, avisos por WhatsApp, solo lectura por suscripción vencida y bitácora (ver interno.js).
import { herramienta } from './interno.js';

const T = (description) => ({ type: 'string', description });
const ID = (d) => T(d);
const R = '/api/:slug/staff';

export default [
  herramienta({ name: 'citas.listar_citas', modulo: 'citas', tipo: 'lectura', description: 'Lista las citas (filtra por fecha, especialista o estado).',
    props: { date: T('Fecha AAAA-MM-DD'), from: T('Desde AAAA-MM-DD'), to: T('Hasta AAAA-MM-DD') }, ruta: ['GET', `${R}/appointments`] }),
  herramienta({ name: 'citas.agendar_cita', modulo: 'citas', tipo: 'escritura', description: 'Agenda una cita para un cliente.',
    props: { clientName: T('Nombre del cliente'), clientPhone: T('Celular'), clientEmail: T('Correo'), serviceId: ID('Id del servicio'), specialistId: ID('Id del especialista'), date: T('Fecha AAAA-MM-DD'), start: T('Hora HH:MM') },
    required: ['clientName', 'serviceId', 'specialistId', 'date', 'start'], ruta: ['POST', `${R}/appointments`] }),
  herramienta({ name: 'citas.completar_cita', modulo: 'citas', tipo: 'escritura', description: 'Marca una cita como completada.', props: { id: ID('Id de la cita') }, required: ['id'], ruta: ['POST', `${R}/appointments/:id/complete`] }),
  herramienta({ name: 'citas.cancelar_cita', modulo: 'citas', tipo: 'escritura', description: 'Cancela una cita y avisa al cliente por WhatsApp.', props: { id: ID('Id de la cita') }, required: ['id'], ruta: ['POST', `${R}/appointments/:id/cancel`] }),
  herramienta({ name: 'citas.listar_servicios', modulo: 'citas', tipo: 'lectura', description: 'Lista los servicios con duración y precio.', ruta: ['GET', `${R}/services`] }),
  herramienta({ name: 'citas.listar_especialistas', modulo: 'citas', tipo: 'lectura', description: 'Lista los especialistas.', ruta: ['GET', `${R}/specialists`] }),
  herramienta({ name: 'citas.listar_clientes', modulo: 'citas', tipo: 'lectura', description: 'Lista los clientes.', ruta: ['GET', `${R}/clients`] }),
  herramienta({ name: 'citas.tablero', modulo: 'citas', tipo: 'lectura', description: 'Tablero del negocio: ingresos de hoy y de la semana, citas activas, tasa de inasistencia, ingresos por servicio, citas por especialista y mejores clientes.', ruta: ['GET', `${R}/flujo`] }),
];
