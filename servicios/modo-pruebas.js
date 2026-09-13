// Modo pruebas público (ORDEN 9): mientras numero_permiso esté vacía, el
// sorteo NO se muestra al público. Una sesión válida del panel sí ve las
// páginas completas, con la franja "MODO PRUEBAS — SIN VALIDEZ". Sin base
// de datos configurada también se oculta (no hay forma de saber si ya hay
// permiso: el lado seguro es no mostrar nada).

const { configurada } = require('../lib/db');
const { leerConfiguracion } = require('../lib/configuracion');
const usuarios = require('./usuarios');

// Misma cookie que rutas/admin.js (Path=/ para que las páginas públicas la vean).
const COOKIE_SESION = 'sesion_ferez';

async function enModoPruebas() {
  if (!configurada()) return true;
  const config = await leerConfiguracion();
  return !String(config.numero_permiso ?? '').trim();
}

// Estado del sorteo hacia el público sin sesión (ORDEN 12):
//   'publico'    — numero_permiso llena: todo visible y limpio.
//   'exhibicion' — sin permiso pero con modo_exhibicion=true: todo visible
//                  con banners "SIN VALIDEZ" (demo para la familia).
//   'oculto'     — sin permiso y sin exhibición: "Próximamente" y ligas
//                  ocultas (solo sesiones del panel ven el sorteo).
async function estadoPublico() {
  if (!configurada()) return 'oculto';
  const config = await leerConfiguracion();
  if (String(config.numero_permiso ?? '').trim()) return 'publico';
  return config.modo_exhibicion === true ? 'exhibicion' : 'oculto';
}

// Como estadoPublico, pero ante cualquier error responde 'oculto' (lado
// seguro). Para las páginas que no pueden permitirse tronar por esto.
async function estadoPublicoSeguro() {
  try {
    return await estadoPublico();
  } catch {
    return 'oculto';
  }
}

// Como enModoPruebas, pero ante cualquier error responde "sí" (lado seguro:
// ocultar). Para las páginas que no pueden permitirse tronar por esto.
async function enModoPruebasSeguro() {
  try {
    return await enModoPruebas();
  } catch {
    return true;
  }
}

function leerCookie(req, nombre) {
  for (const parte of String(req.headers.cookie ?? '').split(';')) {
    const [clave, ...valor] = parte.trim().split('=');
    if (clave === nombre) return decodeURIComponent(valor.join('='));
  }
  return null;
}

// ¿La petición trae una sesión válida del panel? (admin u operador; también
// la credencial provisional de entorno mientras siga habilitada).
async function sesionDePanel(req) {
  const datos = usuarios.verificarSesion(leerCookie(req, COOKIE_SESION));
  if (!datos) return false;
  if (datos.u === 'entorno') {
    if (!process.env.ADMIN_USUARIO) return false;
    return !(configurada() && await usuarios.hayAdministradorActivo());
  }
  if (!configurada()) return false;
  return Boolean(await usuarios.obtenerUsuarioActivo(datos.u));
}

// Franja superior en ámbar, pegada arriba al hacer scroll (sticky: nunca
// tapa contenido, ni en viewports angostos). Estilos en línea para poder
// inyectarla en cualquier página (públicas y estáticas) sin depender de su CSS.
function franjaHTML(texto = 'MODO PRUEBAS — SIN VALIDEZ') {
  return '<div style="position:sticky;top:0;z-index:1000;background:#F5C518;color:#1E2124;' +
    'text-align:center;font-weight:700;padding:9px 14px;font-size:14px;letter-spacing:.06em;' +
    `font-family:Arial,sans-serif">${texto}</div>`;
}

// Banda de la landing en modo exhibición (ORDEN 12).
function franjaExhibicionHTML() {
  return franjaHTML('DEMOSTRACIÓN — SIN VALIDEZ');
}

module.exports = {
  enModoPruebas,
  enModoPruebasSeguro,
  estadoPublico,
  estadoPublicoSeguro,
  sesionDePanel,
  franjaHTML,
  franjaExhibicionHTML,
};
