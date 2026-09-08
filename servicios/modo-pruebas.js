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

// Franja superior en ámbar. Estilos en línea para poder inyectarla en
// cualquier página (públicas y estáticas) sin depender de su CSS.
function franjaHTML() {
  return '<div style="background:#F5C518;color:#1E2124;text-align:center;' +
    'font-weight:700;padding:9px 14px;font-size:14px;letter-spacing:.06em">' +
    'MODO PRUEBAS — SIN VALIDEZ</div>';
}

module.exports = { enModoPruebas, enModoPruebasSeguro, sesionDePanel, franjaHTML };
